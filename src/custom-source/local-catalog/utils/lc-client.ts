// Local-catalog read client for the custom-source.
//
// Owns the catalog source (remote URL or inline preference), TTL caching, and
// normalization of CatalogEntry → $app.AL_BaseManga. The Provider (code.ts) is
// a thin delegate. `fetch` and `$getUserPreference` are injected so the client
// is unit-testable without the goja globals.
//
// `parseCatalog` is shared with the local-catalog-manager plugin (it parses the
// same catalog.json wire format) — see src/_utils/local-catalog/parse.ts.

import { parseCatalog } from "../../../_utils/local-catalog/parse";
import { createLogger } from "../../../_utils/logger";

const log = createLogger();

function coerceTitle(title: string | CatalogTitle): $app.AL_BaseManga_Title {
  if (typeof title === "string") {
    return { english: title, userPreferred: title };
  }
  const userPreferred =
    title.userPreferred || title.english || title.romaji || title.native;
  return { ...title, userPreferred };
}

export function normalizeEntry(entry: CatalogEntry): $app.AL_BaseManga {
  const cover = entry.cover;
  return {
    id: entry.id,
    type: "MANGA",
    siteUrl: entry.siteUrl,
    title: coerceTitle(entry.title),
    synonyms:
      entry.synonyms && entry.synonyms.length > 0 ? entry.synonyms : undefined,
    coverImage: cover
      ? { extraLarge: cover, large: cover, medium: cover }
      : undefined,
    bannerImage: entry.banner,
    description: entry.description,
    genres: entry.genres && entry.genres.length > 0 ? entry.genres : undefined,
    status: entry.status,
    format: entry.format,
    chapters: entry.chapters,
    volumes: entry.volumes,
    isAdult: entry.isAdult,
    countryOfOrigin: entry.country,
    // Forward whichever date parts the catalog has — matches the
    // AL_BaseManga_StartDate (FuzzyDate) shape. Note: seanime's manga entry
    // header formats this via Intl.DateTimeFormat and defaults a missing
    // month to January, so passing only `year` shows "Jan YYYY". Set month
    // (and day) in the catalog when you know them to get the right label.
    startDate:
      typeof entry.year === "number" ||
      typeof entry.month === "number" ||
      typeof entry.day === "number"
        ? {
            year: typeof entry.year === "number" ? entry.year : undefined,
            month: typeof entry.month === "number" ? entry.month : undefined,
            day: typeof entry.day === "number" ? entry.day : undefined,
          }
        : undefined,
  };
}

function matchesSearch(entry: CatalogEntry, q: string): boolean {
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
  entries: CatalogEntry[],
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
  private cache: CatalogEntry[] | null = null;
  private cacheAt = 0;

  constructor(
    fetchFn: typeof fetch,
    getPref: (name: string) => string | undefined,
  ) {
    this.fetchFn = fetchFn;
    this.getPref = getPref;
  }

  async loadCatalog(): Promise<CatalogEntry[]> {
    const ttlMin = Number(this.getPref("cacheMinutes") ?? "10");
    const ttlMs = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin * 60000 : 0;
    const now = Date.now();
    if (this.cache && ttlMs > 0 && now - this.cacheAt < ttlMs) {
      return this.cache;
    }
    try {
      const raw = await this.fetchRaw();
      const parsed = parseCatalog(raw, log);
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
    return { manga: [] } as Catalog;
  }
}
