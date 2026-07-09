export const K_COLS = "columnsByScope";
export const K_USE_DEFAULT = "useSeanimeDefault";

export const ABS_MIN = 1;
export const ABS_MAX = 12;

export type GridScope = { key: string; label: string; min: number };

export const SCOPES: GridScope[] = [
  { key: "mobile", label: "Mobile", min: 0 },
  { key: "tablet", label: "Tablet", min: 768 },
  { key: "laptop", label: "Laptop", min: 1280 },
  { key: "desktop", label: "Desktop", min: 1920 },
];

export const DEFAULTS: Record<string, number> = {
  mobile: 4,
  tablet: 6,
  laptop: 8,
  desktop: 12,
};

export const GRID_SELECTOR =
  "[data-media-card-grid], [data-media-card-lazy-grid]";

export const sanitizeColumns = (raw: unknown): Record<string, number> => {
  const src = (raw ?? {}) as Record<string, unknown>;
  const cfg: Record<string, number> = {};
  let floor = ABS_MIN;
  for (const s of SCOPES) {
    let v = Number(src[s.key] ?? DEFAULTS[s.key]);
    if (!Number.isFinite(v)) v = DEFAULTS[s.key];
    v = Math.max(ABS_MIN, Math.min(ABS_MAX, Math.round(v)));
    v = Math.max(floor, v);
    cfg[s.key] = v;
    floor = v;
  }
  return cfg;
};

export const scopeForWidth = (w: number): GridScope => {
  let chosen = SCOPES[0];
  for (const s of SCOPES) if (w >= s.min) chosen = s;
  return chosen;
};

export const scopeBounds = (
  idx: number,
  cfg: Record<string, number>,
): { lower: number; upper: number } => ({
  lower: idx > 0 ? cfg[SCOPES[idx - 1].key] : ABS_MIN,
  upper: idx < SCOPES.length - 1 ? cfg[SCOPES[idx + 1].key] : ABS_MAX,
});

export const applyScopeDelta = (
  cfg: Record<string, number>,
  key: string,
  delta: number,
): Record<string, number> | null => {
  const idx = SCOPES.findIndex((s) => s.key === key);
  const { lower, upper } = scopeBounds(idx, cfg);
  const next = Math.max(lower, Math.min(upper, cfg[key] + delta));
  if (next === cfg[key]) return null;
  return { ...cfg, [key]: next };
};
