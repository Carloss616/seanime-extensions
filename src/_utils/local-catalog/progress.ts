// Shared progress-sync helpers for the local-catalog-manager plugin. The
// LocalProgress doc has symmetric `manga`/`anime` maps keyed by stringified
// localId; entries are native Manga_/Anime_EntryListData plus a per-entry
// `updatedAt` (epoch ms) driving last-write-wins. `score` carries the AniList
// RAW (POINT_100) value. See types/local-catalog.d.ts.

export const EMPTY_DOC: LocalProgress = {
  version: 1,
  updatedAt: 0,
  manga: {},
  anime: {},
};

function emptyDoc(): LocalProgress {
  return { version: 1, updatedAt: 0, manga: {}, anime: {} };
}

// Each stored entry is SPREAD so every field survives — forward-compatible with
// new Manga_/Anime_EntryListData fields. Only `updatedAt` is guaranteed numeric,
// the one invariant the LWW merge relies on.
function parseEntries<T extends { updatedAt: number }>(
  src: unknown,
  log: Console,
  label: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!src || typeof src !== "object") return out;
  for (const [k, v] of Object.entries(
    src as Record<string, Record<string, unknown>>,
  )) {
    if (!v || typeof v !== "object") continue;
    const updatedAt = typeof v.updatedAt === "number" ? v.updatedAt : 0;
    if (typeof v.updatedAt !== "number") {
      log.warn(`${label} entry ${k} missing updatedAt, treating as 0`);
    }
    // Migrate the legacy V2-B field name: progress entries stored the score
    // under `scoreRaw` before the native-AL-schema migration renamed it to
    // `score` (Manga_/Anime_EntryListData). Drop the stale key so it stops
    // round-tripping into the gist / $storage on every save. `score` wins if
    // both are present (it's the canonical post-migration value).
    const { scoreRaw, ...rest } = v;
    // `scoreRaw > 0` guard: AniList uses 0 to mean "un-rated" and omits score
    // from listData. Migrating a legacy `scoreRaw: 0` to `score: 0` would
    // resurrect a phantom rating that then leaks into the gist on the next push.
    if (scoreRaw != null && Number(scoreRaw) > 0 && rest.score == null) {
      rest.score = scoreRaw;
    }
    out[k] = { ...rest, updatedAt } as unknown as T;
  }
  return out;
}

export function parseProgress(
  raw: string | unknown,
  log: Console,
): LocalProgress {
  if (raw == null || raw === "") return emptyDoc();
  let data: Partial<LocalProgress> = raw as Partial<LocalProgress>;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return emptyDoc();
    }
  }
  if (!data || typeof data !== "object") {
    return emptyDoc();
  }
  if (typeof data.version === "number" && data.version !== 1) {
    log.warn(`progress.json version ${data.version} unknown, keeping entries`);
  }
  return {
    version: typeof data.version === "number" ? data.version : 1,
    updatedAt: typeof data.updatedAt === "number" ? data.updatedAt : 0,
    manga: parseEntries<MangaProgressEntry>(data.manga, log, "progress"),
    anime: parseEntries<AnimeProgressEntry>(data.anime, log, "anime"),
  };
}

// Serialize one namespace with a CANONICAL key order: entries by numeric
// localId, fields alphabetical. Without this, $storage's Go-backed map
// iteration order is non-deterministic — every push surfaced a different byte
// sequence even when no values changed, and GitHub creates a new gist revision
// on every PATCH whose body differs (even just key ordering). Stable output
// makes redundant pushes byte-equal to the existing content → GitHub no-ops.
function serializeEntries(
  map: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  const ids = Object.keys(map).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const e = map[id];
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(e).sort()) {
      const val = e[k];
      // Drop fields that don't carry a meaningful value, mirroring
      // serializeCatalog's canonicalizeKeys:
      //   - null/undefined: $storage round-trips blank fields to JSON null and
      //     JSON.stringify keeps null, so they'd leak into the gist verbatim.
      //   - score === 0: AniList treats 0 as un-rated and omits it; emitting it
      //     wrote phantom `"score": 0` onto entries untouched by a chapter mark.
      if (val === null || val === undefined) continue;
      if (k === "score" && Number(val) === 0) continue;
      sorted[k] = val;
    }
    out[id] = sorted;
  }
  return out;
}

export function serializeProgress(doc: LocalProgress): string {
  const stable = {
    version: doc.version ?? 1,
    updatedAt: doc.updatedAt ?? 0,
    manga: serializeEntries(
      doc.manga as unknown as Record<string, Record<string, unknown>>,
    ),
    anime: serializeEntries(
      (doc.anime ?? {}) as unknown as Record<string, Record<string, unknown>>,
    ),
  };
  // Indented for readability in the GitHub gist UI. The canonical key order
  // above keeps this deterministic, so byte-equal pushes still no-op on GitHub.
  return JSON.stringify(stable, null, 2);
}

// Per-entry last-write-wins by updatedAt. When two sides write within the same
// millisecond (rare but possible when both devices auto-poll and a user marks
// chapters simultaneously), break the tie by HIGHER progress — chapter reads
// are monotonic, so the side that's further along is the side that wouldn't want
// its read reversed. Final fallback (still tied) is local.
function mergeEntries<T extends { updatedAt?: number; progress?: number }>(
  local: Record<string, T>,
  remote: Record<string, T>,
): Record<string, T> {
  const out: Record<string, T> = {};
  const ids = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const l = local[id];
    const r = remote[id];
    // Shallow-spread on assign: prevents callers from mutating the input docs
    // by writing into out[id].field.
    if (!l) {
      out[id] = { ...(r as T) };
      continue;
    }
    if (!r) {
      out[id] = { ...l };
      continue;
    }
    const lu = l.updatedAt ?? 0;
    const ru = r.updatedAt ?? 0;
    if (lu !== ru) {
      out[id] = lu > ru ? { ...l } : { ...r };
      continue;
    }
    const lp = l.progress ?? 0;
    const rp = r.progress ?? 0;
    out[id] = lp >= rp ? { ...l } : { ...r };
  }
  return out;
}

// Top-level updatedAt is set to Date.now() by the caller (kept out of this pure
// function to keep tests deterministic without injecting a clock).
export function mergeProgress(
  local: LocalProgress,
  remote: LocalProgress,
  now = 0,
): LocalProgress {
  return {
    version: 1,
    updatedAt: now,
    manga: mergeEntries(local.manga, remote.manga),
    anime: mergeEntries(local.anime ?? {}, remote.anime ?? {}),
  };
}

// Content equality for the `manga` map only — ignores the top-level `updatedAt`
// which `mergeProgress` always overwrites with `now`. Used to decide whether a
// sync needs to push a new revision to the gist: if local already has exactly
// what remote has, a push would only bump the wrapper timestamp and create a
// noise revision (the symptom: every collection refetch produced a second gist
// revision identical to the prior one). Anime namespace is excluded — extend
// with an anime variant when anime sync is implemented.
//
// Coerces with String() / Number() because one side may come from JSON.parse
// (plain JS) and the other from $storage (potentially goja-wrapped), and
// goja-wrapped primitives aren't === to JS primitives even when both hold the
// same value — see CLAUDE.md "Goja value comparison".
export function progressMangaEquals(
  a: Record<string, MangaProgressEntry>,
  b: Record<string, MangaProgressEntry>,
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
    if (Number(ae.score ?? 0) !== Number(be.score ?? 0)) return false;
    if (Number(ae.repeat ?? 0) !== Number(be.repeat ?? 0)) return false;
    if (String(ae.startedAt ?? "") !== String(be.startedAt ?? "")) return false;
    if (String(ae.completedAt ?? "") !== String(be.completedAt ?? "")) {
      return false;
    }
    if (String(ae.status ?? "") !== String(be.status ?? "")) return false;
  }
  return true;
}

// Counts of ids unique to each side + conflicts. "Conflicts" only flags same-id
// entries with disagreeing status/progress/score — identical fields are equivalent.
export function diffProgress(
  local: LocalProgress,
  remote: LocalProgress,
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
      l.score !== r.score
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
