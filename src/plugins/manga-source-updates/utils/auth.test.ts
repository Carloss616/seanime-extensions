import { describe, expect, test } from "bun:test";
import { interpretDeviceCode, interpretTokenResponse } from "./auth";

describe("interpretDeviceCode", () => {
  test("parses the documented device/code response", () => {
    const r = interpretDeviceCode({
      device_code: "dc",
      user_code: "WDJB-MJHT",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    });
    expect(r).toEqual({
      ok: true,
      start: {
        deviceCode: "dc",
        userCode: "WDJB-MJHT",
        verificationUri: "https://github.com/login/device",
        interval: 5,
        expiresIn: 900,
      },
    });
  });

  test("defaults interval to 5 when absent", () => {
    const r = interpretDeviceCode({
      device_code: "dc",
      user_code: "x",
      verification_uri: "https://x",
      expires_in: 900,
    });
    expect(r.ok && r.start.interval).toBe(5);
  });

  test("fails on a missing field", () => {
    expect(interpretDeviceCode({ user_code: "x" }).ok).toBe(false);
    expect(interpretDeviceCode({ error: "not_found" }).ok).toBe(false);
  });
});

describe("interpretTokenResponse", () => {
  test("access_token → token", () => {
    expect(
      interpretTokenResponse({ access_token: "gho_x", token_type: "bearer" }),
    ).toEqual({
      type: "token",
      token: "gho_x",
    });
  });

  test("authorization_pending → pending", () => {
    expect(interpretTokenResponse({ error: "authorization_pending" })).toEqual({
      type: "pending",
    });
  });

  test("slow_down → slow_down with interval", () => {
    expect(
      interpretTokenResponse({ error: "slow_down", interval: 10 }),
    ).toEqual({
      type: "slow_down",
      interval: 10,
    });
  });

  test("terminal error → error", () => {
    expect(interpretTokenResponse({ error: "access_denied" })).toEqual({
      type: "error",
      message: "access_denied",
    });
    expect(interpretTokenResponse({ error: "expired_token" })).toEqual({
      type: "error",
      message: "expired_token",
    });
  });

  test("unexpected shape → error", () => {
    expect(interpretTokenResponse({}).type).toBe("error");
  });
});
