// AniList ↔ MangaUpdates link persistence over $storage.
//
// $storage handles nested values out of the box: set("mu_link_<id>", obj)
// expands each field into its own dotted leaf key (mu_link_<id>.cover, …) and
// get("mu_link_<id>") reconstructs the object. This is the idiomatic seanime
// pattern (see the docs), so we keep storing plain objects.
//
// THE GOTCHA: $storage.keys() returns every leaf key AND the parent node, so a
// naive `indexOf("mu_link_") === 0` enumeration matches the dotted sub-keys
// too — parseInt("159441.cover") === 159441 then yields duplicate rows.
// listMULinkIds() below matches only top-level `mu_link_<digits>` keys, which
// both skips the sub-keys and dedupes them back to the parent id.

import type { MULink } from "./types";

export type { MULink, MUResult } from "./types";

const LINK_PREFIX = "mu_link_";

export function getMULink(mediaId: number | string): MULink | undefined {
  return $storage.get<MULink>(`${LINK_PREFIX}${mediaId}`);
}

export function setMULink(mediaId: number | string, link: MULink): void {
  $storage.set(`${LINK_PREFIX}${mediaId}`, link);
}

// Removing the parent key deletes the whole nested subtree (the docs' own
// cleanup example does exactly this: remove("scan-duration-history")).
export function removeMULink(mediaId: number | string): void {
  $storage.remove(`${LINK_PREFIX}${mediaId}`);
}

// Enumerate the mediaIds of every linked entry. Matches only top-level keys
// (`mu_link_<digits>`, no trailing ".field") — see the nested-key gotcha above.
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
