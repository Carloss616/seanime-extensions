<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/custom-source/local-catalog/assets/icon.png" width="96" alt="Local Catalog icon" />

# 📚 Local Catalog

![Type](https://img.shields.io/badge/type-custom--source-8b5cf6?style=for-the-badge)
![Version](https://img.shields.io/badge/version-2.0.0-22c55e?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**A seanime custom-source that serves a manga catalog you curate yourself.**

[Features](#-features) · [Quick Start](#-quick-start) · [How it works](#-how-it-works) · [Catalog format](#-catalog-format)

</div>

---

## 💡 Concept

> For titles that aren't on AniList / MangaUpdates (or aren't uploaded yet).

You curate the metadata; the titles then show up in your manga collection like any AniList media, and you read them with any installed manga provider (matched by title) or the built-in local reader.

> [!IMPORTANT]
> This source provides **metadata only** — it does not host or serve chapter pages.

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| Two catalog sources | Curate entries from a **remote URL** or **inline JSON**. |
| Native shapes | Entries use seanime's `AL_BaseManga` shape — cover, banner, genres, status, dates and more. |
| In-memory cache | Configurable TTL (`Cache minutes`). |
| Companion plugin | Pairs with [Local Catalog Manager](../../plugins/local-catalog-manager/) for in-app editing and cross-device sync. |

---

## 🚀 Quick Start

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. Open the extension's config and set **one** catalog source (see below).
3. Open your manga collection — your entries appear there.

### Configuration

Set **one** catalog source:

- **Catalog URL** — a URL returning the catalog JSON, fetched with a plain `GET` and **no authentication**, so it must be publicly reachable:
  - a **public or _secret_ GitHub Gist** raw URL (`https://gist.githubusercontent.com/<user>/<id>/raw/catalog.json`) — a *secret* gist works without a token; its raw URL is just unlisted;
  - a **public repo** raw URL;
  - a **local HTTP server**, e.g. `http://localhost:8000/catalog.json`.
- **Inline catalog JSON** — paste the catalog JSON directly (used when Catalog URL is empty). Ships with a one-record example as its default so you can see the shape and edit in place.

**Cache minutes** controls how long the parsed catalog is cached in memory (default `10`; `0` disables caching). Edits propagate after the TTL expires.

> [!NOTE]
> No token is supported. Truly private gists/repos that require auth are **not** reachable — the extension cannot send an `Authorization` header. Writing a catalog *back* to a Gist (which does need a token) is the job of the [Local Catalog Manager](../../plugins/local-catalog-manager/) plugin, not this source.
>
> A custom-source also can't read a device-local file path directly (seanime only grants it `fetch` + config). Use a local HTTP server and point **Catalog URL** at it if you want a file on disk.

---

## 🔧 How it works

When you set a **Catalog URL**, the source fetches and parses that JSON (caching it for *Cache minutes*); otherwise it uses the **Inline catalog JSON**. Each record is normalized to seanime's native `AL_BaseManga` shape, so entries show up in your manga collection like any AniList media. When you open one, seanime calls your selected manga provider's search with the entry's title(s) and lists its chapters.

---

## 📋 Catalog format

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

- `id` and a non-empty `title` are required; everything else is optional. A bare array `[ … ]` is also accepted and treated as `manga`.
- `title` may be a string (coerced to `{ userPreferred, english }`) or the full `{ english, romaji, native, userPreferred }` object.
- `updatedAt` (per record and at the envelope) is merge-metadata managed by the [Local Catalog Manager](../../plugins/local-catalog-manager/) plugin; hand-authored catalogs can omit it.
- The `anime` namespace is reserved for a future release — the source does not serve anime yet.

> [!WARNING]
> **Breaking change (v2):** the format moved from the old flat shape (`cover`/`banner`/`year`/`country`) to native `AL_BaseManga`. Regenerate any hand-written catalog accordingly.

---

## 📖 Reading

The custom-source supplies metadata only. To read, install a `manga-provider` extension (e.g. MangaDex); seanime matches the entry to it by title.

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
