import { describe, expect, test } from "bun:test";
import { buildSourceRef, upsertSourceRef } from "./sources";

// mediaId = EXT_ID_OFFSET(2^31) + extId*2^40 + localId
const EXT = 0x80000000;
const R = 0x10000000000;
const mediaId = EXT + 554 * R + 60735012287; // extId 554, localId 60735012287

describe("buildSourceRef", () => {
  test("builds a ref from a custom-source mediaId + wrapped siteUrl", () => {
    const ref = buildSourceRef(
      mediaId,
      "ext_custom_source_mangaupdates|END|u",
      100,
    );
    expect(ref).toEqual({
      manifestId: "mangaupdates",
      localId: 60735012287,
      extId: 554,
      updatedAt: 100,
    });
  });
  test("undefined for a native AniList mediaId", () => {
    expect(
      buildSourceRef(12345, "https://anilist.co/manga/1", 100),
    ).toBeUndefined();
  });
  test("undefined when the siteUrl is not a custom-source wrapper", () => {
    expect(buildSourceRef(mediaId, "https://x", 100)).toBeUndefined();
  });
});

describe("upsertSourceRef", () => {
  const ref = {
    manifestId: "mangaupdates",
    localId: 60735012287,
    extId: 554,
    updatedAt: 100,
  };
  test("inserts a new ref (changed=true)", () => {
    const res = upsertSourceRef({}, mediaId, ref);
    expect(res.changed).toBe(true);
    expect(res.map[String(mediaId)]).toEqual(ref);
  });
  test("no-op when identity is unchanged (changed=false, no updatedAt bump)", () => {
    const start = { [String(mediaId)]: { ...ref, updatedAt: 50 } };
    const res = upsertSourceRef(start, mediaId, ref);
    expect(res.changed).toBe(false);
    expect(res.map[String(mediaId)].updatedAt).toBe(50);
  });
  test("does not mutate the input map", () => {
    const start = {};
    upsertSourceRef(start, mediaId, ref);
    expect(start).toEqual({});
  });
});
