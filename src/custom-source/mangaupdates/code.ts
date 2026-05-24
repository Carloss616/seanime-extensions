/// <reference path="../../../types/core.d.ts" />
/// <reference path="../../../types/custom-source.d.ts" />
/// <reference path="../../../types/mu-api.d.ts" />

class Provider implements CustomSource {
    private readonly api = "https://api.mangaupdates.com/v1"

    getSettings(): Settings {
        return { supportsAnime: false, supportsManga: true }
    }

    async listManga(
        search: string,
        page: number,
        perPage: number,
    ): Promise<ListResponse<$app.AL_BaseManga>> {
        const res = await fetch(`${this.api}/series/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ search, page, perpage: perPage }),
        })
        if (!res.ok) {
            return { media: [], page, totalPages: 0, total: 0 }
        }
        const data = (await res.json()) as MUSearchResponse
        const results = data.results || []
        const per = data.per_page || perPage
        return {
            media: results.map((r) => toBaseManga(r.record)),
            page: data.page || page,
            totalPages: per > 0 ? Math.ceil((data.total_hits || 0) / per) : 0,
            total: data.total_hits || 0,
        }
    }

    async getManga(ids: number[]): Promise<$app.AL_BaseManga[]> {
        const records = await Promise.all(
            (ids || []).map((id) => this.fetchSeries(id)),
        )
        return records
            .filter((r): r is MUSeriesRecord => r !== null)
            .map(toBaseManga)
    }

    async getMangaDetails(
        id: number,
    ): Promise<$app.AL_MangaDetailsById_Media | null> {
        const record = await this.fetchSeries(id)
        if (!record) return null
        return {
            id: record.series_id,
            siteUrl: record.url,
            genres: (record.genres || []).map((g) => g.genre),
        }
    }

    // Anime stubs: required by the abstract CustomSource shape. Seanime does
    // not gate calls on `supportsAnime`, so these are reachable in practice.
    async getAnime(_ids: number[]): Promise<$app.AL_BaseAnime[]> {
        return []
    }
    async getAnimeMetadata(
        _id: number,
    ): Promise<$app.Metadata_AnimeMetadata | null> {
        return null
    }
    async getAnimeWithRelations(_id: number): Promise<$app.AL_CompleteAnime> {
        // Throw so goja produces a clean promise rejection. Returning null
        // here nil-derefs inside seanime's GojaCustomSource.GetAnimeWithRelations.
        throw new Error("mangaupdates: anime not supported")
    }
    async getAnimeDetails(
        _id: number,
    ): Promise<$app.AL_AnimeDetailsById_Media | null> {
        return null
    }
    async listAnime(
        _search: string,
        _page: number,
        _perPage: number,
    ): Promise<ListResponse<$app.AL_BaseAnime>> {
        return { media: [], page: 1, totalPages: 0, total: 0 }
    }

    private async fetchSeries(id: number): Promise<MUSeriesRecord | null> {
        try {
            const res = await fetch(`${this.api}/series/${id}`)
            if (!res.ok) return null
            return (await res.json()) as MUSeriesRecord
        } catch {
            return null
        }
    }
}

function toBaseManga(record: MUSeriesRecord): $app.AL_BaseManga {
    const title = record.title || "???"
    const year = record.year ? parseInt(record.year, 10) : NaN
    const synonyms = (record.associated || [])
        .map((a) => a.title)
        .filter((t): t is string => typeof t === "string" && t.length > 0)
    const coverOriginal = record.image?.url?.original
    const coverThumb = record.image?.url?.thumb
    const hasCover = !!(coverOriginal || coverThumb)
    const rating =
        typeof record.bayesian_rating === "number" &&
        (record.rating_votes ?? 0) > 0
            ? Math.round(record.bayesian_rating * 10)
            : undefined
    return {
        id: record.series_id,
        siteUrl: record.url,
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
        startDate: !isNaN(year) ? { year } : undefined,
    }
}

function mapFormat(type?: string): $app.AL_MediaFormat | undefined {
    switch ((type || "").toLowerCase()) {
        case "":
            return undefined
        case "novel":
        case "artbook":
            return "NOVEL"
        default:
            return "MANGA"
    }
}

