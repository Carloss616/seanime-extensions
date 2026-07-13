import { describe, expect, test } from "bun:test";
import {
  DeviceFlowClient,
  formatDeviceCode,
  formatTokenResponse,
} from "./device-flow.ts";

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

const DEVICE_CODE: $gh.Login.DeviceCode = {
  device_code: "dc",
  user_code: "WDJB-MJHT",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

describe("formatDeviceCode", () => {
  test("wraps the documented device/code success body", () => {
    expect(formatDeviceCode(DEVICE_CODE)).toEqual({
      ok: true,
      start: DEVICE_CODE,
    });
  });

  test("surfaces an OAuth error body", () => {
    expect(formatDeviceCode({ error: "device_flow_disabled" })).toEqual({
      ok: false,
      message: "device_flow_disabled",
    });
  });
});

describe("formatTokenResponse", () => {
  test("access_token → token", () => {
    expect(
      formatTokenResponse({
        access_token: "gho_x",
        token_type: "bearer",
        scope: "gist",
      }),
    ).toEqual({
      type: "token",
      token: "gho_x",
    });
  });

  test("authorization_pending → pending", () => {
    expect(formatTokenResponse({ error: "authorization_pending" })).toEqual({
      type: "pending",
    });
  });

  test("slow_down → slow_down with interval", () => {
    expect(formatTokenResponse({ error: "slow_down", interval: 10 })).toEqual({
      type: "slow_down",
      interval: 10,
    });
  });

  test("terminal error → error", () => {
    expect(formatTokenResponse({ error: "access_denied" })).toEqual({
      type: "error",
      message: "access_denied",
    });
    expect(formatTokenResponse({ error: "expired_token" })).toEqual({
      type: "error",
      message: "expired_token",
    });
  });
});

describe("DeviceFlowClient", () => {
  test("requestDeviceCode POSTs client_id + scope, returns the formatted start", async () => {
    const { fn, calls } = fakeFetch(DEVICE_CODE);
    const c = new DeviceFlowClient("cid", fn as unknown as typeof fetch);
    const r = await c.requestDeviceCode("gist");
    expect(calls[0].url).toBe("https://github.com/login/device/code");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(calls[0].init.body);
    expect(body.client_id).toBe("cid");
    expect(body.scope).toBe("gist");
    expect(r.ok && r.start.user_code).toBe("WDJB-MJHT");
  });

  test("pollAccessToken POSTs the device_code + grant_type, returns the poll result", async () => {
    const { fn, calls } = fakeFetch({
      access_token: "gho_x",
      token_type: "bearer",
      scope: "gist",
    });
    const c = new DeviceFlowClient("cid", fn as unknown as typeof fetch);
    const r = await c.pollAccessToken("dc");
    expect(calls[0].url).toBe("https://github.com/login/oauth/access_token");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(calls[0].init.body);
    expect(body.client_id).toBe("cid");
    expect(body.device_code).toBe("dc");
    expect(body.grant_type).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
    expect(r).toEqual({ type: "token", token: "gho_x" });
  });

  test("pollAccessToken surfaces authorization_pending", async () => {
    const { fn } = fakeFetch({ error: "authorization_pending" });
    const c = new DeviceFlowClient("cid", fn as unknown as typeof fetch);
    expect(await c.pollAccessToken("dc")).toEqual({ type: "pending" });
  });
});

// Returns a fetch that yields each scripted response in order (last one sticks).
function seqFetch(responses: unknown[]) {
  let i = 0;
  const fn = async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, status: 200, json: () => r } as FetchResponse;
  };
  return fn as unknown as typeof fetch;
}

describe("DeviceFlowClient.pollUntilToken", () => {
  test("returns the token once the user authorizes, backing off through pending/slow_down", async () => {
    const sleeps: number[] = [];
    const c = new DeviceFlowClient(
      "cid",
      seqFetch([
        { error: "authorization_pending" },
        { error: "slow_down", interval: 7 },
        { access_token: "gho_x", token_type: "bearer", scope: "gist" },
      ]),
    );
    const r = await c.pollUntilToken(DEVICE_CODE, {
      sleep: (ms) => sleeps.push(ms),
    });
    expect(r).toEqual({ type: "token", token: "gho_x" });
    // 3 polls → 3 sleeps; the slow_down bumped the interval (5s → ≥10s) for poll 3.
    expect(sleeps.length).toBe(3);
    expect(sleeps[2]).toBeGreaterThan(sleeps[0]);
  });

  test("returns error on a terminal error response", async () => {
    const c = new DeviceFlowClient(
      "cid",
      seqFetch([{ error: "access_denied" }]),
    );
    const r = await c.pollUntilToken(DEVICE_CODE, { sleep: () => {} });
    expect(r).toEqual({ type: "error", message: "access_denied" });
  });

  test("returns timeout when the code has already expired (no poll)", async () => {
    let polled = false;
    const c = new DeviceFlowClient("cid", (async () => {
      polled = true;
      return { ok: true, status: 200, json: () => ({}) } as FetchResponse;
    }) as unknown as typeof fetch);
    const r = await c.pollUntilToken(
      { ...DEVICE_CODE, expires_in: 0 },
      { sleep: () => {} },
    );
    expect(r).toEqual({ type: "timeout" });
    expect(polled).toBe(false);
  });
});
