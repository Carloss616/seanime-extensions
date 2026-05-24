var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class Provider {
  constructor() {
    __publicField(this, "api", "https://api.mangaupdates.com/v1");
  }
  getSettings() {
    return { supportsAnime: false, supportsManga: true };
  }
  async listManga(search, page, perPage) {
    const res = await fetch(`${this.api}/series/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ search, page, perpage: perPage })
    });
    if (!res.ok) {
      return { media: [], page, totalPages: 0, total: 0 };
    }
    const data = await res.json();
    const results = data.results || [];
    const per = data.per_page || perPage;
    return {
      media: results.map((r) => toBaseManga(r.record)),
      page: data.page || page,
      totalPages: per > 0 ? Math.ceil((data.total_hits || 0) / per) : 0,
      total: data.total_hits || 0
    };
  }
  async getManga(ids) {
    const records = await Promise.all(
      (ids || []).map((id) => this.fetchSeries(id))
    );
    return records.filter((r) => r !== null).map(toBaseManga);
  }
  async getMangaDetails(id) {
    const record = await this.fetchSeries(id);
    if (!record) return null;
    return {
      id: record.series_id,
      siteUrl: record.url,
      genres: (record.genres || []).map((g) => g.genre)
    };
  }
  // Anime stubs: required by the abstract CustomSource shape. Seanime does
  // not gate calls on `supportsAnime`, so these are reachable in practice.
  async getAnime(_ids) {
    return [];
  }
  async getAnimeMetadata(_id) {
    return null;
  }
  async getAnimeWithRelations(_id) {
    throw new Error("mangaupdates: anime not supported");
  }
  async getAnimeDetails(_id) {
    return null;
  }
  async listAnime(_search, _page, _perPage) {
    return { media: [], page: 1, totalPages: 0, total: 0 };
  }
  async fetchSeries(id) {
    try {
      const res = await fetch(`${this.api}/series/${id}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }
}
function toBaseManga(record) {
  var _a, _b, _c, _d, _e, _f;
  const title = record.title || "???";
  const year = record.year ? parseInt(record.year, 10) : NaN;
  const synonyms = (record.associated || []).map((a) => a.title).filter((t) => typeof t === "string" && t.length > 0);
  const coverOriginal = (_b = (_a = record.image) == null ? void 0 : _a.url) == null ? void 0 : _b.original;
  const coverThumb = (_d = (_c = record.image) == null ? void 0 : _c.url) == null ? void 0 : _d.thumb;
  const hasCover = !!(coverOriginal || coverThumb);
  const rating = typeof record.bayesian_rating === "number" && ((_e = record.rating_votes) != null ? _e : 0) > 0 ? Math.round(record.bayesian_rating * 10) : void 0;
  return {
    id: record.series_id,
    siteUrl: record.url,
    type: "MANGA",
    format: mapFormat(record.type),
    description: (_f = record.description) != null ? _f : void 0,
    genres: (record.genres || []).map((g) => g.genre),
    synonyms: synonyms.length > 0 ? synonyms : void 0,
    meanScore: rating,
    title: { english: title, userPreferred: title },
    coverImage: hasCover ? {
      extraLarge: coverOriginal || coverThumb,
      large: coverOriginal || coverThumb,
      medium: coverThumb || coverOriginal
    } : void 0,
    startDate: !isNaN(year) ? { year } : void 0
  };
}
function mapFormat(type) {
  switch ((type || "").toLowerCase()) {
    case "":
      return void 0;
    case "novel":
    case "artbook":
      return "NOVEL";
    default:
      return "MANGA";
  }
}
