# Local Manga (Custom)

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
  "version": 1,
  "manga": [
    {
      "id": 1,
      "title": "Title",
      "synonyms": ["alt title"],
      "cover": "https://…",
      "banner": "https://…",
      "description": "…",
      "genres": ["Action"],
      "status": "RELEASING",
      "format": "MANGA",
      "chapters": 120,
      "volumes": 12,
      "year": 2021,
      "isAdult": false,
      "country": "JP",
      "siteUrl": "https://…"
    }
  ]
}
```

- `id` (stable, unique, integer ≥ 1) and `title` are required; everything else is optional. A bare array `[ … ]` is also accepted.
- `title` may be a string or `{ english, romaji, native, userPreferred }`.
- Good `title` / `synonyms` are what make an entry matchable by your reading provider.

## Reading

The custom-source only supplies metadata. When you open an entry, seanime calls your selected manga provider's search with the entry's title(s) and lists its chapters.

## Roadmap

A companion **plugin** (`local-manga-manager`, a separate extension) over this same catalog format is planned. Not included yet. Scope:

- **CRUD** — tray + command-palette UI to add/edit/delete entries, persisting the catalog to a Gist that the Catalog URL points at (token in `$storage`) plus a local backup.
- **Sync / auto-sync** — keep the same library *and* reading position across devices:
  - **catalog** (metadata) auto pull/push with the Gist. The scheduled auto-sync is a configurable on/off toggle (default off) and **only applies when a Catalog URL/Gist is used** — with inline JSON there is nothing remote to sync, so it is disabled;
  - **reading progress** (list status / chapter progress / score), kept in a *separate* sync document keyed by the entry `id`, so it stays out of the catalog. Captured via the progress hooks (like `mangaupdates-sync`) and restored on other devices. Since seanime stores custom-source progress only locally, this is what makes it portable; it does **not** push to AniList/MU.
