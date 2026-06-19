// Shared catalog parsing / serialization for both the local-catalog
// custom-source (reader) and the local-catalog-manager plugin (writer).
//
// Entries are native $app.AL_BaseManga / $app.AL_BaseAnime plus a per-record
// `updatedAt` (merge-metadata). See types/local-catalog.d.ts.

export function resolveUserPreferred(title: unknown): string | undefined {
  if (typeof title === "string") {
    return title.trim() || undefined;
  }
  if (title && typeof title === "object") {
    const t = title as $app.AL_BaseManga_Title;
    const v = t.userPreferred || t.english || t.romaji || t.native;
    return v?.trim() || undefined;
  }
  return undefined;
}

// Normalize a title (string or partial object) to a full AL title object with a
// populated `userPreferred`. Used at parse time so downstream always sees an
// object, and by the reader as a safety net.
export function coerceTitle(title: unknown): $app.AL_BaseManga_Title {
  if (typeof title === "string") {
    const t = title.trim();
    return { userPreferred: t, english: t };
  }
  if (title && typeof title === "object") {
    const t = title as $app.AL_BaseManga_Title;
    const up = t.userPreferred || t.english || t.romaji || t.native;
    return { ...t, userPreferred: up };
  }
  return {};
}

function parseNamespace<T extends { id: number; title?: unknown }>(
  list: unknown[],
  log: Console,
): T[] {
  const byId = new Map<number, T>();
  for (const item of list) {
    const entry = item as Partial<T>;
    if (!entry || typeof entry !== "object") continue;
    const id = Number(entry.id);
    if (!Number.isInteger(id) || id < 1) {
      log.warn("skipping entry with invalid id");
      continue;
    }
    if (!resolveUserPreferred(entry.title)) {
      log.warn(`skipping entry ${id} with no title`);
      continue;
    }
    if (byId.has(id)) {
      log.warn(`duplicate id ${id}, last wins`);
    }
    const out = {
      ...entry,
      id,
      title: coerceTitle(entry.title),
    } as T;
    byId.set(id, out);
  }
  return Array.from(byId.values());
}

export function parseCatalog(
  raw: string | unknown,
  log: Console,
): LocalCatalog {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { manga: [], anime: [] };
    }
  }
  if (Array.isArray(data)) {
    return { manga: parseNamespace(data, log), anime: [] };
  }
  if (data && typeof data === "object") {
    const doc = data as LocalCatalog;
    return {
      manga: Array.isArray(doc.manga) ? parseNamespace(doc.manga, log) : [],
      anime: Array.isArray(doc.anime)
        ? parseNamespace<AnimeCatalogEntry>(doc.anime, log)
        : [],
    };
  }
  return { manga: [], anime: [] };
}

// Deterministic key order so repeated writes are byte-stable (a redundant gist
// push then no-ops on GitHub instead of creating a noise revision). `id` and
// `title` lead each entry for readability; remaining keys — and nested objects
// (title, coverImage, startDate, …) — are alphabetical. Array element order
// (synonyms, genres) is preserved.
//
// Nullish values are dropped: AL_BaseManga fields are all optional (never
// legitimately null), and $storage.set round-trips JS `undefined` through the
// Go bridge as JSON `null`, so an entry rehydrated from $storage carries
// explicit nulls for every field the form left blank. JSON.stringify omits
// `undefined` but keeps `null`, so without this they'd leak into the gist.
function canonicalizeKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const head = ["id", "title"].filter((k) => k in obj);
    const rest = Object.keys(obj)
      .filter((k) => !head.includes(k))
      .sort();
    const out: Record<string, unknown> = {};
    for (const k of [...head, ...rest]) {
      if (obj[k] === null || obj[k] === undefined) continue;
      out[k] = canonicalizeKeys(obj[k]);
    }
    return out;
  }
  return value;
}

export function serializeCatalog(
  manga: MangaCatalogEntry[],
  updatedAt: number,
  anime: AnimeCatalogEntry[] = [],
): string {
  // Envelope order (version/updatedAt/manga/anime) is fixed; entries are
  // canonicalized. Indented for readability in the GitHub gist UI.
  const doc = {
    version: 2,
    updatedAt,
    manga: manga.map(canonicalizeKeys),
    anime: anime.map(canonicalizeKeys),
  };
  return JSON.stringify(doc, null, 2);
}

// Per-entry last-write-wins by `updatedAt` (missing → 0; tie → local), sorted by
// id. Mirrors mergeProgress. Returned entries are NOT fresh copies — callers that
// mutate the result should spread first.
export function mergeCatalog(
  local: MangaCatalogEntry[],
  remote: MangaCatalogEntry[],
): MangaCatalogEntry[] {
  const byId = new Map<number, MangaCatalogEntry>();
  for (const e of remote) byId.set(e.id, e);
  for (const e of local) {
    const r = byId.get(e.id);
    if (!r || (e.updatedAt ?? 0) >= (r.updatedAt ?? 0)) byId.set(e.id, e);
  }
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

// True when two catalogs hold byte-identical entries, ignoring array order.
// Both sides are canonicalized (same key order, nullish dropped) before
// comparison, so a $storage-rehydrated local (undefined→null round-trip) still
// matches a freshly-parsed remote. Used to short-circuit a spurious "drift":
// the link path flags drift whenever BOTH sides are non-empty, even when they
// are the same data — e.g. re-linking a clean gist, which otherwise pauses
// sync forever.
export function catalogsEqual(
  a: MangaCatalogEntry[],
  b: MangaCatalogEntry[],
): boolean {
  if (a.length !== b.length) return false;
  const norm = (list: MangaCatalogEntry[]) =>
    JSON.stringify([...list].sort((x, y) => x.id - y.id).map(canonicalizeKeys));
  return norm(a) === norm(b);
}

// Counts of ids unique to each side + ids in conflict (same id both sides).
export function diffCatalog(
  local: MangaCatalogEntry[],
  remote: MangaCatalogEntry[],
): { localOnly: number; remoteOnly: number; conflicts: number } {
  const localIds = new Set(local.map((e) => e.id));
  const remoteIds = new Set(remote.map((e) => e.id));
  let conflicts = 0;
  let localOnly = 0;
  for (const id of localIds) {
    if (remoteIds.has(id)) conflicts++;
    else localOnly++;
  }
  let remoteOnly = 0;
  for (const id of remoteIds) {
    if (!localIds.has(id)) remoteOnly++;
  }
  return { localOnly, remoteOnly, conflicts };
}
