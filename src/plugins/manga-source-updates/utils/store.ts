import { K_DIGEST, K_EXCLUSIONS, K_PINS, K_PROBES } from "./constants";
import { getMatches, setMatches } from "./matches";
import type { LocalMaps } from "./sync";
import type {
  ExcludedRecord,
  PinRecord,
  ProviderProbe,
  StoredResult,
} from "./types";

// Raw object read from $storage (empty object when absent/malformed). No shape
// migration on read — records are always written in the current shape.
function readObj<T>(key: string): T {
  const raw = $storage.get<T>(key);
  return raw != null && typeof raw === "object" ? raw : ({} as T);
}

export function isLive(rec: unknown): boolean {
  return rec != null && (rec as { deletedAt?: number }).deletedAt == null;
}

// Live exclusions as the legacy {mediaId: {pid: reasonString}} shape the scan/UI
// code already consumes, so routing through the store changes only the boundary.
export function liveExcludedView(
  map: Record<string, Record<string, ExcludedRecord>>,
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [media, providers] of Object.entries(map)) {
    const inner: Record<string, string> = {};
    for (const [pid, rec] of Object.entries(providers)) {
      if (isLive(rec)) inner[pid] = rec.reason;
    }
    out[media] = inner;
  }
  return out;
}

// Live pins as the legacy {mediaId: pid[]} shape.
export function livePinnedView(
  map: Record<string, Record<string, PinRecord>>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [media, providers] of Object.entries(map)) {
    out[media] = Object.entries(providers)
      .filter(([, rec]) => isLive(rec))
      .map(([pid]) => pid);
  }
  return out;
}

// Carry updatedAt forward for probes whose observable fields are unchanged; bump
// to `now` for changed or new probes. This is the "only edit what changes" rule
// for the churniest map — a re-scan that finds the same numbers keeps the old
// timestamp so sync sees no change.
export function mergeProbeTimestamps(
  prev: Record<string, ProviderProbe>,
  next: Record<string, ProviderProbe>,
  now: number,
): Record<string, ProviderProbe> {
  const out: Record<string, ProviderProbe> = {};
  for (const [pid, probe] of Object.entries(next)) {
    const before = prev[pid];
    const same =
      before != null &&
      before.latest === probe.latest &&
      before.count === probe.count &&
      before.matched === probe.matched &&
      before.errored === probe.errored;
    out[pid] = { ...probe, updatedAt: same ? before.updatedAt : now };
  }
  return out;
}

export function getExcluded(): Record<string, Record<string, ExcludedRecord>> {
  return readObj<Record<string, Record<string, ExcludedRecord>>>(K_EXCLUSIONS);
}
export function setExcluded(
  map: Record<string, Record<string, ExcludedRecord>>,
): void {
  $storage.set(K_EXCLUSIONS, map);
}
export function getExcludedView(): Record<string, Record<string, string>> {
  return liveExcludedView(getExcluded());
}

export function getPinned(): Record<string, Record<string, PinRecord>> {
  return readObj<Record<string, Record<string, PinRecord>>>(K_PINS);
}
export function setPinned(
  map: Record<string, Record<string, PinRecord>>,
): void {
  $storage.set(K_PINS, map);
}
export function getPinnedView(): Record<string, string[]> {
  return livePinnedView(getPinned());
}

export function getResults(): Record<string, StoredResult> {
  return readObj<Record<string, StoredResult>>(K_DIGEST);
}
export function setResults(map: Record<string, StoredResult>): void {
  $storage.set(K_DIGEST, map);
}

export function getProbes(): Record<string, Record<string, ProviderProbe>> {
  return readObj<Record<string, Record<string, ProviderProbe>>>(K_PROBES);
}
export function setProbes(
  map: Record<string, Record<string, ProviderProbe>>,
): void {
  $storage.set(K_PROBES, map);
}

// The sync seam: one snapshot of all five mediaId-keyed maps (RAW, tombstones
// included — the merge needs them) and one write of the merged-back result.
export function snapshotLocalMaps(): LocalMaps {
  return {
    digest: getResults(),
    exclusions: getExcluded(),
    pins: getPinned(),
    probes: getProbes(),
    matches: getMatches(),
  };
}

export function writeLocalMaps(maps: LocalMaps): void {
  setResults(maps.digest);
  setExcluded(maps.exclusions);
  setPinned(maps.pins);
  setProbes(maps.probes);
  setMatches(maps.matches);
}
