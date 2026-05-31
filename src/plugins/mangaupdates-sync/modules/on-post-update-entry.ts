import { SHARED_LIB_NAME } from "../utils/constants";
import { getMULink, setMULink } from "../utils/link-store";
import type { sharedLib } from "./shared-lib";

export const onPostUpdateEntry = (
  event: $app.PostUpdateEntryProgressEvent | $app.PostUpdateEntryEvent,
) => {
  try {
    const mediaId = event.mediaId;
    if (mediaId == null) {
      event.next();
      return;
    }
    const key = `mu_pending_${mediaId}`;
    const update = $store.get<{
      status?: $app.AL_MediaListStatus;
      progress?: number;
      scoreRaw?: number;
    }>(key);
    if (!update) {
      event.next();
      return;
    }
    $store.remove(key);

    // MUClient is shared across runtimes via $shared (defined in code.ts
    // init()) — resolved only once we know there's a pending update to push.
    const { MUClient } =
      $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);

    (async () => {
      const EXT_ID_OFFSET = 0x80000000;
      const LOCAL_ID_RANGE = 0x10000000000;

      let manga: $app.AL_BaseManga | undefined;
      try {
        manga = $anilist.getManga(mediaId);
      } catch (_) {
        manga = undefined;
      }

      const mu = new MUClient((url, init) => fetch(url, init));

      // Resolve MU series_id.
      let externalId: string | undefined;

      // 1. Custom-source MU — decode local id from the synthetic mediaId.
      if (mediaId >= EXT_ID_OFFSET) {
        const siteUrl = manga?.siteUrl;
        if (
          siteUrl &&
          siteUrl.indexOf("ext_custom_source_mangaupdates|END|") === 0
        ) {
          const localId = (mediaId - EXT_ID_OFFSET) % LOCAL_ID_RANGE;
          if (localId > 0) {
            externalId = String(localId);
            console.log(
              "[mangaupdates-sync] custom-source mangaupdates media " +
                mediaId +
                " -> series_id=" +
                externalId,
            );
          }
        }
      }

      // 2. Explicit link in $storage (set manually via the "Link to
      //    MangaUpdates" button on the entry page). NOT $store, which
      //    is the cross-runtime in-memory channel used to pass Pre→Post
      //    payloads.
      if (!externalId) {
        const link = getMULink(mediaId);
        if (link?.id) externalId = link.id;
      }

      // 3. Opt-in title-search fallback. Default OFF for new installs (safer).
      //    Caches the first hit as a link (top match — may be wrong, since it's
      //    an unconfirmed title guess rather than a manual pick).
      if (
        !externalId &&
        ($getUserPreference("autoMatchFallback") ?? "false") === "true"
      ) {
        const title =
          manga?.title &&
          (manga.title.english ||
            manga.title.romaji ||
            manga.title.userPreferred);
        if (title) {
          const match = (await mu.search(title, 25))[0];
          if (match) {
            externalId = match.id;
            setMULink(mediaId, { ...match, linkedAt: Date.now() });
          }
        }
      }

      if (!externalId) {
        console.warn(
          "[mangaupdates-sync] no MU link for media " +
            mediaId +
            " — open the entry page and click 'Link to MangaUpdates' to set one." +
            " Alternatively enable 'Auto-match fallback' in plugin settings.",
        );
        return;
      }

      const seriesIdNum = Number(externalId);
      await mu.pushListEntry(seriesIdNum, {
        status: update.status,
        progress: update.progress,
      });

      const syncScore = ($getUserPreference("syncScore") ?? "true") !== "false";
      if (syncScore && update.scoreRaw != null) {
        await mu.pushRating(seriesIdNum, update.scoreRaw);
      }

      console.log(
        "[mangaupdates-sync] pushed media " +
          mediaId +
          " -> MU " +
          externalId +
          " (status=" +
          (update.status || "-") +
          " chapter=" +
          (update.progress != null ? update.progress : "-") +
          " score=" +
          (update.scoreRaw != null ? update.scoreRaw : "-") +
          ")",
      );
    })().catch((err) => {
      console.error(
        `[mangaupdates-sync] push failed for media ${mediaId}:`,
        err,
      );
    });
  } catch (e) {
    console.error("[mangaupdates-sync] post hook error:", e);
  }
  event.next();
};
