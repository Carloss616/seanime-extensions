/**
 * Sync seanime's goja extension types into types/goja/.
 *
 * Mirrors every *.d.ts under internal/extension_repo/ in 5rahim/seanime,
 * pinned to a commit SHA recorded in types/goja/.sync-meta.json.
 *
 * Usage:
 *   bun run sync:types              # sync at main HEAD, repin (default)
 *   bun run sync:types --ref <x>    # sync at branch/tag/sha <x>, repin
 *
 * Set GITHUB_TOKEN to raise the GitHub API rate limit (60/hr unauthenticated).
 */
import { join } from "node:path";

const REPO = "5rahim/seanime";
const TYPES_GLOB = /^internal\/extension_repo\/.*\.d\.ts$/;
/** Upstream paths to skip (basename collisions / known conflicts). Empty today. */
const IGNORE: string[] = [];

const GOJA_REL = "types/goja"; // repo-relative; stored in meta + used for output
const GOJA_DIR = join(import.meta.dir, "..", GOJA_REL);
const META_PATH = join(GOJA_DIR, ".sync-meta.json");

interface SyncMeta {
  repo: string;
  ref: string;
  committedAt: string;
  files: { src: string; out: string }[];
}

// ---------- pure helpers (unit-tested) ----------

export function filterTypePaths(
  paths: string[],
  ignore: string[] = IGNORE,
): string[] {
  return paths.filter((p) => TYPES_GLOB.test(p) && !ignore.includes(p)).sort();
}

export function flattenTargets(paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, string>(); // basename -> first source path
  for (const p of paths) {
    const base = p.slice(p.lastIndexOf("/") + 1);
    const prev = seen.get(base);
    if (prev) {
      throw new Error(
        `Basename collision: "${prev}" and "${p}" both flatten to "${base}"`,
      );
    }
    seen.set(base, p);
    out.set(p, base);
  }
  return out;
}

export function transformSource(content: string, shortSha: string): string {
  const stripped = content
    .split("\n")
    .filter((line) => !/^\s*\/\/\/\s*<reference\b.*\/>\s*$/.test(line))
    .join("\n");
  const header = `// AUTO-SYNCED from ${REPO}@${shortSha} — do not edit. Regenerate with \`bun run sync:types\`.\n`;
  return header + stripped;
}

// ---------- github IO ----------

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "seanime-extensions-sync",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function resolveSha(
  ref: string,
): Promise<{ sha: string; committedAt: string }> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/commits/${ref}`,
    {
      headers: ghHeaders(),
    },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to resolve ref "${ref}": ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    sha: string;
    commit: { committer: { date: string } };
  };
  return { sha: body.sha, committedAt: body.commit.committer.date };
}

async function listTree(sha: string): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/git/trees/${sha}?recursive=1`,
    { headers: ghHeaders() },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to list tree @${sha}: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    tree: { path: string; type: string }[];
    truncated: boolean;
  };
  if (body.truncated) {
    throw new Error(
      "GitHub tree response was truncated — cannot guarantee a complete sync",
    );
  }
  return body.tree.filter((e) => e.type === "blob").map((e) => e.path);
}

async function downloadRaw(sha: string, path: string): Promise<string> {
  // Try the contents API first (5000/hr when GITHUB_TOKEN is valid). On an
  // auth error (401/403 — no/invalid token), fall back to
  // raw.githubusercontent.com, which needs no auth but is IP rate-limited.
  const api = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}?ref=${sha}`,
    { headers: { ...ghHeaders(), Accept: "application/vnd.github.raw" } },
  );
  if (api.ok) return api.text();
  if (api.status !== 401 && api.status !== 403) {
    throw new Error(
      `Failed to download ${path} @${sha}: ${api.status} ${api.statusText}`,
    );
  }

  const raw = await fetch(
    `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`,
    { headers: { "User-Agent": "seanime-extensions-sync" } },
  );
  if (!raw.ok) {
    throw new Error(
      `Failed to download ${path} @${sha}: ${raw.status} ${raw.statusText}`,
    );
  }
  return raw.text();
}

// ---------- orchestration ----------

async function main(argv: string[]): Promise<void> {
  // Default: latest main. Pass --ref <x> to sync a specific branch/tag/SHA.
  const refFlagIdx = argv.indexOf("--ref");
  let targetRef = "main";
  if (refFlagIdx !== -1) {
    const value = argv[refFlagIdx + 1];
    if (!value) throw new Error("--ref requires a value (branch, tag, or SHA)");
    targetRef = value;
  }

  const { sha, committedAt } = await resolveSha(targetRef);
  const shortSha = sha.slice(0, 7);
  console.log(`Syncing ${REPO} types @ ${sha} (from ref "${targetRef}")`);

  const allPaths = await listTree(sha);
  const typePaths = filterTypePaths(allPaths);
  if (typePaths.length === 0) {
    throw new Error("No .d.ts files found under internal/extension_repo/");
  }
  const targets = flattenTargets(typePaths);

  const files: { src: string; out: string }[] = [];
  for (const [src, base] of targets) {
    const raw = await downloadRaw(sha, src);
    await Bun.write(join(GOJA_DIR, base), transformSource(raw, shortSha));
    const out = join(GOJA_REL, base);
    files.push({ src, out });
    console.log(`  ${src} → ${out}`);
  }

  const meta: SyncMeta = {
    repo: REPO,
    ref: sha,
    committedAt,
    files,
  };
  await Bun.write(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `Wrote ${files.length} files + .sync-meta.json (pinned ${shortSha})`,
  );

  const head = await resolveSha("main");
  if (head.sha !== sha) {
    console.log(
      `\n⚠ main is now ${head.sha.slice(0, 7)} (pinned ${shortSha}). Run \`bun run sync:types --ref <sha>\` to pin, or re-run to bump.`,
    );
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
