/**
 * Print the seanime-extensions Discord submission post for an extension,
 * filled from its manifest.json (the source of truth — no version drift).
 *
 * Usage:
 *   bun run dp <extension-id>     # e.g. bun run dp library-grid-layout
 *
 * Output goes to stdout as Markdown ready to paste into the #extensions channel.
 */

// Marks this file as a module so top-level `await` is allowed under tsc.
export {};

interface Manifest {
  id: string;
  name: string;
  version: string;
  manifestURI: string;
  language: string;
  type: string;
  description: string;
  author: string;
  icon: string;
  website: string;
  readme: string;
  notes: string;
  payloadURI: string;
  plugin?: {
    version: string;
    permissions?: {
      scopes?: string[];
      allow?: { networkAccess?: { allowedDomains?: string[] } };
    };
  };
  [k: string]: unknown;
}

const id = process.argv[2];
if (!id) {
  console.error("usage: bun run dp <extension-id>");
  process.exit(1);
}

const readManifest = (p: string) => Bun.file(p).json() as Promise<Manifest>;

// Fast path: by convention the folder is named after the id, so read just that
// manifest — but confirm its declared id matches (folder == id isn't enforced).
let m: Manifest | undefined;
for (const p of new Bun.Glob(`src/*/${id}/manifest.json`).scanSync()) {
  const cand = await readManifest(p);
  if (cand.id === id) {
    m = cand;
    break;
  }
}

// Slow path: only when the fast path misses — scan everything to match by id
// field (covers folder != id) and to list the available ids on a true miss.
if (!m) {
  const all: Manifest[] = [];
  for (const p of new Bun.Glob("src/*/*/manifest.json").scanSync()) {
    all.push(await readManifest(p));
  }
  m = all.find((x) => x.id === id);
  if (!m) {
    console.error(
      `No extension with id "${id}". Available: ${all
        .map((x) => x.id)
        .sort()
        .join(", ")}`,
    );
    process.exit(1);
  }
}

const toCode = (s: string) => `\`${s}\``;

const notes: string[] = [];
const scopes = m.plugin?.permissions?.scopes;
if (scopes?.length) {
  notes.push(`Requested permission scopes: ${scopes.map(toCode).join(", ")}.`);
}
const domains =
  m.plugin?.permissions?.allow?.networkAccess?.allowedDomains?.map(toCode);
notes.push(
  domains?.length
    ? `Network access: ${domains.join(", ")}.`
    : "No network access.",
);
if (m.readme) notes.push(`[Readme](${m.readme})`);

const desc = m.author
  ? `${m.description ?? ""} Made by ${m.author}.`.trim()
  : (m.description ?? "");

const post = `> **Extension Name:**
> ${m.name}
> 
> **Version:**
> ${m.version ?? "—"}
> 
> **GitHub Repository / Download Link:**
> [Click Here](${m.manifestURI}) / Copy the link below:
> \`\`\`${m.manifestURI}\`\`\`
> **Description:**
> ${desc}
> 
> **Additional Notes:**
${notes.map((n) => `> - ${n}`).join("\n")}`;

console.log(post);
