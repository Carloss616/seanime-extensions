# MangaUpdates (custom-source)

Adds [MangaUpdates](https://www.mangaupdates.com/) as a metadata source for seanime, backed by the public [MangaUpdates API](https://api.mangaupdates.com/).

## Scope

- **Search** — `listManga(query, page, perPage)` → `POST /v1/series/search`
- **Details** — `getMangaDetails(id)` → `GET /v1/series/{id}` (returns minimal AniList-shaped detail object)
- **Batch fetch** — `getManga(ids)` → parallel `GET /v1/series/{id}`

Anime methods (`listAnime`, `getAnime`, ...) are stubbed. Seanime does **not** gate calls on `supportsAnime` — the stubs are reachable in practice (e.g. the library scanner may invoke `getAnimeWithRelations`), so keep them in place even though `getSettings()` reports `supportsAnime: false`.

## What this is NOT

This is **not** a manga reader. MangaUpdates does not host chapter pages — it tracks scanlation releases. For reading, use a `manga-provider` extension (e.g. MangaDex).

## API notes

- Public endpoints, **no API key required**.
- Bearer auth is only needed for user lists / posting actions, which this extension does not touch.
- MangaUpdates TOS request caching and attribution; seanime's catalog already caches custom-source results.

## Field mapping

| MangaUpdates `record` field   | AniList field (`AL_BaseManga`)                |
| ----------------------------- | --------------------------------------------- |
| `series_id`                   | `id`                                          |
| `url`                         | `siteUrl`                                     |
| `title`                       | `title.english` + `title.userPreferred`       |
| `image.url.original`/`.thumb` | `coverImage.extraLarge` / `.large` / `.medium`|
| `description`                 | `description`                                 |
| `genres[].genre`              | `genres`                                      |
| `associated[].title`          | `synonyms`                                    |
| `bayesian_rating` × 10        | `meanScore` (0–100, only if `rating_votes>0`) |
| `year` (string)               | `startDate.year`                              |
| `type` (`Novel`/`Artbook`)    | `format: "NOVEL"`                             |
| `type` (everything else)      | `format: "MANGA"`                             |

## Building

From the repo root:

```bash
python3 build.py mangaupdates
```

This regenerates `mangaupdates.js` and `mangaupdates.json` from `code.ts` + `manifest.template.json`.

## Local install

Copy the built `mangaupdates.json` into `$SEANIME_DATA_DIR/extensions/` and reload extensions in seanime.

## Attribution

Powered by [MangaUpdates](https://www.mangaupdates.com/).
