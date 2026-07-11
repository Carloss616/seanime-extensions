import { describe, expect, test } from "bun:test";
import { encodeMediaId } from "../../../_utils/custom-source-id";
import { GistClient } from "../../../_utils/gist/client";
import type { SourceMap } from "./sources";
import {
  effTs,
  emptyLocalMaps,
  ensureGist,
  type LocalMaps,
  localizeWireDoc,
  mergeLocalBack,
  mergeWireDocs,
  parseWireDoc,
  serializeWireDoc,
  syncMsu,
  toWireDoc,
  type WireDoc,
  wireMapsEqual,
} from "./sync";

const log = console;

function emptyWire(): WireDoc {
  return {
    version: 1,
    updatedAt: 0,
    excluded: {},
    pinned: {},
    results: {},
    probes: {},
    matches: {},
  };
}

describe("effTs", () => {
  test("is max(updatedAt, deletedAt)", () => {
    expect(effTs({ updatedAt: 5 })).toBe(5);
    expect(effTs({ updatedAt: 5, deletedAt: 9 })).toBe(9);
    expect(effTs({ updatedAt: 9, deletedAt: 5 })).toBe(9);
    expect(effTs({} as { updatedAt: number })).toBe(0);
  });
});

describe("mergeWireDocs", () => {
  test("per-record LWW: newer updatedAt wins (2-level map)", () => {
    const local: WireDoc = {
      ...emptyWire(),
      excluded: { "1": { p: { reason: "outdated", updatedAt: 10 } } },
    };
    const remote: WireDoc = {
      ...emptyWire(),
      excluded: { "1": { p: { reason: "other", updatedAt: 20 } } },
    };
    const merged = mergeWireDocs(local, remote, 99);
    expect(merged.excluded["1"].p.reason).toBe("other");
    expect(merged.updatedAt).toBe(99);
  });

  test("tombstone newer than an edit wins", () => {
    const local: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { p: { updatedAt: 30 } } },
    };
    const remote: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { p: { updatedAt: 10, deletedAt: 40 } } },
    };
    const merged = mergeWireDocs(local, remote, 0);
    expect(merged.pinned["1"].p.deletedAt).toBe(40);
  });

  test("edit newer than a tombstone wins (resurrect)", () => {
    const local: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { p: { updatedAt: 50 } } },
    };
    const remote: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { p: { updatedAt: 10, deletedAt: 40 } } },
    };
    const merged = mergeWireDocs(local, remote, 0);
    expect(merged.pinned["1"].p.deletedAt).toBeUndefined();
  });

  test("one-level results map merges by effTs", () => {
    const local: WireDoc = {
      ...emptyWire(),
      results: {
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
    const remote: WireDoc = {
      ...emptyWire(),
      results: {
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
    expect(mergeWireDocs(local, remote, 0).results["1"].title).toBe("R");
  });

  test("union of keys from both sides", () => {
    const local: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { a: { updatedAt: 1 } } },
    };
    const remote: WireDoc = {
      ...emptyWire(),
      pinned: { "2": { b: { updatedAt: 1 } } },
    };
    const merged = mergeWireDocs(local, remote, 0);
    expect(Object.keys(merged.pinned).sort()).toEqual(["1", "2"]);
  });
});

describe("serialize / parse round-trip + equality", () => {
  test("serializeWireDoc is stable regardless of key insertion order", () => {
    const a: WireDoc = {
      ...emptyWire(),
      pinned: { "2": { b: { updatedAt: 1 } }, "1": { a: { updatedAt: 1 } } },
    };
    const b: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { a: { updatedAt: 1 } }, "2": { b: { updatedAt: 1 } } },
    };
    expect(serializeWireDoc(a)).toBe(serializeWireDoc(b));
  });

  test("wireMapsEqual ignores the envelope updatedAt", () => {
    const a: WireDoc = {
      ...emptyWire(),
      updatedAt: 100,
      pinned: { "1": { a: { updatedAt: 1 } } },
    };
    const b: WireDoc = {
      ...emptyWire(),
      updatedAt: 999,
      pinned: { "1": { a: { updatedAt: 1 } } },
    };
    expect(wireMapsEqual(a, b)).toBe(true);
  });

  test("wireMapsEqual is false when a record differs", () => {
    const a: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { a: { updatedAt: 1 } } },
    };
    const b: WireDoc = {
      ...emptyWire(),
      pinned: { "1": { a: { updatedAt: 2 } } },
    };
    expect(wireMapsEqual(a, b)).toBe(false);
  });

  test("parseWireDoc tolerates empty / malformed input", () => {
    expect(parseWireDoc("", log)).toEqual(emptyWire());
    expect(parseWireDoc("not json", log)).toEqual(emptyWire());
    expect(
      parseWireDoc(
        serializeWireDoc({
          ...emptyWire(),
          results: {
            "1": {
              title: "T",
              latest: 0,
              read: 0,
              sources: 0,
              kind: "new",
              updatedAt: 3,
            },
          },
        }),
        log,
      ).results["1"].updatedAt,
    ).toBe(3);
  });

  test("wireMapsEqual treats an empty inner map as equivalent to an absent key", () => {
    const a: WireDoc = { ...emptyWire(), pinned: { "5": {} } };
    const b: WireDoc = { ...emptyWire(), pinned: {} };
    expect(wireMapsEqual(a, b)).toBe(true);
  });

  test("serializeWireDoc drops an outer key whose inner map is empty", () => {
    const doc: WireDoc = { ...emptyWire(), pinned: { "5": {} } };
    expect(serializeWireDoc(doc)).not.toContain('"5"');
  });

  test("parseWireDoc drops a non-numeric deletedAt instead of corrupting the merge", () => {
    const raw = JSON.stringify({
      ...emptyWire(),
      pinned: { "1": { p: { updatedAt: 5, deletedAt: "oops" } } },
    });
    const parsed = parseWireDoc(raw, log);
    expect(parsed.pinned["1"].p.deletedAt).toBeUndefined();
    expect(effTs(parsed.pinned["1"].p)).toBe(5);
  });
});

describe("toWireDoc / localizeWireDoc / mergeLocalBack", () => {
  const csMediaId = encodeMediaId(7, 42);
  const sources: SourceMap = {
    [String(csMediaId)]: {
      manifestId: "mangaupdates",
      localId: 42,
      extId: 7,
      updatedAt: 1,
    },
  };

  test("toWireDoc translates keys and drops untranslatable custom-source ids", () => {
    const local: LocalMaps = {
      ...emptyLocalMaps(),
      pinned: {
        "12345": { p: { updatedAt: 1 } }, // native
        [String(csMediaId)]: { p: { updatedAt: 1 } }, // translatable
        [String(encodeMediaId(7, 99))]: { p: { updatedAt: 1 } }, // no ref → dropped
      },
    };
    const { doc, dropped } = toWireDoc(local, sources, 0);
    expect(Object.keys(doc.pinned).sort()).toEqual([
      "12345",
      "cs:mangaupdates:42",
    ]);
    expect(dropped).toEqual([encodeMediaId(7, 99)]);
  });

  test("localizeWireDoc maps wire keys back to this instance's mediaIds", () => {
    const doc: WireDoc = {
      ...emptyWire(),
      pinned: {
        "12345": { p: { updatedAt: 1 } },
        "cs:mangaupdates:42": { p: { updatedAt: 1 } },
      },
    };
    const { maps, unresolved } = localizeWireDoc(doc, (m) =>
      m === "mangaupdates" ? 9 : null,
    );
    expect(Object.keys(maps.pinned).sort()).toEqual([
      "12345",
      String(encodeMediaId(9, 42)),
    ]);
    expect(unresolved).toEqual([]);
  });

  test("localizeWireDoc collects unresolvable manifests", () => {
    const doc: WireDoc = {
      ...emptyWire(),
      pinned: { "cs:other:1": { p: { updatedAt: 1 } } },
    };
    const { maps, unresolved } = localizeWireDoc(doc, () => null);
    expect(maps.pinned).toEqual({});
    expect(unresolved).toEqual(["cs:other:1"]);
  });

  test("mergeLocalBack keeps untranslatable local keys, localized wins collisions", () => {
    const existing: LocalMaps = {
      ...emptyLocalMaps(),
      pinned: {
        "1": { p: { updatedAt: 1 } }, // localized will overwrite
        "2": { p: { updatedAt: 5 } }, // untranslatable, kept
      },
    };
    const localized: LocalMaps = {
      ...emptyLocalMaps(),
      pinned: { "1": { p: { updatedAt: 9 } } },
    };
    const out = mergeLocalBack(existing, localized);
    expect(out.pinned["1"].p.updatedAt).toBe(9);
    expect(out.pinned["2"].p.updatedAt).toBe(5);
  });
});

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

describe("ensureGist", () => {
  test("returns the stored id without any network call", async () => {
    const { client, calls } = scriptedClient({});
    let stored: string | undefined = "existing";
    const id = await ensureGist({
      client,
      filename: "msu-sync.json",
      getGistId: () => stored,
      setGistId: (v) => (stored = v),
    });
    expect(id).toBe("existing");
    expect(calls.length).toBe(0);
  });

  test("discovers by filename when no id is stored", async () => {
    const { client } = scriptedClient({
      "GET https://api.github.com/gists": () => [
        { id: "found", files: { "msu-sync.json": {} } },
      ],
    });
    let stored: string | undefined;
    const id = await ensureGist({
      client,
      filename: "msu-sync.json",
      getGistId: () => stored,
      setGistId: (v) => (stored = v),
    });
    expect(id).toBe("found");
    expect(stored).toBe("found");
  });

  test("creates a gist when none exists", async () => {
    const { client } = scriptedClient({
      "GET https://api.github.com/gists": () => [],
      "POST https://api.github.com/gists": () => ({
        id: "new",
        owner: { login: "me" },
      }),
    });
    let stored: string | undefined;
    const id = await ensureGist({
      client,
      filename: "msu-sync.json",
      getGistId: () => stored,
      setGistId: (v) => (stored = v),
    });
    expect(id).toBe("new");
    expect(stored).toBe("new");
  });
});

describe("syncMsu round-trip", () => {
  test("merges remote into local, pushes, and returns write-back maps", async () => {
    const remoteDoc = serializeWireDoc({
      ...emptyWire(),
      pinned: { "222": { p: { updatedAt: 100 } } },
    });
    const { client, calls } = scriptedClient({
      "GET https://api.github.com/gists/gid": () => ({
        files: { "msu-sync.json": { content: remoteDoc } },
      }),
      "PATCH https://api.github.com/gists/gid": () => ({}),
    });
    const local: LocalMaps = {
      ...emptyLocalMaps(),
      pinned: { "111": { p: { updatedAt: 50 } } },
    };
    const res = await syncMsu({
      client,
      gistId: "gid",
      filename: "msu-sync.json",
      local,
      sources: {},
      extIdForManifest: () => null,
      now: 999,
      log: console,
    });
    expect(res.pushed).toBe(true);
    // Both records present after merge, localized back to mediaId keys.
    expect(Object.keys(res.writeBack.pinned).sort()).toEqual(["111", "222"]);
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
  });

  test("skips the push when merged equals remote (no-op)", async () => {
    const doc = serializeWireDoc({
      ...emptyWire(),
      pinned: { "111": { p: { updatedAt: 50 } } },
    });
    const { client, calls } = scriptedClient({
      "GET https://api.github.com/gists/gid": () => ({
        files: { "msu-sync.json": { content: doc } },
      }),
      "PATCH https://api.github.com/gists/gid": () => ({}),
    });
    const res = await syncMsu({
      client,
      gistId: "gid",
      filename: "msu-sync.json",
      local: {
        ...emptyLocalMaps(),
        pinned: { "111": { p: { updatedAt: 50 } } },
      },
      sources: {},
      extIdForManifest: () => null,
      now: 1,
      log: console,
    });
    expect(res.pushed).toBe(false);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});
