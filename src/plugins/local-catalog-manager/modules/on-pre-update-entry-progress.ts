import { SHARED_LIB_NAME, SOURCE_PREFIX } from "../utils/constants";
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
    // Skip if this update was triggered by us (post-hook's restore-from-remote
    // path calls $anilist.updateEntry, which fires hooks recursively — we
    // don't want to capture our own restore as a new edit).
    if ($store.has(`progress:skip:${event.mediaId}`)) {
      event.next();
      return;
    }
    let m: $app.AL_BaseManga | null = null;
    try {
      m = $anilist.getManga(event.mediaId);
    } catch (_) {
      m = null;
    }
    const siteUrl = m?.siteUrl ?? "";
    if (siteUrl.indexOf(SOURCE_PREFIX) !== 0) {
      event.next();
      return;
    }
    void decodeLocalId;
    // Include only fields that carry a meaningful value. Null/undefined
    // means "not part of this update"; persisting it would clobber the
    // previously-known value when the post-hook merges into the cached
    // entry. See on-pre-update-entry.ts for the broader rationale.
    const payload: Partial<ProgressEntry> = {};
    if (event.status != null) payload.status = event.status;
    if (event.progress != null) payload.progress = event.progress;
    if (Object.keys(payload).length === 0) {
      event.next();
      return;
    }
    $store.set(`progress:${event.mediaId}`, payload);
  } catch (e) {
    log.error("pre-update-entry-progress error:", e);
  }
  event.next();
};
