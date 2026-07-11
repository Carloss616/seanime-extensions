// Pure state helpers for the GitHub OAuth Device Flow. All I/O (the two POSTs
// and the poll loop with $sleep) lives in register.ts; these just interpret the
// documented response shapes so the poll state machine is unit-tested.
// See https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export interface DeviceCodeStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number; // seconds between polls
  expiresIn: number; // seconds until the device_code expires
}

export function interpretDeviceCode(
  json: unknown,
): { ok: true; start: DeviceCodeStart } | { ok: false; message: string } {
  const j = (json ?? {}) as Record<string, unknown>;
  const deviceCode = typeof j.device_code === "string" ? j.device_code : "";
  const userCode = typeof j.user_code === "string" ? j.user_code : "";
  const verificationUri =
    typeof j.verification_uri === "string" ? j.verification_uri : "";
  if (!deviceCode || !userCode || !verificationUri) {
    const msg =
      typeof j.error === "string" ? j.error : "malformed device-code response";
    return { ok: false, message: msg };
  }
  return {
    ok: true,
    start: {
      deviceCode,
      userCode,
      verificationUri,
      interval: typeof j.interval === "number" ? j.interval : 5,
      expiresIn: typeof j.expires_in === "number" ? j.expires_in : 900,
    },
  };
}

export type PollResult =
  | { type: "token"; token: string }
  | { type: "pending" }
  | { type: "slow_down"; interval: number }
  | { type: "error"; message: string };

export function interpretTokenResponse(json: unknown): PollResult {
  const j = (json ?? {}) as Record<string, unknown>;
  if (typeof j.access_token === "string" && j.access_token.length > 0) {
    return { type: "token", token: j.access_token };
  }
  const err = typeof j.error === "string" ? j.error : "";
  if (err === "authorization_pending") return { type: "pending" };
  if (err === "slow_down") {
    return {
      type: "slow_down",
      interval: typeof j.interval === "number" ? j.interval : 5,
    };
  }
  if (err) return { type: "error", message: err };
  return { type: "error", message: "unexpected token response" };
}
