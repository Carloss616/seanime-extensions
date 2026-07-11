import {
  decodeExtId,
  decodeLocalId,
  isCustomSourceId,
  parseCustomSourceManifestId,
} from "../../../_utils/custom-source-id";
import { K_SOURCES } from "./constants";
import type { TimestampMeta } from "./types";

// Per custom-source manga entry: the stable cross-instance identity
// (manifestId + localId) plus the instance-specific runtime extId. Native
// AniList entries get no ref (their mediaId is already stable).
export interface CustomSourceRef extends TimestampMeta {
  manifestId: string; // stable across instances (e.g. "mangaupdates")
  localId: number; // stable across instances (id the custom-source assigned)
  extId: number; // instance-specific runtime extension identifier (1..1023)
}

export type SourceMap = Record<string, CustomSourceRef>;

// Build a ref from a scan entry's mediaId + siteUrl. undefined for a native
// AniList entry or a custom-source entry whose siteUrl can't be parsed.
export function buildSourceRef(
  mediaId: number,
  siteUrl: string | undefined,
  now: number,
): CustomSourceRef | undefined {
  if (!isCustomSourceId(mediaId)) return undefined;
  const manifestId = parseCustomSourceManifestId(siteUrl);
  if (!manifestId) return undefined;
  return {
    manifestId,
    localId: decodeLocalId(mediaId),
    extId: decodeExtId(mediaId),
    updatedAt: now,
  };
}

// Insert/update a ref, bumping updatedAt only when the record is new or was
// tombstoned — for a given mediaId key, localId/extId/manifestId are all fixed
// (localId/extId decode from the key), so a live prior record is always current.
// A no-op after the first record ("only edit what changes"). Never mutates the
// input map.
export function upsertSourceRef(
  map: SourceMap,
  mediaId: number,
  ref: CustomSourceRef,
): { map: SourceMap; changed: boolean } {
  const key = String(mediaId);
  const prev = map[key];
  if (prev && prev.deletedAt == null && prev.manifestId === ref.manifestId) {
    return { map, changed: false };
  }
  return { map: { ...map, [key]: ref }, changed: true };
}

export function getSources(): SourceMap {
  const raw = $storage.get<SourceMap>(K_SOURCES);
  return raw && typeof raw === "object" ? raw : {};
}

export function setSources(map: SourceMap): void {
  $storage.set(K_SOURCES, map);
}
