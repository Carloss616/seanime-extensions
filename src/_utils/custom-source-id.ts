// Custom-source mediaId codec. seanime assigns synthetic ids to custom-source
// entries (see CLAUDE.md "Custom-source mediaId encoding" + seanime's
// internal/customsource/customsource.go):
//
//   mediaId = EXT_ID_OFFSET + (extensionIdentifier << 40) + localId
//
// EXT_ID_OFFSET is the boundary between AniList ids (< 2^31) and custom-source
// ids; LOCAL_ID_RANGE is the per-extension localId range (2^40). JS bitwise ops
// are int32, so all arithmetic here uses `*`/`%`/`Math.floor` instead of shifts.
//
// Shared cross-extension: both the local-catalog-manager plugin and the
// mangaupdates-sync plugin decode/encode these ids. Imported normally; the
// build inlines the consts/functions into each isolated callback body, so they
// survive goja's `.toString()` re-eval (see CLAUDE.md "Splitting an extension
// across multiple files").

// Boundary between AniList ids and custom-source ids (2^31).
export const EXT_ID_OFFSET = 0x80000000;
// Per-extension localId range (2^40).
export const LOCAL_ID_RANGE = 0x10000000000;
// seanime assigns each loaded custom-source an identifier in 1..1023 (0x3FF).
export const MAX_EXT_ID = 0x3ff;

// True when the mediaId belongs to a custom-source (vs. a native AniList id).
export function isCustomSourceId(mediaId: number): boolean {
  return mediaId >= EXT_ID_OFFSET;
}

// Recover the catalog-/provider-local id from a synthetic custom-source mediaId.
export function decodeLocalId(mediaId: number): number {
  return (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
}

// Recover the runtime extension identifier (1..1023) from a mediaId.
export function decodeExtId(mediaId: number): number {
  return Math.floor((mediaId - EXT_ID_OFFSET) / LOCAL_ID_RANGE);
}

// Compose a synthetic mediaId from a (runtime) extension identifier + localId.
export function encodeMediaId(extId: number, localId: number): number {
  return EXT_ID_OFFSET + extId * LOCAL_ID_RANGE + localId;
}

// Extract the custom-source MANIFEST id from a seanime-wrapped siteUrl:
//   ext_custom_source_<manifest-id>|END|<original-url>
// Returns undefined for a native AniList entry or a malformed wrapper. Unlike
// each plugin's own SOURCE_PREFIX check (which matches ONE known manifest), this
// extracts whatever manifest id is present — MSU spans every installed source.
export function parseCustomSourceManifestId(
  siteUrl: string | undefined,
): string | undefined {
  const PREFIX = "ext_custom_source_";
  if (!siteUrl || siteUrl.indexOf(PREFIX) !== 0) return undefined;
  const end = siteUrl.indexOf("|END|");
  if (end < 0) return undefined;
  const id = siteUrl.slice(PREFIX.length, end);
  return id || undefined;
}

// Stable cross-instance identity for a custom-source entry: manifest id + the
// provider-local id (both stable across installs, unlike the synthetic mediaId
// whose extId differs per install). Used as the Phase 2 sync key.
export function stableCustomSourceKey(
  manifestId: string,
  localId: number,
): string {
  return `${manifestId}:${localId}`;
}
