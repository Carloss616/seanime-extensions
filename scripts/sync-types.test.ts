import { describe, expect, test } from "bun:test";
import {
  filterTypePaths,
  flattenTargets,
  transformSource,
} from "./sync-types.ts";

describe("filterTypePaths", () => {
  test("keeps only .d.ts under extension_repo, sorted", () => {
    const input = [
      "internal/extension_repo/goja_plugin_types/core.d.ts",
      "internal/extension_repo/goja_plugin_types/app.d.ts",
      "internal/extension_repo/foo.go",
      "internal/other/bar.d.ts",
      "README.md",
    ];
    expect(filterTypePaths(input)).toEqual([
      "internal/extension_repo/goja_plugin_types/app.d.ts",
      "internal/extension_repo/goja_plugin_types/core.d.ts",
    ]);
  });

  test("drops ignored paths", () => {
    const input = [
      "internal/extension_repo/a.d.ts",
      "internal/extension_repo/b.d.ts",
    ];
    expect(filterTypePaths(input, ["internal/extension_repo/b.d.ts"])).toEqual([
      "internal/extension_repo/a.d.ts",
    ]);
  });
});

describe("flattenTargets", () => {
  test("maps each path to its basename", () => {
    const m = flattenTargets([
      "internal/extension_repo/goja_plugin_types/core.d.ts",
      "internal/extension_repo/goja_usermedia_test/custom-source.d.ts",
    ]);
    expect(m.get("internal/extension_repo/goja_plugin_types/core.d.ts")).toBe(
      "core.d.ts",
    );
    expect(
      m.get("internal/extension_repo/goja_usermedia_test/custom-source.d.ts"),
    ).toBe("custom-source.d.ts");
  });

  test("throws on basename collision", () => {
    expect(() =>
      flattenTargets([
        "internal/extension_repo/a/core.d.ts",
        "internal/extension_repo/b/core.d.ts",
      ]),
    ).toThrow(/collision/i);
  });
});

describe("transformSource", () => {
  test("strips /// <reference> lines", () => {
    const input = `/// <reference path="../goja_plugin_types/app.d.ts" />\ndeclare type X = number\n`;
    const out = transformSource(input, "abc1234");
    expect(out).not.toContain("<reference");
    expect(out).toContain("declare type X = number");
  });

  test("prepends an AUTO-SYNCED header with the short sha", () => {
    const out = transformSource("declare const y: number\n", "abc1234");
    expect(out.startsWith("// AUTO-SYNCED from 5rahim/seanime@abc1234")).toBe(
      true,
    );
  });

  test("preserves non-reference content verbatim after the header", () => {
    const body = "interface Foo {\n  a: number\n}\n";
    const out = transformSource(body, "deadbee");
    expect(out.endsWith(body)).toBe(true);
  });
});
