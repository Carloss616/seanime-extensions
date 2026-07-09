import { muPendingKey, SHARED_LIB_NAME } from "../utils/constants";
import {
  type MuSeriesIdResolve,
  resolveMuSeriesId,
} from "../utils/resolve-series-id";
import type { MuPendingUpdate } from "../utils/types";
import type { sharedLib } from "./shared-lib";

function logResolveOutcome(
  log: Console,
  mediaId: number,
  resolved: MuSeriesIdResolve,
): string | undefined {
  if ("seriesId" in resolved) {
    if (resolved.via === "custom-source") {
      log.info(
        `custom-source mangaupdates media ${mediaId} -> series_id=${resolved.seriesId}`,
      );
    } else if (resolved.via === "auto") {
      log.info(
        `auto-matched media ${mediaId} -> MU ${resolved.seriesId} "${resolved.title}"`,
      );
    }
    return resolved.seriesId;
  }
  if (resolved.via === "auto-miss") {
    log.warn(
      `auto-match: no MU result cleared the similarity threshold for "${resolved.query}"`,
    );
    return undefined;
  }
  log.warn(
    "no MU link for media " +
      mediaId +
      " — open the entry page and click 'Link to MangaUpdates' to set one." +
      " Alternatively enable 'Auto-match fallback' in plugin settings.",
  );
  return undefined;
}

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
    const key = muPendingKey(mediaId);
    const update = $store.get<MuPendingUpdate>(key);
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

      const resolved = await resolveMuSeriesId({
        mediaId,
        manga,
        mu,
        autoMatchEnabled:
          ($getUserPreference("autoMatchFallback") ?? "false") === "true",
      });
      const externalId = logResolveOutcome(log, mediaId, resolved);
      if (!externalId) return;

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
