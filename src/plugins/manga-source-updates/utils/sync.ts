import type { ManualMatch } from "./matches";
import type { SourceMap } from "./sources";
import { fromWireKey, toWireKey } from "./sync-keys";
import type {
  ExcludedRecord,
  PinRecord,
  ProviderProbe,
  StoredResult,
  TimestampMeta,
} from "./types";

export const SYNC_VERSION = 1;

// mediaId-keyed local maps (as held in $storage) — the sync seam's input/output.
export interface LocalMaps {
  excluded: Record<string, Record<string, ExcludedRecord>>;
  pinned: Record<string, Record<string, PinRecord>>;
  results: Record<string, StoredResult>;
  probes: Record<string, Record<string, ProviderProbe>>;
  matches: Record<string, Record<string, ManualMatch>>;
}

// Wire-keyed sync document — the single gist file. Same maps, keys translated to
// universal wire keys (native → number-string, custom-source → cs:manifest:localId).
export interface WireDoc {
  version: number;
  updatedAt: number;
  excluded: Record<string, Record<string, ExcludedRecord>>;
  pinned: Record<string, Record<string, PinRecord>>;
  results: Record<string, StoredResult>;
  probes: Record<string, Record<string, ProviderProbe>>;
  matches: Record<string, Record<string, ManualMatch>>;
}

export function emptyLocalMaps(): LocalMaps {
  return { excluded: {}, pinned: {}, results: {}, probes: {}, matches: {} };
}
function emptyWire(): WireDoc {
  return {
    version: SYNC_VERSION,
    updatedAt: 0,
    excluded: {},
    pinned: {},
    results: {},
    probes: {},
    matches: {},
  };
}

// A record's effective merge timestamp: the later of its edit and its tombstone.
// So a delete newer than an edit wins, and an edit newer than a tombstone
// resurrects. Missing timestamps read as 0.
export function effTs(rec: TimestampMeta): number {
  return Math.max(rec.updatedAt ?? 0, rec.deletedAt ?? 0);
}

// --- merge (pure, LWW) -------------------------------------------------------

function pick<T extends TimestampMeta>(l: T | undefined, r: T | undefined): T {
  if (!l) return { ...(r as T) };
  if (!r) return { ...l };
  // Tie → local wins (deterministic; MSU has no monotonic axis to break ties on).
  return effTs(l) >= effTs(r) ? { ...l } : { ...r };
}

function mergeOneLevel<T extends TimestampMeta>(
  local: Record<string, T>,
  remote: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    out[k] = pick(local[k], remote[k]);
  }
  return out;
}

function mergeTwoLevel<T extends TimestampMeta>(
  local: Record<string, Record<string, T>>,
  remote: Record<string, Record<string, T>>,
): Record<string, Record<string, T>> {
  const out: Record<string, Record<string, T>> = {};
  for (const k of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    out[k] = mergeOneLevel(local[k] ?? {}, remote[k] ?? {});
  }
  return out;
}

export function mergeWireDocs(
  local: WireDoc,
  remote: WireDoc,
  now: number,
): WireDoc {
  return {
    version: SYNC_VERSION,
    updatedAt: now,
    excluded: mergeTwoLevel(local.excluded, remote.excluded),
    pinned: mergeTwoLevel(local.pinned, remote.pinned),
    results: mergeOneLevel(local.results, remote.results),
    probes: mergeTwoLevel(local.probes, remote.probes),
    matches: mergeTwoLevel(local.matches, remote.matches),
  };
}

// --- parse / serialize (stable byte output so redundant pushes no-op) --------

function sortObj(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    const v = o[k];
    if (v === null || v === undefined) continue; // drop nullish so $storage blanks don't leak
    out[k] =
      v && typeof v === "object" && !Array.isArray(v)
        ? sortObj(v as Record<string, unknown>)
        : v;
  }
  return out;
}

// The map sections only, canonicalized — the unit both push-equality and
// serialization build on (envelope updatedAt excluded).
function canonMaps(doc: WireDoc): Record<string, unknown> {
  return {
    excluded: sortMap(doc.excluded),
    matches: sortMap(doc.matches),
    pinned: sortMap(doc.pinned),
    probes: sortMap(doc.probes),
    results: sortObj(doc.results as unknown as Record<string, unknown>),
  };
}
function sortMap(
  m: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m).sort()) out[k] = sortObj(m[k]);
  return out;
}

export function serializeWireDoc(doc: WireDoc): string {
  return JSON.stringify(
    {
      version: doc.version ?? SYNC_VERSION,
      updatedAt: doc.updatedAt ?? 0,
      ...canonMaps(doc),
    },
    null,
    2,
  );
}

// Content equality on the maps only (ignores envelope updatedAt) — gates the push.
export function wireMapsEqual(a: WireDoc, b: WireDoc): boolean {
  return JSON.stringify(canonMaps(a)) === JSON.stringify(canonMaps(b));
}

function parseMap(src: unknown): Record<string, Record<string, TimestampMeta>> {
  const out: Record<string, Record<string, TimestampMeta>> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, inner] of Object.entries(src as Record<string, unknown>)) {
    if (!inner || typeof inner !== "object") continue;
    const innerOut: Record<string, TimestampMeta> = {};
    for (const [pid, rec] of Object.entries(inner as Record<string, unknown>)) {
      if (!rec || typeof rec !== "object") continue;
      const r = rec as { updatedAt?: unknown };
      innerOut[pid] = {
        ...(rec as object),
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
      } as TimestampMeta;
    }
    out[k] = innerOut;
  }
  return out;
}
function parseResults(src: unknown): Record<string, StoredResult> {
  const out: Record<string, StoredResult> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, rec] of Object.entries(src as Record<string, unknown>)) {
    if (!rec || typeof rec !== "object") continue;
    const r = rec as { updatedAt?: unknown };
    out[k] = {
      ...(rec as object),
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    } as StoredResult;
  }
  return out;
}

export function parseWireDoc(raw: string | unknown, log: Console): WireDoc {
  if (raw == null || raw === "") return emptyWire();
  let data: Partial<WireDoc> = raw as Partial<WireDoc>;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return emptyWire();
    }
  }
  if (!data || typeof data !== "object") return emptyWire();
  if (typeof data.version === "number" && data.version !== SYNC_VERSION) {
    log.warn(`msu-sync.json version ${data.version} unknown, keeping records`);
  }
  return {
    version: typeof data.version === "number" ? data.version : SYNC_VERSION,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    excluded: parseMap(data.excluded) as WireDoc["excluded"],
    pinned: parseMap(data.pinned) as WireDoc["pinned"],
    results: parseResults(data.results),
    probes: parseMap(data.probes) as WireDoc["probes"],
    matches: parseMap(data.matches) as WireDoc["matches"],
  };
}

// --- translate (push) / localize (pull) --------------------------------------

function translateTwoLevel<T>(
  m: Record<string, Record<string, T>>,
  key: (mediaId: number) => string | null,
  dropped: Set<number>,
): Record<string, Record<string, T>> {
  const out: Record<string, Record<string, T>> = {};
  for (const [mediaIdStr, inner] of Object.entries(m)) {
    const wk = key(Number(mediaIdStr));
    if (wk == null) {
      dropped.add(Number(mediaIdStr));
      continue;
    }
    out[wk] = inner;
  }
  return out;
}
function translateOneLevel<T>(
  m: Record<string, T>,
  key: (mediaId: number) => string | null,
  dropped: Set<number>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [mediaIdStr, rec] of Object.entries(m)) {
    const wk = key(Number(mediaIdStr));
    if (wk == null) {
      dropped.add(Number(mediaIdStr));
      continue;
    }
    out[wk] = rec;
  }
  return out;
}

export function toWireDoc(
  local: LocalMaps,
  sources: SourceMap,
  now: number,
): { doc: WireDoc; dropped: number[] } {
  const dropped = new Set<number>();
  const key = (mediaId: number) => toWireKey(mediaId, sources);
  const doc: WireDoc = {
    version: SYNC_VERSION,
    updatedAt: now,
    excluded: translateTwoLevel(local.excluded, key, dropped),
    pinned: translateTwoLevel(local.pinned, key, dropped),
    results: translateOneLevel(local.results, key, dropped),
    probes: translateTwoLevel(local.probes, key, dropped),
    matches: translateTwoLevel(local.matches, key, dropped),
  };
  return { doc, dropped: [...dropped] };
}

export function localizeWireDoc(
  doc: WireDoc,
  extIdForManifest: (manifestId: string) => number | null,
): { maps: LocalMaps; unresolved: string[] } {
  const unresolved = new Set<string>();
  const key = (wireKey: string) => {
    const mediaId = fromWireKey(wireKey, extIdForManifest);
    if (mediaId == null) {
      unresolved.add(wireKey);
      return null;
    }
    return String(mediaId);
  };
  const relTwo = <T>(m: Record<string, Record<string, T>>) => {
    const out: Record<string, Record<string, T>> = {};
    for (const [wk, inner] of Object.entries(m)) {
      const lk = key(wk);
      if (lk != null) out[lk] = inner;
    }
    return out;
  };
  const relOne = <T>(m: Record<string, T>) => {
    const out: Record<string, T> = {};
    for (const [wk, rec] of Object.entries(m)) {
      const lk = key(wk);
      if (lk != null) out[lk] = rec;
    }
    return out;
  };
  const maps: LocalMaps = {
    excluded: relTwo(doc.excluded),
    pinned: relTwo(doc.pinned),
    results: relOne(doc.results),
    probes: relTwo(doc.probes),
    matches: relTwo(doc.matches),
  };
  return { maps, unresolved: [...unresolved] };
}

// Write-back: the localized merged maps are the source of truth for every
// translatable mediaId; local mediaIds that never made it into the wire doc
// (custom-source with no ref) are absent from `localized` and kept as-is. So a
// per-map key union where `localized` wins is correct and lossless.
export function mergeLocalBack(
  existing: LocalMaps,
  localized: LocalMaps,
): LocalMaps {
  const mergeMap = <T>(
    e: Record<string, T>,
    l: Record<string, T>,
  ): Record<string, T> => {
    const out: Record<string, T> = { ...e };
    for (const [k, v] of Object.entries(l)) out[k] = v;
    return out;
  };
  return {
    excluded: mergeMap(existing.excluded, localized.excluded),
    pinned: mergeMap(existing.pinned, localized.pinned),
    results: mergeMap(existing.results, localized.results),
    probes: mergeMap(existing.probes, localized.probes),
    matches: mergeMap(existing.matches, localized.matches),
  };
}
