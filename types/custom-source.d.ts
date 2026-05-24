declare namespace $app {
    type AL_MediaFormat =
        | "TV"
        | "TV_SHORT"
        | "MOVIE"
        | "SPECIAL"
        | "OVA"
        | "ONA"
        | "MUSIC"
        | "MANGA"
        | "NOVEL"
        | "ONE_SHOT"

    type AL_MediaType = "ANIME" | "MANGA"
    type AL_MediaStatus =
        | "FINISHED"
        | "RELEASING"
        | "NOT_YET_RELEASED"
        | "CANCELLED"
        | "HIATUS"
    type AL_MediaSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL"

    interface AL_BaseManga_Title {
        english?: string
        native?: string
        romaji?: string
        userPreferred?: string
    }
    interface AL_BaseManga_CoverImage {
        color?: string
        extraLarge?: string
        large?: string
        medium?: string
    }
    interface AL_BaseManga_StartDate {
        day?: number
        month?: number
        year?: number
    }
    interface AL_BaseManga_EndDate {
        day?: number
        month?: number
        year?: number
    }

    interface AL_BaseManga {
        id: number
        idMal?: number
        siteUrl?: string
        status?: AL_MediaStatus
        season?: AL_MediaSeason
        type?: AL_MediaType
        format?: AL_MediaFormat
        bannerImage?: string
        chapters?: number
        volumes?: number
        synonyms?: Array<string>
        isAdult?: boolean
        countryOfOrigin?: string
        meanScore?: number
        description?: string
        genres?: Array<string>
        title?: AL_BaseManga_Title
        coverImage?: AL_BaseManga_CoverImage
        startDate?: AL_BaseManga_StartDate
        endDate?: AL_BaseManga_EndDate
    }

    interface AL_MangaDetailsById_Media {
        id: number
        siteUrl?: string
        genres?: Array<string>
        duration?: number
        characters?: unknown
        rankings?: unknown
        recommendations?: unknown
        relations?: unknown
    }

    // Stubs for anime types — required to satisfy CustomSource shape even when
    // supportsAnime=false. Treat as opaque; do not rely on field-level typing.
    interface AL_BaseAnime {
        id: number
        [k: string]: unknown
    }
    interface AL_CompleteAnime {
        id: number
        [k: string]: unknown
    }
    interface AL_AnimeDetailsById_Media {
        id: number
        [k: string]: unknown
    }
    interface Metadata_AnimeMetadata {
        [k: string]: unknown
    }
}

type Settings = {
    supportsAnime: boolean
    supportsManga: boolean
}

type ListResponse<T extends $app.AL_BaseAnime | $app.AL_BaseManga> = {
    media: T[]
    page: number
    totalPages: number
    total: number
}

declare abstract class CustomSource {
    getSettings(): Settings
    getAnime(ids: number[]): Promise<$app.AL_BaseAnime[]>
    getAnimeMetadata(id: number): Promise<$app.Metadata_AnimeMetadata | null>
    getAnimeWithRelations(id: number): Promise<$app.AL_CompleteAnime>
    getAnimeDetails(id: number): Promise<$app.AL_AnimeDetailsById_Media | null>
    getManga(ids: number[]): Promise<$app.AL_BaseManga[]>
    listAnime(
        search: string,
        page: number,
        perPage: number,
    ): Promise<ListResponse<$app.AL_BaseAnime>>
    getMangaDetails(id: number): Promise<$app.AL_MangaDetailsById_Media | null>
    listManga(
        search: string,
        page: number,
        perPage: number,
    ): Promise<ListResponse<$app.AL_BaseManga>>
}
