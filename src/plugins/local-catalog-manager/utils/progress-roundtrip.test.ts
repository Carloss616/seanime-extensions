import { describe, expect, test } from "bun:test";
import { encodeMediaId } from "../../../_utils/custom-source-id";
import { createLogger } from "../../../_utils/logger";
import type { GistClient } from "./gist-client.ts";
import {
  buildEncodedMediaIdLookup,
  syncProgressRoundTrip,
} from "./progress-roundtrip.ts";

describe("buildEncodedMediaIdLookup", () => {
  test("maps every merged manga key via encodeMediaId", () => {
    const merged: LocalProgress = {
      version: 1,
      updatedAt: 1,
      manga: { "1": { updatedAt: 1 }, "42": { updatedAt: 2 } },
      anime: {},
    };
    const map = buildEncodedMediaIdLookup(merged, 7);
    expect(map.get(1)).toBe(encodeMediaId(7, 1));
    expect(map.get(42)).toBe(encodeMediaId(7, 42));
    expect(map.size).toBe(2);
  });
});

describe("syncProgressRoundTrip", () => {
  test("merges, applies remote-newer, and skips no-op push", async () => {
    const remoteDoc: LocalProgress = {
      version: 1,
      updatedAt: 100,
      manga: { "1": { progress: 5, updatedAt: 100 } },
      anime: {},
    };
    const localDoc: LocalProgress = {
      version: 1,
      updatedAt: 50,
      manga: { "1": { progress: 3, updatedAt: 50 } },
      anime: {},
    };
    let pushed = false;
    const client = {
      async getGistFile() {
        return JSON.stringify(remoteDoc);
      },
      async updateGistFile() {
        pushed = true;
      },
    } as unknown as GistClient;
    const updates: number[] = [];
    const result = await syncProgressRoundTrip({
      client,
      gistId: "abc",
      filename: "progress.json",
      local: localDoc,
      now: 200,
      log: createLogger(),
      mediaIdByLocalId: new Map([[1, 9001]]),
      updateEntry: (mediaId) => {
        updates.push(mediaId);
      },
    });
    expect(result.applied).toBe(1);
    expect(updates).toEqual([9001]);
    expect(result.merged.manga["1"]?.progress).toBe(5);
    expect(pushed).toBe(false);
  });

  test("skipApply merges and pushes without calling applyRemote", async () => {
    const remoteDoc: LocalProgress = {
      version: 1,
      updatedAt: 100,
      manga: { "1": { progress: 5, updatedAt: 100 } },
      anime: {},
    };
    const localDoc: LocalProgress = {
      version: 1,
      updatedAt: 50,
      manga: {},
      anime: {},
    };
    let updateCalled = false;
    const client = {
      async getGistFile() {
        return JSON.stringify(remoteDoc);
      },
      async updateGistFile() {},
    } as unknown as GistClient;
    const result = await syncProgressRoundTrip({
      client,
      gistId: "abc",
      filename: "progress.json",
      local: localDoc,
      now: 200,
      log: createLogger(),
      skipApply: true,
      updateEntry: () => {
        updateCalled = true;
      },
    });
    expect(result.applied).toBe(0);
    expect(updateCalled).toBe(false);
    expect(result.merged.manga["1"]?.progress).toBe(5);
  });
});
