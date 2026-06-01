import {
  decodeLocalId,
  isCustomSourceId,
} from "../../../_utils/custom-source-id";
import { SHARED_LIB_NAME, SOURCE_PREFIX } from "../utils/constants";
import { getMULink, setMULink } from "../utils/link-store";
import type { sharedLib } from "./shared-lib";

export const onPostUpdateEntry = (
  event: $app.PostUpdateEntryProgressEvent | $app.PostUpdateEntryEvent,
) => {
  const { MUClient, createLogger } =
    $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
  const log = createLogger();

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

    (async () => {
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
      if (isCustomSourceId(mediaId)) {
        const siteUrl = manga?.siteUrl;
        if (siteUrl && siteUrl.indexOf(SOURCE_PREFIX) === 0) {
          const localId = decodeLocalId(mediaId);
          if (localId > 0) {
            externalId = String(localId);
            log.info(
              "custom-source mangaupdates media " +
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
        log.warn(
          "no MU link for media " +
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

      log.info(
        "pushed media " +
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
      log.error(`push failed for media ${mediaId}:`, err);
    });
  } catch (e) {
    log.error("post hook error:", e);
  }
  event.next();
};
