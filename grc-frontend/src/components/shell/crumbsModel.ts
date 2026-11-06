// The trail in the top bar (breadcrumbs) as pure decisions (`node --test src/components/shell/crumbsModel.test.ts`).
// The trail comes from the navigation registry (the menu groups, the pages a page hangs under, the page itself); this file adds what the registry cannot know:
// which levels THIS person may open (a level they have no door to is named, never linked), the menu groups' first page on THEIR menu, where the page was opened from
// (`?from=`, an in-app path), and the real names of a committee and a meeting where the page knows them. A page that draws its own heading (`ownHeading`) does not repeat
// its name in the bar: its last crumb is hidden unless it carries a switcher.
import { isGroup, type NavAccess, type NavEntry, type NavGroup } from '../layout/navAccess.ts';
import { appPath } from '../layout/headerLinks.ts';
import { breadcrumbFor, ownHeadingSection, routeFor } from '../../lib/navRegistry.ts';
import { litFor, moduleOf } from './railModel.ts';
import { offeredEntry, visibleLeafHrefs } from './shellAccess.ts';

export type CrumbMenu = 'module' | 'committee' | 'meeting';

export interface Crumb {
  label: string;
  /** where it goes; none for the page itself and for a level this person cannot open */
  href?: string;
  /** a chevron next to it opens a list of its siblings */
  menu?: CrumbMenu;
  current?: boolean;
}

export interface Trail {
  crumbs: Crumb[];
  /** the page draws its own heading: the bar keeps the levels above it and not its name (a phone's one-block bar still shows it) */
  hideCurrent: boolean;
}

/** The committee and the meeting a page is about, where the page knows them (the page's own queries; nothing is asked for them here). */
export interface CrumbRecords {
  committee?: { id: number; name?: string | null };
  meeting?: { id: number; number?: string | null; committeeId?: number | null };
}

export interface CrumbInput {
  pathname: string | null | undefined;
  /** the page's `from` parameter */
  from?: string | null;
  nav: readonly NavEntry[];
  access: NavAccess;
  records?: CrumbRecords;
}

const COMMITTEES = '/governance/committees';
const groupsOf = (nav: readonly NavEntry[]): NavGroup[] => nav.flatMap((entry) => (isGroup(entry) ? [entry].concat(groupsOf(entry.items)) : []));
const firstLeafOf = (group: NavGroup): string | undefined => {
  for (const item of group.items) {
    if (!isGroup(item)) return item.href;
    const inner = firstLeafOf(item);
    if (inner) return inner;
  }
  return undefined;
};
const leavesOf = (group: NavGroup): Array<{ label: string; href: string }> => group.items.flatMap((item) => (isGroup(item) ? leavesOf(item) : [{ label: item.name, href: item.href }]));

/** The page the person was opened from, as a crumb: only an in-app path of a page they may open. */
function originOf(from: string | null | undefined, here: string, input: CrumbInput, leaves: ReadonlySet<string>): Crumb | null {
  const path = appPath(from ?? '');
  if (!path || path.split(/[?#]/)[0] === here) return null;
  const entry = routeFor(path);
  if (!entry || !offeredEntry(entry, input.access, leaves)) return null;
  return { label: entry.label, href: path };
}

export function crumbsFor(input: CrumbInput): Trail {
  const { pathname, nav, access, records } = input;
  const route = routeFor(pathname);
  if (!pathname || !route) return { crumbs: [], hideCurrent: false };
  const here = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const leaves = visibleLeafHrefs(nav);
  const groups = groupsOf(nav);
  const own = ownHeadingSection(pathname) !== undefined;

  const trail: Crumb[] = breadcrumbFor(pathname).map((c, i, all) => {
    if (i === all.length - 1) return { label: c.label, current: true };
    const group = groups.find((g) => g.name === c.label);
    if (group) return { label: c.label, href: firstLeafOf(group) };
    const entry = routeFor(c.href);
    return entry && offeredEntry(entry, access, leaves) ? { label: c.label, href: c.href } : { label: c.label };
  });

  // the module's first crumb switches between the module's pages (two or more on this person's menu)
  const module = moduleOf(nav, litFor(nav, pathname, input.from));
  if (module && isGroup(module) && trail.length > 1 && trail[0].label === module.name && leavesOf(module).length > 1) trail[0].menu = 'module';

  const origin = originOf(input.from, here, input, leaves);
  let crumbs = trail;
  if (origin) crumbs = [origin, trail[trail.length - 1]];

  // a committee and a meeting: their real names, and the lists that switch between them
  if (route.path === `${COMMITTEES}/:id`) {
    const last = crumbs[crumbs.length - 1];
    if (records?.committee?.name) last.label = records.committee.name;
    last.menu = 'committee';
  } else if (route.path === `${COMMITTEES}/meetings/:id`) {
    const last = crumbs[crumbs.length - 1];
    const committeeId = records?.meeting?.committeeId ?? records?.committee?.id;
    if (records?.meeting?.number) last.label = `Meeting ${records.meeting.number}`;
    if (committeeId) last.menu = 'meeting';
    if (committeeId && !origin) {
      const parent = routeFor(COMMITTEES);
      const committee: Crumb = { label: records?.committee?.name || 'Committee', menu: 'committee' };
      if (parent && offeredEntry(parent, access, leaves)) committee.href = `${COMMITTEES}/${committeeId}`;
      crumbs = crumbs.slice(0, -1).concat(committee, last);
    }
  }

  const last = crumbs[crumbs.length - 1];
  return { crumbs, hideCurrent: own && !last.menu };
}

/** The pages of a module for the first crumb's switcher: the module's leaves on this person's menu, the lit one marked. */
export function moduleSwitcher(nav: readonly NavEntry[], litHref: string | undefined): Array<{ label: string; href: string; current: boolean }> {
  const module = moduleOf(nav, litHref);
  return module && isGroup(module) ? leavesOf(module).map((leaf) => ({ ...leaf, current: leaf.href === litHref })) : [];
}

/** The one block a phone's bar draws: the way up (the nearest crumb that is a page) over the page itself. */
export function phoneBlock(trail: Trail): { up: Crumb | undefined; here: Crumb | undefined } {
  const crumbs = trail.crumbs;
  const here = crumbs[crumbs.length - 1];
  const up = crumbs.slice(0, -1).reverse().find((c) => !!c.href);
  return { up, here };
}

/** What the bar draws for a long trail: the first level, a "…" that holds the middle ones, and the last two. A trail of `max` levels or fewer is drawn whole. */
export type Shown = { crumb: Crumb } | { folded: Crumb[] };
export function foldTrail(crumbs: readonly Crumb[], max = 4): Shown[] {
  if (crumbs.length <= max) return crumbs.map((crumb) => ({ crumb }));
  return [{ crumb: crumbs[0] }, { folded: crumbs.slice(1, crumbs.length - 2) }, { crumb: crumbs[crumbs.length - 2] }, { crumb: crumbs[crumbs.length - 1] }];
}
