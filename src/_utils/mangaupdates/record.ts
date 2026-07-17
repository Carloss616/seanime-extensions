// Pure field-extractors for a MangaUpdates series record, shared by both MU
// clients (they live in separate bundles with different return shapes, so they
// share these helpers rather than a base class).

type MURecord = $mu.Search.Record | $mu.Series.Response;

// MU ships the year as a string ("2019"); undefined for empty/non-numeric.
export function muRecordYear(record: MURecord): number | undefined {
  const year = record.year ? parseInt(record.year, 10) : undefined;
  return Number.isNaN(year) ? undefined : year;
}

// Canonical series URL, falling back to the public site link derived from the
// numeric series_id when the record carries no `url`. The legacy
// `series.html?id=<num>` endpoint 308-redirects to the base36 slug page
// server-side; `/series/<num>` only resolves client-side via MU's SPA (bare
// server response is 404), so the legacy form is the robust fallback.
export function muRecordUrl(record: MURecord): string {
  return (
    record.url ||
    `https://www.mangaupdates.com/series.html?id=${record.series_id}`
  );
}
