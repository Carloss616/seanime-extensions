import { afterEach, describe, expect, test } from "bun:test";

// createLogger derives its prefix from `__MANIFEST_ID__`, a bundle-time literal
// injected by scripts/build.ts. Under `bun test` there is no bundler/define, so
// we stand the global up ourselves before importing the module under test.
const MANIFEST_ID = "test-ext";
(globalThis as unknown as { __MANIFEST_ID__: string }).__MANIFEST_ID__ =
  MANIFEST_ID;
const PREFIX = `[${MANIFEST_ID}]`;

const { createLogger } = await import("./logger.ts");

type Call = [string, unknown[]];

function fakeConsole() {
  const calls: Record<string, Call[]> = {
    log: [],
    info: [],
    warn: [],
    error: [],
    debug: [],
  };
  const make =
    (level: string) =>
    (...args: unknown[]) =>
      calls[level].push([level, args]);
  return {
    sink: {
      log: make("log"),
      info: make("info"),
      warn: make("warn"),
      error: make("error"),
      debug: make("debug"),
    },
    calls,
  };
}

const g = globalThis as unknown as { console: Console };
const realConsole = g.console;

afterEach(() => {
  g.console = realConsole;
});

describe("createLogger", () => {
  test("prepends the prefix and routes to console", () => {
    const fake = fakeConsole();
    g.console = fake.sink as unknown as Console;

    const log = createLogger();
    log.warn("boom", 42);

    expect(fake.calls.warn).toEqual([["warn", [PREFIX, "boom", 42]]]);
  });

  test("prepends the prefix on every level", () => {
    const fake = fakeConsole();
    g.console = fake.sink as unknown as Console;

    const log = createLogger();
    log.log("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    log.debug("e");

    expect(fake.calls.log).toEqual([["log", [PREFIX, "a"]]]);
    expect(fake.calls.info).toEqual([["info", [PREFIX, "b"]]]);
    expect(fake.calls.warn).toEqual([["warn", [PREFIX, "c"]]]);
    expect(fake.calls.error).toEqual([["error", [PREFIX, "d"]]]);
    expect(fake.calls.debug).toEqual([["debug", [PREFIX, "e"]]]);
  });

  test("resolves the console at call time", () => {
    const first = fakeConsole();
    g.console = first.sink as unknown as Console;

    const log = createLogger();
    // Console swapped out after the logger was created.
    const second = fakeConsole();
    g.console = second.sink as unknown as Console;

    log.info("hi");

    expect(second.calls.info).toEqual([["info", [PREFIX, "hi"]]]);
    expect(first.calls.info).toEqual([]);
  });
});
