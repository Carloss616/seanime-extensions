import { describe, expect, test } from "bun:test";
import { connectStatus } from "./github-connect.ts";

describe("connectStatus", () => {
  test("not connected → gray badge, no via", () => {
    expect(connectStatus({ connected: false })).toEqual({
      badge: { label: "Not connected", intent: "gray" },
      text: null,
      via: "",
    });
    // via/syncing/lastSyncedAt ignored while disconnected
    expect(
      connectStatus({ connected: false, syncing: true, via: "PAT" }),
    ).toEqual({
      badge: { label: "Not connected", intent: "gray" },
      text: null,
      via: "",
    });
  });

  test("syncing → plain text, wins over synced/connected", () => {
    expect(
      connectStatus({ connected: true, syncing: true, lastSyncedAt: 5 }),
    ).toEqual({ badge: null, text: "Syncing…", via: "" });
  });

  test("connected, never synced → success badge + via", () => {
    expect(connectStatus({ connected: true, via: "GitHub login" })).toEqual({
      badge: { label: "Connected", intent: "success" },
      text: null,
      via: "GitHub login",
    });
    expect(connectStatus({ connected: true, lastSyncedAt: 0 })).toEqual({
      badge: { label: "Connected", intent: "success" },
      text: null,
      via: "",
    });
  });

  test("synced once lastSyncedAt > 0 → 'Synced' badge", () => {
    expect(
      connectStatus({ connected: true, lastSyncedAt: 1700, via: "PAT" }),
    ).toEqual({
      badge: { label: "Synced", intent: "success" },
      text: null,
      via: "PAT",
    });
  });
});
