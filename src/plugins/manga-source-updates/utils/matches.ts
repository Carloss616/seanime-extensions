import { K_MATCHES } from "./constants";
import { isLive } from "./store";
import type { TimestampMeta } from "./types";

// Per-(manga, provider) record that a manual match was made on some machine. The
// count for this provider comes from a possibly different-titled series, so
// other machines warn about it. `by` = the authoring instance id.
export type ManualMatch = TimestampMeta & {
  mappedId: string;
  mappedTitle?: string;
  by: string;
};

export type MatchMap = Record<string, Record<string, ManualMatch>>;

export function upsertMatch(
  map: MatchMap,
  mediaId: number,
  provider: string,
  mappedId: string,
  by: string,
  now: number,
): MatchMap {
  const key = String(mediaId);
  const rec: ManualMatch = { mappedId, by, updatedAt: now };
  return { ...map, [key]: { ...(map[key] ?? {}), [provider]: rec } };
}

export function tombstoneMatch(
  map: MatchMap,
  mediaId: number,
  provider: string,
  now: number,
): MatchMap {
  const key = String(mediaId);
  const inner = { ...(map[key] ?? {}) };
  const prev = inner[provider];
  if (prev) inner[provider] = { ...prev, updatedAt: now, deletedAt: now };
  return { ...map, [key]: inner };
}

// What to persist for a manual-match panel state (`sig` from mappingSigFromHtml)
// given the currently stored record. Idempotent: returns "none" when the store
// already reflects the panel, so re-observing the same state writes nothing (no
// updatedAt churn), and a removal on an already-absent record is a no-op. sig:
// "none"/"empty" = no mapping; "present" = a mapping whose id couldn't be parsed
// (recorded with an empty mappedId); any other string = the mapped id.
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

export function shouldWarnMatch(
  rec: ManualMatch | undefined,
  myInstanceId: string,
): boolean {
  return isLive(rec) && rec?.by !== myInstanceId;
}

export function getMatches(): MatchMap {
  const raw = $storage.get<MatchMap>(K_MATCHES);
  return raw && typeof raw === "object" ? raw : {};
}

export function setMatches(map: MatchMap): void {
  $storage.set(K_MATCHES, map);
}
