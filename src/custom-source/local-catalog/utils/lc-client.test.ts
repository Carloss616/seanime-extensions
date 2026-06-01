import { afterEach, describe, expect, test } from "bun:test";
import { LCClient, normalizeEntry, searchAndPaginate } from "./lc-client.ts";

// LCClient reads the global `Date.now()` for its TTL clock; stub it so the
// cache-expiry tests are deterministic. Restored after each test.
const realDateNow = Date.now;
afterEach(() => {
  Date.now = realDateNow;
});

describe("normalizeEntry", () => {
  test("expands a string title to english + userPreferred", () => {
    const m = normalizeEntry({ id: 1, title: "Solo" });
    expect(m.id).toBe(1);
    expect(m.type).toBe("MANGA");
    expect(m.title).toEqual({ english: "Solo", userPreferred: "Solo" });
  });

  test("fills userPreferred from an object title", () => {
    const m = normalizeEntry({ id: 2, title: { english: "E", romaji: "R" } });
    expect(m.title?.userPreferred).toBe("E");
    expect(m.title?.romaji).toBe("R");
  });

  test("maps cover to all coverImage sizes", () => {
    const m = normalizeEntry({ id: 3, title: "X", cover: "http://c/x.png" });
    expect(m.coverImage).toEqual({
      extraLarge: "http://c/x.png",
      large: "http://c/x.png",
      medium: "http://c/x.png",
    });
  });

  test("maps year to startDate.year and passes through optional fields", () => {
    const m = normalizeEntry({
      id: 4,
      title: "Y",
      year: 2021,
      banner: "http://b/y.png",
      chapters: 120,
      volumes: 12,
      genres: ["Action"],
      status: "RELEASING",
      format: "MANGA",
      isAdult: true,
      country: "JP",
      siteUrl: "http://s/y",
    });
    expect(m.startDate).toEqual({ year: 2021 });
    expect(m.bannerImage).toBe("http://b/y.png");
    expect(m.chapters).toBe(120);
    expect(m.volumes).toBe(12);
    expect(m.genres).toEqual(["Action"]);
    expect(m.status).toBe("RELEASING");
    expect(m.format).toBe("MANGA");
    expect(m.isAdult).toBe(true);
    expect(m.countryOfOrigin).toBe("JP");
    expect(m.siteUrl).toBe("http://s/y");
  });

  test("omits empty optional collections and missing fields", () => {
    const m = normalizeEntry({ id: 5, title: "Z", genres: [], synonyms: [] });
    expect(m.genres).toBeUndefined();
    expect(m.synonyms).toBeUndefined();
    expect(m.coverImage).toBeUndefined();
    expect(m.startDate).toBeUndefined();
  });
});

const entries = [
  { id: 1, title: "Omniscient Reader", synonyms: ["전지적 독자 시점"] },
  {
    id: 2,
    title: { english: "Solo Leveling", romaji: "Na Honjaman Level Up" },
  },
  { id: 3, title: "Tower of God" },
];

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
  // Drive the client's TTL clock from the mutable box.
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
    const entries = await client.loadCatalog();
    expect(entries.map((e) => e.id)).toEqual([1, 2]);
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
    const entries = await client.loadCatalog();
    expect(entries.map((e) => e.id)).toEqual([1]); // kept the stale entry
  });

  test("parses inline `catalog` preference when no url is set", async () => {
    const { client } = makeClient({
      prefs: {
        catalog: JSON.stringify({ manga: [{ id: 9, title: "Inline" }] }),
      },
    });
    const entries = await client.loadCatalog();
    expect(entries.map((e) => e.id)).toEqual([9]);
  });
});
