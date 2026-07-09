import {
  K_GIST,
  K_PROGRESS,
  K_PROGRESS_UPDATED,
  K_SYNC_PAUSED,
  PROGRESS_FILENAME,
  progressPayloadKey,
  SHARED_LIB_NAME,
  STORE_DRIFT_NOTIFIED,
} from "../utils/constants";
import { wrapUpdateEntryWithSkip } from "../utils/progress-capture";
import type { sharedLib } from "./shared-lib";

// Persist captured payload + sync with the gist (source of truth).
// handlePostUpdate handles the branching: cache present → push, cache absent
// + remote present → restore-from-remote, cache absent + remote absent →
// push-new. We don't block event.next() on the network.
export const onPostUpdateEntry = (event: $app.PostUpdateEntryEvent) => {
  const {
    createLogger,
    GistClient,
    decodeLocalId,
    handlePostUpdate,
    parseProgress,
  } = $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
  const log = createLogger();
  try {
    if (event.mediaId == null) {
      event.next();
      return;
    }
    const payload = $store.get<Partial<MangaProgressEntry>>(
      progressPayloadKey(event.mediaId),
    );
    if (!payload) {
      event.next();
      return;
    }
    $store.remove(progressPayloadKey(event.mediaId));

    const localId = decodeLocalId(event.mediaId);
    const now = Date.now();
    const local = parseProgress($storage.get<LocalProgress>(K_PROGRESS), log);
    const token = ($getUserPreference("githubToken") ?? "").trim();
    const gistId = $storage.get<string>(K_GIST) ?? "";
    const syncPaused = $storage.get<boolean>(K_SYNC_PAUSED) ?? false;
    const client =
      !syncPaused && token && gistId ? new GistClient(token, fetch) : null;
    const mediaId = event.mediaId;
    if (syncPaused && token && gistId) {
      if (!$store.get<boolean>(STORE_DRIFT_NOTIFIED)) {
        $store.set(STORE_DRIFT_NOTIFIED, true);
        log.warn(
          "catalog drift pending — saved locally only. Resolve in tray.",
        );
      }
    }

    handlePostUpdate({
      mediaId,
      localId,
      payload,
      now,
      local,
      client,
      gistId,
      filename: PROGRESS_FILENAME,
      applyToSeanime: (entry: MangaProgressEntry) => {
        wrapUpdateEntryWithSkip(mediaId, () => {
          $anilist.updateEntry(
            mediaId,
            entry.status,
            entry.score,
            entry.progress,
            undefined,
            undefined,
          );
        });
      },
      persistLocal: (doc: LocalProgress, updatedAt: number) => {
        $storage.set(K_PROGRESS, doc);
        $storage.set(K_PROGRESS_UPDATED, updatedAt);
      },
    }).catch((e: unknown) => {
      log.warn("post-update-entry sync failed:", e);
    });
  } catch (e) {
    log.error("post-update-entry error:", e);
  }
  event.next();
};
