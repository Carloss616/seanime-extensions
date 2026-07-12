// TEMPORARY — safe to delete once every device I use has loaded v2.3 at least
// once (this is a personal plugin; no other installs to carry). At that point
// the legacy `lcm_` keys no longer exist anywhere and this is dead code —
// remove this file and its call in code.ts init().
//
// One-shot $storage key migration. v2.2 stored every key `lcm_`-prefixed in
// snake_case (`lcm_gist_id`); v2.3 adopts the repo-wide convention (plain
// camelCase, no prefix — $storage is per-extension namespaced, so the prefix
// was redundant). This copies each legacy key to its new name and drops the
// old one, so an upgrade keeps the user's catalog / gist binding / progress /
// ext-id cache instead of orphaning them under dead keys.
//
// Idempotent + near-free after the first run (14 $storage.has misses). Called
// at the TOP of the register callback — which runs when the plugin loads,
// before the user can do anything. init() (the loader VM) has no $storage, so
// it can't run there. Not called from the hooks: for this personal, one-time
// upgrade the theoretical "a hook writes a fresh key before the user opens the
// plugin" race isn't worth guarding — register migrates first in practice.

// Legacy value → current value. Mirrors utils/constants.ts (old `lcm_*`
// strings on the left, the camelCase values now exported on the right).
const LEGACY_TO_CURRENT: Record<string, string> = {
  lcm_gist_id: "gistId",
  lcm_owner: "owner",
  lcm_raw_url: "rawUrl",
  lcm_catalog: "catalog",
  lcm_updated_at: "updatedAt",
  lcm_next_id: "nextId",
  lcm_progress: "progress",
  lcm_progress_updated_at: "progressUpdatedAt",
  lcm_sync_paused: "syncPaused",
  lcm_drift_remote: "driftRemote",
  lcm_drift_fresh_gist: "driftFreshGist",
  lcm_progress_drift_remote: "progressDriftRemote",
  lcm_ext_id: "extId",
  lcm_oauth_token: "oauthToken",
};

export function migrateStorageKeys(): void {
  for (const oldKey of Object.keys(LEGACY_TO_CURRENT)) {
    if (!$storage.has(oldKey)) continue;
    const newKey = LEGACY_TO_CURRENT[oldKey];
    // Don't clobber a value already written under the new key (shouldn't
    // happen on a clean upgrade, but a re-install mid-migration could): new
    // key wins, we just clear the stale legacy one.
    if (!$storage.has(newKey)) {
      $storage.set(newKey, $storage.get(oldKey));
    }
    $storage.remove(oldKey);
  }
}
