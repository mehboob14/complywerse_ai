// What the shell's icon rail lists and which entry it lights, as pure decisions (`node --test src/components/shell/railModel.test.ts`).
// The entries are the person's menu (navAccess.visibleNav) and the lit one is navActive's: the rail decides nothing about rights or paths itself.
import type { LucideIcon } from 'lucide-react';
import { flattenLeaves, isGroup, type NavEntry, type NavGroup, type NavItem } from '../layout/navAccess.ts';
import { activeNavHref, groupHasActive } from '../layout/navActive.ts';
import { appPath } from '../layout/headerLinks.ts';
import { fold } from '../../lib/navRegistry.ts';

export interface RailItem {
  /** the entry's own name, for a key */
  key: string;
  /** the full name: the tooltip and the accessible name */
  name: string;
  /** the short name under the icon */
  label: string;
  /** what a screen reader and the tooltip say: the full name when the short one is part of it ("Risk" in "Risk Management"), else both ("Vendors (Third-Party Vendor Risk)"),
   *  so what a person reads or says is always inside the accessible name */
  ariaName: string;
  /** a module opens on its first page the person may open */
  href: string;
  icon: LucideIcon;
  /** 'page': the entry is the page the person is on; 'true': the page is inside this module; none: not here */
  current: 'page' | 'true' | undefined;
}

export interface Rail {
  /** Needs my action: first, with its count, set apart from the modules */
  queue: RailItem | undefined;
  modules: RailItem[];
}

const itemOf = (entry: NavItem | NavGroup, litHref: string | undefined): RailItem => {
  const leaf = !isGroup(entry);
  const first = leaf ? (entry as NavItem).href : flattenLeaves((entry as NavGroup).items)[0].href;
  const label = entry.rail ?? entry.name;
  return {
    key: entry.name,
    name: entry.name,
    label,
    ariaName: fold(entry.name).indexOf(fold(label)) >= 0 ? entry.name : `${label} (${entry.name})`,
    href: first,
    icon: (entry.icon ?? (flattenLeaves(isGroup(entry) ? entry.items : [])[0]?.icon)) as LucideIcon,
    current: leaf ? (litHref === first ? 'page' : undefined) : (groupHasActive(entry as NavGroup, litHref) ? 'true' : undefined),
  };
};

/** The rail of a person's menu: the queue (the entry open to everyone signed in) apart, then every other top-level entry in menu order. */
export function railOf(nav: readonly NavEntry[], litHref: string | undefined): Rail {
  const entries = nav.filter((entry) => isGroup(entry) ? entry.items.length > 0 : true);
  const queue = entries.find((entry): entry is NavItem => !isGroup(entry) && !!entry.signedIn);
  return {
    queue: queue ? itemOf(queue, litHref) : undefined,
    modules: entries.filter((entry) => entry !== queue).map((entry) => itemOf(entry, litHref)),
  };
}

/** The top-level entry that holds a page: the leaf itself or its group (what the panel lists under "In {module}"). undefined when the page has no menu entry. */
export function moduleOf(nav: readonly NavEntry[], litHref: string | undefined): NavItem | NavGroup | undefined {
  if (!litHref) return undefined;
  return nav.find((entry) => (isGroup(entry) ? groupHasActive(entry, litHref) : entry.href === litHref));
}

/** The one menu entry that is lit for a page: its own (navActive), else the entry of the page it was opened from (`?from=`, an in-app path): a reviewer on a document opened from their
 *  queue has no entry for it, and the queue is where they are. Only entries on the person's menu can be lit, so `from` can name nothing they may not open. */
export function litFor(nav: readonly NavEntry[], pathname: string | null | undefined, from?: string | null): string | undefined {
  const own = activeNavHref(pathname, nav as NavEntry[]);
  if (own) return own;
  const origin = appPath(from ?? '');
  return origin ? activeNavHref(origin.split(/[?#]/)[0], nav as NavEntry[]) : undefined;
}
