---
name: prune-comments
description: Audit and prune code comments across the repo's TypeScript files — remove outdated, deprecated, and redundant comments while keeping and improving only the ones that earn their place. Use whenever the user asks to clean up / review / prune / tidy comments, says comments are stale or noisy, or wants comment hygiene on *.ts files. Applies this repo's fixed KEEP/REMOVE rubric and its goja-runtime + build-pipeline constraints, dispatches parallel agents over disjoint file groups for large scope, and verifies centrally with build + typecheck + test.
disable-model-invocation: true
---

# Prune comments

Goal: cut comment noise (restatement, stale/deprecated notes, dead code) while
preserving — and tightening — the comments that document *non-obvious* things a
reader genuinely cannot infer from the code. In this repo that is mostly goja
runtime traps, build-pipeline constraints, encoding math, and seanime-internal
behavior. Comments are edited; **code is never touched**.

## 1. Decide scope

Default to the scope the user names. If unspecified, ask once: **whole repo** or
**only changed files** (`git diff --name-only HEAD` + untracked, filtered to
`*.ts`). Comment hygiene on a PR usually means "the files I touched."

## 2. Survey volume — decide inline vs parallel

List the in-scope `*.ts` files and a rough comment count per file:

```bash
for f in $(find src -name '*.ts' | sort); do
  c=$(grep -cE '(^|[^:])//|/\*|^\s*\*' "$f"); [ "$c" -gt 0 ] && printf "%4d  %s\n" "$c" "$f"
done
```

- **Small scope** (≲10 files or ≲150 comment lines): do it yourself, file by file.
  You keep full control of consistency.
- **Large scope**: dispatch parallel agents (next section). One agent per
  *disjoint* set of files so they never edit the same file.

## 3. Parallel dispatch (large scope)

Group files into balanced, disjoint sets and give every agent the **identical
rubric** below so judgment stays consistent. Grouping heuristics:

- Give the **one or two files with by far the most comments their own agent**
  (in this repo the `modules/register.ts` files dwarf everything else).
- Group the rest by area/extension into sets of ~6–10 files.
- Tests can be one agent — their comments are lighter and describe intent.
- **Never** split one file across two agents, and assign each file exactly once.

Dispatch all agents in a single message so they run concurrently
(`superpowers:dispatching-parallel-agents` covers the discipline). Each agent
prompt = the **scope (explicit file list)** + the **rubric** + the **hard
constraints** verbatim. Tell each agent: edit comments only, do not run the
build/tests (you verify centrally), and return a per-file summary of
removed/improved/kept plus any judgment calls.

## The rubric (the heart — paste into every agent)

**REMOVE** a comment when it:
- Restates what the code already says (`// loop over items`, `// return result`, `// constructor`).
- Is outdated/deprecated: refers to code, params, paths, UI fields, or behavior that no longer exist.
- Is commented-out dead code.
- Is a banner/decoration or a divider that just labels the obvious.
- Duplicates information already obvious from a descriptive identifier or type.

**KEEP** (and improve for accuracy/concision) a comment when it:
- Explains a non-obvious **why** — a design decision, tradeoff, ordering constraint, or workaround.
- Documents a gotcha, edge case, or invariant a reader could not infer from the code.
- Documents a goja-runtime trap, the build pipeline's constraints, encoding/bit math, or seanime-internal behavior (see constraints below).
- Is a `SPIKE:` marker (flags a value inferred from reverse-engineering) — never remove.
- Is genuinely useful JSDoc on an exported helper. Trim redundant JSDoc, keep the meaningful description.

**IMPROVE** kept comments: make them accurate to the current code, concise, and
matching the surrounding tone. Fix any that are now wrong — these audits reliably
surface *incorrect* comments (stale paths, params that changed, truncated JSDoc,
fragments spliced in from another function). Correcting those is as valuable as
removing noise.

When uncertain whether a comment is doc-worthy, lean toward **keeping** a tightened
version — the cost of deleting a real warning is higher than the cost of a slightly
verbose note, and the user reviews everything in `git diff`.

## Hard constraints (paste into every agent)

1. **Comments only.** Do not change code, identifiers, string literals, logic, or
   code formatting. Do not reorder code.
2. **Never touch functional/directive comments**: `/// <reference ... />`,
   `// biome-ignore ...`, `// @ts-ignore` / `// @ts-expect-error`, or any
   lint/compiler control comment. These are code, not documentation.
3. **The `modules/*.ts` "export" rule.** The build (`scripts/build.ts`,
   isolate-modules plugin) splits each `modules/*.ts` file on the literal
   substring `export`, expecting exactly one occurrence (the real `export`
   statement). A comment in a `modules/*.ts` file that contains the word `export`
   adds a second occurrence and **breaks the build**. So: in any file under a
   `modules/` directory, a comment must never contain that substring — rephrase
   with a synonym (dump / surface / output / emit). If you find an existing
   `modules/*.ts` comment that contains it, fixing it is required, not optional.
   (Files outside `modules/` — including `_components/` and `_utils/`, which get
   inlined into modules — are NOT subject to this: Bun.build strips their comments
   before the split, verified empirically. Only a `modules/*.ts` file's *own*
   comments matter.)
4. **goja traps worth keeping** (don't strip these — they're the highest-value
   comments in the repo): awaitable-but-not-`.then()`-able Go-bound returns;
   `String()`/`Number()` coercion before `===` across the goja↔Go boundary; the
   `$shared.define`/`use` self-contained-factory + runtime-local re-eval rule;
   helpers must live inside a serialized callback's own body; `event.next()` must
   be called on every hook path; `$sleep(0)` as the only yield primitive;
   `res.json()`/`res.text()` being synchronous; the `declare` class-field emit
   gotcha; the custom-source mediaId encode/decode arithmetic and the
   `ext_custom_source_<id>|END|<url>` siteUrl prefix. CLAUDE.md is the source of
   truth for all of these.

## 4. Verify centrally (always, after all edits land)

Never trust the agents' self-reports for the build constraint — check it:

```bash
# Every modules/*.ts must contain exactly ONE "export" (the real statement).
for f in $(find src -path '*/modules/*.ts' ! -name '*.test.ts'); do
  n=$(grep -o "export" "$f" | wc -l | tr -d ' '); [ "$n" -ne 1 ] && echo "BAD($n): $f"
done

bun run build       # the real test of the export-split constraint; also regenerates marketplace.json + code.js
bun run typecheck
bun run test
```

If a `modules/*.ts` shows a count ≠ 1, find the stray occurrence
(`grep -n export <file>`) and rephrase that comment before building. Report the
final result honestly (counts of removed/improved, any comments corrected, and
that build/typecheck/test pass). Note that the build regenerates `code.js` and
`marketplace.json`, so the working-tree diff will include those generated files
alongside the source `*.ts` changes.
