// Discover and cache the seanime-assigned extensionIdentifier (1–1023) for
// the local-catalog custom-source. See CLAUDE.md "Encoding a mediaId".

import { MAX_EXT_ID } from "../../../_utils/custom-source-id";

export interface DiscoverExtIdDeps {
  getCachedExtId: () => number | null | undefined;
  setCachedExtId: (extId: number) => void;
  getLookupEntry: () => [number, number] | undefined;
  decodeExtId: (mediaId: number) => number;
  getProbeLocalId: () => number | undefined;
  getManga: (mediaId: number) => $app.AL_BaseManga | null | undefined;
  sourcePrefix: string;
  encodeMediaId: (extId: number, localId: number) => number;
  sleep: (ms: number) => void;
}

export function mediaIdFor(
  extId: number | null | undefined,
  localId: number,
  encode: (extId: number, localId: number) => number,
): number | null {
  if (extId == null) return null;
  return encode(extId, localId);
}

export async function discoverExtId(
  deps: DiscoverExtIdDeps,
): Promise<number | null> {
  const cached = deps.getCachedExtId();
  if (cached != null) return cached;

  const lookupEntry = deps.getLookupEntry();
  if (lookupEntry) {
    const [, anyMediaId] = lookupEntry;
    const extId = deps.decodeExtId(anyMediaId);
    deps.setCachedExtId(extId);
    return extId;
  }

  const probeLocalId = deps.getProbeLocalId();
  if (probeLocalId == null) return null;

  for (let extId = 1; extId <= MAX_EXT_ID; extId++) {
    if (extId % 64 === 0) deps.sleep(0);
    const candidate = deps.encodeMediaId(extId, probeLocalId);
    try {
      const m = deps.getManga(candidate);
      if (m?.siteUrl && m.siteUrl.indexOf(deps.sourcePrefix) === 0) {
        deps.setCachedExtId(extId);
        return extId;
      }
    } catch (_) {
      // getManga throws for unknown mediaIds — keep probing.
    }
  }
  return null;
}

export async function resolveMediaId(
  localId: number,
  deps: DiscoverExtIdDeps,
): Promise<number | null> {
  const cached = mediaIdFor(deps.getCachedExtId(), localId, deps.encodeMediaId);
  if (cached != null) return cached;
  const extId = await discoverExtId(deps);
  if (extId == null) return null;
  return deps.encodeMediaId(extId, localId);
}

export interface LocalIdFromMediaIdDeps {
  isCustomSourceId: (mediaId: number) => boolean;
  getManga: (mediaId: number) => $app.AL_BaseManga | null | undefined;
  sourcePrefix: string;
  decodeLocalId: (mediaId: number) => number;
}

export function localIdFromMediaId(
  mediaId: number,
  deps: LocalIdFromMediaIdDeps,
): number {
  if (!deps.isCustomSourceId(mediaId)) return 0;
  let m: $app.AL_BaseManga | undefined;
  try {
    m = deps.getManga(mediaId) ?? undefined;
  } catch {
    m = undefined;
  }
  const siteUrl = m?.siteUrl ?? "";
  if (siteUrl.indexOf(deps.sourcePrefix) !== 0) return 0;
  return deps.decodeLocalId(mediaId);
}
