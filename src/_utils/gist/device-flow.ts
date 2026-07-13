// GitHub OAuth Device Flow client — the auth half of the shared gist stack.
// Pairs with GistClient: this obtains a `gist`-scoped token via the browser
// device flow, GistClient uses it. The two HTTP POSTs live here (mockable via
// fetchFn, like GistClient); the pure response formatters are unit-tested.
// The blocking poll LOOP (there is no setTimeout in goja) stays in the caller,
// which owns the $sleep cadence and its UI state.
// See https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

export function formatDeviceCode(
  json: $gh.Login.DeviceCodeResponse,
): { ok: true; start: $gh.Login.DeviceCode } | { ok: false; message: string } {
  if ("device_code" in json) return { ok: true, start: json };
  return { ok: false, message: json.error ?? "malformed device-code response" };
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

export function formatTokenResponse(
  json: $gh.Login.OAuthTokenResponse,
): PollResult {
  if ("access_token" in json) {
    return { type: "token", token: json.access_token };
  }
  if (json.error === "authorization_pending") return { type: "pending" };
  if (json.error === "slow_down") {
    // Docs: slow_down includes the new interval; fall back to 5 if absent.
    return { type: "slow_down", interval: json.interval ?? 5 };
  }
  return { type: "error", message: json.error ?? "unexpected token response" };
}

export class DeviceFlowClient {
  // Pass `(u, i) => ctx.fetch(u, i)` from UI scope. `declare` fields keep the
  // transpiled output free of `__publicField` so the class survives goja's
  // per-callback `.toString()` re-eval (same pattern as GistClient).
  private declare baseUrl: string;
  private declare clientId: string;
  private declare fetchFn: typeof fetch;

  constructor(clientId: string, fetchFn: typeof fetch) {
    this.baseUrl = "https://github.com/login";
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
  ): Promise<ReturnType<typeof formatDeviceCode>> {
    const res = await this.fetchFn(`${this.baseUrl}/device/code`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ client_id: this.clientId, scope }),
    });
    return formatDeviceCode(res.json<$gh.Login.DeviceCodeResponse>());
  }

  /** One poll for the access token — the loop primitive `pollUntilToken` uses. */
  async pollAccessToken(deviceCode: string): Promise<PollResult> {
    const res = await this.fetchFn(`${this.baseUrl}/oauth/access_token`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        client_id: this.clientId,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });
    return formatTokenResponse(res.json<$gh.Login.OAuthTokenResponse>());
  }

  /** Run the full poll loop until the user authorizes (token), GitHub rejects
   *  (error), or `start.expires_in` elapses (timeout). Backs off on `slow_down`,
   *  keeps waiting on `pending`. `sleep` is injected (goja's `$sleep` blocks —
   *  there is no setTimeout) so the loop is testable with a no-op sleep. The
   *  caller owns what to DO with the outcome (store the token, toast, etc.). */
  async pollUntilToken(
    start: $gh.Login.DeviceCode,
    deps: { sleep: (ms: number) => void },
  ): Promise<ConnectResult> {
    let interval = Math.max(1, start.interval);
    const deadline = Date.now() + start.expires_in * 1000;
    while (Date.now() < deadline) {
      deps.sleep(interval * 1000);
      const result = await this.pollAccessToken(start.device_code);
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
