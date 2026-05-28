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
