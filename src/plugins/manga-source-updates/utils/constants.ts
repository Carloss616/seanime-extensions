import type { ExcludeReason } from "./types";

// $storage keys. (Identifiers keep the K_ prefix; the string values are the
// actual keys in plugin_data.)
export const K_DIGEST = "digest"; // Record<mediaId, StoredResult> — per-manga row summary
export const K_EXCLUSIONS = "exclusions"; // Record<mediaId, Record<providerId, ExcludedRecord>>
export const K_MATCHES = "matches"; // Record<mediaId, Record<providerId, ManualMatch>>
export const K_PINS = "pins"; // Record<mediaId, Record<providerId, PinRecord>> — user-locked
export const K_PROBES = "probes"; // Record<mediaId, Record<providerId, ProviderProbe>> — per-source probe results

// --- $storage keys are all LOCAL, never in the gist payload ---
export const K_SOURCES = "sources"; // Record<mediaId, CustomSourceRef>
export const K_INSTANCE_ID = "instanceId"; // string — this machine's id (never synced)
export const K_OAUTH_TOKEN = "oauthToken"; // device-flow access token
export const K_GIST_ID = "gistId"; // the shared sync gist's id (auto-discovered)
export const K_SYNCED_AT = "syncedAt"; // ms epoch of the last successful sync

// Sync gist layout: ONE gist, one file per map (so no single file grows huge
// as the reading list scales). All wire-keyed, all prefixed `seanime-msu-`.
// GitHub renders the alphabetically-FIRST filename as the gist header
// (`owner/first-file`), so the digest file is named `-digest` (not
// `-summaries`) to sort ahead of exclusions/matches/pins/probes and win that
// slot. DIGEST also doubles as the head file — the discovery anchor
// (findGistByFilename) and the seed file on createGist; that role is unrelated
// to sort order, it just has to be a file that reliably exists in the gist.
export const SYNC_FILE_DIGEST = "seanime-msu-digest.json";
export const SYNC_FILE_EXCLUSIONS = "seanime-msu-exclusions.json";
export const SYNC_FILE_MATCHES = "seanime-msu-matches.json";
export const SYNC_FILE_PINS = "seanime-msu-pins.json";
export const SYNC_FILE_PROBES = "seanime-msu-probes.json";

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
