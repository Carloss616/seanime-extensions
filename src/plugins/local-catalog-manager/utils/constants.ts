// Single source of truth for all constants shared across the plugin's
// modules (code.ts + hooks + register). Imported via `import { ... }`; Bun
// bundling inlines the literal value at each use site, so each isolated
// callback wrapper carries its own copy without referencing a runtime const.

// $shared.define key — must match the string passed to `$shared.use` in
// every hook callback and the register module.
export const SHARED_LIB_NAME = __MANIFEST_ID__;

// Custom-source identity. Seanime wraps a custom-source manga's siteUrl as
// `ext_custom_source_<manifest-id>|END|<original-url>`; we filter incoming
// hook events against this prefix to skip non-local-catalog entries.
export const SOURCE_PREFIX = "ext_custom_source_local-catalog";

// Gist file names (both files live in the same gist — see README).
export const CATALOG_FILENAME = "seanime-local-catalog.json";
export const PROGRESS_FILENAME = "seanime-local-progress.json";
export const GIST_DESCRIPTION = "Seanime local catalog and progress sync";

// $storage keys. All prefixed `lcm_` (matches plugin id `local-catalog-manager`).
export const K_GIST = "lcm_gist_id";
export const K_OWNER = "lcm_owner";
export const K_RAW = "lcm_raw_url";
export const K_CATALOG = "lcm_catalog";
export const K_UPDATED = "lcm_updated_at";
// Monotonic id high-water mark (highest id ever issued). Catalog ids map 1:1
// to seanime mediaIds (localId === id) and seanime caches media details by
// mediaId, so reusing a deleted entry's id makes the new entry inherit the
// old one's cached page. We never reuse: ids only ever increase, even across
// deletes. Seeded from the catalog on first run (installs predate this key).
export const K_NEXT_ID = "lcm_next_id";
export const K_PROGRESS = "lcm_progress";
export const K_PROGRESS_UPDATED = "lcm_progress_updated_at";
// Set true while catalog drift is pending (linked an existing gist that
// disagrees with local). Hooks read this and fall back to local-only writes
// so the user's reading doesn't clobber remote until they resolve the drift.
export const K_SYNC_PAUSED = "lcm_sync_paused";
// Persisted remote catalog captured at link time, so the drift UI can
// re-render after a seanime restart (pendingDrift is runtime state).
// Cleared together with K_SYNC_PAUSED when drift is resolved.
export const K_DRIFT_REMOTE = "lcm_drift_remote";
// True when the current drift was triggered by 'Create new gist' (vs.
// linking an existing one). Cancel-link then ALSO deletes the freshly
// created gist so the user doesn't leave an empty orphan on GitHub.
export const K_DRIFT_FRESH_GIST = "lcm_drift_fresh_gist";
// Persisted remote progress doc captured when link-time drift was detected
// for reading-progress. Lets the drift UI re-render after a seanime
// restart. Cleared when the user resolves the progress drift.
export const K_PROGRESS_DRIFT_REMOTE = "lcm_progress_drift_remote";
// Cached runtime extension identifier (1-1023) — seanime assigns this when
// the custom-source loads (random, persisted in seanime's filecache, NOT
// stable across reinstalls). We discover it from the collection or via
// probe ($anilist.getManga sweep) and cache it so we can compute mediaIds
// for catalog entries that aren't in the user's list yet — needed by the
// "Open →" link and the auto-add path in "Push local progress".
export const K_EXT_ID = "lcm_ext_id";

// $store keys (cross-runtime, in-memory).
export const STORE_SILENT_SYNC_AT = "lcm:silent-sync-at";
export const STORE_DRIFT_NOTIFIED = "lcm:drift-notified";
export const SILENT_SYNC_COOLDOWN_MS = 10_000;

export function progressSkipKey(mediaId: number): string {
  return `progress:skip:${mediaId}`;
}

export function progressPayloadKey(mediaId: number): string {
  return `progress:${mediaId}`;
}
