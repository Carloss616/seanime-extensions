import { K_MATCHES } from "./constants";
import { isLive } from "./store";
import type { TimestampMeta } from "./types";

// A manual match recorded on ONE instance. seanime's manual-match state is
// per-install and the plugin can only OBSERVE it (never set it remotely), so a
// match is NOT converged across devices — each instance owns its own record and
// the UI surfaces where they disagree (see matchDivergence). The authoring
// instance is the KEY (see MatchMap), so it's no longer a field here.
export type ManualMatch = TimestampMeta & {
  mappedId: string;
  mappedTitle?: string;
};

// mediaId → provider → instanceId → record. The instanceId level is what stops
// one device from clobbering another's match on merge (each writes only its own
// leaf), and what lets the UI compare instances.
export type MatchMap = Record<
  string,
  Record<string, Record<string, ManualMatch>>
>;

// Write THIS instance's match for (manga, provider). Only its own leaf changes.
export function upsertMatch(
  map: MatchMap,
  mediaId: number,
  provider: string,
  instanceId: string,
  mappedId: string,
  now: number,
): MatchMap {
  const key = String(mediaId);
  const byInstance = {
    ...(map[key]?.[provider] ?? {}),
    [instanceId]: { mappedId, updatedAt: now } as ManualMatch,
  };
  return {
    ...map,
    [key]: { ...(map[key] ?? {}), [provider]: byInstance },
  };
}

// Tombstone THIS instance's match leaf (no-op if it never recorded one).
export function tombstoneMatch(
  map: MatchMap,
  mediaId: number,
  provider: string,
  instanceId: string,
  now: number,
): MatchMap {
  const key = String(mediaId);
  const byInstance = { ...(map[key]?.[provider] ?? {}) };
  const prev = byInstance[instanceId];
  if (prev)
    byInstance[instanceId] = { ...prev, updatedAt: now, deletedAt: now };
  return {
    ...map,
    [key]: { ...(map[key] ?? {}), [provider]: byInstance },
  };
}

// What to persist for a manual-match panel state (`sig` from mappingSigFromHtml)
// given THIS instance's currently stored record. Idempotent: returns "none" when
// the store already reflects the panel, so re-observing the same state writes
// nothing (no updatedAt churn), and a removal on an already-absent record is a
// no-op. sig: "none"/"empty" = no mapping; "present" = a mapping whose id
// couldn't be parsed (recorded with an empty mappedId); any other string = the
// mapped id.
export type MatchAction =
  | { type: "upsert"; mappedId: string }
  | { type: "tombstone" }
  | { type: "none" };

export function resolveMatchAction(
  sig: string,
  existing: ManualMatch | undefined,
): MatchAction {
  const live = isLive(existing) ? existing : undefined;
  if (sig === "none" || sig === "empty") {
    return live ? { type: "tombstone" } : { type: "none" };
  }
  const mappedId = sig === "present" ? "" : sig;
  if (live && live.mappedId === mappedId) return { type: "none" };
  return { type: "upsert", mappedId };
}

// Do the instances that HAVE recorded a match for this provider disagree?
// - `different`: two+ live matches with different ids (matched to different
//   series) → the counts they produce can't be compared.
// - `missing`: some instance has a live match, another explicitly removed it.
// - none: every recorded instance agrees (or only one recorded / all removed).
// Instances that never observed this provider (absent key) don't count — silence
// is "unknown", not "disagree". `sig === "present"` (unparsed id) is its own value.
const PRESENT_SENTINEL = "\0present";
export function matchDivergence(
  byInstance: Record<string, ManualMatch> | undefined,
): {
  diverges: boolean;
  reason: "" | "different" | "missing";
} {
  if (!byInstance) return { diverges: false, reason: "" };
  const liveIds = new Set<string>();
  let hasRemoved = false;
  for (const rec of Object.values(byInstance)) {
    if (isLive(rec))
      liveIds.add(rec.mappedId === "" ? PRESENT_SENTINEL : rec.mappedId);
    else hasRemoved = true;
  }
  if (liveIds.size >= 2) return { diverges: true, reason: "different" };
  if (liveIds.size === 1 && hasRemoved)
    return { diverges: true, reason: "missing" };
  return { diverges: false, reason: "" };
}

// (mediaId, provider) pairs THIS instance has a live manual match for, keyed
// `${mediaId}\0${provider}`. A manually-matched provider returns a manually
// chosen series, so its scan probe is INSTANCE-relative — the sync keeps those
// probes local-only (see performSync) to avoid a cross-instance LWW ping-pong
// when devices matched differently.
export function liveLocalMatchPairs(
  matches: MatchMap,
  instanceId: string,
): Set<string> {
  const out = new Set<string>();
  for (const [mid, providers] of Object.entries(matches)) {
    for (const [pid, byInstance] of Object.entries(providers)) {
      if (isLive(byInstance[instanceId])) out.add(`${mid}\0${pid}`);
    }
  }
  return out;
}

export function getMatches(): MatchMap {
  const raw = $storage.get<MatchMap>(K_MATCHES);
  return raw && typeof raw === "object" ? raw : {};
}

export function setMatches(map: MatchMap): void {
  $storage.set(K_MATCHES, map);
}
