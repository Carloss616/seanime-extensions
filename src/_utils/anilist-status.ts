import type { EntryListRow } from "../_components/entry-list";

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
