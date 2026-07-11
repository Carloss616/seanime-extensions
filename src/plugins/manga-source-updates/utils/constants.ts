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

// --- Phase 2 sync ($storage keys are all LOCAL, never in the gist payload) ---
export const K_OAUTH_TOKEN = "oauthToken"; // device-flow access token
export const K_GIST_ID = "gistId"; // the shared sync gist's id (auto-discovered)
export const K_SYNCED_AT = "syncedAt"; // ms epoch of the last successful sync

// Sync gist layout: ONE gist, one file per map (so no single file grows huge
// as the reading list scales). All wire-keyed, all prefixed `seanime-msu-`.
// SUMMARIES is the head file: it's the discovery anchor (findGistByFilename)
// and is listed first in the gist. See utils/sync.ts SYNC_FILES for the order.
export const SYNC_FILE_SUMMARIES = "seanime-msu-summaries.json";
export const SYNC_FILE_EXCLUSIONS = "seanime-msu-exclusions.json";
export const SYNC_FILE_PINS = "seanime-msu-pins.json";
export const SYNC_FILE_PROBES = "seanime-msu-probes.json";
export const SYNC_FILE_MATCHES = "seanime-msu-matches.json";
// The file used to discover/create the gist (summaries = head).
export const SYNC_HEAD_FILE = SYNC_FILE_SUMMARIES;

// GitHub OAuth App client_id for the Device Flow. PUBLIC (device flow needs no
// secret) — safe to commit. ponytail: PLACEHOLDER — device-flow login is dead
// until the extension author registers a GitHub OAuth App (device flow enabled,
// `gist` scope) and pastes its client_id here. The PAT fallback (config field)
// is the working auth path until then.
export const GITHUB_CLIENT_ID = "REPLACE_WITH_OAUTH_APP_CLIENT_ID";

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
