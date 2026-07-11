# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
