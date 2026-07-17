export function parseOptionalNumber(s: string | undefined): number | undefined {
  const v = Number((s ?? "").trim());
  return (s ?? "").trim() !== "" && Number.isFinite(v) ? v : undefined;
}

export function parseCommaList(s: string | undefined): string[] | undefined {
  const arr = (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
  return arr.length > 0 ? arr : undefined;
}
