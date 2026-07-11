export interface GistInfo {
  id: string;
  owner: string;
  rawUrl: string;
}

export class GistClient {
  // Pass `(u, i) => ctx.fetch(u, i)` from UI scope; `ctx.fetch` matches the
  // shape declared in types/core.d.ts.
  private declare token: string;
  private declare fetchFn: typeof fetch;

  constructor(token: string, fetchFn: typeof fetch) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    };
  }

  private rawUrl(owner: string, id: string, filename: string): string {
    return `https://gist.githubusercontent.com/${owner}/${id}/raw/${filename}`;
  }

  async createGist(filename: string, content: string): Promise<GistInfo> {
    const res = await this.fetchFn("https://api.github.com/gists", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        public: false,
        description: "Seanime local catalog and progress sync",
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) {
      throw new Error(`createGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<{ id: string; owner?: { login?: string } }>();
    const owner = data.owner?.login ?? "";
    return {
      id: data.id,
      owner,
      rawUrl: this.rawUrl(owner, data.id, filename),
    };
  }

  async getGistFile(id: string, filename: string): Promise<string> {
    const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<{ files?: Record<string, { content?: string }> }>();
    return data.files?.[filename]?.content ?? "";
  }

  /** Single GET that returns owner + computed raw URL + file content — used
   *  by the link-existing-gist flow so we can persist K_OWNER and K_RAW
   *  without a follow-up request (and so "Show raw catalog URL" works
   *  immediately after linking, not only after the first push/pull). */
  async getGistFileWithInfo(
    id: string,
    filename: string,
  ): Promise<{ owner: string; rawUrl: string; content: string }> {
    const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<{
      files?: Record<string, { content?: string }>;
      owner?: { login?: string };
    }>();
    const owner = data.owner?.login ?? "";
    return {
      owner,
      rawUrl: this.rawUrl(owner, id, filename),
      content: data.files?.[filename]?.content ?? "",
    };
  }

  async updateGistFile(
    id: string,
    filename: string,
    content: string,
  ): Promise<void> {
    const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ files: { [filename]: { content } } }),
    });
    if (!res.ok) {
      throw new Error(`updateGist failed: ${res.status} ${res.text()}`);
    }
  }

  async deleteGist(id: string): Promise<void> {
    const res = await this.fetchFn(`https://api.github.com/gists/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    // 204 No Content on success; 404 if already gone (treat as success).
    if (!res.ok && res.status !== 404) {
      throw new Error(`deleteGist failed: ${res.status} ${res.text()}`);
    }
  }

  /** List the authenticated user's gists and return the id of the first one
   *  that contains `filename`, or null. Lets a second device find the shared
   *  sync gist by filename instead of pasting an id — no create/link UI. */
  async findGistByFilename(filename: string): Promise<string | null> {
    const res = await this.fetchFn(
      "https://api.github.com/gists?per_page=100",
      {
        method: "GET",
        headers: this.headers(),
      },
    );
    if (!res.ok) {
      throw new Error(`listGists failed: ${res.status} ${res.text()}`);
    }
    const data =
      res.json<Array<{ id: string; files?: Record<string, unknown> }>>();
    for (const g of data) {
      if (g.files && filename in g.files) return g.id;
    }
    return null;
  }
}
