// AUTO-SYNCED from 5rahim/seanime@a8e4b22 — do not edit. Regenerate with `bun run sync:types`.
declare type SearchResult = {
    id: string
    title: string
    synonyms?: string[]
    year?: number
    image?: string
    imageHeaders?: { [key: string]: string }
}

declare type ChapterDetails = {
    id: string
    url: string
    title: string
    chapter: string
    index: number
    scanlator?: string
    language?: string
    rating?: number
    updatedAt?: string
}

declare type ChapterPage = {
    url: string
    index: number
    headers: { [key: string]: string }
}

declare type QueryOptions = {
    query: string
    year?: number
}

declare type Settings = {
    supportsMultiLanguage?: boolean
    supportsMultiScanlator?: boolean
}

declare abstract class MangaProvider {
    search(opts: QueryOptions): Promise<SearchResult[]>
    findChapters(id: string): Promise<ChapterDetails[]>
    findChapterPages(id: string): Promise<ChapterPage[]>

    getSettings(): Settings
}
