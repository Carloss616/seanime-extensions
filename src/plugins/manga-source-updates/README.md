<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/manga-source-updates/assets/icon.png" width="96" alt="Manga Source Updates icon" />

# 🔎 Manga Source Updates

![Type](https://img.shields.io/badge/type-plugin-3b82f6?style=for-the-badge)
![Version](https://img.shields.io/badge/version-1.0.0-22c55e?style=for-the-badge)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

**Scans your reading list against every installed manga provider and tells you which sources have new chapters.**

[Features](#-features) · [Quick Start](#-quick-start) · [How it works](#-how-it-works) · [Source detail view](#-source-detail-view) · [Permissions](#-permissions)

</div>

---

## 💡 Concept

> seanime lets one manga come from many providers, but only shows the one you're reading. This plugin refreshes each manga on your **CURRENT** list across *all* your installed providers and surfaces the source that's furthest ahead — so you never miss a release just because your usual source is behind. UI-only: no hooks, no external network.

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| Whole-list scan | Probes every provider for each manga on your **CURRENT** reading list. |
| Best-source summary | Per manga: `+N · M` — **N** unread chapters on the furthest-ahead source, **M** sources that have it. |
| New-chapters section | Manga with unread chapters float to the top; the tray-icon badge counts them on every screen. |
| Per-source detail | A `⚙️` view per manga: every source split into **Available** / **Excluded**, each with rescan + exclude controls. |
| Smart auto-exclude | Sources that don't match, error, or sit far behind your progress are remembered and skipped next scan. |
| Live progress panel | A draggable floating panel shows `X/Y + current title` while a scan runs, on any screen. |
| Cheap rescans | TTL skips manga checked within *N* minutes; parallel batches keep a full-list scan fast. |

---

## 🚀 Quick Start

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. **Pin the tray icon** (top-right of the seanime navbar) so the tray can open.
3. Open the tray and hit **↻ Scan**. Manga with new chapters land in the **New chapters** section.

> [!NOTE]
> Uses only your **already-installed manga providers** through documented APIs (`$ui.register`, `ctx.newTray`, `ctx.newWebview`, `ctx.manga.*`, `ctx.state`, `$storage`, `$anilist`). It makes **no external HTTP calls of its own** — hence an empty `networkAccess` allow-list.

### Configuration

| Field | Default | Notes |
| ----- | ------- | ----- |
| `ttlMinutes` | `60` | Skip re-checking a manga scanned within this many minutes. **Force rescan** ignores it. |
| `farBehindGap` | `10` | Auto-exclude a source this many chapters *behind* your progress (likely a wrong match). |
| `parallelBatch` | `10` | How many providers to probe at once per manga. |

---

## 🔧 How it works

Scanning is a UI action, not a hook — everything runs inside the `$ui.register` callback:

1. **Collect** every `CURRENT` entry from `ctx.manga.getCollection()`.
2. **Per manga**, empty seanime's chapter cache, then fetch each non-excluded provider fresh (in parallel batches of `parallelBatch`), passing the entry's AniList titles so providers can fuzzy-match.
3. **Classify** each source against your reading progress → `new` / `up-to-date` / `outdated` / `no match` / `error`.
4. **Summarize** the manga from its best (most-unread, non-excluded) source as `+N · M`.
5. **Auto-exclude** any source that didn't match, errored, or is `farBehindGap`+ chapters behind — persisted so the next scan skips it.

Results, per-source probes, exclusions and pins all live in `$storage`, so a reload shows the **last scan** immediately without re-probing.

> [!NOTE]
> There is **no per-manga "selected provider."** seanime owns the reader's source choice; this plugin only *reports* which source is furthest ahead. Reading still happens through seanime's normal provider selection.

### Cost controls

| Control | Effect |
| ------- | ------ |
| **TTL** (`ttlMinutes`) | A fresh, good prior result is reused with zero network. |
| **Auto-exclude** | A bad source for a manga is never re-fetched — that's the point of excluding it. |
| **Parallel batches** | Up to `parallelBatch` providers probed concurrently per manga. |
| **Cancel** | Stops mid-scan; every manga already scanned keeps its result (progress is persisted per-manga). |

---

## 🗂 Source detail view

Click **⚙️** on any manga row (or open the tray while viewing a manga entry page) for the per-source breakdown.

- **Available** — every non-excluded provider, sorted furthest-ahead first. Each shows its latest chapter + a `+N new` pill, an **↻** to rescan just that source, and an **Exclude ▾** dropdown.
- **Excluded** — sources dropped for this manga, tagged with **why** (behind, no match, error, wrong numbers, manual). Each has an **Include** button to bring it back (which immediately re-probes just that source).
- **↻ Scan this manga** re-probes only the open manga; **Open →** jumps to it in seanime.

<details>
<summary>Exclude reasons</summary>

| Reason | Badge | Set by |
| ------ | ----- | ------ |
| Behind / outdated | `behind` | auto (`farBehindGap`) or manual |
| No match | `no match` | auto (source returned nothing) or manual |
| Fetch error | `error` | auto (provider threw) or manual |
| Wrong chapter numbers | `bad numbers` | manual |
| Other | `manual` | manual |

Manually excluding **or** including a source **pins** it for that manga, so a later auto-exclude can't undo your choice. **Clear exclusions** (in the `…` menu) resets every manga's exclusions; **Force rescan** then re-checks all sources.

</details>

---

## 🔐 Permissions

- `storage` — last scan results, per-source probes, exclusions, and manual pins.
- `anilist` — resolve title / cover / progress for a manga not in the collection lookup, without an extra request.
- **No `networkAccess`** — the plugin never calls an external host; it reads chapters through seanime's own installed providers.

---

## ⚠️ Known limitations

- **Tray must be pinned** to open — a documented limitation of the tray API.
- **Reading list only.** Scans `CURRENT` entries; manga in Planning/Completed/etc. aren't swept (open one's entry page to probe it on demand).
- **`local-manga` is skipped** — it's your local library, not a release source.
- **One scan at a time.** A per-manga or per-source scan blocks the global scan (and vice-versa) — they'd fight over the shared chapter cache.
- **Chapter numbers are floats.** Unread counts floor the gap (`+0` on a `.5` release), so a source can read "up to date" until a whole chapter lands.

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
