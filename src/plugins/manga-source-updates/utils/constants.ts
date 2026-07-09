import type { ExcludeReason } from "./types";

// $storage keys.
export const K_EXCLUDED = "excludedProviders"; // Record<mediaId, Record<providerId, reason>>
export const K_RESULTS = "lastResults"; // Record<mediaId, StoredResult>
export const K_PINNED = "pinnedProviders"; // Record<mediaId, providerId[]> — user-locked
export const K_PROBES = "lastProbes"; // Record<mediaId, Record<providerId, ProviderProbe>>

// One table per exclusion reason: `menu` = dropdown label, `badge` = short label
// on the EXCLUDED row, `intent` = badge color. Keys match the automatic
// auto-exclude reasons (not-matched / error-found / outdated) so manual + auto
// read the same, plus manual-only ones. Dropdown order = key order here.
export const REASONS: Record<
  ExcludeReason,
  { menu: string; badge: string; intent: $ui.BadgeComponentIntent }
> = {
  outdated: { menu: "Behind / outdated", badge: "behind", intent: "warning" },
  // Sources that mangle numbering: fake gaps, invented far-future numbers,
  // duplicate chapters under different numbers, etc.
  "bad-numbering": {
    menu: "Wrong chapter numbers",
    badge: "bad numbers",
    intent: "warning",
  },
  "not-matched": { menu: "No match", badge: "no match", intent: "warning" },
  "error-found": { menu: "Fetch error", badge: "error", intent: "alert" },
  other: { menu: "Other", badge: "manual", intent: "gray" },
};

export const reasonLabel = (key: ExcludeReason) => REASONS[key].badge;
export const reasonIntent = (key: ExcludeReason) => REASONS[key].intent;
