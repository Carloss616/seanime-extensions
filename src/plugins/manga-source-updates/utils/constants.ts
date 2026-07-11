import type { ExcludeReason } from "./types";

// $storage keys. (Identifiers keep the K_ prefix; the string values are the
// actual keys in plugin_data.)
export const K_EXCLUSIONS = "exclusions"; // Record<mediaId, Record<providerId, ExcludedRecord>>
export const K_SUMMARIES = "summaries"; // Record<mediaId, StoredResult> — per-manga row summary
export const K_PINS = "pins"; // Record<mediaId, Record<providerId, PinRecord>> — user-locked
export const K_PROBES = "probes"; // Record<mediaId, Record<providerId, ProviderProbe>> — per-source probe results
export const K_MATCHES = "matches"; // Record<mediaId, Record<providerId, ManualMatch>>
export const K_INSTANCE_ID = "instanceId"; // string — this machine's id (never synced)
export const K_SOURCES = "sources"; // Record<mediaId, CustomSourceRef>

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
