// Prepends the owning extension's manifest id (e.g. "[mangaupdates-sync]") to
// every call and forwards to `console` — works in both plugin and custom-source
// runtimes (the latter has no `$debug`). The prefix comes from `__MANIFEST_ID__`,
// a bundle-time literal injected per extension by scripts/build.ts.
export function createLogger(): Console {
  const prefix = `[${__MANIFEST_ID__}]`;
  return {
    log: (...args) => console.log(prefix, ...args),
    info: (...args) => console.info(prefix, ...args),
    warn: (...args) => console.warn(prefix, ...args),
    error: (...args) => console.error(prefix, ...args),
    debug: (...args) => console.debug(prefix, ...args),
  };
}
