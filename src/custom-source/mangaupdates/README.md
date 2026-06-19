<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/custom-source/mangaupdates/assets/icon.png" width="96" alt="MangaUpdates icon" />

# 🔎 MangaUpdates

![Type](https://img.shields.io/badge/type-custom--source-8b5cf6?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.0.1-22c55e?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**Adds [MangaUpdates](https://www.mangaupdates.com/) as a metadata source for seanime.**

[Scope](#-scope) · [Quick Start](#-quick-start) · [How it works](#-how-it-works) · [Field mapping](#-field-mapping)

</div>

---

## 💡 Concept

> Backed by the public [MangaUpdates API](https://api.mangaupdates.com/) — search and details, mapped onto seanime's native AniList shapes.

> [!IMPORTANT]
> This is **not** a manga reader. MangaUpdates tracks scanlation releases; it does not host chapter pages. For reading, install a `manga-provider` extension (e.g. MangaDex). To mirror your reads back to MangaUpdates, pair this with the [MangaUpdates Sync](../../plugins/mangaupdates-sync/) plugin.

---

## ✨ Scope

| Method | Endpoint |
| ------ | -------- |
| **Search** — `listManga(query, page, perPage)` | `POST /v1/series/search` |
| **Details** — `getMangaDetails(id)` | `GET /v1/series/{id}` |
| **Batch fetch** — `getManga(ids)` | parallel `GET /v1/series/{id}` |

Anime methods (`listAnime`, `getAnime`, …) are stubbed. seanime does **not** gate calls on `supportsAnime` — the stubs are reachable in practice (e.g. the library scanner may call `getAnimeWithRelations`), so they stay defined even though `getSettings()` reports `supportsAnime: false`.

---

## 🚀 Quick Start

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. Search for manga — MangaUpdates titles now appear as a metadata source.

No configuration or API key required.

---

## 🔧 How it works

Each seanime call (`listManga` / `getMangaDetails` / `getManga`) hits the matching MangaUpdates endpoint in the table above, and the `record` is mapped onto seanime's native `AL_BaseManga` shape (see [Field mapping](#-field-mapping)).

- Public endpoints, **no API key required**.
- Bearer auth is only needed for user lists / posting actions, which this extension does not touch.
- MangaUpdates' TOS requests caching and attribution; seanime's catalog already caches custom-source results.

---

## 🗺 Field mapping

| MangaUpdates `record` field | AniList field (`AL_BaseManga`) |
| --------------------------- | ------------------------------ |
| `series_id` | `id` |
| `url` | `siteUrl` |
| `title` | `title.english` + `title.userPreferred` |
| `image.url.original` / `.thumb` | `coverImage.extraLarge` / `.large` / `.medium` |
| `description` | `description` |
| `genres[].genre` | `genres` |
| `associated[].title` | `synonyms` |
| `bayesian_rating` × 10 | `meanScore` (0–100, only if `rating_votes > 0`) |
| `year` (string) | `startDate.year` |
| `type` (`Novel` / `Artbook`) | `format: "NOVEL"` |
| `type` (everything else) | `format: "MANGA"` |

---

## 📄 License & attribution

Powered by [MangaUpdates](https://www.mangaupdates.com/). [Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
