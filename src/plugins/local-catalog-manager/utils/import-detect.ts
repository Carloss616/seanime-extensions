export type ImportKind = "catalog" | "progress" | "invalid";

// Detect pasted JSON shape. Catalog and progress both use
// `{version, updatedAt, manga: ...}` but catalog's manga is an Array;
// progress uses an Object (id → entry). Legacy: bare array (catalog),
// `entries` key (progress).
export const detectImportKind = (raw: string): ImportKind => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  if (Array.isArray(data)) return "catalog";
  if (!data || typeof data !== "object") return "invalid";
  const obj = data as { manga?: unknown; entries?: unknown };
  if (Array.isArray(obj.manga)) return "catalog";
  if (obj.manga && typeof obj.manga === "object") return "progress";
  if (obj.entries && typeof obj.entries === "object") return "progress";
  return "invalid";
};
