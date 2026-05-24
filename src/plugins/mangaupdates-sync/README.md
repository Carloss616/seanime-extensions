# MangaUpdates Sync

Pushes your manga reading state to MangaUpdates whenever seanime updates an
entry — both chapter "+1" bumps and full manual edits (status, score,
progress). Plugin extension — no seanime core changes required.

## How it works

Two hook pairs run inside `init()`:

| Trigger in seanime                             | Pre hook                                                    | Post hook                                                 |
| ---------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------- |
| Chapter "+1" / reader marks chapter            | `onPreUpdateEntryProgress` captures `{progress, status}`    | `onPostUpdateEntryProgress` pushes to MU after AniList OK |
| Manual edit (modal: status / score / progress) | `onPreUpdateEntry` captures `{status, progress, scoreRaw}`  | `onPostUpdateEntry` pushes to MU after AniList OK         |

The payload captured in Pre is stashed in `$store` (cross-runtime, in-memory)
and consumed by the matching Post; the Post only fires when AniList accepted
the update, so MU stays in lock-step.

> Note: hook callbacks do **not** close over module-scope helpers — seanime's
> goja runtime serializes them via `.toString()` and recompiles them in a
> fresh pool runtime. Every hook body in `code.ts` is therefore fully
> self-contained; shared state between Pre and Post goes through `$store`.

## What the plugin sends to MU

Per push, **up to two requests** (verified against the MangaUpdates OpenAPI
spec, `openapi.json`):

| Aspect             | Endpoint                                                                 | Body                                  |
| ------------------ | ------------------------------------------------------------------------ | ------------------------------------- |
| Status + chapter   | `POST /v1/lists/series/update`                                           | `[{ series:{id}, list_id, status:{chapter} }]` (`ListsSeriesModelUpdateV1`) |
| Add (fallback)     | `POST /v1/lists/series` if update returns "isn't on your list"           | same payload — both endpoints share `ListsSeriesModelUpdateV1` |
| Score              | `PUT /v1/series/{series_id}/rating`                                      | `{ rating }` (`SeriesRatingModelV1`)  |

The list-update payload does **not** include `rating` — the schema doesn't
define it and MU silently drops it. Score sync requires the dedicated
rating endpoint. (Discovered by spec audit — the previous version sent
`rating` in the list update and it was being thrown away.)

## Configuration

| Field                | Notes                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------- |
| `username`           | MU username.                                                                                         |
| `password`           | MU password. Used to fetch the initial session token; reused on 401 to refresh.                      |
| `autoSyncOnProgress` | On by default. Gates **both** the chapter-update and manual-edit hooks.                              |
| `syncScore`          | On by default. When off, skips the `PUT .../rating` request (status / chapter still sync).           |

The session token lives in the plugin's `$storage`. On 401 the plugin
re-logs in using the stored credentials and refreshes the token.

## Permissions requested

- `storage` — session token + AniList-id → MU-series-id cache.
- `anilist` — fast lookup of title / `siteUrl` without an extra HTTP call.
- `networkAccess: ["api.mangaupdates.com"]`.

## Mapping AniList ↔ MU series

Tried in this order:

1. **Custom-source fast path.** If the manga came from the
   [`mangaupdates` custom-source](../../custom-source/mangaupdates/) in this
   same repo, the MU `series_id` is embedded in the synthetic `mediaId`.
   Detected via the `ext_custom_source_mangaupdates|END|` prefix on
   `manga.siteUrl`; decoded from the low 40 bits of `mediaId`. **No network
   call.**
2. **`$storage` cache.** First push for a given `mediaId` is cached.
3. **Title search fallback.** For real AniList mangas,
   `POST /v1/series/search` with the title; the first result wins.
   Ambiguous titles can map wrong.

## Status mapping

`POST /v1/lists/series/update` requires the **integer** `list_id` (the
`"reading"/"complete"/...` strings returned under `rank.lists` on
`GET /v1/series/{id}` are read-only labels — `ListsSeriesModelUpdateV1.list_id`
is `type: integer` in the spec).

All five system list ids verified directly against MU
(`https://www.mangaupdates.com/lists/N` for N=0..4):

| seanime status | MU `list_id` |   |
| -------------- | ------------ | - |
| `CURRENT`      | `0` Reading    | ✅ verified |
| `PLANNING`     | `1` Wish       | ✅ verified |
| `COMPLETED`    | `2` Complete   | ✅ verified |
| `DROPPED`      | `3` Unfinished | ✅ verified |
| `PAUSED`       | `4` On-Hold    | ✅ verified |
| `REPEATING`    | `0` Reading    | (MU has no re-read list) |

Custom user lists (`list_id >= 100`) are out of scope.

## Score mapping

AniList `scoreRaw` (0-100) → MU `rating` (0-10 with one decimal) via
`Math.round(scoreRaw) / 10`, clamped to `[0, 10]`. Sent as the body of
`PUT /v1/series/{series_id}/rating`. The spec defines `rating: number` with
no min/max; community convention and the rainbow histogram (`integer`
buckets) imply 0–10 with one decimal.

## Verified against the OpenAPI spec + a real account

- `PUT /v1/account/login` → body `AccountLoginModelV1 {username, password}`,
  response `ApiResponseV1` with token nested under `context.session_token`
  (`ApiContextV1` has `additionalProperties: true`, so the spec doesn't pin
  it — empirically that's where it lives).
- `POST /v1/lists/series/update` and `POST /v1/lists/series` (add) both take
  an array of `ListsSeriesModelUpdateV1` — confirmed identical shape, no
  `rating` field.
- `PUT /v1/series/{id}/rating` takes `SeriesRatingModelV1 { rating }`.
- `POST /v1/series/search` takes `SeriesSearchRequestV1` (we send `search`
  + `perpage`), returns `SeriesSearchResponseV1` with `results[].record.series_id`.
- `series_id` for large MU ids (e.g. TBATE `60735012287`) works in path
  params (spec marks them `int64` on `/series/{id}/...`).

## SPIKE — still pending

- Token TTL and the 401 → re-login path — not yet exercised in production.
- Title-search fallback for real AniList mangas — only the custom-source
  path has been tested end-to-end.
- The rating endpoint flow (`PUT /v1/series/{id}/rating`) — added in
  v0.7.0; needs a real edit to confirm MU persists it.

## Known limitations

- **`412 Precondition Failed` ("Five second update delay")** — the
  `/lists/series` endpoints rate-limit one update per series per 5 seconds.
  The plugin doesn't currently retry/backoff on 412; rapid successive
  updates to the same manga may drop silently.
- **Push-only.** If you change things on MU directly, seanime won't notice.
  A "Pull diff" UI could be added with `$ui` later.
- **Title-based mapping** for the AniList path is lossy — `mal_id` /
  `anilist_id` cross-IDs would help; the spec doesn't expose them on
  `GET /v1/series/{id}`.
- **Stored credentials** live in seanime's `$storage` backend — plaintext at
  the JSON level. Treat the seanime data directory as sensitive.
- **No repeat-count sync.** AniList tracks rereads via `UpdateEntryRepeat`;
  MU has no corresponding counter, so that hook isn't bound. Switching
  status to `REPEATING` does push (maps to `list_id=0`).
- **Score clearing** (setting score back to 0 / null) is not pushed as a
  `DELETE` — the plugin only sends `PUT .../rating` when `scoreRaw > 0`.
