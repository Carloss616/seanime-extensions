// Constants shared across the plugin's modules. Bun inlines the literal value
// at each use site, so each isolated callback wrapper carries its own copy
// without referencing a runtime const.

// $shared.define key — must match the string passed to `$shared.use` in the
// register module and the post-update hook (see modules/shared-lib.ts).
export const SHARED_LIB_NAME = __MANIFEST_ID__;

// Seanime wraps a custom-source manga's siteUrl as
// `ext_custom_source_<manifest-id>|END|<original-url>`. We prefix-match incoming
// hook/UI media against this to detect entries owned by the sibling
// `mangaupdates` custom-source (which renders its own native MU link, so the
// plugin skips them).
export const SOURCE_PREFIX = "ext_custom_source_mangaupdates|END|";

// $store channel between onPreUpdateEntry (write) and onPostUpdateEntry (read).
export const MU_PENDING_PREFIX = "mu_pending_";

export function muPendingKey(mediaId: number): string {
  return `${MU_PENDING_PREFIX}${mediaId}`;
}
