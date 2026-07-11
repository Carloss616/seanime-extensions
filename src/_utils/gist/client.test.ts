import { describe, expect, test } from "bun:test";
import { GistClient } from "./client.ts";

type Call = { url: string; init: FetchOptions };

function fakeFetch(response: unknown) {
  const calls: Call[] = [];
  const fn = async (url: string, init: FetchOptions) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: () => response,
      text: () => JSON.stringify(response),
    } as FetchResponse;
  };
  return { fn, calls };
}

describe("GistClient", () => {
  test("createGist posts to /gists with auth + secret + filename, returns id/owner/rawUrl", async () => {
    const { fn, calls } = fakeFetch({ id: "abc", owner: { login: "carlos" } });
    const c = new GistClient("tok", fn as unknown as typeof fetch);
    const res = await c.createGist("catalog.json", "{}");
    expect(calls[0].url).toBe("https://api.github.com/gists");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers?.Authorization).toBe("Bearer tok");
    const body = JSON.parse(calls[0].init.body);
    expect(body.public).toBe(false);
    expect(body.files["catalog.json"].content).toBe("{}");
    expect(res).toEqual({
      id: "abc",
      owner: "carlos",
      rawUrl: "https://gist.githubusercontent.com/carlos/abc/raw/catalog.json",
    });
  });

  test("getGistFile GETs /gists/:id and returns the file content", async () => {
    const { fn, calls } = fakeFetch({
      files: { "catalog.json": { content: '{"version":1}' } },
    });
    const c = new GistClient("tok", fn as unknown as typeof fetch);
    const content = await c.getGistFile("abc", "catalog.json");
    expect(calls[0].url).toBe("https://api.github.com/gists/abc");
    expect(calls[0].init.method).toBe("GET");
    expect(content).toBe('{"version":1}');
  });

  test("updateGistFile PATCHes /gists/:id with the new content", async () => {
    const { fn, calls } = fakeFetch({ id: "abc" });
    const c = new GistClient("tok", fn as unknown as typeof fetch);
    await c.updateGistFile("abc", "catalog.json", '{"v":2}');
    expect(calls[0].url).toBe("https://api.github.com/gists/abc");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(calls[0].init.body).files["catalog.json"].content).toBe(
      '{"v":2}',
    );
  });

  test("throws on a non-ok response", async () => {
    const c = new GistClient("tok", (async () => ({
      ok: false,
      status: 401,
      text: () => "bad",
    })) as unknown as typeof fetch);
    await expect(c.getGistFile("abc", "catalog.json")).rejects.toThrow();
  });

  test("deleteGist sends DELETE with auth", async () => {
    const { fn, calls } = fakeFetch({});
    const c = new GistClient("tok", fn as unknown as typeof fetch);
    await c.deleteGist("abc");
    expect(calls[0].url).toBe("https://api.github.com/gists/abc");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].init.headers?.Authorization).toBe("Bearer tok");
  });

  test("deleteGist treats 404 as success (already gone)", async () => {
    const c = new GistClient("tok", (async () => ({
      ok: false,
      status: 404,
      text: () => "not found",
    })) as unknown as typeof fetch);
    await expect(c.deleteGist("abc")).resolves.toBeUndefined();
  });

  test("deleteGist throws on other non-ok responses", async () => {
    const c = new GistClient("tok", (async () => ({
      ok: false,
      status: 401,
      text: () => "unauthorized",
    })) as unknown as typeof fetch);
    await expect(c.deleteGist("abc")).rejects.toThrow();
  });

  test("findGistByFilename GETs /gists and returns the id containing the filename", async () => {
    const { fn, calls } = fakeFetch([
      { id: "other", files: { "unrelated.json": {} } },
      { id: "mine", files: { "msu-sync.json": {} } },
    ]);
    const c = new GistClient("tok", fn as unknown as typeof fetch);
    const id = await c.findGistByFilename("msu-sync.json");
    expect(calls[0].url).toBe("https://api.github.com/gists?per_page=100");
    expect(calls[0].init.method).toBe("GET");
    expect(id).toBe("mine");
  });

  test("findGistByFilename returns null when no gist has the file", async () => {
    const { fn } = fakeFetch([{ id: "other", files: { "x.json": {} } }]);
    const c = new GistClient("tok", fn as unknown as typeof fetch);
    expect(await c.findGistByFilename("msu-sync.json")).toBeNull();
  });
});
