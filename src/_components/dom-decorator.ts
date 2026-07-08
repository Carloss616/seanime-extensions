// Reusable, battle-tested harness for injecting custom UI onto seanime's own
// pages via `ctx.dom` — the hard parts distilled from manga-source-updates so a
// plugin declares WHAT to inject and the harness handles every runtime trap:
//
//   1. Mutation-loop safety via a per-node signature (no infinite re-fire).
//   2. Self-healing against duplicates (exactly one correctly-signed node wins).
//   3. A per-target in-flight lock so concurrent triggers can't double-inject.
//   4. `el.query(sel)[0]` + `el.append()` only (denshi's `queryOne`/`appendChild`
//      reject silently — see CLAUDE.md "DOM injection onto seanime pages").
//   5. Restartable observers + explicit query passes + re-arm on nav / reload,
//      because seanime tears down the plugin DOM context on every navigation and
//      `observe` alone misses already-mounted nodes and in-place windowing.
//
// Everything runs in the single `$ui.register` runtime (the harness is imported
// into a `modules/*.ts` and inlined at build time, like the other _components),
// so the callbacks close over plugin state safely — no per-callback
// serialization applies. It does NOT register `ctx.screen.onNavigate` for you:
// plugins usually already have one, so call `.arm()` from inside it (SPA
// navigation does not fire `onMainTabReady`).

// Pure decision at the heart of the loop/duplicate guard: given the signatures
// of the markers currently present in the scope and the desired signature,
// decide whether the DOM is already correct ("skip") or must be rebuilt.
// Rebuild covers none, a stale sig, AND duplicates (length !== 1) — which is why
// a plain `innerHTML.includes(sig)` guard is wrong: it lets a raced duplicate
// stick forever. Exported for unit testing.
export function decideDecoration(
  existingSigs: string[],
  desiredSig: string,
): "skip" | "rebuild" {
  return existingSigs.length === 1 && existingSigs[0] === desiredSig
    ? "skip"
    : "rebuild";
}

export interface DecorateOptions {
  // data-attribute base, e.g. "msu-card-badge" → the node carries
  // `data-msu-card-badge` + `data-msu-card-badge-sig`.
  marker: string;
  // Stable identifier of the logical target (a mediaId for per-card badges, a
  // constant like "bar" for a singleton) — used for the in-flight lock.
  lockKey: string;
  // Desired signature encoding the node's content. Same sig on a re-fire = no-op.
  // For "nothing visible", pass a sig for the empty state and render a hidden
  // marker so the target isn't re-processed every pass.
  sig: string;
  // Where to search for existing markers (defaults to `el`). Pass the observed
  // container when the injected node is a sibling of an anchor inside it.
  scope?: $ui.DOMElement;
  // Style / fill / PLACE the freshly-created, already-marked node. The harness
  // sets `data-${marker}` and `data-${marker}-sig` before calling this; the
  // callback does the rest (setStyle / setInnerHTML / el.append / anchor.after).
  render: (node: $ui.DOMElement) => void | Promise<void>;
}

export interface DomDecorator {
  // Register a restartable observer (recreated on every `arm()`).
  observe(
    selector: string,
    cb: (els: $ui.DOMElement[]) => void,
    opts?: $ui.DOMQueryElementOptions,
  ): void;
  // Register an explicit query→decorate pass, run on `arm()` and `refresh()`.
  pass(fn: () => void | Promise<void>): void;
  // Re-run the passes (cheap; the sig guard makes it idempotent). Call from a
  // `ctx.effect` on the state your decorations read.
  refresh(): void;
  // Stop + recreate every observer, then refresh. Call from `onNavigate`.
  arm(): void;
  // Idempotent, race-safe, signature-guarded single-element decorate.
  decorate(el: $ui.DOMElement, opts: DecorateOptions): Promise<void>;
  // Wire the shared lifecycle: arm now + on `onMainTabReady` + on `onReady`.
  start(): void;
}

export function createDomDecorator(ctx: $ui.Context): DomDecorator {
  const locks = new Set<string>();
  const observers: {
    selector: string;
    cb: (els: $ui.DOMElement[]) => void;
    opts?: $ui.DOMQueryElementOptions;
  }[] = [];
  const passes: Array<() => void | Promise<void>> = [];
  let stops: Array<() => void> = [];

  function observe(
    selector: string,
    cb: (els: $ui.DOMElement[]) => void,
    opts?: $ui.DOMQueryElementOptions,
  ): void {
    observers.push({ selector, cb, opts });
  }

  function pass(fn: () => void | Promise<void>): void {
    passes.push(fn);
  }

  function refresh(): void {
    for (const p of passes) void p();
  }

  function arm(): void {
    for (const s of stops) {
      try {
        s();
      } catch {
        /* already stopped */
      }
    }
    stops = [];
    for (const { selector, cb, opts } of observers) {
      const [stop] = ctx.dom.observe(selector, cb, opts);
      stops.push(stop);
    }
    refresh();
  }

  async function decorate(
    el: $ui.DOMElement,
    o: DecorateOptions,
  ): Promise<void> {
    const lk = `${o.marker}:${o.lockKey}`;
    if (locks.has(lk)) return; // another pass is decorating this target
    locks.add(lk);
    try {
      const scope = o.scope ?? el;
      const sigAttr = `data-${o.marker}-sig`;
      let existing: $ui.DOMElement[] = [];
      try {
        existing = (await scope.query(`[data-${o.marker}]`)) ?? [];
      } catch {
        existing = [];
      }
      const sigs: string[] = [];
      for (const x of existing) {
        sigs.push(String((await x.getAttribute(sigAttr)) ?? ""));
      }
      if (decideDecoration(sigs, o.sig) === "skip") return;
      for (const x of existing) {
        try {
          x.remove();
        } catch {
          /* already gone */
        }
      }
      const node = await ctx.dom.createElement("div");
      node.setAttribute(`data-${o.marker}`, "1");
      node.setAttribute(sigAttr, o.sig);
      await o.render(node);
    } catch {
      /* injection failed for this target — the next pass retries */
    } finally {
      locks.delete(lk);
    }
  }

  function start(): void {
    arm();
    ctx.dom.onMainTabReady(arm);
    ctx.dom.onReady(arm);
  }

  return { observe, pass, refresh, arm, decorate, start };
}
