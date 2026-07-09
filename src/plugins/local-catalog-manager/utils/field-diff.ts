// Coerce before comparing fields across the goja ↔ Go boundary (=== fails).

export const stringFieldDiff = (
  local: string | undefined,
  remote: string | undefined,
): boolean => {
  if (local === undefined) return false;
  return String(local) !== String(remote ?? "");
};

export const numericFieldDiff = (
  local: number | undefined,
  remote: number | undefined,
): boolean => {
  if (local === undefined) return false;
  return Number(local) !== Number(remote ?? 0);
};
