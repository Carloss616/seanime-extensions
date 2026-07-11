import { describe, expect, test } from "bun:test";
import { encodeMediaId } from "../../../_utils/custom-source-id";
import { GistClient } from "../../../_utils/gist/client";
import {
  SYNC_FILE_EXCLUSIONS,
  SYNC_FILE_MATCHES,
  SYNC_FILE_PINS,
  SYNC_FILE_PROBES,
  SYNC_FILE_SUMMARIES,
  SYNC_HEAD_FILE,
} from "./constants";
import type { SourceMap } from "./sources";
import {
  ALL_SYNC_FILES,
  effTs,
  emptyLocalMaps,
  ensureGist,
  filesToWireMaps,
  type LocalMaps,
  localizeWireMaps,
  mergeLocalBack,
  mergeMaps,
  syncMsu,
  toWireMaps,
  type WireMaps,
  wireMapsToFiles,
} from "./sync";

const log = console;

describe("effTs", () => {
  test("is max(updatedAt, deletedAt)", () => {
    expect(effTs({ updatedAt: 5 })).toBe(5);
    expect(effTs({ updatedAt: 5, deletedAt: 9 })).toBe(9);
    expect(effTs({ updatedAt: 9, deletedAt: 5 })).toBe(9);
    expect(effTs({} as { updatedAt: number })).toBe(0);
  });
});

describe("mergeMaps", () => {
  test("per-record LWW: newer updatedAt wins (2-level)", () => {
    const local: WireMaps = {
      ...emptyLocalMaps(),
      exclusions: { "1": { p: { reason: "outdated", updatedAt: 10 } } },
    };
    const remote: WireMaps = {
      ...emptyLocalMaps(),
      exclusions: { "1": { p: { reason: "other", updatedAt: 20 } } },
    };
    expect(mergeMaps(local, remote).exclusions["1"].p.reason).toBe("other");
  });

  test("tombstone newer than an edit wins", () => {
    const local: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { p: { updatedAt: 30 } } },
    };
    const remote: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { p: { updatedAt: 10, deletedAt: 40 } } },
    };
    expect(mergeMaps(local, remote).pins["1"].p.deletedAt).toBe(40);
  });

  test("edit newer than a tombstone resurrects", () => {
    const local: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { p: { updatedAt: 50 } } },
    };
    const remote: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { p: { updatedAt: 10, deletedAt: 40 } } },
    };
    expect(mergeMaps(local, remote).pins["1"].p.deletedAt).toBeUndefined();
  });

  test("one-level summaries merges by effTs", () => {
    const local: WireMaps = {
      ...emptyLocalMaps(),
      summaries: {
        "1": {
          title: "L",
          latest: 1,
          read: 0,
          sources: 1,
          kind: "new",
          updatedAt: 5,
        },
      },
    };
    const remote: WireMaps = {
      ...emptyLocalMaps(),
      summaries: {
        "1": {
          title: "R",
          latest: 2,
          read: 0,
          sources: 1,
          kind: "new",
          updatedAt: 9,
        },
      },
    };
    expect(mergeMaps(local, remote).summaries["1"].title).toBe("R");
  });

  test("union of keys from both sides", () => {
    const local: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { a: { updatedAt: 1 } } },
    };
    const remote: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "2": { b: { updatedAt: 1 } } },
    };
    expect(Object.keys(mergeMaps(local, remote).pins).sort()).toEqual([
      "1",
      "2",
    ]);
  });
});

describe("per-file serialize / parse", () => {
  test("wireMapsToFiles produces one canonical file per map, summaries first", () => {
    const files = wireMapsToFiles(emptyLocalMaps());
    expect(Object.keys(files)).toEqual([
      SYNC_FILE_SUMMARIES,
      SYNC_FILE_EXCLUSIONS,
      SYNC_FILE_PINS,
      SYNC_FILE_PROBES,
      SYNC_FILE_MATCHES,
    ]);
    expect(files[SYNC_FILE_SUMMARIES]).toBe("{}");
  });

  test("ALL_SYNC_FILES lists summaries first", () => {
    expect(ALL_SYNC_FILES[0]).toBe(SYNC_FILE_SUMMARIES);
    expect(ALL_SYNC_FILES).toHaveLength(5);
  });

  test("serialization is stable regardless of key insertion order", () => {
    const a: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "2": { b: { updatedAt: 1 } }, "1": { a: { updatedAt: 1 } } },
    };
    const b: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { a: { updatedAt: 1 } }, "2": { b: { updatedAt: 1 } } },
    };
    expect(wireMapsToFiles(a)[SYNC_FILE_PINS]).toBe(
      wireMapsToFiles(b)[SYNC_FILE_PINS],
    );
  });

  test("empty inner map drops out (so it doesn't look changed vs. an absent key)", () => {
    const withEmpty: WireMaps = { ...emptyLocalMaps(), pins: { "5": {} } };
    expect(wireMapsToFiles(withEmpty)[SYNC_FILE_PINS]).toBe("{}");
  });

  test("files round-trip back to maps (updatedAt preserved)", () => {
    const maps: WireMaps = {
      ...emptyLocalMaps(),
      summaries: {
        "1": {
          title: "T",
          latest: 0,
          read: 0,
          sources: 0,
          kind: "new",
          updatedAt: 3,
        },
      },
      probes: {
        "9": {
          p: {
            provider: "x",
            providerName: "X",
            latest: 1,
            count: 1,
            matched: true,
            errored: false,
            updatedAt: 7,
          },
        },
      },
    };
    const back = filesToWireMaps(wireMapsToFiles(maps));
    expect(back.summaries["1"].updatedAt).toBe(3);
    expect(back.probes["9"].p.updatedAt).toBe(7);
  });

  test("filesToWireMaps tolerates empty / malformed files", () => {
    expect(filesToWireMaps({})).toEqual(emptyLocalMaps());
    expect(filesToWireMaps({ [SYNC_FILE_SUMMARIES]: "not json" })).toEqual(
      emptyLocalMaps(),
    );
  });

  test("filesToWireMaps drops a non-numeric deletedAt (untrusted content)", () => {
    const raw = JSON.stringify({
      "1": { p: { updatedAt: 5, deletedAt: "oops" } },
    });
    const back = filesToWireMaps({ [SYNC_FILE_PINS]: raw });
    expect(back.pins["1"].p.deletedAt).toBeUndefined();
    expect(effTs(back.pins["1"].p)).toBe(5);
  });
});

describe("toWireMaps / localizeWireMaps / mergeLocalBack", () => {
  const csMediaId = encodeMediaId(7, 42);
  const sources: SourceMap = {
    [String(csMediaId)]: {
      manifestId: "mangaupdates",
      localId: 42,
      extId: 7,
      updatedAt: 1,
    },
  };

  test("toWireMaps translates keys and drops untranslatable custom-source ids", () => {
    const local: LocalMaps = {
      ...emptyLocalMaps(),
      pins: {
        "12345": { p: { updatedAt: 1 } }, // native
        [String(csMediaId)]: { p: { updatedAt: 1 } }, // translatable
        [String(encodeMediaId(7, 99))]: { p: { updatedAt: 1 } }, // no ref → dropped
      },
    };
    const { maps, dropped } = toWireMaps(local, sources);
    expect(Object.keys(maps.pins).sort()).toEqual([
      "12345",
      "cs:mangaupdates:42",
    ]);
    expect(dropped).toEqual([encodeMediaId(7, 99)]);
  });

  test("localizeWireMaps maps wire keys back to this instance's mediaIds", () => {
    const maps: WireMaps = {
      ...emptyLocalMaps(),
      pins: {
        "12345": { p: { updatedAt: 1 } },
        "cs:mangaupdates:42": { p: { updatedAt: 1 } },
      },
    };
    const { maps: out, unresolved } = localizeWireMaps(maps, (m) =>
      m === "mangaupdates" ? 9 : null,
    );
    expect(Object.keys(out.pins).sort()).toEqual([
      "12345",
      String(encodeMediaId(9, 42)),
    ]);
    expect(unresolved).toEqual([]);
  });

  test("localizeWireMaps passes the key's localId to the resolver as a seed", () => {
    const seeds: number[] = [];
    const maps: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "cs:mangaupdates:42": { p: { updatedAt: 1 } } },
    };
    localizeWireMaps(maps, (_m, seedLocalId) => {
      seeds.push(seedLocalId);
      return 9;
    });
    expect(seeds).toEqual([42]);
  });

  test("localizeWireMaps collects unresolvable manifests", () => {
    const maps: WireMaps = {
      ...emptyLocalMaps(),
      pins: { "cs:other:1": { p: { updatedAt: 1 } } },
    };
    const { maps: out, unresolved } = localizeWireMaps(maps, () => null);
    expect(out.pins).toEqual({});
    expect(unresolved).toEqual(["cs:other:1"]);
  });

  test("mergeLocalBack keeps untranslatable local keys, localized wins collisions", () => {
    const existing: LocalMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { p: { updatedAt: 1 } }, "2": { p: { updatedAt: 5 } } },
    };
    const localized: LocalMaps = {
      ...emptyLocalMaps(),
      pins: { "1": { p: { updatedAt: 9 } } },
    };
    const out = mergeLocalBack(existing, localized);
    expect(out.pins["1"].p.updatedAt).toBe(9);
    expect(out.pins["2"].p.updatedAt).toBe(5);
  });
});

// Scripted GistClient: routes by "METHOD path" and returns/records per call.
function scriptedClient(scripts: Record<string, () => unknown>) {
  const calls: { url: string; method: string; body?: string }[] = [];
  const fn = (async (url: string, init: FetchOptions) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body });
    const key = `${init?.method ?? "GET"} ${url.split("?")[0]}`;
    const payload = (scripts[key] ?? (() => ({})))();
    return {
      ok: true,
      status: 200,
      json: () => payload,
      text: () => JSON.stringify(payload),
    } as FetchResponse;
  }) as unknown as typeof fetch;
  return { client: new GistClient("tok", fn), calls };
}

// Build the GitHub gist GET response (files → { content }) from a file map.
function gistFilesResponse(files: Record<string, string>) {
  const out: Record<string, { content: string }> = {};
  for (const [name, content] of Object.entries(files)) out[name] = { content };
  return { files: out };
}

describe("ensureGist", () => {
  test("returns the stored id without any network call", async () => {
    const { client, calls } = scriptedClient({});
    let stored: string | undefined = "existing";
    const id = await ensureGist({
      client,
      getGistId: () => stored,
      setGistId: (v) => (stored = v),
    });
    expect(id).toBe("existing");
    expect(calls.length).toBe(0);
  });

  test("discovers by the head filename when no id is stored", async () => {
    const { client } = scriptedClient({
      "GET https://api.github.com/gists": () => [
        { id: "found", files: { [SYNC_HEAD_FILE]: {} } },
      ],
    });
    let stored: string | undefined;
    const id = await ensureGist({
      client,
      getGistId: () => stored,
      setGistId: (v) => (stored = v),
    });
    expect(id).toBe("found");
    expect(stored).toBe("found");
  });

  test("creates a gist (head file only) when none exists", async () => {
    const { client, calls } = scriptedClient({
      "GET https://api.github.com/gists": () => [],
      "POST https://api.github.com/gists": () => ({
        id: "new",
        owner: { login: "me" },
      }),
    });
    let stored: string | undefined;
    const id = await ensureGist({
      client,
      getGistId: () => stored,
      setGistId: (v) => (stored = v),
    });
    expect(id).toBe("new");
    expect(stored).toBe("new");
    const post = calls.find((c) => c.method === "POST");
    const body = JSON.parse(post?.body ?? "{}");
    // Only the head (summaries) file is seeded on create.
    expect(Object.keys(body.files)).toEqual([SYNC_HEAD_FILE]);
  });
});

describe("syncMsu round-trip (multi-file)", () => {
  test("merges remote into local, PATCHes only changed files, returns write-back", async () => {
    const remotePins = JSON.stringify({ "222": { p: { updatedAt: 100 } } });
    const { client, calls } = scriptedClient({
      "GET https://api.github.com/gists/gid": () =>
        gistFilesResponse({ [SYNC_FILE_PINS]: remotePins }),
      "PATCH https://api.github.com/gists/gid": () => ({}),
    });
    const local: LocalMaps = {
      ...emptyLocalMaps(),
      pins: { "111": { p: { updatedAt: 50 } } },
    };
    const res = await syncMsu({
      client,
      gistId: "gid",
      local,
      sources: {},
      extIdForManifest: () => null,
      log,
    });
    expect(res.pushed).toBe(true);
    // Both records present after merge, localized back to mediaId keys.
    expect(Object.keys(res.writeBack.pins).sort()).toEqual(["111", "222"]);
    // Only the pins file changed → only it is PATCHed.
    const patch = calls.find((c) => c.method === "PATCH");
    expect(Object.keys(JSON.parse(patch?.body ?? "{}").files)).toEqual([
      SYNC_FILE_PINS,
    ]);
    expect(res.changedFiles).toEqual([SYNC_FILE_PINS]);
  });

  test("skips the PATCH when merged equals remote (no-op)", async () => {
    const pins = JSON.stringify({ "111": { p: { updatedAt: 50 } } });
    const { client, calls } = scriptedClient({
      "GET https://api.github.com/gists/gid": () =>
        gistFilesResponse({ [SYNC_FILE_PINS]: pins }),
      "PATCH https://api.github.com/gists/gid": () => ({}),
    });
    const res = await syncMsu({
      client,
      gistId: "gid",
      local: { ...emptyLocalMaps(), pins: { "111": { p: { updatedAt: 50 } } } },
      sources: {},
      extIdForManifest: () => null,
      log,
    });
    expect(res.pushed).toBe(false);
    expect(res.changedFiles).toEqual([]);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
