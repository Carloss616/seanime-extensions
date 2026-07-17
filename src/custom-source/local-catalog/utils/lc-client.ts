// Local-catalog read client for the custom-source. `fetch` and
// `$getUserPreference` are injected so the client is unit-testable without the
// goja globals.
//
// `parseCatalog` is shared with the local-catalog-manager plugin (same
// catalog.json wire format) — see src/_utils/local-catalog/catalog.ts.

import {
  coerceTitle,
  parseCatalog,
} from "../../../_utils/local-catalog/catalog";
import { createLogger } from "../../../_utils/logger";

const log = createLogger();

export function normalizeEntry(entry: MangaCatalogEntry): $app.AL_BaseManga {
  // Strip the per-record merge-metadata — it is not part of AL_BaseManga.
  const { updatedAt, ...al } = entry;
  void updatedAt;
  return { ...al, type: al.type ?? "MANGA", title: coerceTitle(al.title) };
}

function matchesSearch(entry: MangaCatalogEntry, q: string): boolean {
  const t = coerceTitle(entry.title);
  const haystack = [
    t.english,
    t.romaji,
    t.native,
    t.userPreferred,
    ...(entry.synonyms || []),
  ]
    .filter((s): s is string => typeof s === "string")
    .join("\n")
    .toLowerCase();
  return haystack.includes(q);
}

export function searchAndPaginate(
  entries: MangaCatalogEntry[],
  search: string,
  page: number,
  perPage: number,
): ListResponse<$app.AL_BaseManga> {
  const q = (search || "").trim().toLowerCase();
  const filtered = q ? entries.filter((e) => matchesSearch(e, q)) : entries;
  const safePage = page > 0 ? page : 1;
  const safePerPage = perPage > 0 ? perPage : filtered.length || 1;
  const start = (safePage - 1) * safePerPage;
  const slice = filtered.slice(start, start + safePerPage);
  return {
    media: slice.map(normalizeEntry),
    page: safePage,
    total: filtered.length,
    totalPages: Math.ceil(filtered.length / safePerPage),
  };
}

export class LCClient {
  private declare fetchFn: typeof fetch;
  private declare getPref: (name: string) => string | undefined;
  private cache: MangaCatalogEntry[] | null = null;
  private cacheAt = 0;

  constructor(
    fetchFn: typeof fetch,
    getPref: (name: string) => string | undefined,
  ) {
    this.fetchFn = fetchFn;
    this.getPref = getPref;
  }

  async loadCatalog(): Promise<MangaCatalogEntry[]> {
    const ttlMin = Number(this.getPref("cacheMinutes") ?? "10");
    const ttlMs = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin * 60000 : 0;
    const now = Date.now();
    if (this.cache && ttlMs > 0 && now - this.cacheAt < ttlMs) {
      return this.cache;
    }
    try {
      const raw = await this.fetchRaw();
      const parsed = parseCatalog(raw, log).manga;
      this.cache = parsed;
      this.cacheAt = now;
      return parsed;
    } catch (e) {
      log.error("failed to load catalog", e);
      return this.cache ?? [];
    }
  }

  private async fetchRaw(): Promise<unknown> {
    const url = (this.getPref("catalogUrl") || "").trim();
    if (url) {
      // Fetched verbatim — a revision-pinned gist URL serves a stale snapshot.
      // The manager's new-entry alert tells the user to use the unversioned URL.
      const res = await this.fetchFn(url);
      if (!res.ok) {
        throw new Error(`catalog fetch failed: ${res.status}`);
      }
      return res.json();
    }
    const inline = (this.getPref("catalog") || "").trim();
    if (inline) {
      return JSON.parse(inline);
    }
    return { manga: [], anime: [] } as LocalCatalog;
  }
}
