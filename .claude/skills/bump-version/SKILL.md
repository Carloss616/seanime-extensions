---
name: bump-version
description: Release every extension whose built code.js changed — bump each version and write the changelog from the diff. Bumps manifest.json + the README version badge, synthesizes a Keep-a-Changelog entry into the extension's CHANGELOG.md (silent bump when the payload changed but behavior didn't), refreshes README feature/config tables and llms-full.txt when features changed, rebuilds, and offers the release commit. A shared _utils/_components fix re-inlines into several extensions' code.js, so it releases them all in one run. Use when the user asks to bump / release / cut a version, publish an update, or update the changelog.
disable-model-invocation: true
---

# Bump an extension's version

Release the extension(s) whose payload actually changed: pick each new version,
write the changelog from the diff, propagate the number + summary to every
surface, rebuild, and offer the commit.

**The trigger is `code.js`, not a folder.** Bump EVERY extension whose built
`code.js` differs from its last release — no more, no less. Usually that's one
extension, but a shared-code fix (`_utils` / `_components`) re-inlines into every
dependent's `code.js`, so one edit legitimately releases several at once. In that
case bump them all in the SAME run (don't ask which, don't defer the rest): the
extension you actually reworked gets a full changelog entry, the ones that only
picked up the re-inlined payload get a silent version bump (step 4). Give each
its own `CHANGELOG.md` entry where warranted, but a single shared fix can share
one commit across the extensions it touches.

## 1. Resolve the extension(s) + their last release

Argument is an extension **id** (the folder name, e.g. `manga-source-updates`) to
scope the run to that one. If none was given, find every extension whose `code.js`
changed (below) and release all of them — an extension has unreleased changes when
its built payload differs from its last release commit.

```bash
MAN=$(ls src/*/<id>/manifest.json)          # e.g. src/plugins/<id>/manifest.json
EXTDIR=$(dirname "$MAN")
CUR=$(grep -m1 '"version"' "$MAN")           # current version
SHA=$(git log -1 --format=%H -- "$MAN")      # last commit that touched the manifest
```

`SHA` is the last release. `ponytail: last manifest commit == last release`
holds because the manifest only changes on a version bump; if you ever touch a
manifest for another reason, verify the version in that commit actually differs.

**The `code.js` diff is the decider — always build first, then bump iff it
changed.** `code.js` is the only thing seanime fetches, so a payload that differs
from its last release MUST be released (even a "defensive" or shared-code-only
change with no behavior difference — that's a silent bump, step 4, not a skip),
and a byte-identical payload (a type-only refactor, a comment/format change) has
nothing to release — do NOT bump it. Never ask the user whether to bump a changed
payload; a changed `code.js` is a release, full stop.

```bash
bun run build >/dev/null 2>&1                     # bring every code.js up to date
# per candidate extension:
git diff "$SHA" -- "$EXTDIR/code.js" | wc -l      # >0 → bump   |   0 → skip
```

This matters most for shared-code (`_utils` / `_components`) churn: it re-inlines
into every dependent extension's `code.js`, so run the diff for EACH dependent and
bump every one whose payload moved — not just the extension you edited.

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

Confirm the build is clean before claiming done. Note `marketplace.json` carries
NO version field (it's not in the build's `MARKETPLACE_FIELDS`), so a version-only
bump leaves it byte-identical — don't expect it in the diff, and never hand-edit
it. It only changes when metadata the marketplace projects (name, description,
icon, …) changed.

## 7. Offer the commit

Show the changelog entry and a one-line summary of touched files, then propose —
and wait for approval before running — a commit in the repo's convention (do not
push, do not add any Claude attribution footer):

```
<type>(<id>): <one-line summary> (vX.Y.Z)
```

`<type>` is `feat` for a minor/major, `fix` for a patch. Stage the source **and**
every rebuilt `code.js` (plus `marketplace.json` if the build changed it). When
one shared-code fix released several extensions, a single commit covering them all
is cleaner than splitting the shared file across commits — list every version in
the subject (e.g. `msu 1.8.3, msync 1.2.3, lcm 2.4.1`).
