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
function parseCatalog(raw) {
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
      console.warn("local-catalog: skipping entry with invalid id");
      continue;
    }
    if (!resolveUserPreferred(entry?.title)) {
      console.warn(`local-catalog: skipping entry ${id} with no title`);
      continue;
    }
    if (byId.has(id)) {
      console.warn(`local-catalog: duplicate id ${id}, last wins`);
    }
    entry.id = id;
    byId.set(id, entry);
  }
  return Array.from(byId.values());
}

// src/custom-source/local-catalog/code.ts
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

class Provider {
  cache = null;
  cacheAt = 0;
  getSettings() {
    return { supportsAnime: false, supportsManga: true };
  }
  async listManga(search, page, perPage) {
    const entries = await this.loadCatalog();
    return searchAndPaginate(entries, search, page, perPage);
  }
  async getManga(ids) {
    const entries = await this.loadCatalog();
    const wanted = new Set(ids || []);
    return entries.filter((e) => wanted.has(e.id)).map(normalizeEntry);
  }
  async getMangaDetails(id) {
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
  async getAnime(_ids) {
    return [];
  }
  async getAnimeMetadata(_id) {
    return null;
  }
  async getAnimeWithRelations(_id) {
    throw new Error("local-catalog: anime not supported");
  }
  async getAnimeDetails(_id) {
    return null;
  }
  async listAnime(_search, _page, _perPage) {
    return { media: [], page: 1, totalPages: 0, total: 0 };
  }
  async loadCatalog() {
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
  async fetchRaw() {
    const url = ($getUserPreference("catalogUrl") || "").trim();
    if (url) {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`catalog fetch failed: ${res.status}`);
      }
      return await res.json();
    }
    const inline = ($getUserPreference("catalog") || "").trim();
    if (inline) {
      return JSON.parse(inline);
    }
    return { manga: [] };
  }
}
