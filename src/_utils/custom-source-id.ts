// Custom-source mediaId codec (see CLAUDE.md "Custom-source mediaId encoding" +
// seanime's internal/customsource/customsource.go):
//
//   mediaId = EXT_ID_OFFSET + (extensionIdentifier << 40) + localId
//
// EXT_ID_OFFSET is the boundary between AniList ids (< 2^31) and custom-source
// ids; LOCAL_ID_RANGE is the per-extension localId range (2^40). JS bitwise ops
// are int32, so all arithmetic here uses `*`/`%`/`Math.floor` instead of shifts.

export const EXT_ID_OFFSET = 0x80000000;
export const LOCAL_ID_RANGE = 0x10000000000;
// seanime assigns each loaded custom-source an identifier in 1..1023 (0x3FF).
export const MAX_EXT_ID = 0x3ff;

export function isCustomSourceId(mediaId: number): boolean {
  return mediaId >= EXT_ID_OFFSET;
}

export function decodeLocalId(mediaId: number): number {
  return (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
}

export function decodeExtId(mediaId: number): number {
  return Math.floor((mediaId - EXT_ID_OFFSET) / LOCAL_ID_RANGE);
}

export function encodeMediaId(extId: number, localId: number): number {
  return EXT_ID_OFFSET + extId * LOCAL_ID_RANGE + localId;
}

// Extract the custom-source MANIFEST id from a seanime-wrapped siteUrl:
//   ext_custom_source_<manifest-id>|END|<original-url>
// Returns undefined for a native AniList entry or a malformed wrapper.
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

// Stable cross-instance identity: manifest id + provider-local id (both stable
// across installs, unlike the synthetic mediaId whose extId differs per install).
export function stableCustomSourceKey(
  manifestId: string,
  localId: number,
): string {
  return `${manifestId}:${localId}`;
}
