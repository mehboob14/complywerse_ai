// What the palette, the crumbs and the Work and context panel may offer a person, as pure decisions (`node --test src/components/shell/shellAccess.test.ts`).
// navAccess.ts stays the one source of who is offered what: a destination is offered when, for a page that hangs under a menu entry, that entry is on THEIR menu
// (so a module whose door is shut for them offers none of its pages, a client feature the tenant lacks offers none, and a department owner's door reaches exactly
// what `ownerDoor` opens), AND the registry's rights cover them (administrators: always). Nothing here grants, widens or enforces a right; it only decides what is shown.
import { flattenLeaves, holds, navigation, type NavAccess, type NavEntry } from '../layout/navAccess.ts';
import { routeFor, sidebarLeafOf, tabsFor, type RouteEntry, type TabEntry } from '../../lib/navRegistry.ts';

/** The hrefs of the menu leaves this person sees (the rail, the drawer and the panel are drawn from the same tree). */
export function visibleLeafHrefs(nav: readonly NavEntry[]): Set<string> {
  return new Set(flattenLeaves(nav as NavEntry[]).map((leaf) => leaf.href));
}

/** The sidebar leaves that are a door for the owner of a department (navAccess `ownerDoor`): the Overview and the Documents area. */
const DOORS: ReadonlySet<string> = new Set(flattenLeaves(navigation).filter((leaf) => leaf.ownerDoor).map((leaf) => leaf.href));

/** Whether the person is offered this registry destination. `leaves`: visibleLeafHrefs of their menu. */
export function offeredEntry(entry: RouteEntry, access: NavAccess, leaves: ReadonlySet<string>): boolean {
  if (!access.signedIn) return false;
  if (entry.adminOnly) return access.isAdmin;
  const leaf = sidebarLeafOf(entry);
  if (leaf && !leaves.has(leaf.path)) return false;
  if (access.isAdmin || entry.permissions === null) return true;
  if (access.headsDepartment && (entry.tab?.ownerDoor || DOORS.has(entry.path))) return true;           // the owner of a department: the Overview and the library are theirs to read (D59)
  return entry.permissions.some((permission) => holds(access.permissions, permission));
}

/** Whether the person may use Comply Agent (the page's own right, /complychat in navAccess PAGE_PERMISSIONS): the top bar's question box, the icon and the palette's "Ask" all ask this. */
export function mayAskComplyAgent(access: NavAccess, leaves: ReadonlySet<string>): boolean {
  const entry = routeFor('/complychat');
  return !!entry && offeredEntry(entry, access, leaves);
}

/** The Documents strip this person has: all of it with a governance right, the tabs made for them (the library, whose Folders layout is where the owner manages their units) as the owner of a department who holds none,
 *  nothing otherwise. The same rule the top bar's strip has always followed; the panel lists the same tabs. `studio`: the Comply AI Studio is on for the tenant. */
export function documentsStrip(access: NavAccess, studio: boolean): TabEntry[] {
  const can = (permission: string) => access.isAdmin || holds(access.permissions, permission);
  if (can('governance:policies:*')) return tabsFor('documents', { studio, can });
  return access.headsDepartment ? tabsFor('documents', { studio, can, ownerOnly: true }) : [];
}
