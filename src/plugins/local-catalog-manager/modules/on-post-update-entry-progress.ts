import {
  K_GIST_ID,
  K_PROGRESS,
  K_PROGRESS_UPDATED_AT,
  K_SYNC_PAUSED,
  PROGRESS_FILENAME,
  SHARED_LIB_NAME,
  STORE_DRIFT_NOTIFIED,
} from "../utils/constants";
import { syncToken } from "../utils/token";
import type { sharedLib } from "./shared-lib";

// Same logic as onPostUpdateEntry; separate file because seanime registers
// it under a different hook. The actual decision (push vs restore vs new)
// lives in handlePostUpdate; this file is a thin adapter.
export const onPostUpdateEntryProgress = (
  event: $app.PostUpdateEntryProgressEvent,
) => {
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
    const key = `progress:${event.mediaId}`;
    const payload = $store.get<Partial<MangaProgressEntry>>(key);
    if (!payload) {
      event.next();
      return;
    }
    $store.remove(key);

    const localId = decodeLocalId(event.mediaId);
    const now = Date.now();
    const local = parseProgress($storage.get<LocalProgress>(K_PROGRESS), log);
    const token = syncToken();
    const gistId = $storage.get<string>(K_GIST_ID) ?? "";
    const syncPaused = $storage.get<boolean>(K_SYNC_PAUSED) ?? false;
    // When drift is pending, force local-only writes by nulling the client.
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
        $store.set(`progress:skip:${mediaId}`, true);
        try {
          $anilist.updateEntry(
            mediaId,
            entry.status,
            entry.score,
            entry.progress,
            undefined,
            undefined,
          );
        } finally {
          $store.remove(`progress:skip:${mediaId}`);
        }
      },
      persistLocal: (doc: LocalProgress, updatedAt: number) => {
        $storage.set(K_PROGRESS, doc);
        $storage.set(K_PROGRESS_UPDATED_AT, updatedAt);
      },
    }).catch((e: unknown) => {
      log.warn("post-update-entry-progress sync failed:", e);
    });
  } catch (e) {
    log.error("post-update-entry-progress error:", e);
  }
  event.next();
};
