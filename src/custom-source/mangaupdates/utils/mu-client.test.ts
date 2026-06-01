import { describe, expect, test } from "bun:test";
import { MUClient, mapFormat, toBaseManga } from "./mu-client.ts";

// Minimal MU search record factory.
function rec(overrides: Partial<MUSearch.Record> = {}): MUSearch.Record {
  return {
    series_id: 555,
    title: "Test Series",
    url: "https://www.mangaupdates.com/series/abc/test-series",
    description: "a description",
    image: {
      url: { original: "https://img/orig.jpg", thumb: "https://img/thumb.jpg" },
      height: 0,
      width: 0,
    },
    type: "Manga",
    year: "2019",
    bayesian_rating: 8.5,
    rating_votes: 120,
    genres: [{ genre: "Action" }, { genre: "Fantasy" }],
    last_updated: { timestamp: 0, as_rfc3339: "", as_string: "" },
    ...overrides,
  };
}

// Fake transport mirroring goja's FetchResponse (sync .json()). Includes the
// `application/json` contentType that MUClientBase._req checks before parsing,
// and a `text()` for the error branch.
function fakeFetch(
  responder: (
    url: string,
    init?: FetchOptions,
  ) => { ok: boolean; body: unknown },
): typeof fetch {
  return (async (url: string, init?: FetchOptions) => {
    const { ok, body } = responder(url, init);
    return {
      ok,
      status: ok ? 200 : 500,
      contentType: "application/json",
      json: () => body,
      text: () => JSON.stringify(body),
    } as unknown as FetchResponse;
  }) as unknown as typeof fetch;
}

describe("mapFormat", () => {
  test("empty type → undefined", () => {
    expect(mapFormat("")).toBeUndefined();
    expect(mapFormat(undefined)).toBeUndefined();
  });
  test("novel / artbook → NOVEL", () => {
    expect(mapFormat("Novel")).toBe("NOVEL");
    expect(mapFormat("artbook")).toBe("NOVEL");
  });
  test("anything else → MANGA", () => {
    expect(mapFormat("Manhwa")).toBe("MANGA");
  });
});

describe("toBaseManga", () => {
  test("maps core fields and rounds the rating to 0-100", () => {
    const m = toBaseManga(rec());
    expect(m.id).toBe(555);
    expect(m.type).toBe("MANGA");
    expect(m.title?.userPreferred).toBe("Test Series");
    expect(m.meanScore).toBe(85);
    expect(m.genres).toEqual(["Action", "Fantasy"]);
    expect(m.startDate).toEqual({ year: 2019 });
    expect(m.coverImage?.extraLarge).toBe("https://img/orig.jpg");
  });

  test("drops rating when there are no votes", () => {
    const m = toBaseManga(rec({ rating_votes: 0 }));
    expect(m.meanScore).toBeUndefined();
  });

  test("falls back to '???' title and omits cover/date when absent", () => {
    const m = toBaseManga(
      rec({
        title: "",
        year: "",
        image: undefined as unknown as MU.Image,
      }),
    );
    expect(m.title?.userPreferred).toBe("???");
    expect(m.coverImage).toBeUndefined();
    expect(m.startDate).toBeUndefined();
  });
});

describe("MUClient.search", () => {
  test("POSTs to the search endpoint and maps results + totalPages", async () => {
    let seenUrl = "";
    let seenBody: unknown;
    const client = new MUClient(
      fakeFetch((url, init) => {
        seenUrl = url;
        seenBody = init?.body;
        return {
          ok: true,
          body: {
            total_hits: 25,
            page: 1,
            per_page: 10,
            results: [
              { record: rec() },
              { record: rec({ series_id: 7 }) },
            ] as unknown as MUSearch.Result[],
          },
        };
      }),
    );

    const res = await client.search("naruto", 1, 10);

    expect(seenUrl).toBe("https://api.mangaupdates.com/v1/series/search");
    expect(JSON.parse(String(seenBody)).search).toBe("naruto");
    expect(res.media).toHaveLength(2);
    expect(res.total).toBe(25);
    expect(res.totalPages).toBe(3);
  });

  test("returns an empty page when the request fails", async () => {
    const client = new MUClient(fakeFetch(() => ({ ok: false, body: null })));
    const res = await client.search("x", 2, 10);
    expect(res).toEqual({ media: [], page: 2, totalPages: 0, total: 0 });
  });
});

describe("MUClient.getManga", () => {
  test("fetches each id and drops failed lookups", async () => {
    const client = new MUClient(
      fakeFetch((url) => {
        if (url.endsWith("/series/1"))
          return { ok: true, body: rec({ series_id: 1 }) };
        return { ok: false, body: null };
      }),
    );
    const out = await client.getManga([1, 2]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe(1);
  });
});

describe("MUClient.getMangaDetails", () => {
  test("returns id/siteUrl/genres for a hit", async () => {
    const client = new MUClient(
      fakeFetch(() => ({ ok: true, body: rec({ series_id: 9 }) })),
    );
    const d = await client.getMangaDetails(9);
    expect(d?.id).toBe(9);
    expect(d?.genres).toEqual(["Action", "Fantasy"]);
  });

  test("returns null when the series is missing", async () => {
    const client = new MUClient(fakeFetch(() => ({ ok: false, body: null })));
    expect(await client.getMangaDetails(9)).toBeNull();
  });
});
