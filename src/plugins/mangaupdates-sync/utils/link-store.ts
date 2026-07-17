// AniList ↔ MangaUpdates link persistence over $storage. $storage.set("mu_link_<id>",
// obj) expands each field into its own dotted leaf key (mu_link_<id>.cover, …) and
// get() reconstructs the object.
//
// THE GOTCHA: $storage.keys() returns every leaf key AND the parent node, so a
// naive `indexOf("mu_link_") === 0` enumeration matches the dotted sub-keys too —
// parseInt("159441.cover") === 159441 then yields duplicate rows. listMULinkIds()
// matches only top-level `mu_link_<digits>` keys, both skipping the sub-keys and
// deduping them back to the parent id.

import type { MULink } from "./types";

export type { MULink, MUResult } from "./types";

const LINK_PREFIX = "mu_link_";

export function getMULink(mediaId: number | string): MULink | undefined {
  return $storage.get<MULink>(`${LINK_PREFIX}${mediaId}`);
}

export function setMULink(mediaId: number | string, link: MULink): void {
  $storage.set(`${LINK_PREFIX}${mediaId}`, link);
}

// Removing the parent key deletes the whole nested subtree.
export function removeMULink(mediaId: number | string): void {
  $storage.remove(`${LINK_PREFIX}${mediaId}`);
}

export function listMULinkIds(): number[] {
  const seen: Record<string, boolean> = {};
  const ids: number[] = [];
  for (const k of $storage.keys()) {
    if (k.indexOf(LINK_PREFIX) !== 0) continue;
    const rest = k.slice(LINK_PREFIX.length);
    if (!/^\d+$/.test(rest)) continue;
    if (seen[rest]) continue;
    seen[rest] = true;
    ids.push(parseInt(rest, 10));
  }
  return ids;
}
