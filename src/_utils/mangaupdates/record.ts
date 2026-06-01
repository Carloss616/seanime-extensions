// Pure normalization helpers for a MangaUpdates series record, shared by both
// MU clients (the custom-source read client's `toBaseManga` and the plugin
// client's lightweight `MUResult` mapping). Composition over a shared base
// class: the two clients live in separate bundles with different return shapes,
// so they share these pure field-extractors, not inheritance.

type MURecord = MUSearch.Record | MUSeries.Response;

// Parse the publication year. MU ships it as a string ("2019"); returns
// undefined for empty/missing/non-numeric values.
export function muRecordYear(record: MURecord): number | undefined {
  const year = record.year ? parseInt(record.year, 10) : undefined;
  return Number.isNaN(year) ? undefined : year;
}

// Canonical series URL, falling back to the public site link derived from the
// numeric series_id when the record carries no `url`.
export function muRecordUrl(record: MURecord): string {
  return (
    record.url ||
    `https://www.mangaupdates.com/series.html?id=${record.series_id}`
  );
}
