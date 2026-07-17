import path from "node:path";

const ISOLATED_FOLDER = "modules";

const VALID_TYPES = new Set([
  "custom-source",
  "manga-provider",
  "anime-torrent-provider",
  "onlinestream-provider",
  "plugin",
]);

// Fields projected into marketplace.json — mirrors what seanime's marketplace reads.
const MARKETPLACE_FIELDS = [
  "id",
  "name",
  "description",
  "author",
  "manifestURI",
  "icon",
  "type",
  "language",
  "lang",
  "website",
] as const;

interface Manifest {
  id: string;
  type: string;
  manifestURI: string;
  payloadURI: string;
  [k: string]: unknown;
}

const discovery = () => {
  const glob = new Bun.Glob("src/*/*/code.ts");
  return Array.from(glob.scanSync());
};

// payloadURI is the sibling `code.js` of the manifest. Keeping it derived (not
// hand-written) means the two URLs can never drift.
const derivePayloadURI = (manifestURI: string) =>
  manifestURI.replace(/manifest\.json$/, "code.js");

const loadAndValidateManifest = async (entryDir: string): Promise<Manifest> => {
  const manifestPath = path.join(entryDir, "manifest.json");
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    throw new Error(`Missing manifest.json in ${entryDir}`);
  }

  const manifest = (await file.json()) as Manifest;

  if (!VALID_TYPES.has(manifest.type)) {
    throw new Error(
      `${manifestPath}: invalid type "${manifest.type}" — expected one of ${[...VALID_TYPES].join(", ")}`,
    );
  }
  if (!manifest.manifestURI?.endsWith("manifest.json")) {
    throw new Error(`${manifestPath}: manifestURI must end with manifest.json`);
  }
  const expectedPayload = derivePayloadURI(manifest.manifestURI);
  if (manifest.payloadURI !== expectedPayload) {
    throw new Error(
      `${manifestPath}: payloadURI must be the sibling code.js (${expectedPayload}), got ${manifest.payloadURI}`,
    );
  }

  return manifest;
};

const buildEntry = async (
  entryPath: string,
  manifestId: string,
  manifestName: string,
  manifestIcon: string,
) => {
  const entryDir = path.dirname(entryPath);

  // Inject the manifest id + name + icon as bundle-time literals. Both Bun.build
  // passes below replace the bare globals `__MANIFEST_ID__` / `__MANIFEST_NAME__`
  // / `__MANIFEST_ICON__` (declared type-only in types/augment.d.ts) with these
  // strings, so `getManifestId()` and the shared tray header resolve to the
  // owning extension's values without any per-call path or per-plugin macro file.
  const define = {
    __MANIFEST_ID__: JSON.stringify(manifestId),
    __MANIFEST_NAME__: JSON.stringify(manifestName),
    __MANIFEST_ICON__: JSON.stringify(manifestIcon),
  };

  // 1. Bundle every isolated module (modules/*.ts) standalone. Each bundle
  //    resolves its `../utils/*` imports and inlines those decls, so the module
  //    becomes self-contained.
  const glob = new Bun.Glob(`./${ISOLATED_FOLDER}/*.ts`);
  const scannedFiles = Array.from(glob.scanSync({ cwd: entryDir }));
  const isolatedContents: Record<string, string> = {};

  await Promise.all(
    scannedFiles.map(async (file) => {
      const filePath = path.join(entryDir, file);
      const result = await Bun.build({
        entrypoints: [filePath],
        target: "browser",
        format: "esm",
        define,
        // Inline `.svg` imports as raw text (a string literal) rather than
        // emitting an asset + returning its path. Keeps icon markup in a
        // file while still surviving goja's per-callback `.toString()`.
        loader: { ".svg": "text", ".html": "text" },
      });
      const output = await result.outputs[0]?.text();
      if (!output) throw new Error(`No output found for ${file}`);
      isolatedContents[path.normalize(file)] = output;
    }),
  );

  // 2. Bundle the entry (code.ts), intercepting imports of modules/*. Each
  //    imported module is re-emitted as a SELF-CONTAINED function (see the
  //    wrapper comment below) so its deps survive goja's `.toString()` +
  //    re-eval in isolated runtimes.
  const isolatedPattern = path.join(entryDir, ISOLATED_FOLDER, ".*");

  const result = await Bun.build({
    entrypoints: [entryPath],
    target: "browser",
    format: "esm",
    define,
    loader: { ".svg": "text" },
    plugins: [
      {
        name: "isolate-modules",
        setup(build) {
          build.onLoad(
            { filter: new RegExp(isolatedPattern), namespace: "file" },
            (args) => {
              const relative = path.normalize(
                path.relative(entryDir, args.path),
              );

              const contentParts = isolatedContents[relative]?.split("export");
              const content = contentParts?.[0]?.trim();
              if (!content) throw new Error(`No content found for ${relative}`);

              const exports = contentParts?.[1]?.trim();
              const exportNames =
                exports
                  ?.replace(/^\s*{\s*|\s*}\s*;?\s*$/g, "")
                  .split(",")
                  .map((s) => s.trim()) || [];

              const moduleName = exportNames[0];
              if (!moduleName || exportNames.length !== 1)
                throw new Error(`Unexpected number of exports for ${relative}`);

              // Wrap as a self-contained function, NOT an IIFE-closure.
              //
              // seanime runs each hook/UI callback in an isolated goja runtime:
              // it serializes the registered function via `.toString()` and
              // re-evals it there. A function's closure does NOT cross that
              // boundary — the docs are explicit that callbacks "cannot read
              // global variables" (module/init scope reads as `undefined`).
              //
              // So an IIFE wrapper `(() => { class Helper{}; return fn })()`
              // is WRONG: `fn.toString()` excludes Helper (it lives in the
              // IIFE closure), giving `ReferenceError: Helper is not defined`
              // at runtime. Instead we declare everything INSIDE the registered
              // function's own body and forward args to the bundled inner fn,
              // so `.toString()` carries the full self-contained source.
              const formatted = `export const ${moduleName} = (...args) => {${content}\nreturn ${moduleName}(...args);};`;
              return { contents: formatted, loader: "js" };
            },
          );
        },
      },
    ],
  });

  let output = await result.outputs[0]?.text();
  output = output?.split("export")?.[0];
  if (!output) throw new Error(`No output found for ${entryPath}`);

  const outputFile = Bun.file(
    entryPath.replace(path.extname(entryPath), ".js"),
  );
  await Bun.write(outputFile, output);
};

const writeMarketplace = async (manifests: Manifest[]) => {
  const entries = manifests
    .map((m) =>
      Object.fromEntries(
        MARKETPLACE_FIELDS.map((f) => [f, (m[f] as string) ?? ""]),
      ),
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  await Bun.write("marketplace.json", `${JSON.stringify(entries, null, 2)}\n`);
};

const main = async () => {
  const extensions = discovery();
  const manifests: Manifest[] = [];

  for (const entryPath of extensions) {
    const entryDir = path.dirname(entryPath);
    const manifest = await loadAndValidateManifest(entryDir);
    await buildEntry(
      entryPath,
      manifest.id,
      String(manifest.name ?? manifest.id),
      String(manifest.icon ?? ""),
    );
    manifests.push(manifest);
    console.log(`built ${manifest.id.padEnd(24)} ${entryDir}`);
  }

  await writeMarketplace(manifests);
  console.log(`wrote marketplace.json (${manifests.length} entries)`);
};

main();
