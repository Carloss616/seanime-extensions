// $shared.define / $shared.use key.
export const SHARED_LIB_NAME = __MANIFEST_ID__;

// seanime wraps a custom-source siteUrl as `ext_custom_source_<id>|END|<url>`;
// hooks filter incoming events against this prefix.
export const SOURCE_PREFIX = "ext_custom_source_local-catalog";

// Gist files (both live in the same gist).
export const CATALOG_FILENAME = "seanime-local-catalog.json";
export const PROGRESS_FILENAME = "seanime-local-progress.json";
export const GIST_DESCRIPTION = "Seanime local catalog and progress sync";

// $storage keys. Values are plain camelCase (no prefix — $storage is
// per-extension namespaced); v2.2's `lcm_` keys are carried forward by
// utils/migrate.ts.
export const K_GIST_ID = "gistId";
export const K_OWNER = "owner";
export const K_RAW_URL = "rawUrl";
export const K_CATALOG = "catalog";
export const K_UPDATED_AT = "updatedAt";
// Monotonic high-water mark: ids map 1:1 to seanime mediaIds and are never
// reused (a reused id inherits seanime's cached page for the deleted entry).
export const K_NEXT_ID = "nextId";
export const K_PROGRESS = "progress";
export const K_PROGRESS_UPDATED_AT = "progressUpdatedAt";
// Catalog/progress drift pending → hooks write local-only until resolved.
export const K_SYNC_PAUSED = "syncPaused";
// Remote snapshots captured at link time so the drift UI survives a restart.
// K_DRIFT_FRESH_GIST: drift came from 'Create new gist', so cancel-link also
// deletes the empty gist.
export const K_DRIFT_REMOTE = "driftRemote";
export const K_DRIFT_FRESH_GIST = "driftFreshGist";
export const K_PROGRESS_DRIFT_REMOTE = "progressDriftRemote";
// Cached extId (1-1023) seanime assigns the custom-source — lets us compute
// mediaIds for entries not yet in the user's list. Not stable across
// reinstalls; discovered from the collection or an $anilist.getManga probe.
export const K_EXT_ID = "extId";
// Device-flow token (gist scope); preferred over the githubToken PAT.
export const K_OAUTH_TOKEN = "oauthToken";

// $store keys (cross-runtime, in-memory; reset on restart, so no migration).
export const STORE_SILENT_SYNC_AT = "silentSyncAt";
export const STORE_DRIFT_NOTIFIED = "driftNotified";
export const SILENT_SYNC_COOLDOWN_MS = 10_000;

export function progressSkipKey(mediaId: number): string {
  return `progress:skip:${mediaId}`;
}

export function progressPayloadKey(mediaId: number): string {
  return `progress:${mediaId}`;
}
