export type SelectOption = { label: string; value: string };

// Radix Select forbids value="" (reserved for cleared state). Treat NONE as
// undefined when serializing the entry.
export const NONE = "-";

export const STATUS_OPTS: SelectOption[] = [
  { label: "—", value: NONE },
  { label: "Releasing", value: "RELEASING" },
  { label: "Finished", value: "FINISHED" },
  { label: "Hiatus", value: "HIATUS" },
  { label: "Cancelled", value: "CANCELLED" },
  { label: "Not yet released", value: "NOT_YET_RELEASED" },
];

export const FORMAT_OPTS: SelectOption[] = [
  { label: "—", value: NONE },
  { label: "Manga", value: "MANGA" },
  { label: "Novel", value: "NOVEL" },
  { label: "One-shot", value: "ONE_SHOT" },
];

// userPreferred variant keys — round-trip through fPreferred unchanged.
export const PREFERRED_OPTS: SelectOption[] = [
  { label: "English", value: "english" },
  { label: "Romaji", value: "romaji" },
  { label: "Native", value: "native" },
];

export const MONTH_OPTS: SelectOption[] = [
  { label: "—", value: NONE },
  ...[
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ].map((label, i) => ({ label, value: String(i + 1) })),
];
