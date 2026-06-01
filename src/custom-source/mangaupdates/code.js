// src/_utils/mangaupdates/client.ts
class MUTokenExpiredError extends Error {
  constructor() {
    super("MU session expired");
    this.name = "MUTokenExpiredError";
  }
}

class MUClientBase {
  constructor() {
    this.baseUrl = "https://api.mangaupdates.com/v1";
  }
  async _req(method, path, options = {}) {
    const {
      body,
      token,
      onRefreshToken,
      maxRefreshTokenAttempts = 2,
    } = options;
    const attempt = "attempt" in options ? Number(options.attempt) : 1;
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.fetchFn(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      if (!onRefreshToken || attempt >= maxRefreshTokenAttempts)
        throw new MUTokenExpiredError();
      const token2 = await onRefreshToken();
      const _options = { ...options, token: token2, attempt: attempt + 1 };
      return this._req(method, path, _options);
    }
    if (!res.ok) {
      throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
    }
    if ((res.contentType || "").includes("application/json")) return res.json();
    return null;
  }
  async _search(query, options) {
    const { page, perPage, token } = options || {};
    return this._req("POST", "/series/search", {
      body: { search: query, page, perpage: perPage },
      token,
    });
  }
}

// src/_utils/mangaupdates/record.ts
function muRecordYear(record) {
  const year = record.year ? parseInt(record.year, 10) : undefined;
  return Number.isNaN(year) ? undefined : year;
}
function muRecordUrl(record) {
  return (
    record.url ||
    `https://www.mangaupdates.com/series.html?id=${record.series_id}`
  );
}

// src/custom-source/mangaupdates/utils/mu-client.ts
function mapFormat(type) {
  switch ((type || "").toLowerCase()) {
    case "":
      return;
    case "novel":
    case "artbook":
      return "NOVEL";
    default:
      return "MANGA";
  }
}
function toBaseManga(record) {
  const title = record.title || "???";
  const year = muRecordYear(record);
  const synonyms = ("associated" in record ? record.associated : [])
    .map((a) => a.title)
    .filter((t) => typeof t === "string" && t.length > 0);
  const { original: coverOriginal, thumb: coverThumb } =
    record.image?.url || {};
  const hasCover = !!(coverOriginal || coverThumb);
  const rating =
    typeof record.bayesian_rating === "number" && (record.rating_votes ?? 0) > 0
      ? Math.round(record.bayesian_rating * 10)
      : undefined;
  return {
    id: record.series_id,
    siteUrl: muRecordUrl(record),
    type: "MANGA",
    format: mapFormat(record.type),
    description: record.description ?? undefined,
    genres: (record.genres || []).map((g) => g.genre),
    synonyms: synonyms.length > 0 ? synonyms : undefined,
    meanScore: rating,
    title: { english: title, userPreferred: title },
    coverImage: hasCover
      ? {
          extraLarge: coverOriginal || coverThumb,
          large: coverOriginal || coverThumb,
          medium: coverThumb || coverOriginal,
        }
      : undefined,
    startDate: year !== undefined ? { year } : undefined,
  };
}

class MUClient extends MUClientBase {
  constructor(fetchFn) {
    super();
    this.fetchFn = fetchFn;
  }
  async req(method, path, options = {}) {
    return this._req(method, path, {
      body: options?.body,
    });
  }
  async search(query, page, perPage) {
    const data = await this._search(query, {
      page,
      perPage,
    }).catch(() => null);
    const results = data?.results || [];
    const per = data?.per_page || perPage;
    return {
      media: results.map((r) => toBaseManga(r.record)),
      page: data?.page || page,
      totalPages: per > 0 ? Math.ceil((data?.total_hits || 0) / per) : 0,
      total: data?.total_hits || 0,
    };
  }
  async getManga(ids) {
    const records = await Promise.all(
      (ids || []).map((id) => this.getSeries(id)),
    );
    return records.filter((r) => r !== null).map(toBaseManga);
  }
  async getMangaDetails(id) {
    const record = await this.getSeries(id);
    if (!record) return null;
    return {
      id: record.series_id,
      siteUrl: record.url,
      genres: (record.genres || []).map((g) => g.genre),
    };
  }
  async getSeries(id) {
    return this.req("GET", `/series/${id}`).catch(() => null);
  }
}

// src/custom-source/mangaupdates/code.ts
class Provider {
  client = new MUClient(fetch);
  getSettings() {
    return { supportsAnime: false, supportsManga: true };
  }
  async listManga(search, page, perPage) {
    return this.client.search(search, page, perPage);
  }
  async getManga(ids) {
    return this.client.getManga(ids);
  }
  async getMangaDetails(id) {
    return this.client.getMangaDetails(id);
  }
  async getAnime(_ids) {
    return [];
  }
  async getAnimeMetadata(_id) {
    return null;
  }
  async getAnimeWithRelations(_id) {
    const id = "mangaupdates";
    throw new Error(`[${id}]: anime not supported`);
  }
  async getAnimeDetails(_id) {
    return null;
  }
  async listAnime(_search, _page, _perPage) {
    return { media: [], page: 1, totalPages: 0, total: 0 };
  }
}
