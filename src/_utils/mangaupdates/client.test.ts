import { describe, expect, test } from "bun:test";
import { MUClientBase } from "./client.ts";

type FakeRes = { status: number; body?: unknown; contentType?: string };

type Recorded = {
  url: string;
  method?: string;
  headers?: unknown;
  body?: unknown;
};

// Concrete subclass that surfaces the protected transport for testing, plus a
// fake fetch that records requests and replays a queue of responses.
function makeClient(responses: FakeRes[]) {
  const calls: Recorded[] = [];
  let i = 0;
  const fetchFn = (async (url: string, init?: FetchOptions) => {
    calls.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    const contentType = r.contentType ?? "application/json";
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      contentType,
      json: () => r.body,
      text: () => JSON.stringify(r.body ?? ""),
    } as unknown as FetchResponse;
  }) as unknown as typeof fetch;

  class TestClient extends MUClientBase {
    constructor() {
      super();
      this.fetchFn = fetchFn;
    }
    req<T = unknown>(method: string, path: string, options = {}) {
      return this._req<T>(method, path, options);
    }
    search(query: string, options = {}) {
      return this._search(query, options);
    }
  }
  return { client: new TestClient(), calls };
}

describe("MUClientBase._req", () => {
  test("hits baseUrl + path and parses a JSON response", async () => {
    const { client, calls } = makeClient([{ status: 200, body: { ok: 1 } }]);
    const out = await client.req<{ ok: number }>("GET", "/series/5");
    expect(out).toEqual({ ok: 1 });
    expect(calls[0].url).toBe("https://api.mangaupdates.com/v1/series/5");
    expect(calls[0].method).toBe("GET");
  });

  test("returns null when the response is not JSON", async () => {
    const { client } = makeClient([
      { status: 200, body: "plain", contentType: "text/plain" },
    ]);
    expect(await client.req("GET", "/x")).toBeNull();
  });

  test("attaches a Bearer token and serializes the body", async () => {
    const { client, calls } = makeClient([{ status: 200, body: {} }]);
    await client.req("POST", "/lists/series", {
      token: "tok",
      body: { a: 1 },
    });
    const headers = calls[0].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0].body))).toEqual({ a: 1 });
  });

  test("throws on a non-ok, non-401 response", async () => {
    const { client } = makeClient([{ status: 500, body: { error: "boom" } }]);
    expect(client.req("GET", "/x")).rejects.toThrow(/-> 500/);
  });

  test("refreshes the token on 401 and retries once", async () => {
    const { client, calls } = makeClient([
      { status: 401 },
      { status: 200, body: { done: true } },
    ]);
    let refreshed = 0;
    const out = await client.req("GET", "/series/9", {
      token: "stale",
      onRefreshToken: async () => {
        refreshed++;
        return "fresh";
      },
    });
    expect(out).toEqual({ done: true });
    expect(refreshed).toBe(1);
    // Retry carried the refreshed token.
    expect((calls[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer fresh",
    );
  });

  test("throws once refresh attempts are exhausted", async () => {
    const { client } = makeClient([{ status: 401 }, { status: 401 }]);
    expect(
      client.req("GET", "/x", { onRefreshToken: async () => "fresh" }),
    ).rejects.toThrow();
  });

  test("throws on 401 when no refresh handler is provided", async () => {
    const { client } = makeClient([{ status: 401 }]);
    expect(client.req("GET", "/x")).rejects.toThrow();
  });
});

describe("MUClientBase._search", () => {
  test("POSTs to /series/search with the search/page/perpage body", async () => {
    const { client, calls } = makeClient([
      {
        status: 200,
        body: { total_hits: 0, page: 1, per_page: 10, results: [] },
      },
    ]);
    await client.search("naruto", { page: 2, perPage: 5, token: "t" });
    expect(calls[0].url).toBe("https://api.mangaupdates.com/v1/series/search");
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(String(calls[0].body))).toEqual({
      search: "naruto",
      page: 2,
      perpage: 5,
    });
  });
});
