// Administration > Roles & permissions: the permission matrix and the role form, as decisions apart from React so `node --test` can pin them (rolesModel.test.ts).
// Relative imports only.
//
// WHAT A ROLE HOLDS, EXACTLY: a role is a list of permission names ("governance:documents:view"). The catalogue (`GET /admin/permissions/matrix`: 19 modules, 311 names)
// is what the editor draws; the server stores any `a:b:c` it is sent and does not check it against the catalogue (G12 G-4). So a role can hold names the catalogue does
// not list (an older name, a name from another build). The editor never drops them: they are kept in `held`, counted apart ("outside the list"), shown, and sent back on
// save. Nothing here changes what a permission means or who may do what.
// THE ADMINISTRATOR ROLE: the platform bypasses the per-permission checks for the role named exactly "Administrator" (auth_router.is_tenant_admin); it stores no
// permission rows, so it used to read "0 permission(s) selected". It is shown as Full access and cannot be changed (the server refuses too).
import { flattenLeaves, isGroup, navigation, visibleNav, type NavAccess, type NavEntry } from '../../components/layout/navAccess.ts';
import { sortRows, type SortState } from '../../components/ui/ds/tableModel.ts';

// ── the shapes the server sends ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface RoleRecord {
  id: number;
  name: string;
  description: string | null;
  is_system_role: boolean;
  user_count: number;
  permissions: string[];
  created_at?: string | null;
}

export interface CatalogueSub { name: string; display_name: string; actions: string[] }
export interface CatalogueModule { module: string; display_name: string; submodules: CatalogueSub[] }

export const ADMINISTRATOR = 'Administrator';
export const isFullAccess = (role: Pick<RoleRecord, 'name'>): boolean => role.name === ADMINISTRATOR;

// ── names and words ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const permName = (module: string, sub: string, action: string): string => `${module}:${sub}:${action}`;

/** The four columns of the grid; every other action of a row goes in "Other". */
export const GRID_ACTIONS = ['view', 'create', 'edit', 'delete'] as const;
const WORDS: Record<string, string> = { approve_ciso: 'Approve (CISO)', accept_risk: 'Accept risk', view_all: 'View all', send_back: 'Send back' };

/** "send_back" -> "Send back". */
export function actionLabel(action: string): string {
  if (WORDS[action]) return WORDS[action];
  const words = action.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : action;
}

export const otherActions = (sub: CatalogueSub): string[] => sub.actions.filter((a) => (GRID_ACTIONS as readonly string[]).indexOf(a) < 0);

// ── the catalogue ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function namesOfSub(module: string, sub: CatalogueSub): string[] {
  return sub.actions.map((a) => permName(module, sub.name, a));
}

export function namesOfModule(m: CatalogueModule): string[] {
  const names: string[] = [];
  m.submodules.forEach((s) => names.push(...namesOfSub(m.module, s)));
  return names;
}

export function catalogueNames(matrix: readonly CatalogueModule[]): string[] {
  const names: string[] = [];
  matrix.forEach((m) => names.push(...namesOfModule(m)));
  return names;
}

/** Names a role holds that the catalogue does not list, in the order the role holds them. */
export function outsideNames(matrix: readonly CatalogueModule[], held: readonly string[]): string[] {
  const known = new Set(catalogueNames(matrix));
  return held.filter((name, i) => !known.has(name) && held.indexOf(name) === i);
}

export interface Tally { granted: number; total: number; state: 'none' | 'some' | 'all' }

/** How many of `names` are held. */
export function tally(names: readonly string[], held: ReadonlySet<string>): Tally {
  const granted = names.filter((n) => held.has(n)).length;
  return { granted, total: names.length, state: granted === 0 ? 'none' : granted === names.length ? 'all' : 'some' };
}

// ── changing what is held ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** `held` with `names` all on or all off. Order is kept (new names go last); nothing outside `names` is touched. */
export function setNames(held: readonly string[], names: readonly string[], on: boolean): string[] {
  if (on) {
    const have = new Set(held);
    return held.concat(names.filter((n, i) => !have.has(n) && names.indexOf(n) === i));
  }
  const drop = new Set(names);
  return held.filter((n) => !drop.has(n));
}

/** The names of one column across a module (all the "View" boxes), for a header tick. */
export function columnNames(m: CatalogueModule, action: string): string[] {
  const names: string[] = [];
  m.submodules.forEach((s) => { if (s.actions.indexOf(action) >= 0) names.push(permName(m.module, s.name, action)); });
  return names;
}

// ── searching the grid ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MatrixFilter { q: string; grantedOnly: boolean }
export const NO_MATRIX_FILTER: MatrixFilter = { q: '', grantedOnly: false };

/** The catalogue narrowed to what matches: a sub-module row stays when its name, its module's name, one of its actions or one of its full names matches the words
 *  (every word must match somewhere), and, with "Granted only", when it holds at least one name. A module with no row left disappears. */
export function filterMatrix(matrix: readonly CatalogueModule[], filter: MatrixFilter, held: ReadonlySet<string>): CatalogueModule[] {
  const words = filter.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const out: CatalogueModule[] = [];
  matrix.forEach((m) => {
    const submodules = m.submodules.filter((s) => {
      if (filter.grantedOnly && !namesOfSub(m.module, s).some((n) => held.has(n))) return false;
      if (words.length === 0) return true;
      const haystack = [m.display_name, m.module, s.display_name, s.name].concat(s.actions, s.actions.map(actionLabel), namesOfSub(m.module, s)).join(' ').toLowerCase();
      return words.every((w) => haystack.indexOf(w) >= 0);
    });
    if (submodules.length > 0) out.push({ ...m, submodules });
  });
  return out;
}

// ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RoleForm { name: string; description: string; held: string[] }

export const blankRole = (): RoleForm => ({ name: '', description: '', held: [] });
export const formOfRole = (role: Pick<RoleRecord, 'name' | 'description' | 'permissions'>): RoleForm => ({ name: role.name, description: role.description ?? '', held: role.permissions.slice() });

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.indexOf(x) >= 0);

export function diffHeld(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: after.filter((n, i) => !b.has(n) && after.indexOf(n) === i), removed: before.filter((n, i) => !a.has(n) && before.indexOf(n) === i) };
}

export const MAX_ROLE_NAME = 100;                    // grc_roles.name is VARCHAR(100)

export function roleErrors(form: RoleForm): Partial<Record<'name', string>> {
  const name = form.name.trim();
  if (name === '') return { name: 'Give the role a name.' };
  if (name.length > MAX_ROLE_NAME) return { name: `Use ${MAX_ROLE_NAME} characters or fewer.` };
  return {};
}

export function isRoleDirty(saved: RoleForm, form: RoleForm): boolean {
  return saved.name.trim() !== form.name.trim() || saved.description.trim() !== form.description.trim() || !sameSet(saved.held, form.held);
}

/** PUT /admin/roles/{id}: only what changed. The permission list, when it changed, is the WHOLE list including the names outside the catalogue (the server replaces it). */
export function updateRoleBody(saved: RoleForm, form: RoleForm): { name?: string; description?: string; permission_names?: string[] } {
  const body: { name?: string; description?: string; permission_names?: string[] } = {};
  if (saved.name.trim() !== form.name.trim()) body.name = form.name.trim();
  if (saved.description.trim() !== form.description.trim()) body.description = form.description.trim();
  if (!sameSet(saved.held, form.held)) body.permission_names = form.held.slice();
  return body;
}

export const createRoleBody = (form: RoleForm): { name: string; description: string; permission_names: string[] } => ({
  name: form.name.trim(), description: form.description.trim(), permission_names: form.held.slice(),
});

// ── words about a change ────────────────────────────────────────────────────────────────────────────────────────────────────────
const plural = (n: number, one: string, other: string): string => `${n} ${n === 1 ? one : other}`;

/** "Adds 3 permissions, removes 1" (nothing when nothing changed). */
export function changeLine(diff: { added: readonly string[]; removed: readonly string[] }): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`adds ${plural(diff.added.length, 'permission', 'permissions')}`);
  if (diff.removed.length) parts.push(`removes ${plural(diff.removed.length, 'permission', 'permissions')}`);
  return parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : '';
}

/** What saving does to people. The server reads a role's permissions on every request, so the change counts at once; a person's menu is read at sign-in
 *  (the page keeps it for the session: G12 G-10), so it catches up then. Nothing for a role nobody holds. */
export function impactLine(userCount: number, changesPermissions: boolean): string {
  if (!changesPermissions || userCount <= 0) return '';
  return `${plural(userCount, 'person holds', 'people hold')} this role. The change counts for ${userCount === 1 ? 'them' : 'them all'} at once; menus catch up the next time they sign in.`;
}

/** The "Permissions" cell of the register. */
export function permissionSummary(role: RoleRecord, matrix: readonly CatalogueModule[] | null): string {
  if (isFullAccess(role)) return 'Full access';
  if (!matrix) return plural(role.permissions.length, 'permission', 'permissions');
  const known = new Set(catalogueNames(matrix));
  const inList = role.permissions.filter((n) => known.has(n)).length;
  return `${inList} of ${known.size}`;
}

/** Why a role cannot be deleted, or null (the server refuses the same cases and says so too). */
export function deleteBlock(role: RoleRecord): string | null {
  if (role.is_system_role) return "A system role can't be deleted.";
  if (role.user_count > 0) return `${plural(role.user_count, 'person holds', 'people hold')} this role. Take it off them first.`;
  return null;
}

export const deleteRoleText = (name: string) => ({
  title: `Delete the role "${name}"?`,
  message: 'Nobody holds it. The role and its permission list are removed and this cannot be undone.',
  confirmLabel: 'Delete role',
});

// ── the list ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const ROLE_SORT_KEYS = ['name', 'people', 'permissions'] as const;
export const DEFAULT_ROLE_SORT: SortState = { key: 'name', dir: 'asc' };

export function filterRoles(roles: readonly RoleRecord[], q: string): RoleRecord[] {
  const words = q.trim().toLowerCase();
  return words ? roles.filter((r) => r.name.toLowerCase().includes(words) || (r.description ?? '').toLowerCase().includes(words)) : roles.slice();
}

export function sortRoles(roles: readonly RoleRecord[], sort: SortState): RoleRecord[] {
  return sortRows(roles, sort, (r, key) => (key === 'people' ? r.user_count : key === 'permissions' ? r.permissions.length : r.name.toLowerCase()));
}

// ── the menu this role sees ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MenuGroup { label: string; names: string[] }

/** What the sidebar shows a person who holds exactly `held` (and nothing else) in a tenant that has `features`: the same rule the sidebar uses (navAccess.visibleNav).
 *  Administration is the sidebar's own pinned menu and is not part of this list. The Administrator role sees all of it. */
export function menuPreview(held: readonly string[], role: Pick<RoleRecord, 'name'>, features: readonly string[]): MenuGroup[] {
  const permissions = held.map((p) => p.trim()).filter(Boolean);
  const access: NavAccess = {
    isAdmin: isFullAccess(role),
    permissions,
    modules: Array.from(new Set(permissions.map((p) => p.split(':')[0]).filter(Boolean))),
    features: features.slice(),
    headsDepartment: false,
    signedIn: true,
  };
  const shown: NavEntry[] = visibleNav(navigation, access);
  return shown.map((entry) => (isGroup(entry)
    ? { label: entry.name, names: flattenLeaves(entry.items).map((leaf) => leaf.name) }
    : { label: entry.name, names: [entry.name] }));
}
