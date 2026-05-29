import {
  K_GIST,
  K_PROGRESS,
  K_PROGRESS_UPDATED,
  K_SYNC_PAUSED,
  PROGRESS_FILENAME,
  SHARED_LIB_NAME,
} from "../utils/constants";
import type { sharedLib } from "./shared-lib";

// Persist captured payload + sync with the gist (source of truth).
// handlePostUpdate handles the branching: cache present → push, cache absent
// + remote present → restore-from-remote, cache absent + remote absent →
// push-new. We don't block event.next() on the network.
export const onPostUpdateEntry = (event: $app.PostUpdateEntryEvent) => {
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
    // handlePostUpdate's "persist-local-only" branch handles it correctly.
    const client =
      !syncPaused && token && gistId ? new GistClient(token, fetch) : null;
    const mediaId = event.mediaId;
    if (syncPaused && token && gistId) {
      // Toast at most once per drift session (cleared when drift resolves).
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
        // Block recursive capture: our restore triggers $anilist.updateEntry,
        // which fires onPre/PostUpdateEntry again. The pre-hook checks this
        // flag and bails — otherwise we'd restore in a loop.
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
      console.warn("[local-catalog-manager] post-update-entry sync failed:", e);
    });
  } catch (e) {
    console.error("[local-catalog-manager] post-update-entry error:", e);
  }
  event.next();
};
