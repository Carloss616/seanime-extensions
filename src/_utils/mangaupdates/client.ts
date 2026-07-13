class MUTokenExpiredError extends Error {
  constructor() {
    super("MU session expired");
    this.name = "MUTokenExpiredError";
  }
}

export abstract class MUClientBase {
  // `declare` keeps these TYPE-ONLY (no runtime emit); assign in the
  // constructor. A bare field initializer (`baseUrl = "..."`) can lower to a
  // `__publicField(this, ...)` helper that lives at bundle module scope —
  // unreachable from inside a goja-isolated callback body, throwing
  // `ReferenceError: __publicField is not defined`. See CLAUDE.md "Class-field
  // gotcha inside helper classes".
  protected declare baseUrl: string;
  protected declare fetchFn: typeof fetch;

  constructor() {
    this.baseUrl = "https://api.mangaupdates.com/v1";
  }

  protected async _req<T = unknown>(
    method: string,
    path: string,
    options: {
      body?: unknown;
      token?: string;
      onRefreshToken?: () => Promise<string>;
      maxRefreshTokenAttempts?: number;
    } = {},
  ): Promise<T | null> {
    const {
      body,
      token,
      onRefreshToken,
      maxRefreshTokenAttempts = 2,
    } = options;
    const attempt = "attempt" in options ? Number(options.attempt) : 1;
    const headers: Record<string, string> = { Accept: "application/json" };

    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchFn(this.baseUrl + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      if (!onRefreshToken || attempt >= maxRefreshTokenAttempts)
        throw new MUTokenExpiredError();
      const token = await onRefreshToken();
      const _options = { ...options, token, attempt: attempt + 1 };
      return this._req<T>(method, path, _options);
    }

    if (!res.ok) {
      throw new Error(`MU ${method} ${path} -> ${res.status} ${res.text()}`);
    }

    if ((res.contentType || "").includes("application/json"))
      return res.json<T>();

    return null;
  }

  protected async _search(
    query: string,
    options?: { page?: number; perPage?: number; token?: string },
  ): Promise<$mu.Search.Response | null> {
    const { page, perPage, token } = options || {};
    return this._req<$mu.Search.Response>("POST", "/series/search", {
      body: { search: query, page, perpage: perPage },
      token,
    });
  }
}
