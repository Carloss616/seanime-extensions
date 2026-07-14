// AniList publication-status → entry-list status pill.
//
// Shared by every plugin that renders an AL_MediaStatus as a colored pill so
// the color mapping stays consistent (local-catalog-manager + mangaupdates-
// sync). Pure data + a pure formatter — safe to inline into goja callbacks.

import type { EntryListRow } from "../_components/entry-list";

// AL_MediaStatus → pill color. NOT_YET_RELEASED defaults to gray.
export const STATUS_INTENT: Record<
  $app.AL_MediaStatus,
  $ui.BadgeComponentIntent
> = {
  RELEASING: "success",
  FINISHED: "info",
  HIATUS: "warning",
  CANCELLED: "alert",
  NOT_YET_RELEASED: "gray",
};

// Build the entry-list `status` pill spec from an AL_MediaStatus, or undefined
// when there's no status (so the row simply omits the pill).
export function statusToPill(
  status: $app.AL_MediaStatus | undefined,
): EntryListRow["status"] | undefined {
  if (!status) return undefined;
  return {
    label: status.replace(/_/g, " ").toLowerCase(),
    intent: STATUS_INTENT[status] ?? "gray",
    className: "capitalize",
  };
}
