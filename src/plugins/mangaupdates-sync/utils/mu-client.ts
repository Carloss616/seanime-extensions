// MangaUpdates v1 REST client.
//
// Imported by the isolated callback modules under `modules/` (e.g.
// on-post-update-entry.ts, register.ts). The build (scripts/build.ts) bundles
// each module standalone, so this class is inlined into each module bundle, and
// then the module bundle is wrapped as a self-contained callback body — landing
// MUClient physically inside every goja-isolated callback that needs it. See
// CLAUDE.md "Splitting an extension across multiple files".

class MUTokenExpiredError extends Error {
  constructor() {
    super("MU session expired");
    this.name = "MUTokenExpiredError";
  }
}

// A normalized MangaUpdates series — the shape the UI and the link store both
// consume. Produced by `MUClient.searchSeries` from the raw MUSearch.Response.
// `MULink` (utils/link-store.ts) extends this with `linkedAt`.
export interface MUResult {
  id: string;
  title: string;
  year?: number;
  cover?: string;
  url: string;
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
  private declare fetchFn: typeof fetch;

  /**
   * @param fetchFn  HTTP transport. Pass `ctx.fetch.bind(ctx)` from UI
   *                 scope, or the plain `fetch` global from hook scope.
   *                 Indirection lets the same class work in either runtime.
   */
  constructor(fetchFn: typeof fetch) {
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
    this.fetchFn = fetchFn;
  }

  async req<T = unknown>(
    method: string,
    path: string,
    options: {
      token?: string;
      body?: unknown;
    },
  ): Promise<T | null> {
    const attempt = "attempt" in options ? Number(options.attempt) : 1;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    if (options.body !== undefined)
      headers["Content-Type"] = "application/json";
    const res = await this.fetchFn(this.base + path, {
      method,
      headers,
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    if (res.status === 401) {
      if (attempt >= 2) throw new MUTokenExpiredError();
      const token = await this.ensureToken(true);
      const _options = { ...options, token, attempt: attempt + 1 };
      return this.req<T>(method, path, _options);
    }
    if (!res.ok) {
      throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
    }
    if ((res.contentType || "").includes("application/json"))
      return res.json<T>();
    return null;
  }

  /** Searches the public MangaUpdates series index and returns normalized
   *  results. No login required — attaches the stored session token only if
   *  one is present (it slightly enriches results but isn't mandatory). A
   *  query shorter than 2 chars short-circuits to an empty list. */
  async search(query: string, perpage = 10): Promise<MUResult[]> {
    const q = (query || "").trim();
    if (q.length < 2) return [];
    const token = $storage.get<string>(this.tokenKey);
    const data = await this.req<MUSearch.Response>("POST", "/series/search", {
      token,
      body: { search: q, perpage },
    });
    const out: MUResult[] = [];
    for (const r of data?.results || []) {
      const sid = r?.record?.series_id;
      if (!sid) continue;
      const rec = r.record;
      const year = rec.year ? parseInt(rec.year, 10) : undefined;
      out.push({
        id: String(sid),
        title: rec.title || "(untitled)",
        year: year != null && !Number.isNaN(year) ? year : undefined,
        cover: rec.image?.url
          ? rec.image.url.thumb || rec.image.url.original
          : undefined,
        url: rec.url || `https://www.mangaupdates.com/series.html?id=${sid}`,
      });
    }
    return out;
  }

  async login(username: string, password: string): Promise<string> {
    const res = await this.fetchFn(`${this.base}/account/login`, {
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
    const data = res.json<MULogin.Response>();
    const token = data?.context?.session_token;
    if (!token) throw new Error("MU login: response missing session token");
    return token;
  }

  /** Returns a usable bearer token, performing a login (and storing the
   *  token in `$storage`) if no stored token is present or the stored one
   *  fails the cheap `/account/profile` probe with 401. */
  private async ensureToken(refresh = false): Promise<string> {
    let token = refresh ? undefined : $storage.get<string>(this.tokenKey);
    const username = $getUserPreference("username");
    const password = $getUserPreference("password");
    if (!token) {
      if (!username || !password) {
        $storage.remove(this.tokenKey);
        throw new Error("Missing MangaUpdates credentials in plugin settings.");
      }
      token = await this.login(username, password);
      $storage.set(this.tokenKey, token);
      return token;
    }
    return token;
  }

  /** Pushes status + chapter to MU. Falls through to `/lists/series` (add)
   *  when the series isn't on the user's list yet — MU's update endpoint
   *  only mutates existing entries. `payload.status` accepts AniList list
   *  status strings; the mapping to MU list ids is built-in. */
  async pushListEntry(
    seriesId: number,
    payload: {
      status?: $app.AL_MediaListStatus;
      progress?: number;
    },
  ): Promise<void> {
    const token = await this.ensureToken();
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
      await this.req("POST", "/lists/series/update", { token, body: [item] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.indexOf("isn't on your list") >= 0) {
        await this.req("POST", "/lists/series", { token, body: [item] });
      } else {
        throw err;
      }
    }
  }

  /** Pushes a rating (0-10 scale, derived from AniList's 0-100 scoreRaw).
   *  Skipped silently when scoreRaw <= 0. Score lives behind a separate
   *  endpoint — `/lists/series/update` silently drops any `rating` field. */
  async pushRating(seriesId: number, scoreRaw: number): Promise<void> {
    if (scoreRaw <= 0) return;
    const token = await this.ensureToken();
    const rating = Math.min(10, Math.max(0, Math.round(scoreRaw) / 10));
    try {
      await this.req("PUT", `/series/${seriesId}/rating`, {
        token,
        body: { rating },
      });
    } catch (err) {
      console.warn("[mangaupdates-sync] rating push failed:", err);
    }
  }
}
