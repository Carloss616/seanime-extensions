import { unreadChapters } from "./chapters";
import { classify } from "./classify";
import type { MangaResult, ResultKind } from "./types";

// Status pill: `+N · M` where N = unread on the best source, M = sources with unread.
export function statusFor(
  r: MangaResult,
  thinLabel = false,
): {
  label: string;
  intent: $ui.BadgeComponentIntent;
  tip: string;
} {
  const n = unreadChapters(r.read, r.latest);
  const m = n > 0 ? (r.newSources ?? 0) : 0;
  const label = thinLabel
    ? n > 0
      ? `+${n}`
      : "0"
    : n > 0
      ? `+${n} · ${m}`
      : "0 · 0";
  const nmTip = `${n} unread by ${m} source${m === 1 ? "" : "s"}`;
  const MAP: Record<
    ResultKind,
    { label: string; intent: $ui.BadgeComponentIntent; tip: string }
  > = {
    new: { label, intent: "success", tip: nmTip },
    "up-to-date": { label, intent: "gray", tip: nmTip },
    outdated: { label, intent: "warning", tip: nmTip },
    "not-matched": {
      label: thinLabel ? "−" : "no match",
      intent: "warning",
      tip: "No source matched",
    },
    "all-excluded": {
      label: thinLabel ? "−" : "all excluded",
      intent: "warning",
      tip: "All sources excluded",
    },
    "error-found": {
      label: thinLabel ? "X" : "error",
      intent: "alert",
      tip: "Source errored",
    },
  };
  return MAP[r.kind] ?? MAP["error-found"];
}

export function cardBadgeKind(
  row: MangaResult,
  progress: number,
  gap: number,
): ResultKind {
  let kind = row.kind;
  if (kind === "new" || kind === "up-to-date" || kind === "outdated") {
    kind = classify(progress, row.latest, row.sources, false, gap);
  }
  return kind;
}
