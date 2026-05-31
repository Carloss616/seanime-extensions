import { describe, expect, test } from "bun:test";
import { STATUS_INTENT, statusToPill } from "./anilist-status.ts";

describe("statusToPill", () => {
  test("returns undefined when there is no status", () => {
    expect(statusToPill(undefined)).toBeUndefined();
    expect(statusToPill("" as $app.AL_MediaStatus)).toBeUndefined();
  });

  test("humanizes the label (underscores → spaces, lowercased)", () => {
    expect(statusToPill("RELEASING")?.label).toBe("releasing");
    expect(statusToPill("NOT_YET_RELEASED")?.label).toBe("not yet released");
  });

  test("maps known statuses to their palette intent", () => {
    expect(statusToPill("RELEASING")?.intent).toBe("success");
    expect(statusToPill("FINISHED")?.intent).toBe("info");
    expect(statusToPill("HIATUS")?.intent).toBe("warning");
    expect(statusToPill("CANCELLED")?.intent).toBe("alert");
    expect(statusToPill("NOT_YET_RELEASED")?.intent).toBe("gray");
  });

  test("falls back to gray for an unknown status", () => {
    expect(statusToPill("WHATEVER" as $app.AL_MediaStatus)?.intent).toBe(
      "gray",
    );
    expect(STATUS_INTENT.RELEASING).toBe("success");
  });
});
