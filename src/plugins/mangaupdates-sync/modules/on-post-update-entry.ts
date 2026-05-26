import { MUClient } from "../utils/mu-client";

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

    (async () => {
      const EXT_ID_OFFSET = 0x80000000;
      const LOCAL_ID_RANGE = 0x10000000000;

      interface MUSearchResponse {
        results?: Array<{
          record?: { series_id?: number };
        }>;
      }

      let manga: $app.AL_BaseManga | undefined;
      try {
        manga = $anilist.getManga(mediaId);
      } catch (_) {
        manga = undefined;
      }

      const mu = new MUClient((url, init) => fetch(url, init));
      const token = await mu.ensureToken();

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
        const link = $storage.get<{
          seriesId: string;
          seriesTitle?: string;
          linkedAt: number;
          source: string;
        }>(`mu_link_${mediaId}`);
        if (link?.seriesId) externalId = link.seriesId;
      }

      // 3. Opt-in title-search fallback. Default OFF for new installs (safer).
      //    Caches the first hit as source: "auto" — surfaced in the button as
      //    "MU: ? (verify)" so the user knows it wasn't manually confirmed.
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
          const data = await mu.req<MUSearchResponse>(
            token,
            "POST",
            "/series/search",
            { search: title, perpage: 25 },
          );
          const sid = data?.results?.[0]?.record?.series_id;
          if (sid) {
            externalId = String(sid);
            $storage.set(`mu_link_${mediaId}`, {
              seriesId: externalId,
              linkedAt: Date.now(),
              source: "auto",
            });
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
      await mu.pushListEntry(token, seriesIdNum, {
        status: update.status,
        progress: update.progress,
      });

      const syncScore = ($getUserPreference("syncScore") ?? "true") !== "false";
      if (syncScore && update.scoreRaw != null) {
        await mu.pushRating(token, seriesIdNum, update.scoreRaw);
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
