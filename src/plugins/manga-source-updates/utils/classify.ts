import { unreadChapters } from "./chapters";
import type { ResultKind } from "./types";

// Classify a source's result for a manga. `read` is the user's progress; `gap`
// the far-behind threshold. Shared by the scan and the detail probe.
export function classify(
  read: number,
  latest: number,
  count: number,
  errored: boolean,
  gap: number,
): ResultKind {
  if (errored) return "error-found";
  if (count === 0) return "not-matched";
  if (read > 0 && read - latest >= gap) return "outdated";
  return unreadChapters(read, latest) > 0 ? "new" : "up-to-date";
}

// Kinds that mark a source as a bad match for a manga -> auto-exclude.
export function isBadKind(kind: ResultKind): boolean {
  return (
    kind === "not-matched" || kind === "error-found" || kind === "outdated"
  );
}
