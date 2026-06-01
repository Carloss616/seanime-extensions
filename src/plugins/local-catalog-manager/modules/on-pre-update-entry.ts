import { SHARED_LIB_NAME, SOURCE_PREFIX } from "../utils/constants";
import type { sharedLib } from "./shared-lib";

// Full-entry update hook (status / score / progress, from the entry edit UI).
// Captures the to-be-applied fields into $store keyed by mediaId, for the
// post hook to read. Post receives only mediaId, so we must stash here.
export const onPreUpdateEntry = (event: $app.PreUpdateEntryEvent) => {
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
    // Suppress unused warning: decodeLocalId is consumed by the post hook;
    // we keep the import here to fail fast if the shared lib drops the export.
    void decodeLocalId;
    // Build the payload by including ONLY fields that carry a meaningful
    // value. Null/undefined means "this field wasn't part of this update";
    // persisting it would clobber the previously-known value when the post-
    // hook merges into the cached entry. scoreRaw=0 is treated the same as
    // null because AniList uses 0 to mean "un-rated" and omits the field
    // from listData — capturing 0 here desyncs us from seanime's view and
    // creates perpetual false-positive drift in the tray.
    const payload: Partial<ProgressEntry> = {};
    if (event.status != null) payload.status = event.status;
    if (event.progress != null) payload.progress = event.progress;
    if (event.scoreRaw != null && event.scoreRaw > 0) {
      payload.scoreRaw = event.scoreRaw;
    }
    if (Object.keys(payload).length === 0) {
      event.next();
      return;
    }
    $store.set(`progress:${event.mediaId}`, payload);
  } catch (e) {
    log.error("pre-update-entry error:", e);
  }
  event.next();
};
