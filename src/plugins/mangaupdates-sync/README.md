# MangaUpdates Sync

Pushes your manga reading state to MangaUpdates whenever seanime updates an
entry — both chapter "+1" bumps and full manual edits (status, score,
progress). Plugin extension — no seanime core changes required.

## Requires

Any seanime version that supports the
[official plugin runtime](https://seanime.gitbook.io/seanime-extensions/plugins/introduction).
The plugin uses only documented APIs (`$ui.register`, `ctx.action.newMangaPageButton`,
`ctx.newTray`, `ctx.fetch`, `ctx.state`, `ctx.effect`, `ctx.fieldRef`,
`ctx.registerEventHandler`, `ctx.eventHandler`, `ctx.toast`, `ctx.screen.*`,
`$storage`, `$store`, `$anilist`) — no fork-specific or undocumented surface.

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
| `autoMatchFallback`  | **Off by default.** When on, the resolver falls back to MU's title search if no explicit link exists; the first hit is cached as `source: "auto"`. May mismatch on common / generic titles. |

The session token lives in the plugin's `$storage`. On 401 the plugin
re-logs in using the stored credentials and refreshes the token.

## Permissions requested

- `storage` — session token and per-entry `mu_link_<mediaId>` records.
- `anilist` — fast lookup of title / `siteUrl` without an extra HTTP call.
- `networkAccess: ["api.mangaupdates.com"]`.

## Mapping AniList ↔ MU series

The plugin tries to resolve the MU `series_id` in this order:

1. **Custom-source fast path.** If the manga came from the
   [`mangaupdates` custom-source](../../custom-source/mangaupdates/) in this
   same repo, the MU `series_id` is embedded in the synthetic `mediaId`.
   Detected via the `ext_custom_source_mangaupdates|END|` prefix on
   `manga.siteUrl`; decoded from the low 40 bits of `mediaId`. **No network
   call.**
2. **Explicit link in `$storage`.** Set by the user via the "Link to
   MangaUpdates" button on the manga page (see below).
3. **Title-search fallback (opt-in).** Only when `autoMatchFallback` is
   enabled in plugin settings. `POST /v1/series/search` with the title; the
   first result wins. Cached as `source: "auto"`. Ambiguous titles can map
   wrong, which is why this is off by default.

If none of the above resolve, the plugin logs a warning and skips the push.

### Linking AniList entries explicitly

The plugin renders a **Link to MangaUpdates** button on every manga entry
page that isn't from the `mangaupdates` custom-source. The button:

- Pre-populates the search input with the entry's title and triggers an
  initial search against MangaUpdates.
- Opens the plugin's tray-popover with the search results listed as
  pickable buttons. **The tray icon must be pinned** (top-right of the
  seanime navbar) for the popover to open — this is a documented
  limitation of `tray.open()`. If the tray isn't pinned, the button
  shows a toast asking you to pin it.
- When you click a search result, the plugin records the mapping in
  `$storage` under `mu_link_<mediaId>` and the button relabels itself
  to `MU: <title>`.
- Click the button again to re-link (e.g. if the original pick was wrong).
- Inside the tray popover you can also use the **Clear link** button to
  remove the mapping for the current entry.

If the button shows **MU: ? (verify)**, the link was set by the
**Auto-match fallback** (`autoMatchFallback` in plugin settings) — it took
the first MU search result for the entry's title. Click the button to
confirm or re-link manually.

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
- Title-search fallback (opt-in, `autoMatchFallback`) for real AniList
  mangas — preserved from earlier versions for users who relied on it;
  not the recommended path. Manual linking via the button is the canonical
  flow now.
- The rating endpoint flow (`PUT /v1/series/{id}/rating`) — added in
  v0.7.0; needs a real edit to confirm MU persists it.

## Known limitations

- **`412 Precondition Failed` ("Five second update delay")** — the
  `/lists/series` endpoints rate-limit one update per series per 5 seconds.
  The plugin doesn't currently retry/backoff on 412; rapid successive
  updates to the same manga may drop silently.
- **Push-only.** If you change things on MU directly, seanime won't notice.
  A "Pull diff" UI could be added with `$ui` later.
- **Linking requires user action** for AniList entries — the plugin can't
  automatically determine the right MU series without prompting (the MU
  spec doesn't expose `mal_id`/`anilist_id` cross-IDs). The opt-in
  title-search fallback covers users who don't want to link manually but
  may mismatch.
- **Stored credentials** live in seanime's `$storage` backend — plaintext at
  the JSON level. Treat the seanime data directory as sensitive.
- **No repeat-count sync.** AniList tracks rereads via `UpdateEntryRepeat`;
  MU has no corresponding counter, so that hook isn't bound. Switching
  status to `REPEATING` does push (maps to `list_id=0`).
- **Score clearing** (setting score back to 0 / null) is not pushed as a
  `DELETE` — the plugin only sends `PUT .../rating` when `scoreRaw > 0`.
