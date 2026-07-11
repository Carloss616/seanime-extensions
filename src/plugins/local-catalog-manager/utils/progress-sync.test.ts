import { describe, expect, test } from "bun:test";
import type { GistClient } from "../../../_utils/gist/client.ts";
import {
  applyRemote,
  buildMediaIdLookup,
  detectOrphans,
  handlePostUpdate,
  pruneOrphans,
  pullProgress,
  pushProgress,
} from "./progress-sync.ts";

const PREFIX = "ext_custom_source_local-catalog";
const idDecoder = (mediaId: number) => mediaId;

describe("buildMediaIdLookup", () => {
  test("maps localId → mediaId for entries with our prefix", () => {
    const collection: $app.Manga_Collection = {
      lists: [
        {
          entries: [
            {
              mediaId: 100,
              media: { id: 100, siteUrl: `${PREFIX}|END|http://x/1` },
            },
            {
              mediaId: 200,
              media: { id: 200, siteUrl: `${PREFIX}|END|http://x/2` },
            },
          ],
        },
      ],
    };
    const out = buildMediaIdLookup(collection, PREFIX, idDecoder);
    expect(out.get(100)).toBe(100);
    expect(out.get(200)).toBe(200);
    expect(out.size).toBe(2);
  });

  test("skips entries with other prefixes (AniList, other custom-sources)", () => {
    const collection: $app.Manga_Collection = {
      lists: [
        {
          entries: [
            {
              mediaId: 100,
              media: { id: 100, siteUrl: "https://anilist.co/manga/100" },
            },
            {
              mediaId: 200,
              media: {
                id: 200,
                siteUrl: "ext_custom_source_other-source|END|x",
              },
            },
            {
              mediaId: 300,
              media: { id: 300, siteUrl: `${PREFIX}|END|http://x/3` },
            },
          ],
        },
      ],
    };
    const out = buildMediaIdLookup(collection, PREFIX, idDecoder);
    expect(out.size).toBe(1);
    expect(out.get(300)).toBe(300);
  });

  test("handles missing siteUrl / lists / entries gracefully", () => {
    expect(buildMediaIdLookup({}, PREFIX, idDecoder).size).toBe(0);
    expect(buildMediaIdLookup({ lists: [] }, PREFIX, idDecoder).size).toBe(0);
    expect(
      buildMediaIdLookup({ lists: [{ entries: [] }] }, PREFIX, idDecoder).size,
    ).toBe(0);
    expect(
      buildMediaIdLookup(
        { lists: [{ entries: [{ mediaId: 1, media: { id: 1 } }] }] },
        PREFIX,
        idDecoder,
      ).size,
    ).toBe(0);
  });
});

// Mirrors the $anilist.updateEntry signature, whose 3rd positional arg is the
// API-named `scoreRaw` — fed from our ProgressEntry.score (raw POINT_100).
type UpdateCall = {
  mediaId: number;
  status?: string;
  scoreRaw?: number;
  progress?: number;
};

function fakeUpdate(calls: UpdateCall[]) {
  return (
    mediaId: number,
    status: $app.AL_MediaListStatus | undefined,
    scoreRaw: number | undefined,
    progress: number | undefined,
  ) => {
    calls.push({ mediaId, status, scoreRaw, progress });
  };
}

const doc = (
  manga: Record<string, MangaProgressEntry>,
  updatedAt = 0,
): LocalProgress => ({ version: 1, updatedAt, manga, anime: {} });

describe("applyRemote", () => {
  test("calls updateEntry for entries newer than local; returns applied count", () => {
    const calls: UpdateCall[] = [];
    const local = doc({
      "1": { progress: 1, updatedAt: 10 },
      "2": { progress: 2, updatedAt: 50 },
    });
    const merged = doc({
      "1": { progress: 5, updatedAt: 20, status: "CURRENT" },
      "2": { progress: 2, updatedAt: 50 },
      "3": { progress: 3, updatedAt: 10, score: 700 },
    });
    const lookup = new Map<number, number>([
      [1, 1001],
      [2, 1002],
      [3, 1003],
    ]);
    const res = applyRemote(merged, local, {
      updateEntry: fakeUpdate(calls),
      mediaIdByLocalId: lookup,
    });
    expect(res).toEqual({ applied: 2, skipped: 0 });
    expect(calls.map((c) => c.mediaId).sort()).toEqual([1001, 1003]);
    const c1 = calls.find((c) => c.mediaId === 1001);
    expect(c1).toBeDefined();
    expect((c1 as UpdateCall).status).toBe("CURRENT");
    expect((c1 as UpdateCall).progress).toBe(5);
    const c3 = calls.find((c) => c.mediaId === 1003);
    expect(c3).toBeDefined();
    expect((c3 as UpdateCall).scoreRaw).toBe(700);
  });

  test("skips entries whose mediaId is not in the lookup (orphans)", () => {
    const calls: UpdateCall[] = [];
    const local = doc({});
    const merged = doc({
      "1": { progress: 1, updatedAt: 10 },
      "99": { progress: 9, updatedAt: 10 },
    });
    const lookup = new Map<number, number>([[1, 1001]]);
    const res = applyRemote(merged, local, {
      updateEntry: fakeUpdate(calls),
      mediaIdByLocalId: lookup,
    });
    expect(res).toEqual({ applied: 1, skipped: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].mediaId).toBe(1001);
  });

  test("no entries → no calls, returns zeros", () => {
    const calls: UpdateCall[] = [];
    const res = applyRemote(doc({}), doc({}), {
      updateEntry: fakeUpdate(calls),
      mediaIdByLocalId: new Map(),
    });
    expect(res).toEqual({ applied: 0, skipped: 0 });
    expect(calls).toHaveLength(0);
  });
});

describe("detectOrphans", () => {
  test("returns localIds present in progress but not in catalog", () => {
    const local = doc({
      "1": { updatedAt: 1 },
      "2": { updatedAt: 1 },
      "99": { updatedAt: 1 },
    });
    const catalogIds = new Set([1, 2]);
    expect(detectOrphans(local, catalogIds).sort()).toEqual([99]);
  });

  test("returns [] when nothing is orphaned", () => {
    const local = doc({ "1": { updatedAt: 1 } });
    expect(detectOrphans(local, new Set([1]))).toEqual([]);
  });

  test("ignores non-numeric keys", () => {
    const local = doc({ abc: { updatedAt: 1 }, "5": { updatedAt: 1 } });
    expect(detectOrphans(local, new Set([5]))).toEqual([]);
  });
});

describe("pruneOrphans", () => {
  test("removes orphan keys from a copy; original unchanged", () => {
    const local = doc({
      "1": { updatedAt: 1 },
      "99": { updatedAt: 1 },
    });
    const cleaned = pruneOrphans(local, [99], 5000);
    expect(Object.keys(cleaned.manga)).toEqual(["1"]);
    expect(cleaned.updatedAt).toBe(5000);
    expect(local.manga["99"]).toBeDefined();
  });
});

type FakeClient = {
  files: Record<string, string>;
  getCalls: Array<{ id: string; filename: string }>;
  updateCalls: Array<{ id: string; filename: string; content: string }>;
  getGistFile(id: string, filename: string): Promise<string>;
  updateGistFile(id: string, filename: string, content: string): Promise<void>;
};

function makeFakeClient(initial: Record<string, string> = {}): FakeClient {
  const files = { ...initial };
  const getCalls: FakeClient["getCalls"] = [];
  const updateCalls: FakeClient["updateCalls"] = [];
  return {
    files,
    getCalls,
    updateCalls,
    async getGistFile(id, filename) {
      getCalls.push({ id, filename });
      return files[filename] ?? "";
    },
    async updateGistFile(id, filename, content) {
      updateCalls.push({ id, filename, content });
      files[filename] = content;
    },
  };
}

describe("pushProgress", () => {
  test("merges local + remote and pushes the merged doc; returns the merged", async () => {
    const fake = makeFakeClient({
      "progress.json": JSON.stringify({
        version: 1,
        updatedAt: 1,
        manga: { "2": { progress: 20, updatedAt: 50 } },
      }),
    });
    const local: LocalProgress = {
      version: 1,
      updatedAt: 100,
      manga: { "1": { progress: 10, updatedAt: 100 } },
      anime: {},
    };
    const merged = await pushProgress(
      fake as unknown as GistClient,
      "GID",
      "progress.json",
      local,
      999,
    );
    expect(fake.updateCalls).toHaveLength(1);
    const pushed = JSON.parse(fake.updateCalls[0].content) as LocalProgress;
    expect(pushed.manga["1"].progress).toBe(10);
    expect(pushed.manga["2"].progress).toBe(20);
    expect(merged.manga["1"].progress).toBe(10);
    expect(merged.manga["2"].progress).toBe(20);
  });

  test("empty / missing remote → pushes local as-is", async () => {
    const fake = makeFakeClient({});
    const local: LocalProgress = {
      version: 1,
      updatedAt: 0,
      manga: { "1": { progress: 1, updatedAt: 1 } },
      anime: {},
    };
    await pushProgress(
      fake as unknown as GistClient,
      "GID",
      "progress.json",
      local,
      500,
    );
    const pushed = JSON.parse(fake.updateCalls[0].content) as LocalProgress;
    expect(pushed.manga["1"].progress).toBe(1);
    expect(pushed.updatedAt).toBe(500);
  });
});

describe("pullProgress", () => {
  test("fetches remote, merges with local, returns merged", async () => {
    const fake = makeFakeClient({
      "progress.json": JSON.stringify({
        version: 1,
        updatedAt: 5,
        manga: { "1": { progress: 5, updatedAt: 200 } },
      }),
    });
    const local: LocalProgress = {
      version: 1,
      updatedAt: 1,
      manga: { "1": { progress: 9, updatedAt: 100 } },
      anime: {},
    };
    const merged = await pullProgress(
      fake as unknown as GistClient,
      "GID",
      "progress.json",
      local,
      777,
    );
    expect(merged.manga["1"].progress).toBe(5);
    expect(merged.updatedAt).toBe(777);
  });

  test("missing remote → returns local unchanged (with new top-level updatedAt)", async () => {
    const fake = makeFakeClient({});
    const local: LocalProgress = {
      version: 1,
      updatedAt: 1,
      manga: { "1": { progress: 9, updatedAt: 100 } },
      anime: {},
    };
    const merged = await pullProgress(
      fake as unknown as GistClient,
      "GID",
      "progress.json",
      local,
      777,
    );
    expect(merged.manga["1"].progress).toBe(9);
    expect(merged.updatedAt).toBe(777);
  });
});

describe("handlePostUpdate", () => {
  type RestoreCall = {
    status: $app.AL_MediaListStatus | undefined;
    scoreRaw: number | undefined;
    progress: number | undefined;
  };

  function makeDeps(
    initial: Record<string, string> = {},
    local: LocalProgress = { version: 1, updatedAt: 0, manga: {}, anime: {} },
  ) {
    const fake = makeFakeClient(initial);
    const restoreCalls: RestoreCall[] = [];
    const persistCalls: Array<{ doc: LocalProgress; updatedAt: number }> = [];
    return {
      fake,
      restoreCalls,
      persistCalls,
      local,
      applyToSeanime: (entry: MangaProgressEntry) => {
        restoreCalls.push({
          status: entry.status,
          scoreRaw: entry.score,
          progress: entry.progress,
        });
      },
      persistLocal: (doc: LocalProgress, updatedAt: number) => {
        persistCalls.push({ doc, updatedAt });
      },
    };
  }

  test("local mode (client = null) → persist-local-only, no remote calls", async () => {
    const deps = makeDeps();
    const action = await handlePostUpdate({
      mediaId: 2147483649,
      localId: 1,
      payload: { status: "CURRENT", progress: 5 },
      now: 1000,
      local: deps.local,
      client: null,
      gistId: "",
      filename: "progress.json",
      applyToSeanime: deps.applyToSeanime,
      persistLocal: deps.persistLocal,
    });
    expect(action).toBe("persist-local-only");
    expect(deps.persistCalls).toHaveLength(1);
    expect(deps.persistCalls[0].doc.manga["1"]).toEqual({
      status: "CURRENT",
      progress: 5,
      updatedAt: 1000,
    });
    expect(deps.fake.getCalls).toHaveLength(0);
    expect(deps.fake.updateCalls).toHaveLength(0);
    expect(deps.restoreCalls).toHaveLength(0);
  });

  test("cache present → push (no remote GET first — trusts local edits)", async () => {
    const local: LocalProgress = {
      version: 1,
      updatedAt: 5,
      manga: { "1": { progress: 3, updatedAt: 5 } },
      anime: {},
    };
    const deps = makeDeps({}, local);
    const action = await handlePostUpdate({
      mediaId: 2147483649,
      localId: 1,
      payload: { status: "CURRENT", progress: 10 },
      now: 1000,
      local: deps.local,
      client: deps.fake as unknown as GistClient,
      gistId: "GID",
      filename: "progress.json",
      applyToSeanime: deps.applyToSeanime,
      persistLocal: deps.persistLocal,
    });
    expect(action).toBe("push");
    expect(deps.persistCalls[0].doc.manga["1"].progress).toBe(10);
    // pushProgress internally GETs (to merge) then PUTs.
    expect(deps.fake.getCalls).toHaveLength(1);
    expect(deps.fake.updateCalls).toHaveLength(1);
    expect(deps.restoreCalls).toHaveLength(0);
  });

  test("cache absent + remote HAS entry → restore (apply remote, NO push)", async () => {
    const deps = makeDeps({
      "progress.json": JSON.stringify({
        version: 1,
        updatedAt: 50,
        manga: { "1": { status: "CURRENT", progress: 50, updatedAt: 50 } },
      }),
    });
    const action = await handlePostUpdate({
      mediaId: 2147483649,
      localId: 1,
      payload: { status: "PLANNING", progress: 0 }, // the "Add to List" defaults
      now: 1000,
      local: deps.local,
      client: deps.fake as unknown as GistClient,
      gistId: "GID",
      filename: "progress.json",
      applyToSeanime: deps.applyToSeanime,
      persistLocal: deps.persistLocal,
    });
    expect(action).toBe("restore");
    // Local cache populated FROM remote (not from payload defaults).
    expect(deps.persistCalls[0].doc.manga["1"]).toMatchObject({
      status: "CURRENT",
      progress: 50,
      updatedAt: 50,
    });
    // Remote is the source of truth — applied to seanime, NOT clobbered by push.
    expect(deps.restoreCalls).toHaveLength(1);
    expect(deps.restoreCalls[0]).toEqual({
      status: "CURRENT",
      scoreRaw: undefined,
      progress: 50,
    });
    expect(deps.fake.getCalls).toHaveLength(1);
    expect(deps.fake.updateCalls).toHaveLength(0); // no push — that's the point
  });

  test("cache absent + remote ALSO absent → push-new (genuine new entry)", async () => {
    const deps = makeDeps({}); // empty gist file
    const action = await handlePostUpdate({
      mediaId: 2147483649,
      localId: 1,
      payload: { status: "CURRENT", progress: 1 },
      now: 1000,
      local: deps.local,
      client: deps.fake as unknown as GistClient,
      gistId: "GID",
      filename: "progress.json",
      applyToSeanime: deps.applyToSeanime,
      persistLocal: deps.persistLocal,
    });
    expect(action).toBe("push-new");
    expect(deps.persistCalls[0].doc.manga["1"]).toEqual({
      status: "CURRENT",
      progress: 1,
      updatedAt: 1000,
    });
    // 1 GET for the absent check + 1 GET inside pushProgress + 1 PUT.
    expect(deps.fake.getCalls.length).toBeGreaterThanOrEqual(1);
    expect(deps.fake.updateCalls).toHaveLength(1);
    expect(deps.restoreCalls).toHaveLength(0);
  });
});
