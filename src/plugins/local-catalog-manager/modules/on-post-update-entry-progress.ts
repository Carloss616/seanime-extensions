import {
  K_GIST,
  K_PROGRESS,
  K_PROGRESS_UPDATED,
  K_SYNC_PAUSED,
  PROGRESS_FILENAME,
  SHARED_LIB_NAME,
} from "../utils/constants";
import type { sharedLib } from "./shared-lib";

// Same logic as onPostUpdateEntry; separate file because seanime registers
// it under a different hook. The actual decision (push vs restore vs new)
// lives in handlePostUpdate; this file is a thin adapter.
export const onPostUpdateEntryProgress = (
  event: $app.PostUpdateEntryProgressEvent,
) => {
  try {
    if (event.mediaId == null) {
      event.next();
      return;
    }
    const key = `progress:${event.mediaId}`;
    const payload = $store.get<Partial<ProgressEntry>>(key);
    if (!payload) {
      event.next();
      return;
    }
    const { GistClient, decodeLocalId, handlePostUpdate } =
      $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
    $store.remove(key);

    const localId = decodeLocalId(event.mediaId);
    const now = Date.now();
    const local = ($storage.get<ProgressDoc>(K_PROGRESS) ?? {
      version: 1,
      updatedAt: 0,
      manga: {},
    }) as ProgressDoc;
    const token = ($getUserPreference("githubToken") ?? "").trim();
    const gistId = $storage.get<string>(K_GIST) ?? "";
    const syncPaused = $storage.get<boolean>(K_SYNC_PAUSED) ?? false;
    // When drift is pending, force local-only writes by nulling the client.
    const client =
      !syncPaused && token && gistId ? new GistClient(token, fetch) : null;
    const mediaId = event.mediaId;
    if (syncPaused && token && gistId) {
      const notifiedKey = "lcm:drift-notified";
      if (!$store.get<boolean>(notifiedKey)) {
        $store.set(notifiedKey, true);
        console.warn(
          "[local-catalog-manager] catalog drift pending — saved locally only. Resolve in tray.",
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
      applyToSeanime: (entry: ProgressEntry) => {
        $store.set(`progress:skip:${mediaId}`, true);
        try {
          $anilist.updateEntry(
            mediaId,
            entry.status,
            entry.scoreRaw,
            entry.progress,
            undefined,
            undefined,
          );
        } finally {
          $store.remove(`progress:skip:${mediaId}`);
        }
      },
      persistLocal: (doc: ProgressDoc, updatedAt: number) => {
        $storage.set(K_PROGRESS, doc);
        $storage.set(K_PROGRESS_UPDATED, updatedAt);
      },
    }).catch((e: unknown) => {
      console.warn(
        "[local-catalog-manager] post-update-entry-progress sync failed:",
        e,
      );
    });
  } catch (e) {
    console.error(
      "[local-catalog-manager] post-update-entry-progress error:",
      e,
    );
  }
  event.next();
};
