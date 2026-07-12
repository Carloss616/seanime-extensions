<div align="center">

<img src="https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/plugins/local-catalog-manager/assets/icon.png" width="96" alt="Local Catalog Manager icon" />

# 🗂️ Local Catalog Manager

![Type](https://shieldcn.dev/badge/type-plugin-3b82f6.svg?variant=secondary)
![Version](https://shieldcn.dev/badge/version-2.3.0-22c55e.svg?variant=secondary)
![TypeScript](https://shieldcn.dev/badge/TypeScript.svg?logo=typescript&color=3178C6&variant=secondary)

**Manage your [Local Catalog](../../custom-source/local-catalog/) from inside seanime — add, edit, delete entries — and sync it to a GitHub Gist.**

[Features](#-features) · [Quick Start](#-quick-start) · [How it works](#-how-it-works) · [Sync](#-catalog-sync)

</div>

---

## 💡 Concept

> The companion plugin to the `local-catalog` custom-source. It also syncs your reading position across devices.

Two operating modes:

- **Gist mode** (GitHub connected via device-flow login or a PAT) — changes are auto-pushed to a secret GitHub Gist; the custom-source reads from the Gist's raw URL and the catalog syncs across devices.
- **Local mode** (not connected) — changes are kept in plugin storage on this device; copy the serialized JSON into the source's **Inline catalog JSON** field by hand.

---

## ✨ Features

| Feature | Description |
| ------- | ----------- |
| In-app CRUD | Add/edit/delete catalog entries from the tray or the **🗂️** manga-page button. |
| Detail form | Contextual header (cover + title when editing), reading-progress section, and **Open →** to the seanime entry page. |
| Gist sync | Auto-push the catalog to a secret Gist the source reads, with optional scheduled pull. |
| Reading-progress sync | Mirror chapter / status / score across devices via a second `progress.json` file. |
| Orphan cleanup | Detect and clear progress left behind by deleted entries. |

---

## 🚀 Quick Start

### Gist mode (recommended for multi-device)

1. Install from the [marketplace](../../../README.md#-quick-start), or paste this extension's `manifest.json` raw URL into seanime → *Add Extension*.
2. Connect GitHub, either way:
   - **Connect GitHub** button in the tray — a browser device-flow login (enter a short code at github.com/login/device, no token typed into seanime), or
   - a **GitHub token** config field for a Personal Access Token with the `gist` scope (fallback).
3. Open the plugin tray. On first save it creates a secret Gist and shows its **raw URL** — copy it into the `local-catalog` source's **Catalog URL**.
4. Manage entries from the tray (or the **🗂️** button on a local-catalog manga page). Changes push to the Gist automatically.

<details>
<summary>Managing the gist binding (from the tray)</summary>

The **🔗 GIST BINDING** section in the tray has two states:

- **Not linked** — **🆕 Create new gist** (makes a secret gist seeded with an empty catalog), or paste a URL/ID into the **Link** input.
- **Linked** — three actions:
  - **📋 Show raw URL** — toast with the raw URL to copy.
  - **🔓 Unlink** — forgets the gist locally (leaves it on GitHub) and clears the local progress cache.
  - **🗑 Delete remotely** — two-click confirm; the second click runs `DELETE /gists/:id` and clears local state.

Accepted link formats: `https://gist.githubusercontent.com/<user>/<id>/raw/catalog.json`, `https://gist.github.com/<user>/<id>`, or the bare `<id>` hex string.

Legacy installs with the old `gistUrl` field: the plugin migrates it into local storage on first load — no action required.

</details>

<details>
<summary>Local mode (single device, inline JSON)</summary>

1. Don't connect GitHub (skip **Connect GitHub** and leave the **GitHub token** field empty).
2. Open the plugin tray. Add/edit/delete entries — they persist in plugin storage on this device.
3. Copy the **Catalog JSON (copy)** input into the `local-catalog` source's **Inline catalog JSON** field. Repeat after each batch of edits.
4. To seed the plugin from an existing inline catalog, paste it into the **Paste catalog JSON to import** field and click **Import**.

</details>

### Configuration

| Field | Notes |
| ----- | ----- |
| `GitHub token` | PAT with the `gist` scope — optional fallback if you prefer not to use the in-app **Connect GitHub** browser login. Not connected either way → Local mode. |
| `Auto-sync` | Off by default. Periodically pull the catalog (and progress) from the Gist. Only runs once a Gist exists and a token is configured. |
| `Auto-sync interval (minutes)` | Pull interval when Auto-sync is on (default `30`). |

---

## 🔧 How it works

You add/edit/delete entries from the tray or the **🗂️** button on a local-catalog manga page. In **Gist mode** each change pushes to `catalog.json` in the secret Gist the source reads; in **Local mode** you copy the JSON into the source's *Inline catalog JSON* field yourself.

### Tray UI

- **List view** — gist/local mode header, catalog sync controls, reading-progress section, searchable entry list.
- **Form view** — opened via **+ New entry**, **⚙️** on a list row, or **🗂️** on the manga page. Opening the tray while viewing a local-catalog manga page jumps straight into the form for that entry.
  - **Header** — cover + resolved title when editing (or **New entry**); **← Back** returns to the list.
  - **Reading progress** — local chapter / status / score, seanime comparison line, **Apply** when drift is detected, **Open →** to the seanime entry page.
  - **Fields** — full `AL_BaseManga` metadata form; **Save** / **Cancel** at the bottom.

For reading-progress sync (Gist mode only), seanime's `onPre/PostUpdateEntry` and `onPre/PostUpdateEntryProgress` hooks capture every change and push it to `progress.json` in the same Gist. **Pull progress** (or Auto-sync) reads it back and restores your position via `$anilist.updateEntry`.

---

## 🔄 Catalog sync

*(Gist mode only — Local mode has no remote sync.)*

- Every add/edit/delete is pushed to the Gist.
- **Pull now** (tray) re-reads the Gist; **Auto-sync** pulls on the configured interval.

> [!WARNING]
> There is **no automatic conflict resolution** for the catalog: a push overwrites the Gist with your local copy (blind last-write-wins), and a pull replaces your local copy with the Gist. The `updatedAt` field is informational — edit from one device at a time, or **Pull now** before editing on a second device, to avoid clobbering changes.

---

## 📖 Reading-progress sync

In Gist mode the plugin also syncs your reading position (chapter, status, score) across devices via a second file `progress.json` in the same gist.

- Every progress / entry update for a `local-catalog` manga is captured by hooks (`onPre/PostUpdateEntry` + `onPre/PostUpdateEntryProgress`) and pushed to the gist (fire-and-forget; failures are logged but don't block the update).
- **Pull progress** (tray button) re-applies the remote progress to your local library via `$anilist.updateEntry`.
- Auto-sync pulls both `catalog.json` and `progress.json`.
- **Conflict resolution:** per-entry last-write-wins by `updatedAt`. Edits to *different* entries on different devices both survive; for the *same* entry, the most recent wins (ties → local).
- **Dates are not synced literally** — `startedAt` / `completedAt` are auto-managed per device by seanime from status transitions.
- **Orphan progress:** if you delete a catalog entry but its progress remains in `progress.json`, a **🧹 Clean orphans (N)** button appears in the tray.
- In Local mode (no token) progress sync is a no-op — the tray shows a hint that Gist mode is required.

---

## ⚠️ Limitations

- `mediaId` lookup uses `ctx.manga.getCollection()`. On a freshly-installed device where you've never opened a manga page, the collection may be empty and the first pull-progress is a no-op — open any manga page once, then pull.
- Push is fire-and-forget per update event. GitHub Gist's rate limit (5000 requests/hour for authenticated tokens) is ample for normal reading.

---

## 📄 License

[Carlos Espinoza](https://github.com/Carloss616). Licensed under [MIT](../../../LICENSE). Part of [seanime-extensions](../../../).
