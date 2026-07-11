import { describe, expect, test } from "bun:test";
import { encodeMediaId } from "../../../_utils/custom-source-id";
import { buildManifestExtIdIndex, probeExtId } from "./ext-id";
import type { SourceMap } from "./sources";

describe("buildManifestExtIdIndex", () => {
  test("maps each live ref's manifest → extId", () => {
    const sources: SourceMap = {
      "1": { manifestId: "mangaupdates", localId: 1, extId: 5, updatedAt: 1 },
      "2": { manifestId: "local-catalog", localId: 2, extId: 8, updatedAt: 1 },
    };
    expect(buildManifestExtIdIndex(sources)).toEqual({
      mangaupdates: 5,
      "local-catalog": 8,
    });
  });

  test("skips tombstoned refs", () => {
    const sources: SourceMap = {
      "1": {
        manifestId: "mangaupdates",
        localId: 1,
        extId: 5,
        updatedAt: 1,
        deletedAt: 2,
      },
    };
    expect(buildManifestExtIdIndex(sources)).toEqual({});
  });
});

describe("probeExtId", () => {
  test("returns the extId whose encoded mediaId resolves to the target manifest", () => {
    const target = 3;
    const found = probeExtId("mangaupdates", 42, {
      getManga: (mediaId) =>
        mediaId === encodeMediaId(target, 42)
          ? { siteUrl: "ext_custom_source_mangaupdates|END|https://x" }
          : { siteUrl: "ext_custom_source_other|END|https://y" },
      sleep: () => {},
    });
    expect(found).toBe(target);
  });

  test("returns null when no extId matches", () => {
    expect(
      probeExtId("mangaupdates", 42, {
        getManga: () => ({ siteUrl: "ext_custom_source_other|END|https://y" }),
        sleep: () => {},
      }),
    ).toBeNull();
  });
});
