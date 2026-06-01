import {
  K_EXT_ID,
  K_GIST,
  K_PROGRESS,
  K_PROGRESS_UPDATED,
  K_SYNC_PAUSED,
  PROGRESS_FILENAME,
  SHARED_LIB_NAME,
} from "../utils/constants";
import type { sharedLib } from "./shared-lib";

// Fires every time seanime fetches the user's manga collection — manga
// library page load, Refresh source, Reload sources, etc. We use the
// firing as a cross-device-sync trigger: pull progress.json, LWW merge,
// apply remote-newer entries to seanime via $anilist.updateEntry, and
// push the merged doc back to the gist.
//
// Apply needs a mediaId per progress entry. Instead of walking the
// collection (whose shape we'd have to adapt across goja boundary), we
// compute it from the cached extId: mediaId = EXT_OFFSET + extId *
// LOCAL_RANGE + localId. updateEntry against an id the user hasn't
// added to their list is a silent no-op, so applying to "future" entries
// is safe.
//
// updateEntry calls are wrapped with the `progress:skip:<mediaId>`
// $store flag so our own pre/post-update-entry hooks bail — without that,
// each apply would echo back through handlePostUpdate's pushProgress and
// race with the surrounding sync's gist write (the perpetual "Synced N
// progress updates" toast bug).
//
// After applying, refresh seanime's in-process AniList collection cache
// and invalidate the frontend's React Query caches so the user sees the
// new chapter numbers immediately on the next render.
//
// $store cooldown gates back-to-back firings (the same UI action often
// triggers cache miss + raw + cached fetches — we'd hammer GitHub
// otherwise).
export const onGetMangaCollection = (event: $app.GetMangaCollectionEvent) => {
  void (async () => {
    const {
      createLogger,
      GistClient,
      parseProgress,
      mergeProgress,
      progressMangaEquals,
      serializeProgress,
    } = $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
    const log = createLogger();
    try {
      const COOLDOWN_KEY = "lcm:silent-sync-at";
      const COOLDOWN_MS = 10_000;
      const lastAt = $store.get<number>(COOLDOWN_KEY) ?? 0;
      const now = Date.now();
      if (now - lastAt < COOLDOWN_MS) return;
      $store.set(COOLDOWN_KEY, now);
      const token = ($getUserPreference("githubToken") ?? "").trim();
      const gistId = $storage.get<string>(K_GIST) ?? "";
      if (!token || !gistId) return;
      if ($storage.get<boolean>(K_SYNC_PAUSED)) return;
      const client = new GistClient(token, fetch);
      const local = $storage.get<ProgressDoc>(K_PROGRESS) ?? {
        version: 1,
        updatedAt: 0,
        manga: {},
      };
      // Inline pull (instead of `pullProgress`) so we keep the parsed
      // remote around for the no-op-push check below.
      let remoteStr = "";
      try {
        remoteStr = await client.getGistFile(gistId, PROGRESS_FILENAME);
      } catch (_) {
        remoteStr = "";
      }
      const remote = parseProgress(remoteStr, log);
      const merged = mergeProgress(local, remote, now);
      // Apply remote-newer entries to seanime. Skip flag prevents our own
      // hooks from echoing the update.
      const extId = $storage.get<number>(K_EXT_ID);
      const EXT_OFFSET = 0x80000000;
      const LOCAL_RANGE = 0x10000000000;
      let applied = 0;
      if (extId != null) {
        for (const [localIdStr, entry] of Object.entries(merged.manga)) {
          const before = local.manga[localIdStr];
          if (before && (before.updatedAt ?? 0) >= (entry.updatedAt ?? 0)) {
            continue;
          }
          const localId = Number(localIdStr);
          if (!Number.isFinite(localId)) continue;
          const mediaId = EXT_OFFSET + extId * LOCAL_RANGE + localId;
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
            applied++;
          } catch (e) {
            log.warn(`hook apply failed for localId ${localIdStr}:`, e);
          } finally {
            $store.remove(`progress:skip:${mediaId}`);
          }
        }
      }
      // Push only when local has something the gist doesn't (extra entries
      // or newer per-entry updatedAts). When `merged === remote` content-
      // wise, the push would only create a noise revision differing in
      // the wrapper updatedAt — every chapter mark would produce a second
      // duplicate gist revision a couple seconds after the post-hook's
      // real push.
      if (!progressMangaEquals(merged.manga, remote.manga)) {
        await client.updateGistFile(
          gistId,
          PROGRESS_FILENAME,
          serializeProgress(merged),
        );
      }
      $storage.set(K_PROGRESS, merged);
      $storage.set(K_PROGRESS_UPDATED, now);
      if (applied > 0) {
        // Refresh seanime's in-process AniList cache so subsequent
        // getMangaCollection calls see the new state, and tell the
        // frontend to refetch so the UI shows the new chapter numbers.
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
  // Every hook callback MUST call event.next(), even when the work fires
  // out-of-band — without it seanime stalls waiting for the chain to advance.
  event.next();
};
