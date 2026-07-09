import { describe, expect, test } from "bun:test";
import { encodeMediaId } from "../../../_utils/custom-source-id";
import {
  discoverExtId,
  localIdFromMediaId,
  mediaIdFor,
  resolveMediaId,
} from "./ext-id.ts";

const PREFIX = "ext_custom_source_local-catalog";

describe("mediaIdFor", () => {
  test("returns null when extId is not cached", () => {
    expect(mediaIdFor(null, 1, encodeMediaId)).toBeNull();
    expect(mediaIdFor(undefined, 1, encodeMediaId)).toBeNull();
  });

  test("encodes when extId is present", () => {
    expect(mediaIdFor(3, 99, encodeMediaId)).toBe(encodeMediaId(3, 99));
  });
});

describe("discoverExtId", () => {
  test("returns cached extId without probing", async () => {
    let probed = false;
    const extId = await discoverExtId({
      getCachedExtId: () => 42,
      setCachedExtId: () => {},
      getLookupEntry: () => undefined,
      decodeExtId: () => 0,
      getProbeLocalId: () => 1,
      getManga: () => {
        probed = true;
        return undefined;
      },
      sourcePrefix: PREFIX,
      encodeMediaId,
      sleep: () => {},
    });
    expect(extId).toBe(42);
    expect(probed).toBe(false);
  });

  test("derives extId from collection lookup entry", async () => {
    const mediaId = encodeMediaId(5, 10);
    let stored: number | undefined;
    const extId = await discoverExtId({
      getCachedExtId: () => undefined,
      setCachedExtId: (id) => {
        stored = id;
      },
      getLookupEntry: () => [10, mediaId],
      decodeExtId: () => 5,
      getProbeLocalId: () => undefined,
      getManga: () => undefined,
      sourcePrefix: PREFIX,
      encodeMediaId,
      sleep: () => {},
    });
    expect(extId).toBe(5);
    expect(stored).toBe(5);
  });
});

describe("resolveMediaId", () => {
  test("uses cached extId without async discovery", async () => {
    const id = await resolveMediaId(7, {
      getCachedExtId: () => 2,
      setCachedExtId: () => {},
      getLookupEntry: () => undefined,
      decodeExtId: () => 0,
      getProbeLocalId: () => undefined,
      getManga: () => undefined,
      sourcePrefix: PREFIX,
      encodeMediaId,
      sleep: () => {},
    });
    expect(id).toBe(encodeMediaId(2, 7));
  });
});

describe("localIdFromMediaId", () => {
  test("returns 0 for non-custom-source id", () => {
    expect(
      localIdFromMediaId(123, {
        isCustomSourceId: () => false,
        getManga: () => undefined,
        sourcePrefix: PREFIX,
        decodeLocalId: () => 0,
      }),
    ).toBe(0);
  });

  test("returns 0 when siteUrl prefix mismatches", () => {
    const mediaId = encodeMediaId(2, 9);
    expect(
      localIdFromMediaId(mediaId, {
        isCustomSourceId: () => true,
        getManga: () => ({ id: 1, siteUrl: "ext_custom_source_other|END|x" }),
        sourcePrefix: PREFIX,
        decodeLocalId: () => 9,
      }),
    ).toBe(0);
  });

  test("decodes local id for matching entry", () => {
    const mediaId = encodeMediaId(2, 9);
    expect(
      localIdFromMediaId(mediaId, {
        isCustomSourceId: () => true,
        getManga: () => ({
          id: mediaId,
          siteUrl: `${PREFIX}|END|https://example.com/9`,
        }),
        sourcePrefix: PREFIX,
        decodeLocalId: () => 9,
      }),
    ).toBe(9);
  });
});
