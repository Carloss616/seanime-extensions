import type { ProbeMap } from "./types";

export function isActiveProvider(
  pid: string,
  installed: Record<string, string>,
): boolean {
  return pid !== "local-manga" && pid in installed;
}

export function pruneInactiveProbes(
  probes: ProbeMap,
  installed: Record<string, string>,
): ProbeMap {
  const out: ProbeMap = {};
  for (const [pid, p] of Object.entries(probes)) {
    if (isActiveProvider(pid, installed)) out[pid] = p;
  }
  return out;
}
