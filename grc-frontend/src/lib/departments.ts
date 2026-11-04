// Administration → Departments: the small rules of the page and of the Department pickers. Pure (no React), so `node --test`
// runs departments.test.ts against it. The department list is the one list every picker reads (documents, sign-off, assets,
// assessments, stage owners, risks); a department's people are those added by hand, its lead and everyone who holds one of its roles.

export type MemberRole = 'lead' | 'member' | 'viewer';
export const MEMBER_ROLES: { value: MemberRole; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'member', label: 'Member' },
  { value: 'viewer', label: 'Viewer' },
];
const ROLE_LABEL: Record<string, string> = { lead: 'Lead', member: 'Member', viewer: 'Viewer' };
export const roleLabel = (role: string | null | undefined): string => ROLE_LABEL[role ?? ''] ?? 'Member';

/** Every cached list that is read from the departments (the pickers of other pages): stale as soon as one is created, renamed,
 *  given other people or switched off. */
export const DEPARTMENT_QUERY_KEYS: readonly (readonly string[])[] = [
  ['admin-departments'], ['org-departments'], ['signoff-targets'], ['teams-for-asset-edit'],
  ['assessment-assignee-teams'], ['stage-owner-teams'], ['risk-modal-teams'],
];

/** Marks every cached list that is read from the departments out of date: call it after any create, edit, switch-off or switch-on,
 *  from Administration or from Governance → Settings, so the document form, the library, the sign-off, asset, assessment, stage-owner
 *  and risk pickers all read the change. (`qc` is the React Query client; typed by the one call it needs.) */
export function refreshDepartments(qc: { invalidateQueries(filters: { queryKey: readonly string[] }): unknown }): void {
  DEPARTMENT_QUERY_KEYS.forEach((queryKey) => qc.invalidateQueries({ queryKey }));
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;

export type PickItem = { value: string; label: string; subLabel?: string };

// ── members ──────────────────────────────────────────────────────────────────

export interface MemberHow {
  /** how the person belongs: 'head' (the lead), 'manual' (added by hand), 'role' (holds one of the department's roles) */
  how: readonly string[];
  member_role?: string | null;
  via_roles?: readonly string[] | null;
}
export type HowChip = { key: string; label: string; kind: 'lead' | 'hand' | 'role' };

/** The chips that say how a person belongs to a department, in the order the server lists them: "Lead", "Added by hand · Member",
 *  "Through role · Compliance Officer" (one for each role). */
export function howChips(m: MemberHow): HowChip[] {
  const out: HowChip[] = [];
  m.how.forEach((how) => {
    if (how === 'head') out.push({ key: 'head', label: 'Lead', kind: 'lead' });
    else if (how === 'manual') out.push({ key: 'manual', label: `Added by hand · ${roleLabel(m.member_role)}`, kind: 'hand' });
    else if (how === 'role') {
      const names = (m.via_roles ?? []).filter(Boolean);
      if (names.length === 0) out.push({ key: 'role', label: 'Through role', kind: 'role' });
      names.forEach((name) => out.push({ key: `role:${name}`, label: `Through role · ${name}`, kind: 'role' }));
    }
  });
  return out;
}

/** Why a person cannot be removed from the members list (null: they were added by hand, so Remove works). Someone who belongs
 *  through a role leaves with the role (or by losing it), the lead by changing the lead under Edit. */
export function removeBlock(m: MemberHow): string | null {
  if (m.how.includes('manual')) return null;
  const roles = (m.via_roles ?? []).filter(Boolean);
  if (roles.length) return `Belongs through the role${roles.length === 1 ? '' : 's'} ${roles.join(', ')}`;
  if (m.how.includes('role')) return 'Belongs through a role';
  return 'Is the lead of this department: change the lead under Edit';
}

/** "5 people · 3 through roles" */
export function memberSummary(members: readonly MemberHow[]): string {
  const through = members.filter((m) => m.how.includes('role')).length;
  return `${people(members.length)} · ${through} through ${through === 1 ? 'a role' : 'roles'}`;
}

// ── lists and options ────────────────────────────────────────────────────────

/** A department's roles as chips: the first `max` names, alphabetically, and how many more there are. */
export function roleChips(roles: readonly { name: string }[] | null | undefined, max = 3): { names: string[]; more: number } {
  const names = (roles ?? []).map((r) => r.name).filter(Boolean).sort(byName);
  return { names: names.slice(0, max), more: Math.max(0, names.length - max) };
}

/** The roles to choose from, with how many people hold each; a role already chosen that is not among them (it may have been
 *  removed since) is kept so it shows, and can be unticked. */
export function roleItems(
  options: readonly { id: number; name: string; user_count: number }[] | null | undefined,
  chosen: readonly { id: number; name: string }[] = [],
): PickItem[] {
  const out: PickItem[] = (options ?? []).map((o) => ({ value: String(o.id), label: o.name, subLabel: people(o.user_count) }));
  chosen.forEach((r) => { if (!out.some((i) => i.value === String(r.id))) out.push({ value: String(r.id), label: r.name }); });
  return out.sort((a, b) => byName(a.label, b.label));
}

/** The people to choose from (lead, new member), by name. */
export function userItems(users: readonly { id: number; display_name: string; email?: string | null }[] | null | undefined): PickItem[] {
  return (users ?? [])
    .map((u) => ({ value: String(u.id), label: u.display_name || u.email || `User ${u.id}`, subLabel: u.email || undefined }))
    .sort((a, b) => byName(a.label, b.label));
}

// ── the tree: three levels, named by the organisation (DECISIONS D57) ────────

/** A department sits under another, this many levels deep at most (the server refuses a fourth: org_departments.MAX_DEPTH). */
export const MAX_DEPTH = 3;
/** What the three levels are called until the organisation names them (GET /admin/departments/levels). */
export const DEFAULT_LEVEL_LABELS: readonly string[] = ['Department', 'Sub-department', 'Unit'];

/** The name of a level (1 = a top department); a level past the third (data older than the limit) is called as the third. */
export function levelLabel(level: number, labels: readonly string[] = DEFAULT_LEVEL_LABELS): string {
  const names = labels.length >= MAX_DEPTH ? labels : DEFAULT_LEVEL_LABELS;
  return names[Math.min(Math.max(level, 1), MAX_DEPTH) - 1];
}

type TreeDepartment = { id: number; name: string; parent_department_id?: number | null };

export interface DepartmentTree<D extends TreeDepartment> {
  /** the parent that counts: none for a top department, and none where the parent is missing, is itself, or closes a loop */
  parentOf(id: number): number | null;
  /** the departments directly under it, A-Z */
  childrenOf(id: number): D[];
  /** 1 for a top department, 2 for one under it, 3 for the deepest (more only in data older than the limit) */
  level(id: number): number;
  /** the department and the ones above it, the top one first */
  path(id: number): D[];
  /** the department and everything under it, however deep */
  subtree(id: number): Set<number>;
  /** how many levels sit under it (0: none) */
  height(id: number): number;
}

/** The departments as a tree, answered from memory. The same reading as the server's (`org_departments.Tree`): a department whose parent
 *  is missing, is itself or closes a loop counts as a top one, so every department has a level and none is lost. */
export function departmentTree<D extends TreeDepartment>(all: readonly D[]): DepartmentTree<D> {
  const rows = new Map<number, D>(all.map((d) => [d.id, d]));
  const parent = new Map<number, number | null>();
  rows.forEach((d, id) => {
    const up = d.parent_department_id ?? null;
    let ok = up != null && rows.has(up) && up !== id;
    const seen = new Set<number>();
    for (let walker = up; ok && walker != null && !seen.has(walker);) {
      if (walker === id) ok = false;                                   // the chain above comes back to this department: a loop
      seen.add(walker);
      walker = rows.get(walker)?.parent_department_id ?? null;
    }
    parent.set(id, ok ? up : null);
  });
  const children = new Map<number, D[]>();
  rows.forEach((d, id) => {
    const up = parent.get(id);
    if (up != null) children.set(up, (children.get(up) ?? []).concat(d));
  });
  children.forEach((list) => list.sort((a, b) => byName(a.name, b.name) || a.id - b.id));
  const level = (id: number): number => { let n = 1; for (let at = parent.get(id); at != null; at = parent.get(at)) n += 1; return n; };
  const height = (id: number): number => { const below = (children.get(id) ?? []).map((c) => height(c.id)); return below.length ? 1 + Math.max(...below) : 0; };
  return {
    parentOf: (id) => parent.get(id) ?? null,
    childrenOf: (id) => children.get(id) ?? [],
    level,
    path: (id) => { const out: D[] = []; for (let at: number | null | undefined = id; at != null && rows.has(at); at = parent.get(at)) out.unshift(rows.get(at)!); return out; },
    subtree: (id) => {
      const out = new Set<number>();
      const todo = [id];
      while (todo.length) { const n = todo.pop()!; if (out.has(n) || !rows.has(n)) continue; out.add(n); (children.get(n) ?? []).forEach((c) => todo.push(c.id)); }
      return out;
    },
    height,
  };
}

/** The departments a department can sit under: not itself, nothing under it (that would make a loop), not one switched off
 *  (unless it is the one it sits under now), and not one so deep that the department, with what is under it, would pass the third
 *  level; by name. */
export function parentChoices<D extends { id: number; name: string; parent_department_id?: number | null; is_active?: boolean }>(
  all: readonly D[],
  selfId: number | null,
  currentParentId: number | null,
): D[] {
  const tree = departmentTree(all);
  const below = selfId != null ? tree.subtree(selfId) : new Set<number>();
  const own = selfId != null ? tree.height(selfId) : 0;
  return all
    .filter((d) => !below.has(d.id) && (d.id === currentParentId || (d.is_active !== false && tree.level(d.id) + 1 + own <= MAX_DEPTH)))
    .sort((a, b) => byName(a.name, b.name));
}

/** The departments as a table lists them: the top ones A-Z, each followed by the ones under it A-Z (and theirs, one step further in:
 *  `depth`). A department whose parent is not in the list, or that is its own parent, is listed at the top; if some are left that
 *  way (a loop that the server would not allow, but old data may hold) they are listed too, so no row is ever lost. */
export function departmentRows<D extends { id: number; name: string; parent_department_id?: number | null }>(
  all: readonly D[],
): { department: D; depth: number }[] {
  const ids = new Set(all.map((d) => d.id));
  const under = new Map<number, D[]>();
  const top: D[] = [];
  all.forEach((d) => {
    const parent = d.parent_department_id;
    if (parent != null && parent !== d.id && ids.has(parent)) under.set(parent, (under.get(parent) ?? []).concat(d));
    else top.push(d);
  });
  const out: { department: D; depth: number }[] = [];
  const listed = new Set<number>();
  const walk = (level: readonly D[], depth: number) => {
    level.slice().sort((a, b) => byName(a.name, b.name) || a.id - b.id).forEach((d) => {
      if (listed.has(d.id)) return;
      listed.add(d.id);
      out.push({ department: d, depth });
      walk(under.get(d.id) ?? [], depth + 1);
    });
  };
  walk(top, 0);
  walk(all.filter((d) => !listed.has(d.id)), 0);
  return out;
}

/** What a picker lists for a department field: every department in tree order (the top ones A-Z, each followed by what is under it),
 *  named by its whole path ("Operations › Support") so two units of the same name can be told apart, with its level under the name
 *  ("Sub-department"). A department switched off is left out unless it is one of `keep` (the one a document already sits in; it is
 *  then marked "(inactive)") or `withInactive` is set. */
export function departmentPickItems<D extends TreeDepartment & { is_active?: boolean }>(
  all: readonly D[],
  opts: { labels?: readonly string[]; keep?: readonly (number | null | undefined)[]; withInactive?: boolean } = {},
): PickItem[] {
  const tree = departmentTree(all);
  const keep = new Set((opts.keep ?? []).filter((id): id is number => id != null));
  return departmentRows(all)
    .filter(({ department: d }) => d.is_active !== false || opts.withInactive || keep.has(d.id))
    .map(({ department: d }) => ({
      value: String(d.id),
      label: tree.path(d.id).map((p) => p.name).join(' › ') + (d.is_active === false ? ' (inactive)' : ''),
      subLabel: levelLabel(tree.level(d.id), opts.labels),
    }));
}

/** The department and everything under it: what filtering by a department means (a document in a unit is in its department too). */
export function descendantIds(all: readonly TreeDepartment[], id: number): Set<number> {
  return departmentTree(all).subtree(id);
}

/** The Documents cell: the number, and the words for a tooltip or a screen reader ("12 documents", "No documents"). */
export function documentsLabel(count: number | null | undefined): { text: string; long: string } {
  const n = typeof count === 'number' && count > 0 ? Math.floor(count) : 0;
  return { text: String(n), long: n === 0 ? 'No documents' : `${n} ${n === 1 ? 'document' : 'documents'}` };
}

/** The facts line of the Departments section: "6 departments · 1 inactive". */
export function departmentsSummary(all: readonly { is_active?: boolean }[]): string {
  const off = all.filter((d) => d.is_active === false).length;
  return `${all.length} ${all.length === 1 ? 'department' : 'departments'}${off ? ` · ${off} inactive` : ''}`;
}

// ── the form ─────────────────────────────────────────────────────────────────

/** The fields a person fills in. There is no code: the server makes one from the name (initials, a number added when taken) and an
 *  edit leaves it alone, so nobody is asked for an identifier. */
export interface DepartmentForm {
  name: string;
  description: string;
  parentId: number | null;
  leadId: number | null;
  roleIds: number[];
  active: boolean;
}
interface DepartmentRecord {
  name: string;
  code?: string | null;
  description?: string | null;
  parent_department_id?: number | null;
  department_head_user_id?: number | null;
  is_active: boolean;
  roles: readonly { id: number }[];
}

const sameIds = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((id) => b.includes(id));

/** The PATCH body for an edit: only what the person changed (a cleared description is sent as '', a cleared lead or parent as
 *  null, which is how the server clears them). Empty: nothing to save. */
export function departmentPatch(d: DepartmentRecord, f: DepartmentForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const name = f.name.trim();
  const description = f.description.trim();
  if (name !== d.name) out.name = name;
  if (description !== (d.description ?? '')) out.description = description;
  if (f.parentId !== (d.parent_department_id ?? null)) out.parent_department_id = f.parentId;
  if (f.leadId !== (d.department_head_user_id ?? null)) out.department_head_user_id = f.leadId;
  if (f.active !== d.is_active) out.is_active = f.active;
  if (!sameIds(f.roleIds, d.roles.map((r) => r.id))) out.role_ids = f.roleIds;
  return out;
}

/** The POST body for a new department: the name, and only what was filled in. */
export function departmentCreateBody(f: DepartmentForm): Record<string, unknown> {
  const out: Record<string, unknown> = { name: f.name.trim() };
  if (f.description.trim()) out.description = f.description.trim();
  if (f.parentId != null) out.parent_department_id = f.parentId;
  if (f.leadId != null) out.department_head_user_id = f.leadId;
  if (f.roleIds.length) out.role_ids = f.roleIds;
  return out;
}

/** Whether closing the form would throw something away: typed into a new department, or any field changed from the department being edited
 *  (the same comparison the save makes, so "nothing to save" and "nothing to lose" are one answer). Drives the drawer's "Discard changes?". */
export function departmentFormDirty(mode: 'create' | 'edit', department: DepartmentRecord | undefined, f: DepartmentForm): boolean {
  if (mode === 'edit' && department) return Object.keys(departmentPatch(department, f)).length > 0;
  return f.name.trim() !== '' || f.description.trim() !== '' || f.parentId != null || f.leadId != null || f.roleIds.length > 0;
}

// ── the Department pickers of other pages ────────────────────────────────────

/** What the Department field of a document says when there is nothing to pick (not while it has options). */
export function departmentPlaceholder(s: { loading?: boolean; failed?: boolean; count: number }): string {
  if (s.failed) return "Couldn't load departments";
  if (s.loading) return 'Loading departments…';
  if (s.count === 0) return 'No departments yet — an administrator adds them in Administration → Departments';
  return 'Choose a department';
}

// ── switching one off and on (Administration and Governance → Settings say the same words) ───────────────────

/** What the confirm dialog says switching a department off does. There is no delete: documents and assignments point at it. */
export const DEACTIVATE_NOTE =
  'It stops appearing in the lists people pick a department from. Documents that are already in it keep it, and you can activate it again at any time.';
export const deactivatedText = (name: string) => `${name} is deactivated. Documents already in it keep it.`;
export const activatedText = (name: string) => `${name} is active again.`;
