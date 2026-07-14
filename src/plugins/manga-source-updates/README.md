<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/manga-source-updates/assets/icon.png" width="96" alt="Manga Source Updates icon" />

# 🔎 Manga Source Updates

![Type](https://shieldcn.dev/badge/type-plugin-3b82f6.svg?variant=secondary)
![Version](https://shieldcn.dev/badge/version-1.8.3-22c55e.svg?variant=secondary)
![TypeScript](https://shieldcn.dev/badge/TypeScript.svg?logo=typescript&color=3178C6&variant=secondary)

**Scans your reading list against every installed manga provider and tells you which sources have new chapters — now synced across your devices.**

[Features](#-features) · [Quick Start](#-quick-start) · [On seanime's pages](#-on-seanimes-pages) · [How it works](#-how-it-works) · [Sync](#-sync) · [Source detail view](#-source-detail-view) · [Permissions](#-permissions)

</div>

---

## 💡 Concept

> One manga, many providers — but seanime only shows the one you read.

This plugin re-checks your **CURRENT** list across *all* installed providers and flags the source that's furthest ahead — in its own tray and on seanime's own pages. UI-only (no update hooks); optionally syncs across devices via a private GitHub Gist.

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| Whole-list scan | Probes every provider for each **CURRENT** manga. |
| Best-source summary | `+N · M` — **N** unread on the furthest-ahead source, **M** sources that have it. |
| New-chapters section | Unread manga float to the top; the tray badge counts them on every screen. |
| Per-source detail | A `⚙️` view: sources split **Available** / **Excluded**, each with rescan + exclude. |
| On seanime's pages | 📚 button, chapter-list bar, and card badges — see [below](#-on-seanimes-pages). |
| Live updates | Read a chapter → counts refresh instantly everywhere, no reopening. |
| Smart auto-exclude | Non-matching, erroring, or far-behind sources are skipped next scan. |
| Live progress panel | A draggable panel shows `X/Y + title` while a scan runs, on any screen. |
| Cheap rescans | TTL skips recently-checked manga; parallel batches keep scans fast. |
| Cross-device sync | Exclusions, pins, results, probes, matches — see [Sync](#-sync). |

---

## 🚀 Quick Start

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. Open the tray (navbar, or the **📚** button on any manga entry) and hit **↻ Scan**.
3. Manga with new chapters land in **New chapters** — and show on seanime's own pages too.

> [!NOTE]
> Scanning uses only your installed providers and makes **no external calls**. Sync (opt-in) is the only outbound traffic — so `networkAccess` is scoped to GitHub only.

### Configuration

| Field | Default | Notes |
| ----- | ------- | ----- |
| `ttlMinutes` | `60` | Skip re-checking a manga scanned within N minutes (**Force rescan** ignores it). |
| `farBehindGap` | `10` | Auto-exclude a source this many chapters behind your progress. |
| `parallelBatch` | `10` | Providers probed at once per manga. |
| `syncNativeButtons` | `true` | Also scan on seanime's **Reload sources** (entry) / **Refresh sources** (library). |
| `githubPat` | *(empty)* | GitHub PAT with the `gist` scope — fallback auth for [Sync](#-sync). |
| `autoSync` | `false` | Periodically sync via the Gist (needs GitHub auth). |
| `syncIntervalMinutes` | `30` | Auto-sync interval in minutes (min 5). |

---

## 🖼 On seanime's pages

Results also render in place, updating live as you read:

| Where | What |
| ----- | ---- |
| **Manga entry** | A native **📚** button → opens the source detail. |
| **Chapter list** | A **"New on: {source} +N"** bar for each non-excluded source with unread chapters (informational). |
| **Library cards** | A **`+N · M`** badge on each scanned cover. |

> [!NOTE]
> Added via seanime's action API (button) + `ctx.dom` injection (bar/badges) — no extra permissions. Reading a chapter updates every surface instantly.

---

## 🔧 How it works

Scanning is a UI action, not a hook — it all runs in the `$ui.register` callback:

1. **Collect** every `CURRENT` entry from `ctx.manga.getCollection()`.
2. **Fetch** each non-excluded provider fresh (parallel batches of `parallelBatch`), passing AniList titles for fuzzy-matching.
3. **Classify** each source vs. your progress → `new` / `up-to-date` / `outdated` / `no match` / `error`.
4. **Summarize** from the best (most-unread) source as `+N · M`.
5. **Auto-exclude** sources that don't match, error, or sit `farBehindGap`+ behind — persisted for next scan.

Everything lives in `$storage`, so a reload shows the last scan instantly. Cost controls: **TTL** reuse (`ttlMinutes`), auto-exclude never re-fetches a bad source, `parallelBatch` concurrency, and **Cancel** keeps already-scanned results.

> [!NOTE]
> There's **no per-manga selected provider** — seanime owns the reader's source choice; this plugin only *reports* which is furthest ahead.

---

## 🔄 Sync

Five local maps sync across your devices via one private GitHub Gist — one file each:

| Map | Holds |
|-----|-------|
| `digest` | Row summaries (the gist's head file). |
| `exclusions` | Sources excluded per manga. |
| `pins` | Your manual exclude/include choices. |
| `probes` | Per-source scan cache. |
| `matches` | Manual source matches. |

Every sync pulls and merges all five files in one request. Pushes are **selective** — an edit uploads only the file(s) it changed.

- **Conflicts resolve automatically.** Each record carries `updatedAt`/`deletedAt`; the newest wins, deletes are tombstone-aware. No manual conflict UI.
- **Custom-source entries sync too**, keyed by a stable `manifestId:localId` (their `mediaId` is randomized per install).
- **Auth:** *Connect GitHub* (browser Device Flow — enter a code, no token typed) or the `githubPat` field (PAT with `gist` scope). Device Flow wins if both are set.
- **The gist is auto-discovered** by its `digest` file — created if missing, no link/unlink UI.

### When it pulls / pushes

Every trigger below **pulls + merges all five files**. They differ only in **what** they push and **when**: manual edits push live, scans push at the end (or on cancel), whole-account triggers push every changed file.

| Trigger | When | Pushes |
|---|---|---|
| Exclude / include a source, clear exclusions | on click | `exclusions` + `pins` |
| Manual match set / cleared (seanime's modal) | on close | `matches` |
| **Scan this manga** / **Scan a source** / global **↻ Scan** | at end **or on cancel** | `digest`, `probes` (+ `exclusions` for full/per-manga) |
| **↻ Sync now** | on click | every changed file |
| Tray opens · **Connect GitHub** · `autoSync` cron | on open / connect / interval | every changed file |

> Syncs are serialized and coalesced (no overlapping writes, no lost edits). Silent whole-account triggers (tray/cron/connect) are throttled to once per 10 s; live edit/scan pushes never are.

> [!IMPORTANT]
> **Connect GitHub** uses the shared *Seanime Extensions Sync* OAuth App (public `GITHUB_CLIENT_ID`, no secret). It blocks the plugin UI while polling for authorization (~15 min max) — fine for a one-time connect. Prefer **`githubPat`** to skip the browser flow.

---

## 🗂 Source detail view

Click **⚙️** on any manga row (or open the tray on a manga entry page) for the per-source breakdown.

- **Available** — active, non-excluded providers, furthest-ahead first. Each shows its latest chapter + a `+N new` pill, an **↻** to rescan it, and an **Exclude ▾** dropdown.
- **Excluded** — sources dropped for this manga, tagged with why (behind, no match, error, wrong numbers, manual). **Include** brings one back and re-probes it.
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

Excluding **or** including a source **pins** it for that manga, so a later auto-exclude can't undo your choice. **Clear exclusions** (in the `…` menu) resets every manga; **Force rescan** then re-checks all sources.

</details>

---

## 🔐 Permissions

- `storage` — scan results, probes, exclusions, pins, and (locally only, never synced) the device-flow token / gist id / last-synced timestamp.
- `anilist` — resolve title / cover / progress for a manga not in the collection lookup.
- `cron` — schedules the optional `autoSync` job.
- `networkAccess` — scoped to `api.github.com`, `github.com`, `gist.githubusercontent.com` only, used solely by [Sync](#-sync). Scanning reads chapters through seanime's own providers, no external calls.

---

## ⚠️ Known limitations

- **Reading list only.** Scans `CURRENT`; open an entry page to probe others on demand.
- **On-page UI targets seanime's DOM.** A major frontend refactor could move the anchors (they fail silently). The "New on:" bar is informational — a plugin can't switch the reader's source.
- **`local-manga` is skipped** — your local library, not a release source.
- **Disabled providers are hidden, not deleted** — re-enabling restores their stored data.
- **One scan at a time** — per-manga/per-source and global scans share the chapter cache.
- **Chapter numbers are floats** — unread counts floor the gap (`+0` on a `.5` release).

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
