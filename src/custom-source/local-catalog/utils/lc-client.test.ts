import { afterEach, describe, expect, test } from "bun:test";

// `lc-client.ts` calls `createLogger()` at module scope, which reads
// `__MANIFEST_ID__` — a bundle-time define injected by scripts/build.ts.
// Under `bun test` there is no bundler, so we stub the global before the
// dynamic import that pulls in the module under test.
(globalThis as unknown as { __MANIFEST_ID__: string }).__MANIFEST_ID__ =
  "test-local-catalog";

const { normalizeEntry, searchAndPaginate, LCClient } = await import(
  "./lc-client.ts"
);

// LCClient reads the global `Date.now()` for its TTL clock; stub it so the
// cache-expiry tests are deterministic. Restored after each test.
const realDateNow = Date.now;
afterEach(() => {
  Date.now = realDateNow;
});

describe("normalizeEntry", () => {
  test("strips per-record updatedAt", () => {
    const out = normalizeEntry({
      id: 1,
      title: { userPreferred: "A" },
      updatedAt: 999,
    });
    expect(
      (out as unknown as Record<string, unknown>).updatedAt,
    ).toBeUndefined();
  });

  test("defaults type to MANGA and ensures title.userPreferred", () => {
    const out = normalizeEntry({ id: 2, title: { english: "B" } });
    expect(out.type).toBe("MANGA");
    expect(out.title?.userPreferred).toBe("B");
  });

  test("preserves an explicit type", () => {
    const out = normalizeEntry({
      id: 3,
      title: { userPreferred: "C" },
      type: "MANGA",
    });
    expect(out.type).toBe("MANGA");
  });
});

const entries = [
  { id: 1, title: "Omniscient Reader", synonyms: ["전지적 독자 시점"] },
  {
    id: 2,
    title: { english: "Solo Leveling", romaji: "Na Honjaman Level Up" },
  },
  { id: 3, title: "Tower of God" },
] as MangaCatalogEntry[];

describe("searchAndPaginate", () => {
  test("empty search returns all (mapped), with totals", () => {
    const r = searchAndPaginate(entries, "", 1, 10);
    expect(r.total).toBe(3);
    expect(r.totalPages).toBe(1);
    expect(r.page).toBe(1);
    expect(r.media.map((m) => m.id)).toEqual([1, 2, 3]);
  });

  test("matches title case-insensitively", () => {
    const r = searchAndPaginate(entries, "solo", 1, 10);
    expect(r.media.map((m) => m.id)).toEqual([2]);
  });

  test("matches romaji and synonyms", () => {
    expect(searchAndPaginate(entries, "honjaman", 1, 10).total).toBe(1);
    expect(searchAndPaginate(entries, "전지적", 1, 10).total).toBe(1);
  });

  test("paginates", () => {
    const p1 = searchAndPaginate(entries, "", 1, 2);
    expect(p1.media.map((m) => m.id)).toEqual([1, 2]);
    expect(p1.totalPages).toBe(2);
    const p2 = searchAndPaginate(entries, "", 2, 2);
    expect(p2.media.map((m) => m.id)).toEqual([3]);
    expect(p2.page).toBe(2);
  });

  test("no match returns empty media but correct totals", () => {
    const r = searchAndPaginate(entries, "zzzz", 1, 10);
    expect(r.media).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(0);
  });
});

// Build a client with injected deps. `now` is a mutable box so tests can
// advance the clock.
function makeClient(opts: {
  prefs?: Record<string, string>;
  responder?: (url: string) => { ok: boolean; body: unknown };
  nowBox?: { t: number };
}) {
  const prefs = opts.prefs ?? {};
  const nowBox = opts.nowBox ?? { t: 0 };
  Date.now = () => nowBox.t;
  let fetchCount = 0;
  const fetchFn = (async (url: string) => {
    fetchCount++;
    const { ok, body } = opts.responder?.(url) ?? {
      ok: true,
      body: { manga: [] },
    };
    return {
      ok,
      status: ok ? 200 : 500,
      json: () => body,
    } as unknown as FetchResponse;
  }) as unknown as typeof fetch;
  const client = new LCClient(fetchFn, (name) => prefs[name]);
  return { client, getFetchCount: () => fetchCount };
}

describe("LCClient.loadCatalog", () => {
  test("fetches and parses from catalogUrl", async () => {
    const { client } = makeClient({
      prefs: { catalogUrl: "http://cat/list.json", cacheMinutes: "10" },
      responder: () => ({
        ok: true,
        body: {
          manga: [
            { id: 1, title: "A" },
            { id: 2, title: "B" },
          ],
        },
      }),
    });
    const result = await client.loadCatalog();
    expect(result.map((e) => e.id)).toEqual([1, 2]);
  });

  test("serves cache within the TTL window (no refetch)", async () => {
    const nowBox = { t: 1000 };
    const { client, getFetchCount } = makeClient({
      prefs: { catalogUrl: "http://cat/list.json", cacheMinutes: "10" },
      responder: () => ({ ok: true, body: { manga: [{ id: 1, title: "A" }] } }),
      nowBox,
    });
    await client.loadCatalog();
    nowBox.t = 1000 + 9 * 60000; // still within 10 min
    await client.loadCatalog();
    expect(getFetchCount()).toBe(1);
  });

  test("refetches once the TTL expires", async () => {
    const nowBox = { t: 0 };
    const { client, getFetchCount } = makeClient({
      prefs: { catalogUrl: "http://cat/list.json", cacheMinutes: "10" },
      responder: () => ({ ok: true, body: { manga: [{ id: 1, title: "A" }] } }),
      nowBox,
    });
    await client.loadCatalog();
    nowBox.t = 11 * 60000; // past 10 min
    await client.loadCatalog();
    expect(getFetchCount()).toBe(2);
  });

  test("returns stale cache when a refetch fails", async () => {
    let fail = false;
    const nowBox = { t: 0 };
    const { client } = makeClient({
      prefs: { catalogUrl: "http://cat/list.json", cacheMinutes: "10" },
      responder: () =>
        fail
          ? { ok: false, body: null }
          : { ok: true, body: { manga: [{ id: 1, title: "A" }] } },
      nowBox,
    });
    await client.loadCatalog();
    fail = true;
    nowBox.t = 11 * 60000;
    const result = await client.loadCatalog();
    expect(result.map((e) => e.id)).toEqual([1]); // kept the stale entry
  });

  test("parses inline `catalog` preference when no url is set", async () => {
    const { client } = makeClient({
      prefs: {
        catalog: JSON.stringify({ manga: [{ id: 9, title: "Inline" }] }),
      },
    });
    const result = await client.loadCatalog();
    expect(result.map((e) => e.id)).toEqual([9]);
  });
});
