import { unreadChapters } from "./chapters";
import type { AutoBadKind, ResultKind } from "./types";

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

// Kinds that mark a source as a bad match for a manga -> auto-exclude. A type
// predicate (not just boolean) so a caller narrows `kind` to AutoBadKind —
// which is assignable to ExcludeReason when auto-excluding.
export function isBadKind(kind: ResultKind): kind is AutoBadKind {
  return (
    kind === "not-matched" || kind === "error-found" || kind === "outdated"
  );
}

// seanime's getChapterContainer THROWS both when a provider searched fine but
// found no matching series ("not found") AND on a genuine fetch failure
// (network / HTTP / parse). The message is the only signal that tells them
// apart — without it every no-match reads as "error". A match here means "no
// series found" (→ treat as no-match, matched:false), anything else is a real
// error.
// SPIKE: exact strings unconfirmed against a live seanime run — readContainer
// console.warns unmatched (treated-as-error) messages so this pattern can be
// widened from real output.
const NO_MATCH_RX =
  /no results|not found|no chapters|no manga|could ?n'?o?t find|not matched|no search result|0 result/i;

export function isNoMatchError(message: string): boolean {
  return NO_MATCH_RX.test(String(message));
}
