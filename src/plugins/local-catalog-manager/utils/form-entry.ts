import { NONE } from "./form-options";
import { parseCommaList, parseOptionalNumber } from "./form-parse";

export interface CatalogFormFields {
  romaji: string;
  english: string;
  native: string;
  preferred: string;
  synonyms: string;
  cover: string;
  banner: string;
  description: string;
  genres: string;
  status: string;
  format: string;
  chapters: string;
  volumes: string;
  year: string;
  month: string;
  day: string;
  endYear: string;
  endMonth: string;
  endDay: string;
  isAdult: boolean;
  country: string;
  siteUrl: string;
  idMal: string;
  meanScore: string;
}

type StringFieldRef = { current?: string; setValue: (v: string) => void };
type BoolFieldRef = { current?: boolean; setValue: (v: boolean) => void };

export interface CatalogFormRefs {
  romaji: StringFieldRef;
  english: StringFieldRef;
  native: StringFieldRef;
  preferred: StringFieldRef;
  synonyms: StringFieldRef;
  cover: StringFieldRef;
  banner: StringFieldRef;
  description: StringFieldRef;
  genres: StringFieldRef;
  status: StringFieldRef;
  format: StringFieldRef;
  chapters: StringFieldRef;
  volumes: StringFieldRef;
  year: StringFieldRef;
  month: StringFieldRef;
  day: StringFieldRef;
  endYear: StringFieldRef;
  endMonth: StringFieldRef;
  endDay: StringFieldRef;
  isAdult: BoolFieldRef;
  country: StringFieldRef;
  siteUrl: StringFieldRef;
  idMal: StringFieldRef;
  meanScore: StringFieldRef;
}

const EMPTY_FORM_FIELDS: CatalogFormFields = {
  romaji: "",
  english: "",
  native: "",
  preferred: "english",
  synonyms: "",
  cover: "",
  banner: "",
  description: "",
  genres: "",
  status: "",
  format: "",
  chapters: "",
  volumes: "",
  year: "",
  month: "",
  day: "",
  endYear: "",
  endMonth: "",
  endDay: "",
  isAdult: false,
  country: "",
  siteUrl: "",
  idMal: "",
  meanScore: "",
};

export const readCatalogFormFields = (
  refs: CatalogFormRefs,
): CatalogFormFields => ({
  romaji: refs.romaji.current ?? "",
  english: refs.english.current ?? "",
  native: refs.native.current ?? "",
  preferred: refs.preferred.current ?? "english",
  synonyms: refs.synonyms.current ?? "",
  cover: refs.cover.current ?? "",
  banner: refs.banner.current ?? "",
  description: refs.description.current ?? "",
  genres: refs.genres.current ?? "",
  status: refs.status.current ?? "",
  format: refs.format.current ?? "",
  chapters: refs.chapters.current ?? "",
  volumes: refs.volumes.current ?? "",
  year: refs.year.current ?? "",
  month: refs.month.current ?? "",
  day: refs.day.current ?? "",
  endYear: refs.endYear.current ?? "",
  endMonth: refs.endMonth.current ?? "",
  endDay: refs.endDay.current ?? "",
  isAdult: !!refs.isAdult.current,
  country: refs.country.current ?? "",
  siteUrl: refs.siteUrl.current ?? "",
  idMal: refs.idMal.current ?? "",
  meanScore: refs.meanScore.current ?? "",
});

export const writeCatalogFormFields = (
  refs: CatalogFormRefs,
  fields: CatalogFormFields,
): void => {
  refs.romaji.setValue(fields.romaji);
  refs.english.setValue(fields.english);
  refs.native.setValue(fields.native);
  refs.preferred.setValue(fields.preferred);
  refs.synonyms.setValue(fields.synonyms);
  refs.cover.setValue(fields.cover);
  refs.banner.setValue(fields.banner);
  refs.description.setValue(fields.description);
  refs.genres.setValue(fields.genres);
  refs.status.setValue(fields.status);
  refs.format.setValue(fields.format);
  refs.chapters.setValue(fields.chapters);
  refs.volumes.setValue(fields.volumes);
  refs.year.setValue(fields.year);
  refs.month.setValue(fields.month);
  refs.day.setValue(fields.day);
  refs.endYear.setValue(fields.endYear);
  refs.endMonth.setValue(fields.endMonth);
  refs.endDay.setValue(fields.endDay);
  refs.isAdult.setValue(fields.isAdult);
  refs.country.setValue(fields.country);
  refs.siteUrl.setValue(fields.siteUrl);
  refs.idMal.setValue(fields.idMal);
  refs.meanScore.setValue(fields.meanScore);
};

const preferredVariantKey = (
  t: MangaCatalogEntry["title"] | undefined,
): string => {
  const up = t?.userPreferred;
  if (up && up === t?.romaji) return "romaji";
  if (up && up === t?.native) return "native";
  return "english";
};

const optionalMediaEnum = <T extends string>(v: string): T | undefined => {
  const trimmed = v.trim();
  return trimmed && trimmed !== NONE ? (trimmed as T) : undefined;
};

export const catalogFormFieldsFromEntry = (
  e: MangaCatalogEntry | undefined,
): CatalogFormFields => {
  if (!e) return EMPTY_FORM_FIELDS;
  const t = e.title;
  return {
    romaji: t?.romaji ?? "",
    english: t?.english ?? "",
    native: t?.native ?? "",
    preferred: preferredVariantKey(t),
    synonyms: (e.synonyms ?? []).join(", "),
    cover: e.coverImage?.extraLarge ?? e.coverImage?.large ?? "",
    banner: e.bannerImage ?? "",
    description: e.description ?? "",
    genres: (e.genres ?? []).join(", "),
    status: e.status ?? "",
    format: e.format ?? "",
    chapters: e.chapters != null ? String(e.chapters) : "",
    volumes: e.volumes != null ? String(e.volumes) : "",
    year: e.startDate?.year != null ? String(e.startDate.year) : "",
    month: e.startDate?.month != null ? String(e.startDate.month) : "",
    day: e.startDate?.day != null ? String(e.startDate.day) : "",
    endYear: e.endDate?.year != null ? String(e.endDate.year) : "",
    endMonth: e.endDate?.month != null ? String(e.endDate.month) : "",
    endDay: e.endDate?.day != null ? String(e.endDate.day) : "",
    isAdult: !!e.isAdult,
    country: e.countryOfOrigin ?? "",
    siteUrl: e.siteUrl ?? "",
    idMal: e.idMal != null ? String(e.idMal) : "",
    meanScore: e.meanScore != null ? String(e.meanScore) : "",
  };
};

export const catalogEntryFromFormFields = (
  id: number,
  existing: MangaCatalogEntry | undefined,
  fields: CatalogFormFields,
  now = Date.now(),
): MangaCatalogEntry => {
  const cover = fields.cover.trim() || undefined;
  const sd = {
    year: parseOptionalNumber(fields.year),
    month: parseOptionalNumber(fields.month),
    day: parseOptionalNumber(fields.day),
  };
  const ed = {
    year: parseOptionalNumber(fields.endYear),
    month: parseOptionalNumber(fields.endMonth),
    day: parseOptionalNumber(fields.endDay),
  };
  const hasSd = sd.year != null || sd.month != null || sd.day != null;
  const hasEd = ed.year != null || ed.month != null || ed.day != null;
  const romaji = fields.romaji.trim() || undefined;
  const english = fields.english.trim() || undefined;
  const native = fields.native.trim() || undefined;
  const pref = fields.preferred || "english";
  const userPreferred =
    (pref === "romaji" ? romaji : pref === "native" ? native : english) ||
    english ||
    romaji ||
    native;

  return {
    ...existing,
    id,
    type: "MANGA",
    updatedAt: now,
    title: { romaji, english, native, userPreferred },
    synonyms: parseCommaList(fields.synonyms),
    coverImage: cover
      ? {
          ...existing?.coverImage,
          extraLarge: cover,
          large: cover,
          medium: cover,
        }
      : undefined,
    bannerImage: fields.banner.trim() || undefined,
    description: fields.description.trim() || undefined,
    genres: parseCommaList(fields.genres),
    status: optionalMediaEnum<$app.AL_MediaStatus>(fields.status),
    format: optionalMediaEnum<$app.AL_MediaFormat>(fields.format),
    chapters: parseOptionalNumber(fields.chapters),
    volumes: parseOptionalNumber(fields.volumes),
    startDate: hasSd ? sd : undefined,
    endDate: hasEd ? ed : undefined,
    isAdult: fields.isAdult ? true : undefined,
    countryOfOrigin: fields.country.trim() || undefined,
    siteUrl: fields.siteUrl.trim() || undefined,
    idMal: parseOptionalNumber(fields.idMal),
    meanScore: parseOptionalNumber(fields.meanScore),
  };
};
