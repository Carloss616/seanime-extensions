// GitHub OAuth Device Flow client — obtains a `gist`-scoped token GistClient
// then uses. See
// https://docs.github.com/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow

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
  // `declare` fields keep the transpiled output free of `__publicField` so the
  // class survives goja's per-callback `.toString()` re-eval (like GistClient).
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

  /** Poll until the user authorizes (token), GitHub rejects (error), or
   *  `expires_in` elapses (timeout). `sleep` is injected — goja's `$sleep`
   *  blocks and there is no setTimeout — so the loop is testable with a no-op. */
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
    }
    return { type: "timeout" };
  }
}
