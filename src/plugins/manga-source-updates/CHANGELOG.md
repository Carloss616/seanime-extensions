# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
