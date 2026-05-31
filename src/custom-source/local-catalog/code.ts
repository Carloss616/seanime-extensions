import { parseCatalog } from "../../_utils/local-catalog/parse";

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

export class Provider implements CustomSource {
  private cache: CatalogEntry[] | null = null;
  private cacheAt = 0;

  getSettings(): Settings {
    return { supportsAnime: false, supportsManga: true };
  }

  async listManga(
    search: string,
    page: number,
    perPage: number,
  ): Promise<ListResponse<$app.AL_BaseManga>> {
    const entries = await this.loadCatalog();
    return searchAndPaginate(entries, search, page, perPage);
  }

  async getManga(ids: number[]): Promise<$app.AL_BaseManga[]> {
    const entries = await this.loadCatalog();
    const wanted = new Set(ids || []);
    return entries.filter((e) => wanted.has(e.id)).map(normalizeEntry);
  }

  async getMangaDetails(
    id: number,
  ): Promise<$app.AL_MangaDetailsById_Media | null> {
    const entries = await this.loadCatalog();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    return {
      id: entry.id,
      siteUrl: entry.siteUrl,
      genres:
        entry.genres && entry.genres.length > 0 ? entry.genres : undefined,
    };
  }

  // Anime stubs: required by the abstract CustomSource shape. Seanime does
  // not gate calls on `supportsAnime`, so these are reachable in practice.
  async getAnime(_ids: number[]): Promise<$app.AL_BaseAnime[]> {
    return [];
  }
  async getAnimeMetadata(
    _id: number,
  ): Promise<$app.Metadata_AnimeMetadata | null> {
    return null;
  }
  async getAnimeWithRelations(_id: number): Promise<$app.AL_CompleteAnime> {
    throw new Error("local-catalog: anime not supported");
  }
  async getAnimeDetails(
    _id: number,
  ): Promise<$app.AL_AnimeDetailsById_Media | null> {
    return null;
  }
  async listAnime(
    _search: string,
    _page: number,
    _perPage: number,
  ): Promise<ListResponse<$app.AL_BaseAnime>> {
    return { media: [], page: 1, totalPages: 0, total: 0 };
  }

  private async loadCatalog(): Promise<CatalogEntry[]> {
    const ttlMin = Number($getUserPreference("cacheMinutes") ?? "10");
    const ttlMs = Number.isFinite(ttlMin) && ttlMin > 0 ? ttlMin * 60000 : 0;
    const now = Date.now();
    if (this.cache && ttlMs > 0 && now - this.cacheAt < ttlMs) {
      return this.cache;
    }
    try {
      const raw = await this.fetchRaw();
      const parsed = parseCatalog(raw);
      this.cache = parsed;
      this.cacheAt = now;
      return parsed;
    } catch (e) {
      console.error("local-catalog: failed to load catalog", e);
      return this.cache ?? [];
    }
  }

  private async fetchRaw(): Promise<unknown> {
    const url = ($getUserPreference("catalogUrl") || "").trim();
    if (url) {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`catalog fetch failed: ${res.status}`);
      }
      return res.json();
    }
    const inline = ($getUserPreference("catalog") || "").trim();
    if (inline) {
      return JSON.parse(inline);
    }
    return { manga: [] } as Catalog;
  }
}
