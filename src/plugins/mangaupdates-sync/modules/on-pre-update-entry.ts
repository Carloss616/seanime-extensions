export const onPreUpdateEntry = (
  event: $app.PreUpdateEntryEvent | $app.PreUpdateEntryProgressEvent,
) => {
  try {
    const auto =
      ($getUserPreference("autoSyncOnProgress") ?? "true") !== "false";
    if (!auto || event.mediaId == null) {
      event.next();
      return;
    }
    let isMng = false;
    try {
      isMng = !!$anilist.getManga(event.mediaId);
    } catch (_) {
      isMng = false;
    }
    if (!isMng) {
      event.next();
      return;
    }
    $store.set(`mu_pending_${event.mediaId}`, {
      status: event.status,
      progress: event.progress,
      ...("scoreRaw" in event ? { scoreRaw: event.scoreRaw } : {}),
    });
  } catch (e) {
    console.error("[mangaupdates-sync] pre-edit error:", e);
  }
  event.next();
};
