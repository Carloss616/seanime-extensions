import {
  K_EXT_ID,
  K_GIST_ID,
  K_PROGRESS,
  K_PROGRESS_UPDATED_AT,
  K_SYNC_PAUSED,
  PROGRESS_FILENAME,
  SHARED_LIB_NAME,
  SILENT_SYNC_COOLDOWN_MS,
  STORE_SILENT_SYNC_AT,
} from "../utils/constants";
import { wrapUpdateEntryWithSkip } from "../utils/progress-capture";
import {
  buildEncodedMediaIdLookup,
  syncProgressRoundTrip,
} from "../utils/progress-roundtrip";
import { syncToken } from "../utils/token";
import type { sharedLib } from "./shared-lib";

// Fires every time seanime fetches the user's manga collection — manga
// library page load, Refresh source, Reload sources, etc. We use the
// firing as a cross-device-sync trigger: pull progress.json, LWW merge,
// apply remote-newer entries to seanime via $anilist.updateEntry, and
// push the merged doc back to the gist.
export const onGetMangaCollection = (event: $app.GetMangaCollectionEvent) => {
  void (async () => {
    const { createLogger, GistClient, parseProgress } =
      $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      const lastAt = $store.get<number>(STORE_SILENT_SYNC_AT) ?? 0;
      const now = Date.now();
      if (now - lastAt < SILENT_SYNC_COOLDOWN_MS) return;
      $store.set(STORE_SILENT_SYNC_AT, now);
      const token = syncToken();
      const gistId = $storage.get<string>(K_GIST_ID) ?? "";
      if (!token || !gistId) return;
      if ($storage.get<boolean>(K_SYNC_PAUSED)) return;
      const client = new GistClient(token, fetch);
      const local = parseProgress($storage.get<LocalProgress>(K_PROGRESS), log);
      const extId = $storage.get<number>(K_EXT_ID);
      const result = await syncProgressRoundTrip({
        client,
        gistId,
        filename: PROGRESS_FILENAME,
        local,
        now,
        log,
        skipApply: extId == null,
        ...(extId != null
          ? {
              mediaIdByLocalId: (merged: LocalProgress) =>
                buildEncodedMediaIdLookup(merged, extId),
              updateEntry: (
                mediaId: number,
                status: $app.AL_MediaListStatus | undefined,
                scoreRaw: number | undefined,
                progress: number | undefined,
              ) => {
                wrapUpdateEntryWithSkip(mediaId, () => {
                  $anilist.updateEntry(
                    mediaId,
                    status,
                    scoreRaw,
                    progress,
                    undefined,
                    undefined,
                  );
                });
              },
            }
          : {}),
      });
      $storage.set(K_PROGRESS, result.merged);
      $storage.set(K_PROGRESS_UPDATED_AT, now);
      if (result.applied > 0) {
        try {
          $anilist.refreshMangaCollection();
        } catch (e) {
          log.warn("refreshMangaCollection failed:", e);
        }
        try {
          $app.invalidateClientQuery([
            "MANGA-get-manga-collection",
            "MANGA-get-anilist-manga-collection",
            "MANGA-get-manga-entry",
          ]);
        } catch (e) {
          log.warn("invalidateClientQuery failed:", e);
        }
      }
    } catch (e) {
      log.warn("on-get-manga-collection sync failed:", e);
    }
  })();
  event.next();
};
