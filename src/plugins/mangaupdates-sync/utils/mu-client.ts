// MangaUpdates v1 REST client.
//
// Imported by the isolated callback modules under `modules/` (e.g.
// on-post-update-entry.ts, register.ts). The build (scripts/build.ts) bundles
// each module standalone, so this class is inlined into each module bundle, and
// then the module bundle is wrapped as a self-contained callback body — landing
// MUClient physically inside every goja-isolated callback that needs it. See
// CLAUDE.md "Splitting an extension across multiple files".

type MUFetcher = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

class MUTokenExpiredError extends Error {
  constructor() {
    super("MU session expired");
    this.name = "MUTokenExpiredError";
  }
}

export class MUClient {
  // `declare` makes these fields TYPE-ONLY (zero runtime emit). Defensive:
  // some transpiler targets lower bare field declarations to `__publicField`
  // helper calls that live at bundle module scope — unreachable from inside an
  // isolated-runtime callback body, throwing `ReferenceError: __publicField is
  // not defined`. Assigning in the constructor (below) keeps the emit clean
  // regardless of target.
  private declare base: string;
  private declare tokenKey: string;
  private declare statusList: Record<string, number>;
  private declare fetcher: MUFetcher;

  /**
   * @param fetcher  HTTP transport. Pass `ctx.fetch.bind(ctx)` from UI
   *                 scope, or the plain `fetch` global from hook scope.
   *                 Indirection lets the same class work in either runtime.
   */
  constructor(fetcher: MUFetcher) {
    this.base = "https://api.mangaupdates.com/v1";
    this.tokenKey = "mu_session_token";
    // Numeric ids of MU's built-in lists. `POST /v1/lists/series/update`
    // requires the numeric `list_id`, not the "reading"/"complete"/... string
    // keys returned by `GET /v1/series/{id}` under `rank.lists`. Verified by
    // visiting mangaupdates.com/lists/N for N=0..4. Custom user lists use
    // ids >= 100 and are out of scope here.
    this.statusList = {
      CURRENT: 0, // Reading
      PLANNING: 1, // Wish
      COMPLETED: 2, // Complete
      DROPPED: 3, // Unfinished
      PAUSED: 4, // On-Hold
      REPEATING: 0, // Reading (MU has no separate re-read list)
    };
    this.fetcher = fetcher;
  }

  async req<T = unknown>(
    token: string,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetcher(this.base + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new MUTokenExpiredError();
    if (!res.ok) {
      throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
    }
    if ((res.contentType || "").includes("application/json"))
      return res.json<T>();
    return null;
  }

  async login(username: string, password: string): Promise<string> {
    const res = await this.fetcher(`${this.base}/account/login`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      throw new Error(`MU login -> ${res.status} ${res.text()}`);
    }
    const data = res.json<{
      context?: { session_token?: string };
      session_token?: string;
      token?: string;
    }>();
    const token =
      data?.context?.session_token || data?.session_token || data?.token;
    if (!token) throw new Error("MU login: response missing session token");
    return token;
  }

  /** Returns a usable bearer token, performing a login (and storing the
   *  token in `$storage`) if no stored token is present or the stored one
   *  fails the cheap `/account/profile` probe with 401. */
  async ensureToken(): Promise<string> {
    let token = $storage.get<string>(this.tokenKey) || "";
    const username = $getUserPreference("username") || "";
    const password = $getUserPreference("password") || "";
    if (!token) {
      if (!username || !password) {
        throw new Error("Missing MangaUpdates credentials in plugin settings.");
      }
      token = await this.login(username, password);
      $storage.set(this.tokenKey, token);
      return token;
    }
    try {
      await this.req(token, "GET", "/account/profile");
      return token;
    } catch (err) {
      if (!(err instanceof MUTokenExpiredError)) throw err;
      if (!username || !password) {
        $storage.remove(this.tokenKey);
        throw new Error(
          "MangaUpdates session expired and no credentials to re-login.",
        );
      }
      token = await this.login(username, password);
      $storage.set(this.tokenKey, token);
      return token;
    }
  }

  /** Pushes status + chapter to MU. Falls through to `/lists/series` (add)
   *  when the series isn't on the user's list yet — MU's update endpoint
   *  only mutates existing entries. `payload.status` accepts AniList list
   *  status strings; the mapping to MU list ids is built-in. */
  async pushListEntry(
    token: string,
    seriesId: number,
    payload: {
      status?: $app.AL_MediaListStatus;
      progress?: number;
    },
  ): Promise<void> {
    const item: {
      series: { id: number };
      list_id?: number;
      status?: { chapter: number };
    } = { series: { id: seriesId } };
    if (payload.status != null) {
      const mapped = this.statusList[payload.status];
      item.list_id = mapped !== undefined ? mapped : this.statusList.CURRENT;
    }
    if (payload.progress !== undefined) {
      item.status = { chapter: payload.progress };
    }
    try {
      await this.req(token, "POST", "/lists/series/update", [item]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.indexOf("isn't on your list") >= 0) {
        await this.req(token, "POST", "/lists/series", [item]);
      } else {
        throw err;
      }
    }
  }

  /** Pushes a rating (0-10 scale, derived from AniList's 0-100 scoreRaw).
   *  Skipped silently when scoreRaw <= 0. Score lives behind a separate
   *  endpoint — `/lists/series/update` silently drops any `rating` field. */
  async pushRating(
    token: string,
    seriesId: number,
    scoreRaw: number,
  ): Promise<void> {
    if (scoreRaw <= 0) return;
    const rating = Math.min(10, Math.max(0, Math.round(scoreRaw) / 10));
    try {
      await this.req(token, "PUT", `/series/${seriesId}/rating`, { rating });
    } catch (err) {
      console.warn("[mangaupdates-sync] rating push failed:", err);
    }
  }
}
