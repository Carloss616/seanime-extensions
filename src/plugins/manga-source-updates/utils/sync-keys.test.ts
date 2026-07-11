import { describe, expect, test } from "bun:test";
import { encodeMediaId } from "../../../_utils/custom-source-id";
import type { SourceMap } from "./sources";
import { fromWireKey, toWireKey } from "./sync-keys";

describe("toWireKey", () => {
  test("native AniList mediaId → its string form", () => {
    expect(toWireKey(12345, {})).toBe("12345");
  });

  test("custom-source mediaId → cs:manifest:localId via K_SOURCES", () => {
    const mediaId = encodeMediaId(7, 42); // extId 7, localId 42
    const sources: SourceMap = {
      [String(mediaId)]: {
        manifestId: "mangaupdates",
        localId: 42,
        extId: 7,
        updatedAt: 1,
      },
    };
    expect(toWireKey(mediaId, sources)).toBe("cs:mangaupdates:42");
  });

  test("custom-source mediaId with no ref → null (skip from push)", () => {
    const mediaId = encodeMediaId(7, 42);
    expect(toWireKey(mediaId, {})).toBeNull();
  });

  test("custom-source mediaId with a tombstoned ref → null", () => {
    const mediaId = encodeMediaId(7, 42);
    const sources: SourceMap = {
      [String(mediaId)]: {
        manifestId: "mangaupdates",
        localId: 42,
        extId: 7,
        updatedAt: 1,
        deletedAt: 2,
      },
    };
    expect(toWireKey(mediaId, sources)).toBeNull();
  });
});

describe("fromWireKey", () => {
  const extIdForManifest = (m: string) => (m === "mangaupdates" ? 9 : null);

  test("plain numeric key → that mediaId", () => {
    expect(fromWireKey("12345", extIdForManifest)).toBe(12345);
  });

  test("cs:manifest:localId → encodeMediaId(thisExtId, localId)", () => {
    expect(fromWireKey("cs:mangaupdates:42", extIdForManifest)).toBe(
      encodeMediaId(9, 42),
    );
  });

  test("cs key for an unresolvable manifest → null", () => {
    expect(fromWireKey("cs:unknownsrc:42", extIdForManifest)).toBeNull();
  });

  test("malformed cs key → null", () => {
    expect(fromWireKey("cs:mangaupdates", extIdForManifest)).toBeNull();
    expect(fromWireKey("cs:mangaupdates:abc", extIdForManifest)).toBeNull();
  });
});
