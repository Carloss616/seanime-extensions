---
name: prune-comments
description: Audit and prune code comments across the repo's TypeScript files — remove outdated, deprecated, and redundant comments while keeping and improving only the ones that earn their place. Use whenever the user asks to clean up / review / prune / tidy comments, says comments are stale or noisy, or wants comment hygiene on *.ts files. Applies this repo's fixed KEEP/REMOVE rubric and its goja-runtime + build-pipeline constraints, dispatches parallel agents over disjoint file groups for large scope, and verifies centrally with build + typecheck + test.
disable-model-invocation: true
---

# Prune comments

Goal: **aggressively** cut comment noise. The default action on any comment is
**delete it**. A comment survives only if it earns its place by documenting
something a competent reader — or Claude in a future session — genuinely could
not infer from the code itself. Comment density in this repo is far too high:
every session accretes narration, restatement, and step-by-step play-by-play,
and almost none of it earns its keep. The comments that DO earn their place are
nearly all goja runtime traps, build-pipeline constraints, encoding/bit math,
and seanime-internal behavior. Everything else goes. Comments are edited;
**code is never touched**.

**The litmus test — apply to every comment.** Ask: *would a competent engineer,
or Claude reading only this code in a future session, be surprised or make a
wrong change without this note?* If **no** → delete it. "Hard to write" is not
"hard to read": a comment narrating clever logic that is now plainly visible in
the code still goes. The bar is not "is this true / nice to know" — it is "is
this load-bearing." Most comments fail it.

**Local warning vs. general lesson — the single biggest source of retained
noise.** A comment earns *inline* placement only if it explains why **this
specific line** does something surprising. A comment that teaches how the
runtime / build / architecture works *in general* — the kind of thing true of
every extension in the repo — is **documentation, not a code comment**: it
belongs in CLAUDE.md, not copied above each `init()`, `shared-lib.ts`, or hook.
The tell is a multi-line essay atop a file restating a rule CLAUDE.md already
states ("callbacks run in separate goja runtimes, so must be self-contained…",
"`$shared.define` must come before any hook…", "the build self-containerizes
this file…"). **Cut it, or reduce it to a one-line pointer** (`// $shared
factory (see CLAUDE.md "$shared")`). The trap is kept *where it bites*, not
*where it is lectured*.

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

**REMOVE** (the default — when in doubt, remove) a comment when it:
- Explains **what** the code does rather than **why** (`// loop over items`, `// return result`, `// set the flag`, `// constructor`). If the code already says it, the comment is noise.
- Restates a descriptive identifier or type (`// the gist client` above `const gistClient = …`).
- Narrates steps a reader follows straight from the code (`// Step 1: fetch`, `// now build the map`, `// finally, render`) — the play-by-play sessions accrete.
- Is a banner / decoration / section divider that just labels the obvious (`// ---- helpers ----`, `// STATE`, `// === render ===`).
- Is outdated/deprecated: refers to code, params, paths, UI fields, or behavior that no longer exist.
- Is commented-out dead code.
- Is obvious JSDoc: `@param name The name` on a `name: string`, or a one-line `/** The X. */` that just echoes the function name. Strip the boilerplate.
- Restates a **repo-wide convention already documented in CLAUDE.md** as a general lesson rather than a site-local warning — the goja isolation / `$shared` / build-pipeline rules spelled out as a multi-line essay atop a `code.ts` / `shared-lib.ts` / hook. The rule lives in CLAUDE.md; an inline copy at each call site is noise. Cut it, or reduce to a one-line pointer (`see CLAUDE.md "$shared"`). See "Local warning vs. general lesson" above.

**KEEP** (rare — the comment must justify its own existence against the litmus test) only when it:
- Explains a non-obvious **why** a competent reader could NOT reconstruct from the code: a design decision, tradeoff, ordering constraint, or workaround.
- Warns of a gotcha, edge case, or invariant the code alone does not reveal and that getting wrong would break something.
- Documents a goja-runtime trap, build-pipeline constraint, encoding/bit math, or seanime-internal behavior **as a pointed, site-local warning** — right where the code does the non-obvious thing (the `String()` coercion before *this* `===`, the `$storage` mirror for *this* state). A *general* explanation of how the runtime works is NOT this — that belongs in CLAUDE.md, so REMOVE it (see the REMOVE list and "Local warning vs. general lesson").
- Is a `SPIKE:` marker (flags a value inferred from reverse-engineering) — never remove.
- Is a `ponytail:` marker (names a deliberate simplification or a known ceiling + upgrade path) — never remove.
- Is JSDoc on an exported helper whose description carries a real non-obvious fact — keep only that fact, drop the rest.

**IMPROVE** kept comments: make them accurate to the current code, concise, and
matching the surrounding tone. Fix any that are now wrong — these audits reliably
surface *incorrect* comments (stale paths, params that changed, truncated JSDoc,
fragments spliced in from another function). Correcting those is as valuable as
removing noise.

When uncertain whether a comment is doc-worthy, **remove it** — that is the whole
point of this pass. The one exception is a genuine trap in the high-value category
(a real goja / build-pipeline / encoding warning): there, keep a tightened version,
because the cost of deleting a real warning outweighs a terse note and the user
reviews everything in `git diff`. That safety valve is for **traps, not explanatory
prose** — do not use it to rationalize keeping narration.

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
   truth for all of these. **Keep them as terse, site-local warnings — right
   where the trap bites.** When the SAME fact instead appears as a multi-line
   architecture essay in a `code.ts` / `shared-lib.ts` header (re-teaching a rule
   CLAUDE.md already documents), that copy is noise: cut it to a one-line pointer.
   The rule: the trap is kept where it bites, not where it is lectured.

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
