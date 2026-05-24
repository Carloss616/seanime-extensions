// Minimal subset of seanime's plugin runtime types — only what the
// extensions in this repo actually touch. The full surface lives in
// internal/extension_repo/goja_plugin_types/ in the seanime source tree;
// if you need more bindings, copy them in (they are type-only, the runtime
// already exposes everything).

declare function init(): void

declare namespace $app {
    type AL_MediaListStatus =
        | "CURRENT"
        | "PLANNING"
        | "COMPLETED"
        | "DROPPED"
        | "PAUSED"
        | "REPEATING"

    interface AL_BaseManga_Title {
        english?: string
        native?: string
        romaji?: string
        userPreferred?: string
    }

    interface AL_BaseManga {
        id: number
        idMal?: number
        title?: AL_BaseManga_Title
        synonyms?: string[]
        /** For AniList entries: https://anilist.co/manga/<id>.
         *  For custom-source entries seanime wraps the original URL as
         *  `ext_custom_source_<extId>|END|<original-url>` (see
         *  internal/customsource/customsource.go:formatSiteUrl in seanime). */
        siteUrl?: string
    }

    interface AL_MediaListEntry_Media {
        id?: number
        idMal?: number
        title?: AL_BaseManga_Title
    }

    interface AL_MediaList {
        id?: number
        mediaId?: number
        status?: AL_MediaListStatus
        progress?: number
        score?: number
        media?: AL_MediaListEntry_Media
    }

    interface AL_MediaListGroup {
        status?: AL_MediaListStatus
        entries?: AL_MediaList[]
    }

    interface AL_MangaCollection {
        MediaListCollection?: {
            lists?: AL_MediaListGroup[]
        }
    }

    /** Triggered before AniList updates an entry's progress.
     *  Call event.preventDefault() to skip the default AniList update. */
    interface PreUpdateEntryProgressEvent {
        next(): void
        preventDefault(): void
        mediaId?: number
        progress?: number
        totalCount?: number
        status?: AL_MediaListStatus
    }

    function onPreUpdateEntryProgress(
        cb: (event: PreUpdateEntryProgressEvent) => void,
    ): void

    /** Triggered after AniList successfully updates an entry's progress. */
    interface PostUpdateEntryProgressEvent {
        next(): void
        mediaId?: number
    }

    function onPostUpdateEntryProgress(
        cb: (event: PostUpdateEntryProgressEvent) => void,
    ): void

    /** Triggered before AniList updates an entry via the full edit flow
     *  (status / score / progress / dates). Call event.preventDefault() to
     *  skip the default AniList update. */
    interface PreUpdateEntryEvent {
        next(): void
        preventDefault(): void
        mediaId?: number
        status?: AL_MediaListStatus
        scoreRaw?: number
        progress?: number
    }

    function onPreUpdateEntry(cb: (event: PreUpdateEntryEvent) => void): void

    /** Triggered after AniList successfully commits a full entry edit. */
    interface PostUpdateEntryEvent {
        next(): void
        mediaId?: number
    }

    function onPostUpdateEntry(cb: (event: PostUpdateEntryEvent) => void): void
}

declare namespace $anilist {
    /** Returns the user's manga collection, optionally bypassing the cache. */
    function getMangaCollection(bypassCache: boolean): $app.AL_MangaCollection

    /** Lookup a single manga by AniList id. */
    function getManga(id: number): $app.AL_BaseManga
}

declare namespace $storage {
    function set(key: string, value: any): void
    function get<T = any>(key: string): T | undefined
    function has(key: string): boolean
    function remove(key: string): void
    function keys(): string[]
}

/** Cross-runtime in-memory store. Persists for the plugin's lifetime and is
 *  shared between the loader VM (where init() runs) and the pool runtimes
 *  that execute hook callbacks. Use it to hand state between Pre and Post
 *  hooks (callbacks cannot close over module scope). */
declare namespace $store {
    function set<T = any>(key: string, value: T): void
    function get<T = any>(key: string): T | undefined
    function has(key: string): boolean
    function remove(key: string): void
    function removeAll(): void
}
