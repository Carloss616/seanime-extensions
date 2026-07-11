# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.7.0] - 2026-07-11

### Added
- Cross-device sync: your exclusions, pins, scan summaries, per-source probes, and manual matches sync across every seanime instance where you run the plugin, through one private GitHub Gist. Each map is its own file in the gist (`seanime-msu-summaries.json`, `-exclusions`, `-pins`, `-probes`, `-matches`) so no single file grows huge; the gist is auto-discovered by filename, so a second device finds it with no manual linking.
- Automatic conflict resolution: when two devices disagree, the newer per-record timestamp wins (last-writer-wins), and a delete newer than an edit sticks. There is no manual conflict prompt, ever. Custom-source entries sync correctly even though seanime assigns them a different local id per install — they're matched across devices by a stable `manifestId:localId` identity.
- GitHub sign-in, two ways: a **Connect GitHub** button in the tray's new Sync section (browser device-flow login — enter a short code at github.com/login/device, no token typed into seanime), or a `githubPat` config field for a Personal Access Token with the `gist` scope.
- Sync section in the tray with a **↻ Sync now** button (a single pull → merge → push round-trip) and last-synced status.
- Optional auto-sync: a silent sync when the tray opens (rate-limited), plus a scheduled background sync every `syncIntervalMinutes` when `autoSync` is on.

### Changed
- New config fields: `githubPat`, `autoSync` (default off), and `syncIntervalMinutes` (default 30). Added the `cron` permission scope and a GitHub network allow-list for the sync.

## [1.6.0] - 2026-07-11

### Added
- Manual-match metadata: when you manually match a manga to a provider series, the mapping (provider + mapped id) is recorded together with a per-install instance id identifying which machine set it — groundwork for cross-device sync and "matched on another device" warnings. Captured the moment the match panel shows its state, so an already-matched manga is recorded on open, not only when the mapping changes.
- Custom-source identity: during each scan (full list and per-manga "Scan this manga"), every custom-source entry's stable cross-instance identity (manifest id + provider-local id) is recorded to `$storage` with no extra network calls — the key a future sync uses to match the same manga across machines, where seanime assigns a different local id per install.

### Changed
- All stored data (exclusions, pins, scan summaries, per-source probes, manual matches) now carries a per-record `updatedAt` timestamp plus soft-delete tombstones — the schema foundation the upcoming cross-device sync builds on. No visible change to behavior.
- Renamed the internal `$storage` keys for consistency (`exclusions`, `summaries`, `pins`, `probes`, `matches`, `sources`, `instanceId`). Existing scan cache and exclusions re-initialize on the next scan.

## [1.5.0] - 2026-07-09

### Added
- Cancel button in the floating scan panel — stops a global, per-manga, or single-source scan; the "Cancelling…" state is reflected in the panel.
- Manga cover thumbnail in the scan panel; click it to open that manga's entry (or jump straight to its source detail when you're already on the entry / the tray is open).
- Per-manga "Clear exclusions" button in the source detail view (shown only when that manga has exclusions).
- Live ⏳ indicator on each source's rescan button while that provider is being fetched in the active scan.

### Changed
- Clear exclusions (global menu item and the new per-manga button) now also clears pins and re-discovers every source from scratch (global → force rescan; per-manga → rescan that manga), so auto-exclude re-runs cleanly instead of a stale pin suppressing it.
- Scan controls in the detail view are disabled while any scan is running, including a global scan on another manga.
- Scan panel restyled to match seanime's own UI (paper card, badge, action footer), with dark + light support.

### Fixed
- Sources with no match were mislabeled "error". seanime throws the same way for "no series matched" and a genuine fetch failure, so the thrown message is now inspected — a no-match reads as "no match", and only real fetch errors read as "error".
