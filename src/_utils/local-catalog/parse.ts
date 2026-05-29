// Shared catalog parsing / serialization for both the local-catalog
// custom-source (reader) and the local-catalog-manager plugin (writer).
//
// The shape (`Catalog` / `CatalogEntry` / `CatalogTitle`) is declared in
// types/local-catalog.d.ts as ambient globals — no import needed.

export function resolveUserPreferred(title: unknown): string | undefined {
  if (typeof title === "string") {
    return title.trim() || undefined;
  }
  if (title && typeof title === "object") {
    const t = title as CatalogTitle;
    const v = t.userPreferred || t.english || t.romaji || t.native;
    return v?.trim() || undefined;
  }
  return undefined;
}

export function parseCatalog(raw: string | unknown): CatalogEntry[] {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as Catalog).manga)
  ) {
    list = (data as Catalog).manga as CatalogEntry[];
  }

  const byId = new Map<number, CatalogEntry>();
  for (const item of list) {
    const entry = item as CatalogEntry;
    const id = Number(entry?.id);
    if (!Number.isInteger(id) || id < 1) {
      console.warn("local-catalog: skipping entry with invalid id");
      continue;
    }
    if (!resolveUserPreferred(entry?.title)) {
      console.warn(`local-catalog: skipping entry ${id} with no title`);
      continue;
    }
    if (byId.has(id)) {
      console.warn(`local-catalog: duplicate id ${id}, last wins`);
    }
    entry.id = id;
    byId.set(id, entry);
  }
  return Array.from(byId.values());
}

export function serializeCatalog(
  entries: CatalogEntry[],
  updatedAt: number,
): string {
  return JSON.stringify({ version: 1, updatedAt, manga: entries });
}

// Dedupe-by-id merge of two catalog entry lists. Local wins ties (consistent
// with mergeProgress). Caller is responsible for sorting / serializing.
//
// Used by drift resolution when linking an existing gist that already has
// entries: "merge" keeps both sides, preferring local when the same id
// exists on both. Returned entries are NOT a fresh copy — callers that
// mutate the result should spread the entries first.
export function mergeCatalog(
  local: CatalogEntry[],
  remote: CatalogEntry[],
): CatalogEntry[] {
  const byId = new Map<number, CatalogEntry>();
  // Remote first so local entries overwrite same-id remotes (local-wins).
  for (const e of remote) byId.set(e.id, e);
  for (const e of local) byId.set(e.id, e);
  return Array.from(byId.values()).sort((a, b) => a.id - b.id);
}

// Counts of ids unique to each side + ids in conflict (same id, both sides).
// Used by the drift UI to show "5 local · 12 remote · 3 in conflict".
export function diffCatalog(
  local: CatalogEntry[],
  remote: CatalogEntry[],
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
