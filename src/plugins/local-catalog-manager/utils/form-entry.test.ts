import { describe, expect, test } from "bun:test";
import {
  type CatalogFormRefs,
  catalogEntryFromFormFields,
  catalogFormFieldsFromEntry,
  readCatalogFormFields,
  writeCatalogFormFields,
} from "./form-entry";
import { NONE } from "./form-options";

const sampleEntry: MangaCatalogEntry = {
  id: 1,
  type: "MANGA",
  updatedAt: 1000,
  title: {
    romaji: "Romaji",
    english: "English",
    native: "Native",
    userPreferred: "English",
  },
  status: "RELEASING",
  format: "MANGA",
  chapters: 10,
  startDate: { year: 2020, month: 3, day: 15 },
  isAdult: true,
  genres: ["Action", "Drama"],
  synonyms: ["Alt"],
};

describe("catalogFormFieldsFromEntry", () => {
  test("maps entry fields to form strings", () => {
    expect(catalogFormFieldsFromEntry(sampleEntry)).toEqual({
      romaji: "Romaji",
      english: "English",
      native: "Native",
      preferred: "english",
      synonyms: "Alt",
      cover: "",
      banner: "",
      description: "",
      genres: "Action, Drama",
      status: "RELEASING",
      format: "MANGA",
      chapters: "10",
      volumes: "",
      year: "2020",
      month: "3",
      day: "15",
      endYear: "",
      endMonth: "",
      endDay: "",
      isAdult: true,
      country: "",
      siteUrl: "",
      idMal: "",
      meanScore: "",
    });
  });

  test("empty entry yields blank form", () => {
    const fields = catalogFormFieldsFromEntry(undefined);
    expect(fields.romaji).toBe("");
    expect(fields.preferred).toBe("english");
  });
});

describe("catalogEntryFromFormFields", () => {
  test("round-trips core fields", () => {
    const fields = catalogFormFieldsFromEntry(sampleEntry);
    const entry = catalogEntryFromFormFields(1, sampleEntry, fields, 2000);
    expect(entry.id).toBe(1);
    expect(entry.updatedAt).toBe(2000);
    expect(entry.title?.userPreferred).toBe("English");
    expect(entry.chapters).toBe(10);
    expect(entry.startDate).toEqual({ year: 2020, month: 3, day: 15 });
  });

  test("NONE sentinel clears status and format", () => {
    const entry = catalogEntryFromFormFields(
      2,
      undefined,
      {
        ...catalogFormFieldsFromEntry(undefined),
        romaji: "Solo",
        status: NONE,
        format: NONE,
      },
      1,
    );
    expect(entry.status).toBeUndefined();
    expect(entry.format).toBeUndefined();
    expect(entry.title?.userPreferred).toBe("Solo");
  });
});

describe("readCatalogFormFields", () => {
  test("reads field ref currents", () => {
    const refs: CatalogFormRefs = {
      romaji: { current: "R", setValue: () => {} },
      english: { current: "E", setValue: () => {} },
      native: { setValue: () => {} },
      preferred: { current: "romaji", setValue: () => {} },
      synonyms: { setValue: () => {} },
      cover: { setValue: () => {} },
      banner: { setValue: () => {} },
      description: { setValue: () => {} },
      genres: { setValue: () => {} },
      status: { setValue: () => {} },
      format: { setValue: () => {} },
      chapters: { setValue: () => {} },
      volumes: { setValue: () => {} },
      year: { setValue: () => {} },
      month: { setValue: () => {} },
      day: { setValue: () => {} },
      endYear: { setValue: () => {} },
      endMonth: { setValue: () => {} },
      endDay: { setValue: () => {} },
      isAdult: { current: true, setValue: () => {} },
      country: { setValue: () => {} },
      siteUrl: { setValue: () => {} },
      idMal: { setValue: () => {} },
      meanScore: { setValue: () => {} },
    };
    expect(readCatalogFormFields(refs).romaji).toBe("R");
    expect(readCatalogFormFields(refs).preferred).toBe("romaji");
    expect(readCatalogFormFields(refs).isAdult).toBe(true);
  });
});

describe("writeCatalogFormFields", () => {
  test("writes through field refs", () => {
    const romaji: string[] = [];
    const refs: CatalogFormRefs = {
      romaji: { setValue: (v) => romaji.push(v) },
      english: { setValue: () => {} },
      native: { setValue: () => {} },
      preferred: { setValue: () => {} },
      synonyms: { setValue: () => {} },
      cover: { setValue: () => {} },
      banner: { setValue: () => {} },
      description: { setValue: () => {} },
      genres: { setValue: () => {} },
      status: { setValue: () => {} },
      format: { setValue: () => {} },
      chapters: { setValue: () => {} },
      volumes: { setValue: () => {} },
      year: { setValue: () => {} },
      month: { setValue: () => {} },
      day: { setValue: () => {} },
      endYear: { setValue: () => {} },
      endMonth: { setValue: () => {} },
      endDay: { setValue: () => {} },
      isAdult: { setValue: () => {} },
      country: { setValue: () => {} },
      siteUrl: { setValue: () => {} },
      idMal: { setValue: () => {} },
      meanScore: { setValue: () => {} },
    };
    writeCatalogFormFields(refs, catalogFormFieldsFromEntry(sampleEntry));
    expect(romaji).toEqual(["Romaji"]);
  });
});
