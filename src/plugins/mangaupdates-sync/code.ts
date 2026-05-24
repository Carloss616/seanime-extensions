/// <reference path="../../../types/core.d.ts" />
/// <reference path="../../../types/plugin.d.ts" />
/// <reference path="../../../types/mu-api.d.ts" />

// MangaUpdates sync plugin.
//
// init() runs in the plugin's loader VM, but hook callbacks fire in a
// SEPARATE goja pool runtime — they cannot close over anything declared at
// module scope (see seanime's internal/extension_repo/goja_plugin.go
// bindHooks: the callback is serialized via .toString() and recompiled in a
// fresh executor). Every hook body below is therefore fully self-contained
// and uses `$store` (cross-runtime) to hand state between Pre and Post.

function init() {
    $app.onPreUpdateEntryProgress((event) => {
        try {
            const auto =
                ($getUserPreference("autoSyncOnProgress") ?? "true") !== "false"
            if (
                !auto ||
                event.mediaId == null ||
                event.progress == null
            ) {
                event.next()
                return
            }
            let isMng = false
            try {
                isMng = !!$anilist.getManga(event.mediaId)
            } catch (_) {
                isMng = false
            }
            if (!isMng) {
                event.next()
                return
            }
            $store.set("mu_pending_" + event.mediaId, {
                progress: event.progress,
                status: event.status || "CURRENT",
            })
        } catch (e) {
            console.error("[mangaupdates-sync] pre-progress error:", e)
        }
        event.next()
    })

    $app.onPreUpdateEntry((event) => {
        try {
            const auto =
                ($getUserPreference("autoSyncOnProgress") ?? "true") !== "false"
            if (!auto || event.mediaId == null) {
                event.next()
                return
            }
            let isMng = false
            try {
                isMng = !!$anilist.getManga(event.mediaId)
            } catch (_) {
                isMng = false
            }
            if (!isMng) {
                event.next()
                return
            }
            $store.set("mu_pending_" + event.mediaId, {
                status: event.status,
                progress: event.progress,
                scoreRaw: event.scoreRaw,
            })
        } catch (e) {
            console.error("[mangaupdates-sync] pre-edit error:", e)
        }
        event.next()
    })

    // Shared post handler — registered on both UpdateEntryProgress and
    // UpdateEntry. Goja toString()s the function and recompiles it in the
    // pool runtime per fire; the body must reference nothing outside its own
    // scope (so all helpers/constants live inline).
    const onPost = (event: { mediaId?: number; next(): void }) => {
        try {
            const mediaId = event.mediaId
            if (mediaId == null) {
                event.next()
                return
            }
            const key = "mu_pending_" + mediaId
            const update = $store.get<{
                status?: $app.AL_MediaListStatus
                progress?: number
                scoreRaw?: number
            }>(key)
            if (!update) {
                event.next()
                return
            }
            $store.remove(key)

            ;(async () => {
                const MU_API_BASE = "https://api.mangaupdates.com/v1"
                const TOKEN_KEY = "mu_session_token"
                const CACHE_KEY = "mu_external_id_cache"
                const EXT_ID_OFFSET = 0x80000000
                const LOCAL_ID_RANGE = 0x10000000000
                const CUSTOM_PREFIX =
                    "ext_custom_source_mangaupdates|END|"
                // MU system list ids. POST /v1/lists/series/update wants the
                // numeric id (not the "reading"/"complete"/... string keys
                // returned in `rank.lists` from GET /v1/series/{id}). Verified
                // by visiting mangaupdates.com/lists/N for N=0..4. Custom user
                // lists use ids >= 100 and aren't covered here.
                const STATUS_LIST: Record<string, number> = {
                    CURRENT: 0, // Reading
                    PLANNING: 1, // Wish
                    COMPLETED: 2, // Complete
                    DROPPED: 3, // Unfinished
                    PAUSED: 4, // On-Hold
                    REPEATING: 0, // Reading (MU has no separate re-read list)
                }

                interface MULoginResponse {
                    context?: { session_token?: string }
                    session_token?: string
                    token?: string
                }
                interface MUSearchResponse {
                    results?: Array<{
                        record?: { series_id?: number }
                    }>
                }
                // ListsSeriesModelUpdateV1 from the MU OpenAPI spec.
                // `rating` is NOT part of this schema — MU silently drops it.
                // Score lives behind PUT /v1/series/{id}/rating instead.
                interface MUUpdateItem {
                    series: { id: number }
                    list_id?: number
                    status?: { chapter: number }
                }

                class TokenExpiredError extends Error {
                    constructor() {
                        super("MU session expired")
                        this.name = "TokenExpiredError"
                    }
                }

                const reqMU = async <T = unknown>(
                    token: string,
                    method: string,
                    path: string,
                    body?: unknown,
                ): Promise<T | null> => {
                    const headers: Record<string, string> = {
                        Accept: "application/json",
                    }
                    if (token) headers["Authorization"] = "Bearer " + token
                    if (body !== undefined)
                        headers["Content-Type"] = "application/json"
                    const res = await fetch(MU_API_BASE + path, {
                        method,
                        headers,
                        body:
                            body !== undefined
                                ? JSON.stringify(body)
                                : undefined,
                    })
                    if (res.status === 401) throw new TokenExpiredError()
                    if (!res.ok) {
                        throw new Error(
                            "MU " +
                                method +
                                " " +
                                path +
                                " -> " +
                                res.status +
                                " " +
                                res.text(),
                        )
                    }
                    if (
                        (res.contentType || "").includes("application/json")
                    )
                        return res.json<T>()
                    return null
                }

                const muLogin = async (
                    username: string,
                    password: string,
                ): Promise<string> => {
                    const res = await fetch(
                        MU_API_BASE + "/account/login",
                        {
                            method: "PUT",
                            headers: {
                                "Content-Type": "application/json",
                                Accept: "application/json",
                            },
                            body: JSON.stringify({ username, password }),
                        },
                    )
                    if (!res.ok) {
                        throw new Error(
                            "MU login -> " +
                                res.status +
                                " " +
                                res.text(),
                        )
                    }
                    const data = res.json<MULoginResponse>()
                    const token =
                        data?.context?.session_token ??
                        data?.session_token ??
                        data?.token
                    if (!token)
                        throw new Error(
                            "MU login: response missing session token",
                        )
                    return token
                }

                const ensureToken = async (): Promise<string> => {
                    let token = $storage.get<string>(TOKEN_KEY) || ""
                    const username = $getUserPreference("username") || ""
                    const password = $getUserPreference("password") || ""
                    if (!token) {
                        if (!username || !password) {
                            throw new Error(
                                "MangaUpdates: missing credentials and no stored session token",
                            )
                        }
                        token = await muLogin(username, password)
                        $storage.set(TOKEN_KEY, token)
                        return token
                    }
                    try {
                        await reqMU(token, "GET", "/account/profile")
                        return token
                    } catch (err) {
                        if (!(err instanceof TokenExpiredError)) throw err
                        if (!username || !password) {
                            $storage.remove(TOKEN_KEY)
                            throw new Error(
                                "MangaUpdates: session expired and no stored password to re-login",
                            )
                        }
                        token = await muLogin(username, password)
                        $storage.set(TOKEN_KEY, token)
                        return token
                    }
                }

                let manga: $app.AL_BaseManga | undefined
                try {
                    manga = $anilist.getManga(mediaId)
                } catch (_) {
                    manga = undefined
                }

                const token = await ensureToken()

                // Resolve MU series_id.
                let externalId: string | undefined
                if (mediaId >= EXT_ID_OFFSET) {
                    const siteUrl = manga && manga.siteUrl
                    if (siteUrl && siteUrl.indexOf(CUSTOM_PREFIX) === 0) {
                        const localId =
                            (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE
                        if (localId > 0) {
                            externalId = String(localId)
                            console.log(
                                "[mangaupdates-sync] custom-source mangaupdates media " +
                                    mediaId +
                                    " -> series_id=" +
                                    externalId,
                            )
                        }
                    }
                }
                if (!externalId) {
                    const cache =
                        $storage.get<Record<string, string>>(CACHE_KEY) ||
                        {}
                    externalId = cache[String(mediaId)]
                }
                if (!externalId) {
                    const title =
                        manga &&
                        manga.title &&
                        (manga.title.romaji ||
                            manga.title.english ||
                            manga.title.userPreferred)
                    if (title) {
                        const data = await reqMU<MUSearchResponse>(
                            token,
                            "POST",
                            "/series/search",
                            { search: title, perpage: 25 },
                        )
                        const results = data?.results ?? []
                        const sid = results[0]?.record?.series_id
                        if (sid) {
                            externalId = String(sid)
                            const cache =
                                $storage.get<Record<string, string>>(
                                    CACHE_KEY,
                                ) || {}
                            cache[String(mediaId)] = externalId
                            $storage.set(CACHE_KEY, cache)
                        }
                    }
                }
                if (!externalId) {
                    console.warn(
                        "[mangaupdates-sync] no MU mapping for media " +
                            mediaId +
                            "; skipping push",
                    )
                    return
                }

                const syncScore =
                    ($getUserPreference("syncScore") ?? "true") !== "false"
                const listId =
                    update.status != null
                        ? STATUS_LIST[update.status] ?? STATUS_LIST.CURRENT
                        : undefined
                let rating: number | undefined
                if (
                    syncScore &&
                    update.scoreRaw != null &&
                    update.scoreRaw > 0
                ) {
                    rating = Math.min(
                        10,
                        Math.max(0, Math.round(update.scoreRaw) / 10),
                    )
                }

                const seriesIdNum = Number(externalId)
                const item: MUUpdateItem = { series: { id: seriesIdNum } }
                if (listId !== undefined) item.list_id = listId
                if (update.progress !== undefined)
                    item.status = { chapter: update.progress }

                try {
                    await reqMU(
                        token,
                        "POST",
                        "/lists/series/update",
                        [item],
                    )
                } catch (err) {
                    // MU update endpoint only mutates series already on the
                    // user's list. If the series is new, fall through to the
                    // add endpoint with the same payload shape.
                    const msg =
                        err instanceof Error ? err.message : String(err)
                    if (msg.indexOf("isn't on your list") >= 0) {
                        await reqMU(
                            token,
                            "POST",
                            "/lists/series",
                            [item],
                        )
                    } else {
                        throw err
                    }
                }

                // Score lives behind a dedicated endpoint
                // (PUT /v1/series/{id}/rating with { rating }).
                if (rating !== undefined) {
                    try {
                        await reqMU(
                            token,
                            "PUT",
                            "/series/" + seriesIdNum + "/rating",
                            { rating },
                        )
                    } catch (err) {
                        console.warn(
                            "[mangaupdates-sync] rating push failed for media " +
                                mediaId +
                                ":",
                            err,
                        )
                    }
                }
                console.log(
                    "[mangaupdates-sync] pushed media " +
                        mediaId +
                        " -> MU " +
                        externalId +
                        " (list=" +
                        (listId != null ? listId : "-") +
                        " chapter=" +
                        (update.progress != null ? update.progress : "-") +
                        " rating=" +
                        (rating != null ? rating : "-") +
                        ")",
                )
            })().catch((err) => {
                console.error(
                    "[mangaupdates-sync] push failed for media " +
                        mediaId +
                        ":",
                    err,
                )
            })
        } catch (e) {
            console.error("[mangaupdates-sync] post hook error:", e)
        }
        event.next()
    }

    $app.onPostUpdateEntryProgress(onPost)
    $app.onPostUpdateEntry(onPost)

    console.log("[mangaupdates-sync] initialized")
}
