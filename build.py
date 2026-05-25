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
import re
import subprocess
import sys
from pathlib import Path

# `// @inline <path>` — path is relative to the file containing the marker
# (in practice, ext_dir/code.ts). Matches the whole line. The marker is a
# preprocessor directive (textual `#include`-style substitution), NOT an
# ES import — see "Splitting an extension across multiple files" in
# CLAUDE.md for why bundling can't replace this primitive.
INLINE_PATTERN = re.compile(r"^[ \t]*//[ \t]*@inline[ \t]+(\S+)[ \t]*$", re.MULTILINE)
# Bare `// @inline` (no path) is intentionally rejected — explicit paths
# avoid the "dead code in every callback" pitfall when more lib files exist
# than any one callback needs.
BARE_INLINE_PATTERN = re.compile(r"^[ \t]*//[ \t]*@inline[ \t]*$", re.MULTILINE)

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


# --- @inline validation helpers --------------------------------------------

# Top-level runtime declarations in a lib file. Anchored at column 0 so we
# don't pick up local `const`/`let` declarations inside method bodies as if
# they were exported helpers. Restricted to `class` and `function` for the
# same reason — top-level `const x = ...` is allowed in lib files but harder
# to disambiguate from local consts safely without a real parser, and our
# convention is "lib files declare classes and helper functions, period."
# `type`/`interface` vanish at runtime so they don't need inlining; skipped.
LIB_DECL_PATTERN = re.compile(
    r"^(?:export[ \t]+)?(?:abstract[ \t]+)?(?:class|function)[ \t]+(\w+)",
    re.MULTILINE,
)


def _strip_strings_and_comments(text: str) -> str:
    """Blank out string literals and comments so identifier scans don't trip
    on a class name mentioned in a docstring, log message, or regex.

    Implemented as a tiny state machine because regexes can't disambiguate
    context-sensitive tokens — e.g. a literal `/*` inside a line comment
    (a file path like `internal/plugin/ui/*.go`) would otherwise start a
    spurious block comment that swallows hundreds of lines until the next
    `*/`. Newlines and total length are preserved so positions/line numbers
    stay aligned with the original text. Template-literal interpolations
    (`${...}`) are stripped along with their surrounding string — referring
    to a lib class from inside a template is vanishingly rare and not worth
    the complexity of nested parsing.
    """
    out = list(text)
    n = len(text)
    i = 0
    while i < n:
        c = text[i]
        # Line comment — blank until newline, preserve the newline itself.
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = i
            while j < n and text[j] != "\n":
                out[j] = " "
                j += 1
            i = j
            continue
        # Block comment — blank everything except newlines so line offsets stay.
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            out[i] = out[i + 1] = " "
            j = i + 2
            while j + 1 < n and not (text[j] == "*" and text[j + 1] == "/"):
                if text[j] != "\n":
                    out[j] = " "
                j += 1
            if j + 1 < n:
                out[j] = out[j + 1] = " "
                i = j + 2
            else:
                i = n
            continue
        # String literals (single + double). Newlines inside are illegal in
        # standard JS, so we stop at \n to be safe.
        if c in ('"', "'"):
            quote = c
            j = i + 1
            while j < n and text[j] != quote and text[j] != "\n":
                if text[j] == "\\" and j + 1 < n:
                    out[j] = out[j + 1] = " "
                    j += 2
                else:
                    out[j] = " "
                    j += 1
            i = j + 1 if j < n and text[j] == quote else j
            continue
        # Template literals — can span multiple lines; preserve only newlines.
        if c == "`":
            j = i + 1
            while j < n and text[j] != "`":
                if text[j] == "\\" and j + 1 < n:
                    if text[j] != "\n":
                        out[j] = " "
                    if text[j + 1] != "\n":
                        out[j + 1] = " "
                    j += 2
                else:
                    if text[j] != "\n":
                        out[j] = " "
                    j += 1
            i = j + 1 if j < n else j
            continue
        i += 1
    return "".join(out)


def _find_matching_brace(text: str, open_pos: int) -> int:
    """Returns the position of the `}` matching `text[open_pos]` == `{`,
    respecting strings and comments."""
    assert text[open_pos] == "{"
    depth = 1
    i = open_pos + 1
    n = len(text)
    while i < n:
        c = text[i]
        if c == "/" and i + 1 < n:
            if text[i + 1] == "/":
                nl = text.find("\n", i)
                i = n if nl == -1 else nl + 1
                continue
            if text[i + 1] == "*":
                end = text.find("*/", i + 2)
                i = n if end == -1 else end + 2
                continue
        if c in ('"', "'", "`"):
            quote = c
            i += 1
            while i < n and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError(f"unmatched `{{` at offset {open_pos}")


def _enclosing_blocks(text: str, pos: int) -> list[tuple[int, int]]:
    """Returns [(open_pos, close_pos)] for each `{...}` enclosing `pos`,
    innermost first. Skips comments and strings while walking."""
    starts: list[int] = []
    i = 0
    n = len(text)
    while i < pos:
        c = text[i]
        if c == "/" and i + 1 < n:
            if text[i + 1] == "/":
                nl = text.find("\n", i)
                i = n if nl == -1 else nl + 1
                continue
            if text[i + 1] == "*":
                end = text.find("*/", i + 2)
                i = n if end == -1 else end + 2
                continue
        if c in ('"', "'", "`"):
            quote = c
            i += 1
            while i < pos and text[i] != quote:
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c == "{":
            starts.append(i)
        elif c == "}":
            if starts:
                starts.pop()
        i += 1

    result: list[tuple[int, int]] = []
    for s in starts:
        try:
            result.append((s, _find_matching_brace(text, s)))
        except ValueError:
            continue
    result.sort(key=lambda p: -p[0])  # innermost first
    return result


def _scan_lib_decls(lib_dir: Path) -> dict[str, Path]:
    """Returns {decl_name: resolved_lib_path} for every top-level runtime
    declaration in lib/*.ts. Errors on cross-file name collisions."""
    decls: dict[str, Path] = {}
    for lib_ts in sorted(lib_dir.glob("*.ts")):
        text = _strip_strings_and_comments(lib_ts.read_text())
        for match in LIB_DECL_PATTERN.finditer(text):
            name = match.group(1)
            resolved = lib_ts.resolve()
            if name in decls and decls[name] != resolved:
                raise SystemExit(
                    f"lib decl name collision: {name!r} declared in "
                    f"{decls[name]} and {resolved}"
                )
            decls[name] = resolved
    return decls


def _validate_inline_usage(code_text: str, ext_dir: Path, code_ts: Path) -> None:
    """Two checks per build:

    1. **Missing inline** — any reference to a `lib/*.ts` declaration must
       sit inside a function body that has the corresponding `// @inline`
       marker. Otherwise seanime's `.toString() + eval` recompilation would
       hit a `ReferenceError` at runtime.
    2. **Unused inline** — every `// @inline` marker's lib file must
       contribute at least one referenced declaration to the enclosing body.
       Discourages dead code in isolated runtimes; if a marker is dead, the
       lib file probably should be split.

    Both classes of error were observed empirically against this very plugin
    before the validator existed; the messages name the lib file so the fix
    is mechanical.
    """
    lib_dir = ext_dir / "lib"
    if not lib_dir.is_dir():
        return
    lib_decls = _scan_lib_decls(lib_dir)
    if not lib_decls:
        return
    ext_root = ext_dir.resolve()

    # Gather every @inline marker with its position + resolved lib path.
    markers: list[tuple[int, Path, str]] = []  # (pos, resolved, rel_path)
    for m in INLINE_PATTERN.finditer(code_text):
        rel_path = m.group(1).strip()
        resolved = (ext_dir / rel_path).resolve()
        markers.append((m.start(), resolved, rel_path))

    clean = _strip_strings_and_comments(code_text)

    # --- Check 1: missing inline ---
    # For each lib-decl reference, walk enclosing braces outward and verify
    # one of them contains a marker for the corresponding lib file.
    for name, lib_file in lib_decls.items():
        for usage in re.finditer(rf"\b{re.escape(name)}\b", clean):
            pos = usage.start()
            blocks = _enclosing_blocks(code_text, pos)
            covered = False
            for (b_start, b_end) in blocks:
                for (mark_pos, mark_resolved, _) in markers:
                    if b_start < mark_pos < b_end and mark_resolved == lib_file:
                        covered = True
                        break
                if covered:
                    break
            if not covered:
                line_no = code_text[:pos].count("\n") + 1
                rel_lib = lib_file.relative_to(ext_root).as_posix()
                raise SystemExit(
                    f"{code_ts}:{line_no}: `{name}` is declared in `{rel_lib}` and "
                    f"used here, but no enclosing function body has "
                    f"`// @inline ./{rel_lib}`. seanime recompiles isolated-runtime "
                    f"callbacks via `.toString() + eval` — the reference would be "
                    f"unresolved at runtime. Add the marker inside the relevant "
                    f"outer callback body ($ui.register / $app.on* / named function "
                    f"passed to those)."
                )

    # --- Check 2: unused inline ---
    # For each marker, identify the enclosing body, and verify at least one
    # of the lib file's top-level decls is referenced inside that body. A
    # dead marker means either the body changed (forgot to remove the marker)
    # or the lib file mixes unrelated decls (should be split).
    decls_by_lib: dict[Path, list[str]] = {}
    for n, f in lib_decls.items():
        decls_by_lib.setdefault(f, []).append(n)

    for (mark_pos, mark_resolved, rel_path) in markers:
        # Find the marker's immediate enclosing block (the body it's in).
        enclosing = _enclosing_blocks(code_text, mark_pos)
        if not enclosing:
            line_no = code_text[:mark_pos].count("\n") + 1
            raise SystemExit(
                f"{code_ts}:{line_no}: `// @inline {rel_path}` sits outside any "
                f"function body — it must be placed inside the callback whose "
                f"runtime needs the lib."
            )
        b_start, b_end = enclosing[0]  # innermost
        body_clean = clean[b_start:b_end + 1]
        decls = decls_by_lib.get(mark_resolved, [])
        used = [n for n in decls if re.search(rf"\b{re.escape(n)}\b", body_clean)]
        if not used:
            line_no = code_text[:mark_pos].count("\n") + 1
            rel_lib = mark_resolved.relative_to(ext_root).as_posix()
            raise SystemExit(
                f"{code_ts}:{line_no}: `// @inline {rel_path}` injects {rel_lib} "
                f"but its declarations ({', '.join(decls) or '(none)'}) aren't "
                f"referenced in this body — dead code. Remove the marker, or "
                f"narrow the lib file so it only contains helpers actually used "
                f"by this callback."
            )


def _substitute_inline(code_text: str, ext_dir: Path, code_ts: Path) -> str:
    """Replace every `// @inline <path>` line with the file's content
    (minus triple-slash references). Paths are relative to code.ts and must
    stay inside `ext_dir`. Fails fast with a clear message on missing files
    or path escapes."""
    ext_root = ext_dir.resolve()

    def replace(match: re.Match) -> str:
        rel_path = match.group(1).strip()
        target = (ext_dir / rel_path).resolve()
        try:
            target.relative_to(ext_root)
        except ValueError:
            raise SystemExit(
                f"{code_ts}: @inline path {rel_path!r} escapes the extension folder"
            )
        if not target.is_file():
            raise SystemExit(
                f"{code_ts}: @inline path not found: {rel_path!r} (resolved to {target})"
            )
        return "\n".join(
            line
            for line in target.read_text().splitlines()
            if not line.strip().startswith("///")
        )

    return INLINE_PATTERN.sub(replace, code_text)


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

    # `// @inline <path>` marker substitution + validation. Each occurrence
    # in code.ts is replaced with the referenced file's contents (sans
    # triple-slash references — they're TS-only). The path is relative to
    # code.ts and must stay inside the extension folder.
    #
    # Why: hooks AND $ui.register callbacks are serialized via `.toString()`
    # and re-eval'd in a fresh goja runtime that has no view of module scope.
    # Any helper class they need must physically live inside the callback's
    # own body. The marker keeps the source DRY — declare the helper once in
    # lib/, point each isolated-runtime callback at exactly the file(s) it
    # needs (granular: callbacks only pay for what they reference).
    #
    # `lib/*.ts` files are NOT concatenated at module scope — at runtime they
    # only appear where explicitly injected. TypeScript still sees them via
    # the project `include` glob so the IDE can resolve cross-file types.
    code_text = code_ts.read_text()
    bare = BARE_INLINE_PATTERN.search(code_text)
    if bare:
        raise SystemExit(
            f"{code_ts}: bare `// @inline` is not supported — "
            f"specify a path: `// @inline ./lib/<file>.ts` "
            f"(found on line {code_text[:bare.start()].count(chr(10)) + 1})"
        )
    _validate_inline_usage(code_text, ext_dir, code_ts)
    code_text = _substitute_inline(code_text, ext_dir, code_ts)

    js = transpile(code_text)

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
