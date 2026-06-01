// Shared progress-sync helpers used by both the local-catalog-manager plugin
// (writer + sync ops) and tests.
//
// The custom-source mediaId codec (decodeLocalId/encodeMediaId/…) lives in
// src/_utils/custom-source-id.ts — import it from there.

const EMPTY_DOC: ProgressDoc = { version: 1, updatedAt: 0, manga: {} };

export function parseProgress(
  raw: string | unknown,
  log: Console,
): ProgressDoc {
  if (raw == null || raw === "") return { ...EMPTY_DOC, manga: {} };
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...EMPTY_DOC, manga: {} };
    }
  }
  if (!data || typeof data !== "object") {
    return { ...EMPTY_DOC, manga: {} };
  }
  // Migration: V2-B initial shape was { entries: {...} }; rename to "manga"
  // on read so the wire format mirrors catalog.json's "manga" namespace
  // (forward-compat with a future "anime" key).
  const obj = data as Partial<ProgressDoc> & {
    entries?: Record<string, Partial<ProgressEntry>>;
  };
  if (typeof obj.version === "number" && obj.version !== 1) {
    log.warn(`progress.json version ${obj.version} unknown, keeping entries`);
  }
  const out: ProgressDoc = {
    version: typeof obj.version === "number" ? obj.version : 1,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : 0,
    manga: {},
  };
  const srcEntries = (obj.manga ?? obj.entries ?? {}) as Record<
    string,
    Partial<ProgressEntry>
  >;
  for (const [k, v] of Object.entries(srcEntries)) {
    if (!v || typeof v !== "object") continue;
    const e: ProgressEntry = { updatedAt: 0 };
    if (typeof v.updatedAt === "number") e.updatedAt = v.updatedAt;
    else log.warn(`progress entry ${k} missing updatedAt, treating as 0`);
    if (typeof v.progress === "number") e.progress = v.progress;
    if (typeof v.scoreRaw === "number") e.scoreRaw = v.scoreRaw;
    if (typeof v.status === "string")
      e.status = v.status as $app.AL_MediaListStatus;
    out.manga[k] = e;
  }
  return out;
}

// Serialize with a CANONICAL key order so two calls with the same data
// produce byte-identical JSON. Without this, $storage's Go-backed map
// iteration order is non-deterministic — every push surfaced a different
// byte sequence even when no values changed, and GitHub creates a new
// gist revision on every PATCH whose body differs from current (even
// just in key ordering). Stable output makes redundant pushes byte-equal
// to the existing gist content → GitHub no-ops the PATCH, no revision.
//
// Order rules:
//   - top level: version, updatedAt, manga (fixed)
//   - manga: entries by numeric localId
//   - each entry: alphabetical (progress, scoreRaw, status, updatedAt)
export function serializeProgress(doc: ProgressDoc): string {
  const stable = {
    version: doc.version ?? 1,
    updatedAt: doc.updatedAt ?? 0,
    manga: {} as Record<string, Record<string, unknown>>,
  };
  const ids = Object.keys(doc.manga).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const e = doc.manga[id] as unknown as Record<string, unknown>;
    const sortedEntry: Record<string, unknown> = {};
    for (const k of Object.keys(e).sort()) {
      sortedEntry[k] = e[k];
    }
    stable.manga[id] = sortedEntry;
  }
  return JSON.stringify(stable);
}

// Per-entry last-write-wins by updatedAt. When two sides write within the
// same millisecond (rare but possible when both devices auto-poll and a
// user marks chapters simultaneously), break the tie by HIGHER progress —
// chapter reads are monotonic, so the side that's further along is the
// side that wouldn't want its read reversed. Final fallback (still tied)
// is local.
// Top-level updatedAt is set to Date.now() by the caller (kept out of this
// pure function to keep tests deterministic without injecting a clock).
export function mergeProgress(
  local: ProgressDoc,
  remote: ProgressDoc,
  now = 0,
): ProgressDoc {
  const merged: ProgressDoc = {
    version: 1,
    updatedAt: now,
    manga: {},
  };
  const allIds = new Set<string>([
    ...Object.keys(local.manga),
    ...Object.keys(remote.manga),
  ]);
  for (const id of allIds) {
    const l = local.manga[id];
    const r = remote.manga[id];
    // Shallow-spread on assign: prevents callers from mutating the input
    // docs by writing into merged.manga[id].field. The post-hook path
    // replaces full entry objects (so this is not a live bug today) but the
    // alias trap would catch any future caller that mutates a field in place.
    if (!l) {
      merged.manga[id] = { ...(r as ProgressEntry) };
      continue;
    }
    if (!r) {
      merged.manga[id] = { ...l };
      continue;
    }
    const lu = l.updatedAt ?? 0;
    const ru = r.updatedAt ?? 0;
    if (lu !== ru) {
      merged.manga[id] = lu > ru ? { ...l } : { ...r };
      continue;
    }
    // Same updatedAt → defer to higher progress (monotonic-read assumption).
    const lp = l.progress ?? 0;
    const rp = r.progress ?? 0;
    merged.manga[id] = lp >= rp ? { ...l } : { ...r };
  }
  return merged;
}

// Content equality for the `manga` map only — ignores the top-level
// `updatedAt` which `mergeProgress` always overwrites with `now`. Used to
// decide whether a sync needs to push a new revision to the gist: if local
// already has exactly what remote has, a push would only bump the wrapper
// timestamp and create a noise revision (the symptom: every collection
// refetch produced a second gist revision identical to the prior one).
//
// Coerces with String() / Number() because one side may come from JSON.parse
// (plain JS) and the other from $storage (potentially goja-wrapped), and
// goja-wrapped primitives aren't === to JS primitives even when both hold
// the same value — see CLAUDE.md "Goja value comparison".
export function progressMangaEquals(
  a: Record<string, ProgressEntry>,
  b: Record<string, ProgressEntry>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!(k in b)) return false;
    const ae = a[k];
    const be = b[k];
    if (Number(ae.updatedAt ?? 0) !== Number(be.updatedAt ?? 0)) return false;
    if (Number(ae.progress ?? 0) !== Number(be.progress ?? 0)) return false;
    if (Number(ae.scoreRaw ?? 0) !== Number(be.scoreRaw ?? 0)) return false;
    if (String(ae.status ?? "") !== String(be.status ?? "")) return false;
  }
  return true;
}

// Counts of ids unique to each side + ids whose fields disagree. Used by the
// link-drift UI to summarize the situation before the user picks a strategy.
// "Conflicts" only flags same-id entries with disagreeing status/progress/
// scoreRaw — same-id entries with identical fields are treated as equivalent.
export function diffProgress(
  local: ProgressDoc,
  remote: ProgressDoc,
): { localOnly: number; remoteOnly: number; conflicts: number } {
  const localIds = new Set(Object.keys(local.manga));
  const remoteIds = new Set(Object.keys(remote.manga));
  let conflicts = 0;
  let localOnly = 0;
  for (const id of localIds) {
    if (!remoteIds.has(id)) {
      localOnly++;
      continue;
    }
    const l = local.manga[id];
    const r = remote.manga[id];
    if (
      l.status !== r.status ||
      l.progress !== r.progress ||
      l.scoreRaw !== r.scoreRaw
    ) {
      conflicts++;
    }
  }
  let remoteOnly = 0;
  for (const id of remoteIds) {
    if (!localIds.has(id)) remoteOnly++;
  }
  return { localOnly, remoteOnly, conflicts };
}
