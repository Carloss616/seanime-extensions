import {
  progressPayloadKey,
  progressSkipKey,
  SHARED_LIB_NAME,
  SOURCE_PREFIX,
} from "../utils/constants";
import {
  buildProgressPayload,
  isLocalCatalogEntry,
} from "../utils/progress-capture";
import type { sharedLib } from "./shared-lib";

// Chapter-increment hook (fired when the reader marks a chapter). No scoreRaw
// on this event shape — capture only what's available.
export const onPreUpdateEntryProgress = (
  event: $app.PreUpdateEntryProgressEvent,
) => {
  const { createLogger, decodeLocalId } =
    $shared.use<ReturnType<typeof sharedLib>>(SHARED_LIB_NAME);
  const log = createLogger();
  try {
    if (event.mediaId == null) {
      event.next();
      return;
    }
    if ($store.has(progressSkipKey(event.mediaId))) {
      event.next();
      return;
    }
    let m: $app.AL_BaseManga | null = null;
    try {
      m = $anilist.getManga(event.mediaId);
    } catch (_) {
      m = null;
    }
    if (!isLocalCatalogEntry(m?.siteUrl ?? "", SOURCE_PREFIX)) {
      event.next();
      return;
    }
    void decodeLocalId;
    const payload = buildProgressPayload(event);
    if (!payload) {
      event.next();
      return;
    }
    $store.set(progressPayloadKey(event.mediaId), payload);
  } catch (e) {
    log.error("pre-update-entry-progress error:", e);
  }
  event.next();
};
