# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.0] - 2026-07-13

### Changed
- Gist binding management moved into a **⋮ actions menu** in the tray header — Copy raw catalog URL / Unlink / Delete when linked, Create / Link when not — replacing the old ⚙️ expand toggle.
- Linking an existing gist (paste input) and confirming a remote delete now surface as an inline banner near the top of the tray, matching the drift banner, instead of an always-expanded section and a two-click arm button.

### Fixed
- Re-linking the same gist no longer raises a false "reading progress drift".
- The drift banner now clears when you unlink or delete the gist (it used to linger).
- Fully disconnecting GitHub (no PAT fallback) now clears any pending drift instead of resurfacing it on reconnect.
- The ⋮ actions menu no longer renders opaque/disabled during a reading-progress drift — only catalog drift blocks binding management.

## [2.3.0] - 2026-07-12

### Added
- **Connect GitHub** in the tray — a browser device-flow login (enter a short code at github.com/login/device, no token pasted into seanime) as an alternative to the `githubToken` PAT config field. Either path lights up Gist mode. The tray shows a connection badge (Connected / Synced · via GitHub login | PAT) with a ⋮ menu to Disconnect (device-flow only — a PAT is cleared in config).

### Changed
- Buttons that kick off work (Reload / Create / Link / Merge / Apply / Open …) now show a native loading spinner instead of a swapped emoji label.
- Internal: `$storage` keys moved to the repo-wide camelCase convention. A one-time migration carries existing catalog / gist binding / progress / ext-id data forward on upgrade — no action needed.
- Internal: the connect UI is now the shared `github-connect` component (identical to Manga Source Updates).

## [2.2.1] - 2026-07-09

### Removed
- Command palette (the `l` keyboard shortcut with New entry / Reload catalog / Reload progress / per-entry edit). Manage entries from the tray instead.

### Changed
- Manga-page button relabeled to 🗂️ ("Edit local entry", gray-subtle).
- Internal: register and hook logic extracted into co-located, unit-tested `utils/` modules (progress sync round-trip, form parse, drift detection, ext-id resolution, client-cache keys). No change to sync/drift/catalog behavior.
