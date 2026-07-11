import { K_INSTANCE_ID } from "./constants";

// Pure: keep a valid existing id, else mint `${now}-${base36 random}`. `rand` is
// a 0..1 value (Math.random()); we drop the "0." prefix for a compact suffix.
export function deriveInstanceId(
  existing: unknown,
  now: number,
  rand: number,
): string {
  if (typeof existing === "string" && existing.length > 0) return existing;
  const suffix = rand.toString(36).slice(2) || "0";
  return `${now}-${suffix}`;
}

// This machine's id, minted once and persisted. Stored under its own key that is
// NEVER included in the synced gist payload — it identifies who authored a
// manual match so other machines can warn about it.
export function getInstanceId(): string {
  const id = deriveInstanceId(
    $storage.get(K_INSTANCE_ID),
    Date.now(),
    Math.random(),
  );
  $storage.set(K_INSTANCE_ID, id);
  return id;
}
