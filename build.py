#!/usr/bin/env python3
"""
Build all extensions under src/ and regenerate marketplace.json.

Layout convention:
    src/<type>/<id>/code.ts
    src/<type>/<id>/manifest.template.json   (no payload — payloadURI auto-injected from manifestURI)
    src/<type>/<id>/<id>.js                  (generated, raw JS — what seanime fetches via payloadURI)
    src/<type>/<id>/<id>.json                (generated, manifest with payloadURI set to <id>.js raw URL)

Distribution mode: payloadURI (per official doc — see
https://seanime.gitbook.io/seanime-extensions/content-providers/write-test-share).
The manifest sets payloadURI to the raw GitHub URL of <id>.js and leaves
`payload` empty. Seanime fetches the JS lazily at plugin load time. Keeps the
manifest small and readable, and makes PR diffs land in the .js (or .ts source)
instead of as escaped strings inside the JSON.

Usage:
    python3 build.py                     build every extension + marketplace.json
    python3 build.py <id> [<id> ...]     build only matching extensions (+ marketplace)
    python3 build.py new <type> <id>     scaffold a new extension folder
    python3 build.py dev [<id> ...]      generate <id>.dev.json for every (or given) extension
    python3 build.py --no-marketplace    skip marketplace.json regeneration
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
MARKETPLACE = ROOT / "marketplace.json"

VALID_TYPES = {
    "custom-source",
    "manga-provider",
    "anime-torrent-provider",
    "onlinestream-provider",
    "plugin",
}

MARKETPLACE_FIELDS = (
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
)


def transpile(ts_source: str) -> str:
    proc = subprocess.run(
        ["npx", "--yes", "esbuild", "--loader=ts", "--target=es2018"],
        input=ts_source,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr)
        raise SystemExit(f"esbuild failed (exit {proc.returncode})")
    return proc.stdout


def build_one(ext_dir: Path) -> dict | None:
    code_ts = ext_dir / "code.ts"
    tpl = ext_dir / "manifest.template.json"
    if not code_ts.exists() or not tpl.exists():
        return None

    manifest = json.loads(tpl.read_text())
    if manifest["type"] not in VALID_TYPES:
        raise SystemExit(f"{tpl}: unknown type {manifest['type']!r}")
    manifest_uri = manifest.get("manifestURI", "")
    if not manifest_uri.endswith(".json"):
        raise SystemExit(
            f"{tpl}: manifestURI must be set and end with .json "
            f"(got {manifest_uri!r}) — payloadURI is derived from it"
        )

    js = transpile(code_ts.read_text())

    # payloadURI distribution: store the .js URL alongside the .json, leave
    # `payload` empty. Both files share a path prefix on raw GitHub so they
    # always come from the same commit when fetched via the same branch.
    manifest["payloadURI"] = manifest_uri[: -len(".json")] + ".js"
    manifest["payload"] = ""

    ext_id = manifest["id"]
    (ext_dir / f"{ext_id}.js").write_text(js)
    (ext_dir / f"{ext_id}.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    )
    print(f"built {ext_id:30s} {ext_dir.relative_to(ROOT)}")
    return manifest


def write_marketplace(manifests: list[dict]) -> None:
    entries = []
    for m in manifests:
        entries.append({k: m.get(k, "") for k in MARKETPLACE_FIELDS})
    entries.sort(key=lambda e: e["id"])
    MARKETPLACE.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {MARKETPLACE.relative_to(ROOT)}  ({len(entries)} entries)")


def discover_manifests() -> list[Path]:
    return sorted(SRC.rglob("manifest.template.json"))


def cmd_build(targets: set[str], regen_marketplace: bool) -> int:
    built: list[dict] = []
    matched = False
    for tpl in discover_manifests():
        ext_dir = tpl.parent
        manifest = json.loads(tpl.read_text())
        if targets and manifest.get("id") not in targets:
            continue
        m = build_one(ext_dir)
        if m is not None:
            built.append(m)
            matched = True

    if targets and not matched:
        sys.stderr.write(f"no extensions matched: {sorted(targets)}\n")
        return 1

    if regen_marketplace:
        all_manifests: list[dict] = []
        for tpl in discover_manifests():
            ext_dir = tpl.parent
            mid = json.loads(tpl.read_text())["id"]
            built_path = ext_dir / f"{mid}.json"
            if built_path.exists():
                all_manifests.append(json.loads(built_path.read_text()))
        write_marketplace(all_manifests)

    return 0


def cmd_new(ext_type: str, ext_id: str) -> int:
    if ext_type not in VALID_TYPES:
        sys.stderr.write(
            f"unknown type {ext_type!r}; expected one of: {sorted(VALID_TYPES)}\n"
        )
        return 2
    ext_dir = SRC / ext_type / ext_id
    if ext_dir.exists():
        sys.stderr.write(f"{ext_dir} already exists\n")
        return 2
    ext_dir.mkdir(parents=True)

    pretty = ext_id.replace("-", " ").title()
    (ext_dir / "manifest.template.json").write_text(
        json.dumps(
            {
                "id": ext_id,
                "name": pretty,
                "version": "0.1.0",
                "manifestURI": f"https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/{ext_type}/{ext_id}/{ext_id}.json",
                "language": "typescript",
                "type": ext_type,
                "description": "TODO",
                "author": "Carloss616",
                "icon": "",
                "website": "",
                "readme": f"https://raw.githubusercontent.com/Carloss616/seanime-extensions/main/src/{ext_type}/{ext_id}/README.md",
                "lang": "en",
            },
            indent=2,
        )
        + "\n"
    )
    (ext_dir / "code.ts").write_text(
        f'/// <reference path="../../../types/core.d.ts" />\n'
        f"// TODO: implement {ext_type} for {ext_id}\n"
        f"// See types/ for the interface this extension must implement.\n"
        f"class Provider {{\n"
        f"}}\n"
    )
    (ext_dir / "README.md").write_text(f"# {pretty}\n\nTODO.\n")
    print(f"scaffolded {ext_dir.relative_to(ROOT)}")
    return 0


def cmd_dev(targets: set[str]) -> int:
    """Generate <id>.dev.json next to each manifest.template.json.

    Dev manifests live alongside the prod manifest but are gitignored
    (see .gitignore -> *.dev.json). Drop them into $SEANIME_DATA_DIR/extensions/
    (or symlink) and seanime treats `payloadURI` as a local filesystem path,
    re-reading it from disk on every load — no `build.py` step needed for
    code-only iteration since seanime transpiles TS internally when
    `language: "typescript"`.

    Caveats:
    - `icon` is set to a `file://` URL pointing at the local icon.png.
      Works in seanime desktop (webview can load file://); in pure web
      builds, mixed-scheme policy may block it — fall back to the HTTPS
      icon manually if so.
    - seanime refuses to install dev manifests via the "Add from URL" UI
      flow; drop the file in the data dir manually.
    """
    matched = False
    discovered_ids: list[str] = []
    for tpl in discover_manifests():
        ext_dir = tpl.parent
        manifest = json.loads(tpl.read_text())
        ext_id = manifest.get("id", "")
        discovered_ids.append(ext_id)
        if targets and ext_id not in targets:
            continue
        if manifest.get("type") not in VALID_TYPES:
            continue
        code_ts = ext_dir / "code.ts"
        if not code_ts.exists():
            sys.stderr.write(f"skip {ext_id}: no code.ts in {ext_dir}\n")
            continue

        dev = dict(manifest)
        dev["name"] = f"{manifest.get('name', ext_id)} (dev)"
        dev["manifestURI"] = ""
        dev["payloadURI"] = str(code_ts.resolve())
        dev["isDevelopment"] = True
        # Drop the embedded payload field if the prod manifest had one;
        # dev mode reads payloadURI from disk.
        dev.pop("payload", None)
        # Prefer a local icon (file://) when available so dev works offline.
        for cand in ("icon.png", "icon.jpg", "icon.jpeg", "icon.webp", "icon.ico"):
            icon_path = ext_dir / cand
            if icon_path.exists():
                dev["icon"] = f"file://{icon_path.resolve()}"
                break

        dev_path = ext_dir / f"{ext_id}.dev.json"
        dev_path.write_text(json.dumps(dev, ensure_ascii=False, indent=2) + "\n")
        print(f"wrote {dev_path.relative_to(ROOT)}")
        matched = True

    if targets and not matched:
        sys.stderr.write(
            f"no extensions matched: {sorted(targets)}; "
            f"available: {sorted(discovered_ids)}\n"
        )
        return 1
    return 0


def main(argv: list[str]) -> int:
    args = argv[1:]
    if args and args[0] == "new":
        if len(args) != 3:
            sys.stderr.write("usage: build.py new <type> <id>\n")
            return 2
        return cmd_new(args[1], args[2])

    if args and args[0] == "dev":
        return cmd_dev(set(args[1:]))

    regen = True
    if "--no-marketplace" in args:
        regen = False
        args = [a for a in args if a != "--no-marketplace"]

    return cmd_build(set(args), regen)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
