import { describe, expect, test } from "bun:test";
import { isManualMatchConfirmDialog, mappingSigFromHtml } from "./manual-match";

const MAPPED_PANEL = `<div class="UI-AppLayoutStack__root relative space-y-4"><p>Current mapping: <span>lector_omnisciente_1699214996766</span></p><button>Remove mapping</button></div>`;

describe("mappingSigFromHtml", () => {
  test("mapped panel returns provider-local id", () => {
    expect(mappingSigFromHtml(MAPPED_PANEL)).toBe(
      "lector_omnisciente_1699214996766",
    );
  });

  test("no manual match", () => {
    expect(mappingSigFromHtml("<p>No manual match</p>")).toBe("none");
    expect(
      mappingSigFromHtml(
        '<p class="text-[--muted] italic">No manual match</p>',
      ),
    ).toBe("none");
  });

  test("loading / unknown body", () => {
    expect(mappingSigFromHtml("<div>Scanning…</div>")).toBeNull();
  });
});

describe("isManualMatchConfirmDialog", () => {
  test("nested confirm", () => {
    expect(
      isManualMatchConfirmDialog(
        "<p>Are you sure you want to match this manga to the search result?</p>",
      ),
    ).toBe(true);
  });

  test("main panel with mapping is not confirm", () => {
    expect(isManualMatchConfirmDialog(MAPPED_PANEL)).toBe(false);
  });
});
