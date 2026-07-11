import type { GistClient } from "../../../_utils/gist/client";
import {
  SYNC_FILE_EXCLUSIONS,
  SYNC_FILE_MATCHES,
  SYNC_FILE_PINS,
  SYNC_FILE_PROBES,
  SYNC_FILE_SUMMARIES,
  SYNC_HEAD_FILE,
} from "./constants";
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

// The five sync maps. Field names match the K_* $storage keys
// (summaries/exclusions/pins/probes/matches) so the wire layout, the storage
// layer, and the gist file names all read the same. `summaries` is one-level
// (mediaId → row); the rest are two-level (mediaId → providerId → record).
//
// LocalMaps is keyed by this instance's mediaId (as held in $storage); WireMaps
// is the same shape with keys translated to universal wire keys (native →
// number-string, custom-source → cs:manifestId:localId). Distinct aliases keep
// the push/pull boundary legible even though the shapes are identical.
export interface LocalMaps {
  summaries: Record<string, StoredResult>;
  exclusions: Record<string, Record<string, ExcludedRecord>>;
  pins: Record<string, Record<string, PinRecord>>;
  probes: Record<string, Record<string, ProviderProbe>>;
  matches: Record<string, Record<string, ManualMatch>>;
}
export type WireMaps = LocalMaps;

export function emptyLocalMaps(): LocalMaps {
  return { summaries: {}, exclusions: {}, pins: {}, probes: {}, matches: {} };
}

// Sync gist layout: ONE gist, one file per map (so no single file grows huge).
// SUMMARIES is listed FIRST (the head/discovery file). `level` = key depth.
export const SYNC_FILES: Array<{
  section: keyof LocalMaps;
  file: string;
  level: 1 | 2;
}> = [
  { section: "summaries", file: SYNC_FILE_SUMMARIES, level: 1 },
  { section: "exclusions", file: SYNC_FILE_EXCLUSIONS, level: 2 },
  { section: "pins", file: SYNC_FILE_PINS, level: 2 },
  { section: "probes", file: SYNC_FILE_PROBES, level: 2 },
  { section: "matches", file: SYNC_FILE_MATCHES, level: 2 },
];
export const ALL_SYNC_FILES = SYNC_FILES.map((s) => s.file);

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

export function mergeMaps(local: WireMaps, remote: WireMaps): WireMaps {
  return {
    summaries: mergeOneLevel(local.summaries, remote.summaries),
    exclusions: mergeTwoLevel(local.exclusions, remote.exclusions),
    pins: mergeTwoLevel(local.pins, remote.pins),
    probes: mergeTwoLevel(local.probes, remote.probes),
    matches: mergeTwoLevel(local.matches, remote.matches),
  };
}

// --- per-file serialize / parse (stable byte output so redundant pushes no-op) -

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

function sortMap(
  m: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(m).sort()) {
    const sorted = sortObj(m[k]);
    if (Object.keys(sorted).length === 0) continue; // drop empty inner map so it doesn't look "changed" vs. an absent key
    out[k] = sorted;
  }
  return out;
}

function serializeSection(map: unknown, level: 1 | 2): string {
  const canon =
    level === 2
      ? sortMap(map as Record<string, Record<string, unknown>>)
      : sortObj(map as Record<string, unknown>);
  // Indented for readability in the GitHub gist UI; canonical key order keeps
  // byte-equal pushes no-op on GitHub.
  return JSON.stringify(canon, null, 2);
}

// Each map → its own canonical gist-file content. summaries first.
export function wireMapsToFiles(maps: WireMaps): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { section, file, level } of SYNC_FILES) {
    out[file] = serializeSection(maps[section], level);
  }
  return out;
}

function parseMap(src: unknown): Record<string, Record<string, TimestampMeta>> {
  const out: Record<string, Record<string, TimestampMeta>> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, inner] of Object.entries(src as Record<string, unknown>)) {
    if (!inner || typeof inner !== "object") continue;
    const innerOut: Record<string, TimestampMeta> = {};
    for (const [pid, rec] of Object.entries(inner as Record<string, unknown>)) {
      if (!rec || typeof rec !== "object") continue;
      const r = rec as { updatedAt?: unknown; deletedAt?: unknown };
      const parsed: TimestampMeta = {
        ...(rec as object),
        updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
      } as TimestampMeta;
      if (r.deletedAt !== undefined && typeof r.deletedAt !== "number") {
        delete parsed.deletedAt; // untrusted gist content — drop so it reads as live, not NaN
      }
      innerOut[pid] = parsed;
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
    const r = rec as { updatedAt?: unknown; deletedAt?: unknown };
    const parsed: StoredResult = {
      ...(rec as object),
      updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    } as StoredResult;
    if (r.deletedAt !== undefined && typeof r.deletedAt !== "number") {
      delete parsed.deletedAt; // untrusted gist content — drop so it reads as live, not NaN
    }
    out[k] = parsed;
  }
  return out;
}

function parseJsonObj(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Remote gist files → in-memory wire maps (tolerant of empty/malformed files).
export function filesToWireMaps(files: Record<string, string>): WireMaps {
  return {
    summaries: parseResults(parseJsonObj(files[SYNC_FILE_SUMMARIES] ?? "")),
    exclusions: parseMap(
      parseJsonObj(files[SYNC_FILE_EXCLUSIONS] ?? ""),
    ) as WireMaps["exclusions"],
    pins: parseMap(
      parseJsonObj(files[SYNC_FILE_PINS] ?? ""),
    ) as WireMaps["pins"],
    probes: parseMap(
      parseJsonObj(files[SYNC_FILE_PROBES] ?? ""),
    ) as WireMaps["probes"],
    matches: parseMap(
      parseJsonObj(files[SYNC_FILE_MATCHES] ?? ""),
    ) as WireMaps["matches"],
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

export function toWireMaps(
  local: LocalMaps,
  sources: SourceMap,
): { maps: WireMaps; dropped: number[] } {
  const dropped = new Set<number>();
  const key = (mediaId: number) => toWireKey(mediaId, sources);
  const maps: WireMaps = {
    summaries: translateOneLevel(local.summaries, key, dropped),
    exclusions: translateTwoLevel(local.exclusions, key, dropped),
    pins: translateTwoLevel(local.pins, key, dropped),
    probes: translateTwoLevel(local.probes, key, dropped),
    matches: translateTwoLevel(local.matches, key, dropped),
  };
  return { maps, dropped: [...dropped] };
}

export function localizeWireMaps(
  maps: WireMaps,
  extIdForManifest: (manifestId: string, seedLocalId: number) => number | null,
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
  const out: LocalMaps = {
    summaries: relOne(maps.summaries),
    exclusions: relTwo(maps.exclusions),
    pins: relTwo(maps.pins),
    probes: relTwo(maps.probes),
    matches: relTwo(maps.matches),
  };
  return { maps: out, unresolved: [...unresolved] };
}

// Write-back: the localized merged maps are the source of truth for every
// translatable mediaId; local mediaIds that never made it into the wire maps
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
    summaries: mergeMap(existing.summaries, localized.summaries),
    exclusions: mergeMap(existing.exclusions, localized.exclusions),
    pins: mergeMap(existing.pins, localized.pins),
    probes: mergeMap(existing.probes, localized.probes),
    matches: mergeMap(existing.matches, localized.matches),
  };
}

// --- gist binding (auto-discovery, no create/link UI) ------------------------

export interface EnsureGistDeps {
  client: GistClient;
  getGistId: () => string | undefined;
  setGistId: (id: string) => void;
}

export async function ensureGist(deps: EnsureGistDeps): Promise<string> {
  const existing = deps.getGistId();
  if (existing) return existing;
  const found = await deps.client.findGistByFilename(SYNC_HEAD_FILE);
  if (found) {
    deps.setGistId(found);
    return found;
  }
  // Seed the gist with just the head (summaries) file as an empty map; the
  // remaining files are created on the first push (updateGistFiles).
  const info = await deps.client.createGist(
    SYNC_HEAD_FILE,
    "{}",
    "Seanime manga source updates sync",
  );
  deps.setGistId(info.id);
  return info.id;
}

// --- round-trip: pull → merge → push-changed-files → localize ----------------

export interface SyncDeps {
  client: GistClient;
  gistId: string;
  local: LocalMaps; // snapshot from $storage (RAW, tombstones included)
  sources: SourceMap;
  // Resolves this instance's extId for a manifest (local index → probe seeded by
  // the record's own localId). Sync so the pure localize step can run inline.
  extIdForManifest: (manifestId: string, seedLocalId: number) => number | null;
  log: Console;
}

export interface SyncResult {
  pushed: boolean;
  changedFiles: string[]; // gist files actually PATCHed
  writeBack: LocalMaps;
  dropped: number[]; // local custom-source mediaIds with no ref (not pushed)
  unresolved: string[]; // remote wire keys we couldn't localize (not written back)
}

export async function syncMsu(deps: SyncDeps): Promise<SyncResult> {
  const { maps: wireLocal, dropped } = toWireMaps(deps.local, deps.sources);
  if (dropped.length > 0) {
    deps.log.warn(
      `msu-sync: skipped ${dropped.length} custom-source id(s) with no source ref from push`,
    );
  }

  // One GET pulls every file's content.
  let remoteFiles: Record<string, string> = {};
  try {
    remoteFiles = await deps.client.getGistFiles(deps.gistId, ALL_SYNC_FILES);
  } catch (_) {
    remoteFiles = {};
  }
  const remote = filesToWireMaps(remoteFiles);
  const merged = mergeMaps(wireLocal, remote);

  // Push only the files whose canonical content actually changed vs. remote.
  const mergedFiles = wireMapsToFiles(merged);
  const remoteCanon = wireMapsToFiles(remote);
  const changed: Record<string, string> = {};
  for (const { file } of SYNC_FILES) {
    if (mergedFiles[file] !== remoteCanon[file])
      changed[file] = mergedFiles[file];
  }
  const changedFiles = Object.keys(changed);
  const pushed = changedFiles.length > 0;
  if (pushed) {
    await deps.client.updateGistFiles(deps.gistId, changed);
  }

  const { maps: localized, unresolved } = localizeWireMaps(
    merged,
    deps.extIdForManifest,
  );
  if (unresolved.length > 0) {
    deps.log.warn(
      `msu-sync: ${unresolved.length} remote key(s) not localizable on this instance`,
    );
  }
  const writeBack = mergeLocalBack(deps.local, localized);
  return { pushed, changedFiles, writeBack, dropped, unresolved };
}
