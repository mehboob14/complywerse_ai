// Which sidebar entry says "you are here", as one pure decision: `node --test src/components/layout/navActive.test.ts` runs it.
// ONE entry lights across the whole menu, not one per group: the deepest entry whose page the current path is on or under.
// It used to be picked per group by the longest href, so an Overview lit on every page of its area that has no entry of its own,
// and a page whose entry sits in another group (Regulatory Changes, under Compliance) lit two groups.
import { flattenLeaves, type NavEntry, type NavGroup, type NavItem } from './navAccess.ts';

/** `path` without query, hash and trailing slash. */
export function cleanPath(path: string): string {
  const bare = path.split(/[?#]/)[0].replace(/\/+$/, '');
  return bare === '' ? '/' : bare;
}

/** Whether `path` is `prefix` or a page under it, on whole path segments: "/a/b" is under "/a", "/ab" is not. */
export function underPath(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

const depth = (path: string) => path.split('/').filter(Boolean).length;

/** How deep (in path segments) the entry's best match for `path` is; 0: the entry does not light on it. */
function matchDepth(item: NavItem, path: string): number {
  let best = 0;
  const href = cleanPath(item.href);
  if (item.exact ? path === href : underPath(path, href)) best = depth(href);
  const extra = item.activeMatch === undefined ? [] : Array.isArray(item.activeMatch) ? item.activeMatch : [item.activeMatch];
  for (const raw of extra) {
    const prefix = cleanPath(raw);
    if (underPath(path, prefix)) best = Math.max(best, depth(prefix));
  }
  return best;
}

/** The href of the one entry that lights for `pathname` among `entries` (any depth of groups), or undefined when none does.
 *  An entry lights on its href and the pages under it (only on its href with `exact`) and on the prefixes of its `activeMatch`;
 *  the deepest match wins, and on a tie the first in menu order. */
export function activeNavHref(pathname: string | null | undefined, entries: NavEntry[]): string | undefined {
  if (!pathname) return undefined;
  const path = cleanPath(pathname);
  let found: string | undefined;
  let foundDepth = 0;
  for (const leaf of flattenLeaves(entries)) {
    const d = matchDepth(leaf, path);
    if (d > foundDepth) { found = leaf.href; foundDepth = d; }
  }
  return found;
}

/** Whether the lit entry is inside this group (at any depth): the group's title and icon take the "you are here" colour, and it opens. */
export function groupHasActive(group: NavGroup, activeHref: string | undefined): boolean {
  return !!activeHref && flattenLeaves(group.items).some((leaf) => leaf.href === activeHref);
}
