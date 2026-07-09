# Changelog

All notable changes to this extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.2] - 2026-07-09

### Changed
- Internal refactor: the scope/column logic (breakpoint selection, column
  sanitization, monotonic bounds) moved into a tested `utils/scopes.ts`. No
  user-facing behavior change.
