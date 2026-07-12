import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrateStorageKeys } from "./migrate.ts";

// Minimal in-memory $storage stub (same shape as link-store.test.ts).
function fakeStorage() {
  const map = new Map<string, unknown>();
  return {
    map,
    set: (key: string, value: unknown) => map.set(key, value),
    get: <T>(key: string): T | undefined => map.get(key) as T | undefined,
    has: (key: string) => map.has(key),
    remove: (key: string) => void map.delete(key),
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

describe("migrateStorageKeys", () => {
  test("copies legacy lcm_ keys to camelCase and drops the old ones", () => {
    storage.set("lcm_gist_id", "abc123");
    storage.set("lcm_catalog", [{ id: 1 }]);
    storage.set("lcm_ext_id", 554);
    migrateStorageKeys();
    expect(storage.get("gistId")).toBe("abc123");
    expect(storage.get("catalog")).toEqual([{ id: 1 }]);
    expect(storage.get("extId")).toBe(554);
    expect(storage.has("lcm_gist_id")).toBe(false);
    expect(storage.has("lcm_catalog")).toBe(false);
    expect(storage.has("lcm_ext_id")).toBe(false);
  });

  test("no-ops when there is nothing to migrate (fresh install)", () => {
    storage.set("gistId", "already-new");
    migrateStorageKeys();
    expect(storage.get("gistId")).toBe("already-new");
    expect(storage.map.size).toBe(1);
  });

  test("is idempotent — second run changes nothing", () => {
    storage.set("lcm_oauth_token", "tok");
    migrateStorageKeys();
    migrateStorageKeys();
    expect(storage.get("oauthToken")).toBe("tok");
    expect(storage.has("lcm_oauth_token")).toBe(false);
  });

  test("does not clobber a value already under the new key", () => {
    storage.set("lcm_gist_id", "legacy");
    storage.set("gistId", "current");
    migrateStorageKeys();
    expect(storage.get("gistId")).toBe("current"); // new wins
    expect(storage.has("lcm_gist_id")).toBe(false); // stale legacy dropped
  });
});
