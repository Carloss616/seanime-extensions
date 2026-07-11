// GitHub OAuth Device Flow client — the auth half of the shared gist stack.
// Pairs with GistClient: this obtains a `gist`-scoped token via the browser
// device flow, GistClient uses it. The two HTTP POSTs live here (mockable via
// fetchFn, like GistClient); the pure response interpreters are unit-tested.
// The blocking poll LOOP (there is no setTimeout in goja) stays in the caller,
// which owns the $sleep cadence and its UI state.
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

// Terminal outcome of the whole poll loop (pending/slow_down are handled inside
// the loop and never surface).
export type ConnectResult =
  | { type: "token"; token: string }
  | { type: "error"; message: string }
  | { type: "timeout" };

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

export class DeviceFlowClient {
  // Pass `(u, i) => ctx.fetch(u, i)` from UI scope. `declare` fields keep the
  // transpiled output free of `__publicField` so the class survives goja's
  // per-callback `.toString()` re-eval (same pattern as GistClient).
  private declare clientId: string;
  private declare fetchFn: typeof fetch;

  constructor(clientId: string, fetchFn: typeof fetch) {
    this.clientId = clientId;
    this.fetchFn = fetchFn;
  }

  private headers(): Record<string, string> {
    // Accept JSON so GitHub returns JSON, not the default form-encoded body.
    return { Accept: "application/json", "Content-Type": "application/json" };
  }

  /** Start the flow: returns the user code + verification URL to show, or an
   *  error message. */
  async requestDeviceCode(
    scope: string,
  ): Promise<
    { ok: true; start: DeviceCodeStart } | { ok: false; message: string }
  > {
    const res = await this.fetchFn("https://github.com/login/device/code", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ client_id: this.clientId, scope }),
    });
    return interpretDeviceCode(res.json());
  }

  /** One poll for the access token — the loop primitive `pollUntilToken` uses. */
  async pollAccessToken(deviceCode: string): Promise<PollResult> {
    const res = await this.fetchFn(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          client_id: this.clientId,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      },
    );
    return interpretTokenResponse(res.json());
  }

  /** Run the full poll loop until the user authorizes (token), GitHub rejects
   *  (error), or `start.expiresIn` elapses (timeout). Backs off on `slow_down`,
   *  keeps waiting on `pending`. `sleep` is injected (goja's `$sleep` blocks —
   *  there is no setTimeout) so the loop is testable with a no-op sleep. The
   *  caller owns what to DO with the outcome (store the token, toast, etc.). */
  async pollUntilToken(
    start: DeviceCodeStart,
    deps: { sleep: (ms: number) => void },
  ): Promise<ConnectResult> {
    let interval = Math.max(1, start.interval);
    const deadline = Date.now() + start.expiresIn * 1000;
    while (Date.now() < deadline) {
      deps.sleep(interval * 1000);
      const result = await this.pollAccessToken(start.deviceCode);
      if (result.type === "token")
        return { type: "token", token: result.token };
      if (result.type === "error") {
        return { type: "error", message: result.message };
      }
      if (result.type === "slow_down") {
        interval = Math.max(interval + 5, result.interval);
      }
      // pending / slow_down → keep polling
    }
    return { type: "timeout" };
  }
}
