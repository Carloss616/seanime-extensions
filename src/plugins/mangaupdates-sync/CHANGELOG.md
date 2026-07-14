# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] - 2026-07-13

### Fixed
- Opening a linked manga's detail view no longer crashes the plugin ("Fatal error: expected string, got nil"). The MangaUpdates status pill was being rendered in a way that broke the tray render.

## [1.2.1] - 2026-07-09

### Changed
- Manga-page link button relabeled: 🔓 when unlinked, 🔗 when linked (was MU 🔍 / MU ✅).
- Series-URL fallback (used when a MU record has no `url`) now points at the redirecting `series.html?id=<series_id>` endpoint, which resolves server-side to the canonical series page.

### Fixed
- Duplicate / misplaced MangaUpdates icon on the entry page (custom-source entries nested the icon inside another button's tooltip) — the injector now dedupes against the live DOM and re-inserts as a sibling wrapper.
- Link tray sometimes failed to find an entry's list data because a media-id comparison crossed the goja↔Go boundary; ids are now coerced before comparing.
