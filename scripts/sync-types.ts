/**
 * Sync seanime's goja extension types into types/goja/.
 *
 * Mirrors every *.d.ts under internal/extension_repo/ in 5rahim/seanime,
 * pinned to a commit SHA recorded in types/goja/.sync-meta.json.
 *
 * Usage:
 *   bun run sync:types              # re-sync at the pinned SHA (main HEAD on first run)
 *   bun run sync:types --ref <x>    # sync at branch/tag/sha <x>, repin
 *   bun run sync:types --latest     # sync at main HEAD, repin
 *
 * Set GITHUB_TOKEN to raise the GitHub API rate limit (60/hr unauthenticated).
 */
import { join } from "node:path";

const REPO = "5rahim/seanime";
const TYPES_GLOB = /^internal\/extension_repo\/.*\.d\.ts$/;
/** Upstream paths to skip (basename collisions / known conflicts). Empty today. */
const IGNORE: string[] = [];

const GOJA_DIR = join(import.meta.dir, "..", "types", "goja");
const META_PATH = join(GOJA_DIR, ".sync-meta.json");

interface SyncMeta {
  repo: string;
  ref: string;
  syncedAt: string;
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

async function resolveSha(ref: string): Promise<string> {
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
  const body = (await res.json()) as { sha: string };
  return body.sha;
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
  const res = await fetch(
    `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`,
    {
      headers: { "User-Agent": "seanime-extensions-sync" },
    },
  );
  if (!res.ok) {
    throw new Error(
      `Failed to download ${path} @${sha}: ${res.status} ${res.statusText}`,
    );
  }
  return res.text();
}

async function readPinnedRef(): Promise<string | null> {
  try {
    const meta = (await Bun.file(META_PATH).json()) as SyncMeta;
    return meta.ref ?? null;
  } catch {
    return null;
  }
}

// ---------- orchestration ----------

async function main(argv: string[]): Promise<void> {
  const refFlagIdx = argv.indexOf("--ref");
  let targetRef: string;
  if (argv.includes("--latest")) {
    targetRef = "main";
  } else if (refFlagIdx !== -1) {
    const value = argv[refFlagIdx + 1];
    if (!value) throw new Error("--ref requires a value (branch, tag, or SHA)");
    targetRef = value;
  } else {
    targetRef = (await readPinnedRef()) ?? "main";
  }

  const sha = await resolveSha(targetRef);
  const shortSha = sha.slice(0, 7);
  console.log(`Syncing ${REPO} types @ ${sha} (from ref "${targetRef}")`);

  const allPaths = await listTree(sha);
  const typePaths = filterTypePaths(allPaths);
  if (typePaths.length === 0) {
    throw new Error("No .d.ts files found under internal/extension_repo/");
  }
  const targets = flattenTargets(typePaths);

  const files: { src: string; out: string }[] = [];
  for (const [src, out] of targets) {
    const raw = await downloadRaw(sha, src);
    await Bun.write(join(GOJA_DIR, out), transformSource(raw, shortSha));
    files.push({ src, out });
    console.log(`  ${src} → types/goja/${out}`);
  }

  const meta: SyncMeta = {
    repo: REPO,
    ref: sha,
    syncedAt: new Date().toISOString(),
    files,
  };
  await Bun.write(META_PATH, `${JSON.stringify(meta, null, 2)}\n`);
  console.log(
    `Wrote ${files.length} files + .sync-meta.json (pinned ${shortSha})`,
  );

  const head = await resolveSha("main");
  if (head !== sha) {
    console.log(
      `\n⚠ main is now ${head.slice(0, 7)} (pinned ${shortSha}). Run \`bun run sync:types --latest\` to bump.`,
    );
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
