<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/mangaupdates-sync/assets/icon.png" width="96" alt="MangaUpdates Sync icon" />

# 🔁 MangaUpdates Sync

![Type](https://img.shields.io/badge/type-plugin-3b82f6?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.0.3-22c55e?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**Pushes your manga reading state to [MangaUpdates](https://www.mangaupdates.com/) whenever seanime updates an entry.**

[Features](#-features) · [Quick Start](#-quick-start) · [How it works](#-how-it-works) · [Mapping](#-mapping-anilist--mu-series)

</div>

---

## 💡 Concept

> Both chapter "+1" bumps and full manual edits (status, score, progress). Plugin extension — no seanime core changes required.

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| Progress + status + score | Mirrored to MangaUpdates on every seanime update. |
| Zero-config for custom-source | Resolves the MU series automatically for [`mangaupdates`](../../custom-source/mangaupdates/) entries — **no network call**. |
| Manual linking | A **Link to MangaUpdates** button on every other manga page to map AniList entries by hand. |
| Optional auto-match | Title-search fallback for users who'd rather not link manually. |

---

## 🚀 Quick Start

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. Enter your MangaUpdates **username** and **password** in the plugin config (used to fetch a session token).
3. Read or edit a manga — your state syncs to MangaUpdates automatically.

> [!NOTE]
> Requires any seanime version with the [official plugin runtime](https://seanime.gitbook.io/seanime-extensions/plugins/introduction). Uses only documented APIs (`$ui.register`, `ctx.action.newMangaPageButton`, `ctx.newTray`, `ctx.fetch`, `ctx.state`, `$storage`, `$store`, `$anilist`) — no fork-specific or undocumented surface.

### Configuration

| Field | Notes |
| ----- | ----- |
| `username` | MU username. |
| `password` | MU password. Used to fetch the initial session token; reused on 401 to refresh. |
| `autoSyncOnProgress` | On by default. Gates **both** the chapter-update and manual-edit hooks. |
| `syncScore` | On by default. When off, skips the `PUT .../rating` request (status / chapter still sync). |
| `autoMatchFallback` | **Off by default.** When on, the resolver falls back to MU's title search if no explicit link exists; the first hit is cached as `source: "auto"`. May mismatch on common / generic titles. |
| `injectEntryIcon` | On by default. Shows a MangaUpdates icon on the manga entry page (next to AniList). |

The session token lives in the plugin's `$storage`. On 401 the plugin re-logs in using the stored credentials and refreshes the token.

---

## 🔧 How it works

Two hook pairs run inside `init()`:

| Trigger in seanime | Pre hook | Post hook |
| ------------------ | -------- | --------- |
| Chapter "+1" / reader marks chapter | `onPreUpdateEntryProgress` captures `{progress, status}` | `onPostUpdateEntryProgress` pushes to MU after AniList OK |
| Manual edit (status / score / progress) | `onPreUpdateEntry` captures `{status, progress, scoreRaw}` | `onPostUpdateEntry` pushes to MU after AniList OK |

The payload captured in **Pre** is stashed in `$store` (cross-runtime, in-memory) and consumed by the matching **Post**. The Post only fires when AniList accepted the update, so MU stays in lock-step.

> [!NOTE]
> Hook callbacks don't close over module-scope helpers — seanime's goja runtime serializes them via `.toString()` and recompiles them in a fresh runtime. Each callback lives in its own `modules/*.ts` file and the build inlines its `utils/` deps into the callback body; shared state between Pre and Post goes through `$store`.

### What the plugin sends to MU

Per push, **up to two requests** (verified against the MangaUpdates OpenAPI spec):

| Aspect | Endpoint | Body |
| ------ | -------- | ---- |
| Status + chapter | `POST /v1/lists/series/update` | `[{ series:{id}, list_id, status:{chapter} }]` (`ListsSeriesModelUpdateV1`) |
| Add (fallback) | `POST /v1/lists/series` if update returns "isn't on your list" | same payload — both endpoints share `ListsSeriesModelUpdateV1` |
| Score | `PUT /v1/series/{series_id}/rating` | `{ rating }` (`SeriesRatingModelV1`) |

> [!NOTE]
> The list-update payload does **not** include `rating` — the schema doesn't define it and MU silently drops it. Score sync requires the dedicated rating endpoint.

---

## 🗺 Mapping AniList ↔ MU series

The plugin resolves the MU `series_id` in this order:

1. **Custom-source fast path.** If the manga came from the [`mangaupdates` custom-source](../../custom-source/mangaupdates/), the MU `series_id` is embedded in the synthetic `mediaId` — detected via the `ext_custom_source_mangaupdates|END|` prefix on `manga.siteUrl`, decoded from the low 40 bits of `mediaId`. **No network call.**
2. **Explicit link in `$storage`.** Set via the *Link to MangaUpdates* button (below).
3. **Title-search fallback (opt-in).** Only when `autoMatchFallback` is enabled. `POST /v1/series/search` with the title; the first result wins, cached as `source: "auto"`. Ambiguous titles can map wrong — hence off by default.

If none resolve, the plugin logs a warning and skips the push.

<details>
<summary>Linking AniList entries explicitly</summary>

A **Link to MangaUpdates** button renders on every manga entry page that isn't from the `mangaupdates` custom-source. It:

- Pre-populates the search input with the entry's title and triggers an initial MU search.
- Opens the plugin's tray-popover with the search results as pickable buttons.
- On pick, records the mapping in `$storage` under `mu_link_<mediaId>` and relabels itself to `MU: <title>`.
- Click again to re-link; inside the popover, **Clear link** removes the mapping.

> [!IMPORTANT]
> **The tray icon must be pinned** (top-right of the seanime navbar) for the popover to open — a documented limitation of `tray.open()`. If it isn't pinned, the button shows a toast asking you to pin it.

If the button shows **MU: ? (verify)**, the link was set by the auto-match fallback — it took the first MU search result for the title. Click to confirm or re-link.

</details>

### Status mapping

`POST /v1/lists/series/update` requires the **integer** `list_id`. All five system list ids verified directly against MU:

| seanime status | MU `list_id` | |
| -------------- | ------------ | - |
| `CURRENT` | `0` Reading | ✅ verified |
| `PLANNING` | `1` Wish | ✅ verified |
| `COMPLETED` | `2` Complete | ✅ verified |
| `DROPPED` | `3` Unfinished | ✅ verified |
| `PAUSED` | `4` On-Hold | ✅ verified |
| `REPEATING` | `0` Reading | (MU has no re-read list) |

Custom user lists (`list_id >= 100`) are out of scope.

### Score mapping

AniList `scoreRaw` (0–100) → MU `rating` (0–10, one decimal) via `Math.round(scoreRaw) / 10`, clamped to `[0, 10]`, sent as the body of `PUT /v1/series/{series_id}/rating`. The spec defines `rating: number` with no min/max; community convention and the rainbow histogram imply 0–10 with one decimal.

---

## 🔐 Permissions

- `storage` — session token and per-entry `mu_link_<mediaId>` records.
- `anilist` — fast lookup of title / `siteUrl` without an extra HTTP call.
- `networkAccess: ["api.mangaupdates.com"]`.

---

## ⚠️ Known limitations

- **`412 Precondition Failed` ("Five second update delay")** — the `/lists/series` endpoints rate-limit one update per series per 5 seconds. The plugin doesn't retry/backoff on 412; rapid successive updates to the same manga may drop silently.
- **Push-only.** If you change things on MU directly, seanime won't notice.
- **Linking requires user action** for AniList entries — the MU spec doesn't expose `mal_id`/`anilist_id` cross-IDs. The opt-in title-search fallback covers users who don't want to link manually, but may mismatch.
- **Stored credentials** live in seanime's `$storage` backend — plaintext at the JSON level. Treat the seanime data directory as sensitive.
- **No repeat-count sync.** MU has no reread counter, so the repeat hook isn't bound. Switching status to `REPEATING` does push (maps to `list_id=0`).
- **Score clearing** (setting score back to 0 / null) is not pushed — the plugin only sends `PUT .../rating` when `scoreRaw > 0`.

<details>
<summary>SPIKE — still pending verification</summary>

`SPIKE:` markers flag values inferred from the spec / community wrappers that haven't been confirmed against a real account in production.

- Token TTL and the 401 → re-login path — not yet exercised in production.
- Title-search fallback (opt-in) for real AniList mangas — preserved for users who relied on it; manual linking is the canonical flow now.
- The rating endpoint flow (`PUT /v1/series/{id}/rating`) — needs a real edit to confirm MU persists it.

</details>

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
