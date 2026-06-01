// MangaUpdates v1 REST client. Inlined into every goja-isolated callback that
// needs it (via the modules/ self-containerization, or once through $shared).
// See CLAUDE.md "Splitting an extension across multiple files".

import { createLogger } from "../../../_utils/logger";
import { MUClientBase } from "../../../_utils/mangaupdates/client";
import { muRecordUrl, muRecordYear } from "../../../_utils/mangaupdates/record";

const log = createLogger();

export function toBaseResult(record: MUSearch.Record): MUResult {
  const cover = record.image?.url || {};
  return {
    id: String(record.series_id),
    title: record.title || "???",
    year: muRecordYear(record),
    cover: cover.thumb || cover.original,
    url: muRecordUrl(record),
  };
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

export class MUClient extends MUClientBase {
  private declare tokenKey: string;
  private declare statusList: Record<string, number>;

  /**
   * @param fetchFn  HTTP transport. Pass `ctx.fetch.bind(ctx)` from UI
   *                 scope, or the plain `fetch` global from hook scope.
   *                 Indirection lets the same class work in either runtime.
   */
  constructor(fetchFn: typeof fetch) {
    super();
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
    } = {},
  ): Promise<T | null> {
    return this._req<T>(method, path, {
      token: options.token,
      body: options.body,
      onRefreshToken: () => this.ensureToken(true),
    });
  }

  /** Searches the public MangaUpdates series index and returns normalized
   *  results. No login required — attaches the stored session token only if
   *  one is present (it slightly enriches results but isn't mandatory). A
   *  query shorter than 2 chars short-circuits to an empty list. */
  async search(query: string, page = 1, perpage = 10): Promise<MUResult[]> {
    const token = await this.ensureToken();
    const data = await this._search(query, { page, perPage: perpage, token });
    return data?.results.map((r) => toBaseResult(r.record)) || [];
  }

  async login(username: string, password: string): Promise<string> {
    const data = await this.req<MULogin.Response>("PUT", "/account/login", {
      body: { username, password },
    });
    const token = data?.context?.session_token;
    if (!token) throw new Error("MU login: response missing session token");
    return token;
  }

  /** Returns a usable bearer token. Logs in (caching the token in `$storage`)
   *  when none is stored; `refresh=true` forces a fresh login, bypassing the
   *  cache (used by `req`'s onRefreshToken to recover from an expired token). */
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
      log.warn("rating push failed:", err);
    }
  }
}
