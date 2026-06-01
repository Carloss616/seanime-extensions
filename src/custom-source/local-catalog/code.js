// src/_utils/local-catalog/parse.ts
function resolveUserPreferred(title) {
  if (typeof title === "string") {
    return title.trim() || undefined;
  }
  if (title && typeof title === "object") {
    const t = title;
    const v = t.userPreferred || t.english || t.romaji || t.native;
    return v?.trim() || undefined;
  }
  return;
}
function parseCatalog(raw, log) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  let list = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === "object" && Array.isArray(data.manga)) {
    list = data.manga;
  }
  const byId = new Map();
  for (const item of list) {
    const entry = item;
    const id = Number(entry?.id);
    if (!Number.isInteger(id) || id < 1) {
      log.warn("skipping entry with invalid id");
      continue;
    }
    if (!resolveUserPreferred(entry?.title)) {
      log.warn(`skipping entry ${id} with no title`);
      continue;
    }
    if (byId.has(id)) {
      log.warn(`duplicate id ${id}, last wins`);
    }
    entry.id = id;
    byId.set(id, entry);
  }
  return Array.from(byId.values());
}

// src/_utils/logger.ts
function createLogger() {
  const prefix = `[${"local-catalog"}]`;
  return {
    log: (...args) => console.log(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args),
  };
}

// src/custom-source/local-catalog/utils/lc-client.ts
var log = createLogger();
function coerceTitle(title) {
  if (typeof title === "string") {
    return { english: title, userPreferred: title };
  }
  const userPreferred =
    title.userPreferred || title.english || title.romaji || title.native;
  return { ...title, userPreferred };
}
function normalizeEntry(entry) {
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
function matchesSearch(entry, q) {
  const t = coerceTitle(entry.title);
  const haystack = [
    t.english,
    t.romaji,
    t.native,
    t.userPreferred,
    ...(entry.synonyms || []),
  ]
    .filter((s) => typeof s === "string")
    .join(`
`)
    .toLowerCase();
  return haystack.includes(q);
}
function searchAndPaginate(entries, search, page, perPage) {
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

class LCClient {
  cache = null;
  cacheAt = 0;
  constructor(fetchFn, getPref) {
    this.fetchFn = fetchFn;
    this.getPref = getPref;
  }
  async loadCatalog() {
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
  async fetchRaw() {
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
    return { manga: [] };
  }
}

// src/custom-source/local-catalog/code.ts
class Provider {
  client = new LCClient(fetch, $getUserPreference);
  getSettings() {
    return { supportsAnime: false, supportsManga: true };
  }
  async listManga(search, page, perPage) {
    const entries = await this.client.loadCatalog();
    return searchAndPaginate(entries, search, page, perPage);
  }
  async getManga(ids) {
    const entries = await this.client.loadCatalog();
    const wanted = new Set(ids || []);
    return entries.filter((e) => wanted.has(e.id)).map(normalizeEntry);
  }
  async getMangaDetails(id) {
    const entries = await this.client.loadCatalog();
    const entry = entries.find((e) => e.id === id);
    if (!entry) return null;
    return {
      id: entry.id,
      siteUrl: entry.siteUrl,
      genres:
        entry.genres && entry.genres.length > 0 ? entry.genres : undefined,
    };
  }
  async getAnime(_ids) {
    return [];
  }
  async getAnimeMetadata(_id) {
    return null;
  }
  async getAnimeWithRelations(_id) {
    const id = "local-catalog";
    throw new Error(`[${id}]: anime not supported`);
  }
  async getAnimeDetails(_id) {
    return null;
  }
  async listAnime(_search, _page, _perPage) {
    return { media: [], page: 1, totalPages: 0, total: 0 };
  }
}
