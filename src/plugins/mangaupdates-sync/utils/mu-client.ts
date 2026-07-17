import { createLogger } from "../../../_utils/logger";
import { MUClientBase } from "../../../_utils/mangaupdates/client";
import { muRecordUrl, muRecordYear } from "../../../_utils/mangaupdates/record";

const log = createLogger();

export function toBaseResult(record: $mu.Search.Record): MUResult {
  const cover = record.image?.url || {};
  return {
    id: String(record.series_id),
    title: record.title || "???",
    year: muRecordYear(record),
    cover: cover.thumb || cover.original,
    url: muRecordUrl(record),
  };
}

import type { MUResult } from "./types";

export type { MUResult } from "./types";

export class MUClient extends MUClientBase {
  private declare tokenKey: string;
  private declare statusList: Record<string, number>;

  // fetchFn indirection lets the same class work in either runtime: pass
  // `ctx.fetch.bind(ctx)` from UI scope, or the plain `fetch` global from hook scope.
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

  // No login required — attaches the stored session token only if present (it
  // slightly enriches results but isn't mandatory).
  async search(query: string, page = 1, perpage = 10): Promise<MUResult[]> {
    const token = await this.ensureToken();
    const data = await this._search(query, { page, perPage: perpage, token });
    return data?.results.map((r) => toBaseResult(r.record)) || [];
  }

  async login(username: string, password: string): Promise<string> {
    const data = await this.req<$mu.Login.Response>("PUT", "/account/login", {
      body: { username, password },
    });
    const token = data?.context?.session_token;
    if (!token) throw new Error("MU login: response missing session token");
    return token;
  }

  // `refresh=true` forces a fresh login, bypassing the cache — used by `req`'s
  // onRefreshToken to recover from an expired token.
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

  // Falls through to `/lists/series` (add) when the series isn't on the user's
  // list yet — MU's update endpoint only mutates existing entries.
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

  // Rating (0-10) is derived from AniList's 0-100 scoreRaw. Score lives behind a
  // separate endpoint — `/lists/series/update` silently drops any `rating` field.
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
