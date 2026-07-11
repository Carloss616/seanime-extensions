import { describe, expect, test } from "bun:test";
import {
  decodeExtId,
  decodeLocalId,
  EXT_ID_OFFSET,
  encodeMediaId,
  isCustomSourceId,
  LOCAL_ID_RANGE,
  MAX_EXT_ID,
  parseCustomSourceManifestId,
  stableCustomSourceKey,
} from "./custom-source-id.ts";

describe("custom-source-id constants", () => {
  test("offset is 2^31 and range is 2^40", () => {
    expect(EXT_ID_OFFSET).toBe(0x80000000);
    expect(LOCAL_ID_RANGE).toBe(0x10000000000);
    expect(EXT_ID_OFFSET).toBe(2 ** 31);
    expect(LOCAL_ID_RANGE).toBe(2 ** 40);
  });

  test("max extension identifier is 1023", () => {
    expect(MAX_EXT_ID).toBe(1023);
    expect(MAX_EXT_ID).toBe(0x3ff);
  });
});

describe("isCustomSourceId", () => {
  test("AniList ids (< 2^31) are not custom-source ids", () => {
    expect(isCustomSourceId(0)).toBe(false);
    expect(isCustomSourceId(150000)).toBe(false);
    expect(isCustomSourceId(EXT_ID_OFFSET - 1)).toBe(false);
  });

  test("ids at or above the offset are custom-source ids", () => {
    expect(isCustomSourceId(EXT_ID_OFFSET)).toBe(true);
    expect(isCustomSourceId(609192324283839)).toBe(true);
  });
});

describe("decode", () => {
  // CLAUDE.md worked example: The Beginning After the End.
  const mediaId = 609192324283839;

  test("decodeLocalId recovers the MU series_id", () => {
    expect(decodeLocalId(mediaId)).toBe(60735012287);
  });

  test("decodeExtId recovers the runtime extension identifier", () => {
    expect(decodeExtId(mediaId)).toBe(554);
  });
});

describe("encodeMediaId", () => {
  test("round-trips with decodeLocalId/decodeExtId", () => {
    const extId = 554;
    const localId = 60735012287;
    const mediaId = encodeMediaId(extId, localId);
    expect(mediaId).toBe(609192324283839);
    expect(decodeExtId(mediaId)).toBe(extId);
    expect(decodeLocalId(mediaId)).toBe(localId);
  });

  test("smallest custom-source entry (extId 1, localId 1)", () => {
    const mediaId = encodeMediaId(1, 1);
    expect(mediaId).toBe(EXT_ID_OFFSET + LOCAL_ID_RANGE + 1);
    expect(isCustomSourceId(mediaId)).toBe(true);
    expect(decodeExtId(mediaId)).toBe(1);
    expect(decodeLocalId(mediaId)).toBe(1);
  });

  test("max representable mediaId stays under Number.MAX_SAFE_INTEGER", () => {
    const mediaId = encodeMediaId(MAX_EXT_ID, LOCAL_ID_RANGE - 1);
    expect(Number.isSafeInteger(mediaId)).toBe(true);
  });
});

describe("parseCustomSourceManifestId", () => {
  test("extracts the manifest id from a wrapped siteUrl", () => {
    expect(
      parseCustomSourceManifestId(
        "ext_custom_source_mangaupdates|END|https://x",
      ),
    ).toBe("mangaupdates");
  });
  test("handles a hyphenated manifest id", () => {
    expect(
      parseCustomSourceManifestId(
        "ext_custom_source_local-catalog|END|https://y",
      ),
    ).toBe("local-catalog");
  });
  test("undefined for a native AniList siteUrl", () => {
    expect(
      parseCustomSourceManifestId("https://anilist.co/manga/1"),
    ).toBeUndefined();
  });
  test("undefined for empty / missing / malformed (no |END|)", () => {
    expect(parseCustomSourceManifestId(undefined)).toBeUndefined();
    expect(parseCustomSourceManifestId("")).toBeUndefined();
    expect(parseCustomSourceManifestId("ext_custom_source_x")).toBeUndefined();
    expect(
      parseCustomSourceManifestId("ext_custom_source_|END|u"),
    ).toBeUndefined();
  });
});

describe("stableCustomSourceKey", () => {
  test("joins manifest id and localId", () => {
    expect(stableCustomSourceKey("mangaupdates", 60735012287)).toBe(
      "mangaupdates:60735012287",
    );
  });
});
