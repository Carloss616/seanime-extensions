---
name: bump-version
description: Release one extension — bump its version and write the changelog everywhere from the diff. Bumps manifest.json + the README version badge, synthesizes a Keep-a-Changelog entry into the extension's CHANGELOG.md, refreshes its README feature/config tables and llms-full.txt entry when features changed, rebuilds (code.js + marketplace.json), and offers the release commit. Use when the user asks to bump / release / cut a version, publish an update, or update the changelog for an extension.
disable-model-invocation: true
---

# Bump an extension's version

Release **one** extension: pick the new version, write the changelog from the
diff, propagate the number + summary to every surface, rebuild, and offer the
commit. Run it again for the next extension — one changelog and one commit per
extension keeps history clean.

## 1. Resolve the extension + its last release

Argument is the extension **id** (the folder name, e.g. `manga-source-updates`).
If none was given, list the extensions with unreleased changes and ask which —
an extension has unreleased changes when `git diff` / new files exist under its
dir since its last release commit (below). Never bump more than one per run.

```bash
MAN=$(ls src/*/<id>/manifest.json)          # e.g. src/plugins/<id>/manifest.json
EXTDIR=$(dirname "$MAN")
CUR=$(grep -m1 '"version"' "$MAN")           # current version
SHA=$(git log -1 --format=%H -- "$MAN")      # last commit that touched the manifest
```

`SHA` is the last release. `ponytail: last manifest commit == last release`
holds because the manifest only changes on a version bump; if you ever touch a
manifest for another reason, verify the version in that commit actually differs.

**Skip an extension whose built `code.js` is unchanged.** `code.js` is the only
thing seanime fetches, so a source diff that produces a byte-identical payload
(a type-only refactor, a comment/format change) has nothing to release — do NOT
bump it. Confirm against a fresh build before deciding:

```bash
bun run build >/dev/null 2>&1                     # bring code.js up to date
git diff "$SHA" -- "$EXTDIR/code.js" | wc -l      # 0 → payload unchanged → skip
```

This matters most for shared-code (`_utils` / `_components`) churn: it re-inlines
into every dependent extension's `code.js`, so check each candidate's payload
rather than assuming the source diff means a real release.

## 2. Read the change set to summarize

Everything under the extension dir since the last release — **tracked** changes
(committed + uncommitted) and **new** files, excluding the built `code.js`
(that's build output, not a change to describe):

```bash
git diff "$SHA" -- "$EXTDIR" ':(exclude)'"$EXTDIR"'/code.js'   # tracked
git ls-files --others --exclude-standard -- "$EXTDIR"          # untracked → Read each
```

Also glance at any `src/_utils/*` / `src/_components/*` the extension imports if
they changed alongside — a shared-code change can be the real feature. Read the
current `README.md`, `CHANGELOG.md` (if present), and the extension's section in
`llms-full.txt` so you know what prose already exists.

## 3. Decide the new version (semver)

Bump level from the argument (`major` / `minor` / `patch`), else infer from the
diff and state your reasoning:

- **major** — a breaking change (config field removed/renamed, behavior users
  relied on removed). Rare; when unsure, ask.
- **minor** — a new feature / capability. **Default** — the repo's history is
  almost entirely `feat` minor bumps.
- **patch** — fixes / internal-only changes, no new user-facing capability.

## 4. Write the changelog entry

**Skip the changelog entirely when the release has no user-facing change.** An
internal-only bump — a refactor, type-only changes, shared-code churn that just
re-inlines into `code.js` with no behavior difference — still bumps the version
+ README badge + `llms-full.txt` tag, but adds **NO** `CHANGELOG.md` entry and no
version-tagged llms bullet. Only write an entry when a user would notice it: a
new/changed/removed capability or a fixed bug. Litmus test — if you can't phrase
a bullet as what the user *sees or does differently*, there's no entry to write.
(When bumping several extensions in one pass, this is per-extension: the one you
actually reworked gets a full entry; the ones that only picked up a shared-code
refactor get a silent version bump.)

Otherwise, prepend a block to the extension's **`CHANGELOG.md`** (create it with
a `# Changelog` + Keep-a-Changelog preamble on the first bump). Use today's date
(`date +%F`) and only the categories that apply, bullets synthesized from the
diff — describe *user-facing* behavior, not file moves:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added
- New capability, in one line.

### Changed
- Behavior that changed.

### Removed
- What was taken out.

### Fixed
- Bug that was fixed.
```

## 5. Propagate to every surface

| Surface | Edit |
|---|---|
| `manifest.json` | `"version"` → `X.Y.Z` |
| `README.md` (per-ext) | version badge `version-X.Y.Z-...`; feature / config tables **only if the diff changed features or `userConfig.fields`** |
| `CHANGELOG.md` (per-ext) | the entry from step 4 — **omit for an internal-only bump** (no user-facing change) |
| `llms-full.txt` | the extension's `(<type>, vX.Y.Z)` heading → new version; add/adjust a version-tagged bullet **only if a notable feature changed** |
| `llms.txt` | the "N extensions" count / summary — **only when adding a brand-new extension** (not a normal bump) |
| `code.js`, `marketplace.json` | **do not hand-edit** — regenerated by the build in step 6 |

Match README badges and llms `(v…)` tags exactly to the manifest — the repo
treats badge/llms drift from the manifest as a bug.

## 6. Rebuild + verify

```bash
bun run build       # re-emits code.js, regenerates marketplace.json, runs check:fix
bun run typecheck
bun run test        # if any shared _utils/_components or utils/ logic changed
```

Confirm `marketplace.json` now shows the new version and the build is clean
before claiming done. Never hand-edit `marketplace.json`.

## 7. Offer the commit

Show the changelog entry and a one-line summary of touched files, then propose —
and wait for approval before running — a commit in the repo's convention (do not
push, do not add any Claude attribution footer):

```
<type>(<id>): <one-line summary> (vX.Y.Z)
```

`<type>` is `feat` for a minor/major, `fix` for a patch. Stage the source **and**
the built `code.js` + `marketplace.json`.
