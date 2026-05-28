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

#### Pointing at an existing Gist (e.g. from another device)

If you already have a Gist (you created it from another device, or by hand), paste its raw URL — or just the gist ID — into the **Existing Gist raw URL or ID** config field. The plugin will read/write that gist instead of auto-creating a new one. Leave the field empty to fall back to auto-create on first save.

Accepted formats: `https://gist.githubusercontent.com/<user>/<id>/raw/catalog.json`, `https://gist.github.com/<user>/<id>`, or the bare `<id>` hex string.

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

## Notes

This plugin only manages catalog **metadata**. Reading-progress sync across devices is a separate planned plugin (V2 sub-project B).
