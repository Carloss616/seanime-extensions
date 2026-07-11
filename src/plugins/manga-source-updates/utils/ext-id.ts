import {
  encodeMediaId,
  MAX_EXT_ID,
  parseCustomSourceManifestId,
} from "../../../_utils/custom-source-id";
import type { SourceMap } from "./sources";

// manifestId → this instance's extId, built from the LOCAL K_SOURCES refs.
// Free and covers the common case (source installed with ≥1 manga in the list).
// Live refs only — a tombstoned ref's extId is stale.
export function buildManifestExtIdIndex(
  sources: SourceMap,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ref of Object.values(sources)) {
    if (ref.deletedAt != null) continue;
    if (out[ref.manifestId] == null) out[ref.manifestId] = ref.extId;
  }
  return out;
}

export interface ProbeDeps {
  getManga: (mediaId: number) => { siteUrl?: string } | null | undefined;
  sleep: (ms: number) => void;
}

// Cold-start fallback for a manifest with ZERO local manga: iterate extId 1..1023,
// asking $anilist.getManga for the synthetic mediaId of (extId, localId) and
// accepting the one whose siteUrl decodes to the target manifest. `localId` is a
// known-good id taken from the remote wire record. Yields every 64 iterations so
// the ~1023 sync calls don't block the runtime. ponytail: linear probe, 1-3s
// worst case, cached by the caller per sync run — only runs for a source with no
// local manga, which is rare.
export function probeExtId(
  manifestId: string,
  localId: number,
  deps: ProbeDeps,
): number | null {
  for (let extId = 1; extId <= MAX_EXT_ID; extId++) {
    if (extId % 64 === 0) deps.sleep(0);
    try {
      const m = deps.getManga(encodeMediaId(extId, localId));
      if (m?.siteUrl && parseCustomSourceManifestId(m.siteUrl) === manifestId) {
        return extId;
      }
    } catch (_) {
      // getManga throws for unknown mediaIds — keep probing.
    }
  }
  return null;
}
