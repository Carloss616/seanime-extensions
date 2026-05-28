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
        description: "local-catalog catalog",
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
}
