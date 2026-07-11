// Pull → LWW merge → apply remote-newer → push-if-changed. Shared by the
// tray's reload/sync flows and the onGetMangaCollection silent-sync hook.

import { encodeMediaId } from "../../../_utils/custom-source-id";
import type { GistClient } from "../../../_utils/gist/client";
import {
  mergeProgress,
  parseProgress,
  progressMangaEquals,
  serializeProgress,
} from "../../../_utils/local-catalog/progress";
import type { createLogger } from "../../../_utils/logger";
import { type ApplyDeps, applyRemote } from "./progress-sync";

export interface ProgressRoundTripResult {
  merged: LocalProgress;
  remote: LocalProgress;
  applied: number;
  skipped: number;
  pushed: boolean;
}

export async function syncProgressRoundTrip(deps: {
  client: GistClient;
  gistId: string;
  filename: string;
  local: LocalProgress;
  now: number;
  log: ReturnType<typeof createLogger>;
  mediaIdByLocalId?:
    | Map<number, number>
    | ((merged: LocalProgress) => Map<number, number>);
  updateEntry?: ApplyDeps["updateEntry"];
  /** When true, merge + push only — no applyRemote (e.g. extId not cached yet). */
  skipApply?: boolean;
}): Promise<ProgressRoundTripResult> {
  let remoteStr = "";
  try {
    remoteStr = await deps.client.getGistFile(deps.gistId, deps.filename);
  } catch (_) {
    remoteStr = "";
  }
  const remote = parseProgress(remoteStr, deps.log);
  const merged = mergeProgress(deps.local, remote, deps.now);
  const res =
    deps.skipApply || !deps.updateEntry
      ? { applied: 0, skipped: 0 }
      : (() => {
          const lookup =
            typeof deps.mediaIdByLocalId === "function"
              ? deps.mediaIdByLocalId(merged)
              : (deps.mediaIdByLocalId ?? new Map<number, number>());
          return applyRemote(merged, deps.local, {
            updateEntry: deps.updateEntry,
            mediaIdByLocalId: lookup,
          });
        })();
  const pushed = !progressMangaEquals(merged.manga, remote.manga);
  if (pushed) {
    await deps.client.updateGistFile(
      deps.gistId,
      deps.filename,
      serializeProgress(merged),
    );
  }
  return {
    merged,
    remote,
    applied: res.applied,
    skipped: res.skipped,
    pushed,
  };
}

/** Build a localId → mediaId map from merged progress keys + cached extId. */
export function buildEncodedMediaIdLookup(
  merged: LocalProgress,
  extId: number,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const key of Object.keys(merged.manga)) {
    const localId = Number(key);
    if (Number.isFinite(localId)) {
      map.set(localId, encodeMediaId(extId, localId));
    }
  }
  return map;
}
