# Local Catalog Manager

A seanime **plugin** companion to the `local-catalog` custom-source. It lets you add/edit/delete catalog entries from inside seanime. Two operating modes:

- **Gist mode** (GitHub token configured) — changes are auto-pushed to a secret GitHub Gist; the custom-source reads from the Gist's raw URL and the catalog syncs across devices.
- **Local mode** (no token) — changes are kept in plugin storage on this device; copy the serialized JSON into the source's **Inline catalog JSON** field by hand.

## Setup

### Gist mode (recommended for multi-device)

1. Create a GitHub **Personal Access Token** with the `gist` scope.
2. Paste it into this plugin's **GitHub token** config field and save.
3. Open the plugin tray. On first save it creates a secret Gist and shows its **raw URL** — copy it into the `local-catalog` source's **Catalog URL**.
4. Manage entries from the tray (or the "Edit local entry" button on a manga page, or the command palette). Changes are pushed to the Gist automatically.

#### Managing the gist binding (from the tray)

The tray has a **🔗 GIST BINDING** section with three states / actions:

- **Not linked:** **🆕 Create new gist** (auto-creates a secret gist seeded with an empty catalog) or paste a URL/ID into the **Link** input.
- **Linked:** **📋 Show raw URL** (toast with the raw URL — copy from there), **🔓 Unlink** (forget the gist locally, leave it on GitHub, clears local progress cache), **🗑 Delete remotely** (two-click confirm: first click arms the button, second click runs `DELETE /gists/:id` on GitHub and clears local state).

Accepted link formats: `https://gist.githubusercontent.com/<user>/<id>/raw/catalog.json`, `https://gist.github.com/<user>/<id>`, or the bare `<id>` hex string.

Legacy installs with the old `gistUrl` config field set: the plugin migrates the value into local storage on first load — no action required.

### Local mode (single device, inline JSON)

1. Leave the **GitHub token** field empty.
2. Open the plugin tray. Add/edit/delete entries — they persist in plugin storage on this device.
3. Copy the **Catalog JSON (copy)** input into the `local-catalog` source's **Inline catalog JSON** field. Repeat after each batch of edits.
4. To seed the plugin from an existing inline catalog, paste it into the **Paste catalog JSON to import** field and click **Import**.

## Sync

(Gist mode only — local mode has no remote sync.)

- Every add/edit/delete is pushed to the Gist.
- **Pull now** (tray) re-reads the Gist. Enable **Auto-sync** to pull on an interval (default 30 min). Auto-sync only runs once a Gist exists and a token is configured.
- There is **no automatic conflict resolution**: a push overwrites the Gist
  with your local copy (blind last-write-wins on the server), and a pull
  replaces your local copy with the Gist. Each catalog carries an `updatedAt`
  field, but it is informational — edit from one device at a time, or **Pull
  now** before editing on a second device, to avoid clobbering changes.

## Reading progress sync (V2-B)

In Gist mode, this plugin also syncs your reading position (chapter, status,
score) across devices via a second file `progress.json` in the same gist.

- Every progress / entry update for a `local-catalog` manga is captured by
  hooks (`onPre/PostUpdateEntry` + `onPre/PostUpdateEntryProgress`) and pushed
  to the gist (fire-and-forget; failures are logged but don't block the
  underlying update).
- **Pull progress** (tray button or command palette `lcm-pull-progress`)
  re-applies the remote progress to your local library via
  `$anilist.updateEntry`.
- Auto-sync (existing toggle) now pulls both `catalog.json` AND `progress.json`.
- **Dates are not synced literally** — `startedAt` / `completedAt` are
  auto-managed per device by seanime based on status transitions (e.g.
  status → `CURRENT` sets `startedAt` on this device).
- **Conflict resolution**: per-entry last-write-wins by `updatedAt`. Edits on
  different devices to *different* entries both survive; edits on the *same*
  entry, the most recent wins. Ties → local.
- **Orphan progress**: if you delete a catalog entry but its progress remains
  in `progress.json`, a "🧹 Clean orphans (N)" button appears in the tray.
- In Local mode (no GitHub token), progress sync is a no-op — the tray shows
  a hint that Gist mode is required.

### Limitations

- `mediaId` lookup uses `ctx.manga.getCollection()`. If you've never opened a
  manga page on a freshly-installed device, the collection may be empty and
  the first pull-progress is a no-op. Open any manga page once, then pull.
- Push is fire-and-forget per update event. GitHub Gist's rate limit is
  5000 requests/hour for authenticated tokens; for normal reading this is
  fine.

## Notes

This plugin manages catalog **metadata** (V2-A) AND reading-progress sync (V2-B).
Both share the same secret Gist (`catalog.json` + `progress.json`).
