# Local Catalog (Custom)

A seanime **custom-source** that serves a manga catalog you curate yourself, for titles that are not on AniList / MangaUpdates (or not yet uploaded). The entries show up in your manga collection like any AniList media; you read them with any installed manga provider (matched by title) or the built-in local reader.

This extension provides **metadata only** — it does not serve chapter pages.

## Configuration

Open the extension's config in seanime and set one of:

- **Catalog URL** — a URL returning the catalog JSON. It is fetched with a plain
  `GET` and **no authentication**, so it must be publicly reachable:
  - a **public or _secret_ GitHub Gist** raw URL (`https://gist.githubusercontent.com/<user>/<id>/raw/catalog.json`) — a *secret* gist works without a token, its raw URL is just unlisted;
  - a **public repo** raw URL;
  - a **local HTTP server**, e.g. `http://localhost:8000/catalog.json`.

  **No token is needed.** Truly private gists/repos (that require auth) are **not**
  supported — the extension cannot send an `Authorization` header. (Writing a
  catalog back to a Gist, which *does* need a token, is the job of the planned v2
  CRUD plugin, not this source.)
- **Inline catalog JSON** — paste the catalog JSON directly (used when Catalog URL is empty). This field ships with a one-record example as its default, so you can see the shape and edit it in place; replace it with your own entries (or clear it and use a Catalog URL instead).

**Cache minutes** controls how long the parsed catalog is cached in memory (default `10`; `0` disables caching). Edits propagate after the TTL expires.

> A custom-source cannot read a device-local file path directly (seanime only grants it `fetch` + config). Use a local HTTP server and point Catalog URL at it if you want a file on disk.

## Catalog format

```jsonc
{
  "version": 2,
  "updatedAt": 1700000000000,        // optional; managed by local-catalog-manager
  "manga": [
    {
      "id": 1,                        // required: stable unique integer ≥ 1
      "type": "MANGA",
      "title": { "userPreferred": "Title", "english": "Title", "romaji": "", "native": "" },
      "synonyms": ["alt title"],
      "coverImage": { "extraLarge": "https://…", "large": "https://…", "medium": "https://…", "color": "#abcabc" },
      "bannerImage": "https://…",
      "description": "…",
      "genres": ["Action"],
      "status": "RELEASING",          // AL_MediaStatus
      "format": "MANGA",              // AL_MediaFormat
      "chapters": 120,
      "volumes": 12,
      "startDate": { "year": 2021, "month": 3, "day": 1 },
      "endDate": { "year": 2024 },
      "isAdult": false,
      "countryOfOrigin": "JP",
      "idMal": 12345,
      "meanScore": 78,
      "siteUrl": "https://…",
      "updatedAt": 1700000000000      // optional per-record merge timestamp; hand authors may omit
    }
  ],
  "anime": []                          // RESERVED — not served yet
}
```

- Entries use seanime's native `AL_BaseManga` shape. `id` and a non-empty
  `title` are required; everything else is optional. A bare array `[ … ]` is
  also accepted and treated as `manga`.
- `title` may be a string (coerced to `{ userPreferred, english }`) or the full
  `{ english, romaji, native, userPreferred }` object.
- `updatedAt` (per record and at the envelope) is merge-metadata managed by the
  `local-catalog-manager` plugin; hand-authored catalogs can omit it.
- The `anime` namespace is reserved for a future release — the source does not
  serve anime yet.

> **Breaking change (v2):** the format moved from the old flat shape
> (`cover`/`banner`/`year`/`country`) to native `AL_BaseManga`. Regenerate any
> hand-written catalog accordingly.

## Reading

The custom-source only supplies metadata. When you open an entry, seanime calls your selected manga provider's search with the entry's title(s) and lists its chapters.

## Roadmap

A companion **plugin** (`local-catalog-manager`, a separate extension) over this same catalog format is planned. Not included yet. Scope:

- **CRUD** — tray + command-palette UI to add/edit/delete entries, persisting the catalog to a Gist that the Catalog URL points at (token in `$storage`) plus a local backup.
- **Sync / auto-sync** — keep the same library *and* reading position across devices:
  - **catalog** (metadata) auto pull/push with the Gist. The scheduled auto-sync is a configurable on/off toggle (default off) and **only applies when a Catalog URL/Gist is used** — with inline JSON there is nothing remote to sync, so it is disabled;
  - **reading progress** (list status / chapter progress / score), kept in a *separate* sync document keyed by the entry `id`, so it stays out of the catalog. Captured via the progress hooks (like `mangaupdates-sync`) and restored on other devices. Since seanime stores custom-source progress only locally, this is what makes it portable; it does **not** push to AniList/MU.
