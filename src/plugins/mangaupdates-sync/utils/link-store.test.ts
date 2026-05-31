import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  getMULink,
  listMULinkIds,
  type MULink,
  removeMULink,
  setMULink,
} from "./link-store.ts";

// Minimal in-memory $storage stub. The real seanime $storage expands object
// values into dotted leaf keys and reconstructs them on get(); the flat fake
// is enough to exercise our prefix logic and the top-level-only enumeration
// (the listMULinkIds tests seed the dotted sub-keys by hand).
function fakeStorage() {
  const map = new Map<string, unknown>();
  return {
    map,
    set: (key: string, value: unknown) => map.set(key, value),
    get: <T>(key: string): T | undefined => map.get(key) as T | undefined,
    has: (key: string) => map.has(key),
    remove: (key: string) => void map.delete(key),
    keys: () => Array.from(map.keys()),
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  (globalThis as unknown as { $storage: unknown }).$storage = storage;
});
afterEach(() => {
  (globalThis as unknown as { $storage?: unknown }).$storage = undefined;
});

const sample: MULink = {
  id: "159441",
  title: "Some Manga",
  year: 2018,
  url: "https://www.mangaupdates.com/series/abc/some-manga",
  cover: "https://example.com/cover.jpg",
  linkedAt: 1700000000000,
};

describe("link-store", () => {
  test("setMULink stores the link object under the prefixed key", () => {
    setMULink(159441, sample);
    expect(storage.map.get("mu_link_159441")).toEqual(sample);
  });

  test("getMULink round-trips the stored object", () => {
    setMULink(159441, sample);
    expect(getMULink(159441)).toEqual(sample);
  });

  test("getMULink returns undefined for a missing key", () => {
    expect(getMULink(123)).toBeUndefined();
  });

  test("removeMULink deletes the key", () => {
    setMULink(159441, sample);
    removeMULink(159441);
    expect(getMULink(159441)).toBeUndefined();
  });

  test("listMULinkIds returns only top-level ids", () => {
    setMULink(159441, sample);
    setMULink(164222, { ...sample, id: "164222" });
    expect(listMULinkIds().sort()).toEqual([159441, 164222]);
  });

  test("listMULinkIds skips dotted sub-keys and dedupes to parent", () => {
    // Mimic the polluted keys() from the bug report: $storage emits the parent
    // node AND a leaf key per object field.
    storage.map.set("mu_link_159441", sample);
    storage.map.set("mu_link_159441.cover", "x");
    storage.map.set("mu_link_159441.id", "159441");
    storage.map.set("mu_link_159441.title", "T");
    storage.map.set("mu_session_token", "tok");
    expect(listMULinkIds()).toEqual([159441]);
  });

  test("listMULinkIds ignores unrelated keys", () => {
    storage.map.set("mu_session_token", "tok");
    storage.map.set("other", 1);
    expect(listMULinkIds()).toEqual([]);
  });
});
