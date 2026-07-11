import {
  decodeLocalId,
  encodeMediaId,
  isCustomSourceId,
  stableCustomSourceKey,
} from "../../../_utils/custom-source-id";
import type { SourceMap } from "./sources";

// Wire keys for custom-source entries carry this prefix so they never collide
// with a plain numeric AniList id. manifest ids contain no ":", so a single
// split on ":" after the prefix is unambiguous (cs:<manifestId>:<localId>).
export const WIRE_CS_PREFIX = "cs:";

// PUSH direction. Native AniList mediaId is already universal → its string.
// Custom-source mediaId is instance-local (embeds this install's extId), so it
// is translated to the stable cs:manifestId:localId identity using the LOCAL
// K_SOURCES ref (O(1)). A custom-source id with no live ref can't be translated
// → return null so the caller skips it from the push (it'll sync once the next
// scan captures its ref). `extId` NEVER appears in a wire key.
export function toWireKey(mediaId: number, sources: SourceMap): string | null {
  if (!isCustomSourceId(mediaId)) return String(mediaId);
  const ref = sources[String(mediaId)];
  if (!ref || ref.deletedAt != null) return null;
  return `${WIRE_CS_PREFIX}${stableCustomSourceKey(ref.manifestId, decodeLocalId(mediaId))}`;
}

// PULL direction. Plain number → that mediaId. cs:manifest:localId → this
// instance's mediaId via encodeMediaId(thisExtId, localId), where thisExtId is
// resolved by the caller (from the local manifest→extId index, or a probe).
// Returns null when the manifest's extId can't be resolved on this instance
// (source not installed / zero local manga and probe failed) or the key is
// malformed — the caller drops it from the local write-back.
export function fromWireKey(
  key: string,
  extIdForManifest: (manifestId: string) => number | null,
): number | null {
  if (key.indexOf(WIRE_CS_PREFIX) !== 0) {
    const n = Number(key);
    return Number.isFinite(n) ? n : null;
  }
  const rest = key.slice(WIRE_CS_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const manifestId = rest.slice(0, sep);
  const localId = Number(rest.slice(sep + 1));
  if (!Number.isFinite(localId)) return null;
  const extId = extIdForManifest(manifestId);
  if (extId == null) return null;
  return encodeMediaId(extId, localId);
}
