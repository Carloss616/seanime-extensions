# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.1] - 2026-07-09

### Removed
- Command palette (the `l` keyboard shortcut with New entry / Reload catalog / Reload progress / per-entry edit). Manage entries from the tray instead.

### Changed
- Manga-page button relabeled to 🗂️ ("Edit local entry", gray-subtle).
- Internal: register and hook logic extracted into co-located, unit-tested `utils/` modules (progress sync round-trip, form parse, drift detection, ext-id resolution, client-cache keys). No change to sync/drift/catalog behavior.
