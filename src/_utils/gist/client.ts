export interface GistInfo {
  id: string;
  owner: string;
  rawUrl: string;
}

export class GistClient {
  private declare baseUrl: string;
  private declare token: string;
  private declare fetchFn: typeof fetch;

  constructor(token: string, fetchFn: typeof fetch) {
    this.baseUrl = "https://api.github.com";
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

  async createGist(
    filename: string,
    content: string,
    description: string,
  ): Promise<GistInfo> {
    const res = await this.fetchFn(`${this.baseUrl}/gists`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        public: false,
        description,
        files: { [filename]: { content } },
      }),
    });
    if (!res.ok) {
      throw new Error(`createGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<$gh.Gist.Response>();
    const id = data.id ?? "";
    const owner = data.owner?.login ?? "";
    return {
      id,
      owner,
      rawUrl: this.rawUrl(owner, id, filename),
    };
  }

  async getGistFile(id: string, filename: string): Promise<string> {
    const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<$gh.Gist.Response>();
    return data.files?.[filename]?.content ?? "";
  }

  /** Single GET returning owner + raw URL + content, so the link-existing-gist
   *  flow can persist K_OWNER/K_RAW without a follow-up request (and "Show raw
   *  catalog URL" works right after linking, not only after the first push). */
  async getGistFileWithInfo(
    id: string,
    filename: string,
  ): Promise<{ owner: string; rawUrl: string; content: string }> {
    const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<$gh.Gist.Response>();
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
    const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify({ files: { [filename]: { content } } }),
    });
    if (!res.ok) {
      throw new Error(`updateGist failed: ${res.status} ${res.text()}`);
    }
  }

  /** Read several files from ONE gist in a single GET. Returns filename →
   *  content, "" for any requested file the gist doesn't have. */
  async getGistFiles(
    id: string,
    filenames: string[],
  ): Promise<Record<string, string>> {
    const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`getGist failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<$gh.Gist.Response>();
    const out: Record<string, string> = {};
    for (const name of filenames) {
      out[name] = data.files?.[name]?.content ?? "";
    }
    return out;
  }

  /** Create/update several files in ONE PATCH (a filename absent from the gist
   *  is created). Only pass the files that actually changed. */
  async updateGistFiles(
    id: string,
    files: Record<string, string>,
  ): Promise<void> {
    const body: { files: Record<string, { content: string }> } = { files: {} };
    for (const [name, content] of Object.entries(files)) {
      body.files[name] = { content };
    }
    const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
      method: "PATCH",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`updateGist failed: ${res.status} ${res.text()}`);
    }
  }

  async deleteGist(id: string): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}/gists/${id}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    // 204 No Content on success; 404 if already gone (treat as success).
    if (!res.ok && res.status !== 404) {
      throw new Error(`deleteGist failed: ${res.status} ${res.text()}`);
    }
  }

  /** Id of the authenticated user's first gist containing `filename`, or null.
   *  Lets a second device find the shared sync gist without pasting an id. */
  async findGistByFilename(filename: string): Promise<string | null> {
    const res = await this.fetchFn(`${this.baseUrl}/gists?per_page=100`, {
      method: "GET",
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`listGists failed: ${res.status} ${res.text()}`);
    }
    const data = res.json<$gh.Gists.Response>();
    for (const g of data) {
      if (g.files && filename in g.files) return g.id;
    }
    return null;
  }
}
