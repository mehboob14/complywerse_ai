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

/** The departments a department can sit under: not itself, nothing under it (that would make a loop), not one switched off
 *  (unless it is the one it sits under now), by name. */
export function parentChoices<D extends { id: number; name: string; parent_department_id?: number | null; is_active?: boolean }>(
  all: readonly D[],
  selfId: number | null,
  currentParentId: number | null,
): D[] {
  const below = new Set<number>();
  if (selfId != null) {
    below.add(selfId);
    for (let grew = true; grew;) {
      grew = false;
      all.forEach((d) => {
        if (d.parent_department_id != null && below.has(d.parent_department_id) && !below.has(d.id)) { below.add(d.id); grew = true; }
      });
    }
  }
  return all.filter((d) => !below.has(d.id) && (d.is_active !== false || d.id === currentParentId)).sort((a, b) => byName(a.name, b.name));
}

// ── the form ─────────────────────────────────────────────────────────────────

export interface DepartmentForm {
  name: string;
  code: string;
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

/** The PATCH body for an edit: only what the person changed (a code left empty keeps the one it has; a cleared description is
 *  sent as '', a cleared lead or parent as null, which is how the server clears them). Empty: nothing to save. */
export function departmentPatch(d: DepartmentRecord, f: DepartmentForm): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const name = f.name.trim();
  const code = f.code.trim();
  const description = f.description.trim();
  if (name !== d.name) out.name = name;
  if (code && code !== (d.code ?? '')) out.code = code;
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
  if (f.code.trim()) out.code = f.code.trim();
  if (f.description.trim()) out.description = f.description.trim();
  if (f.parentId != null) out.parent_department_id = f.parentId;
  if (f.leadId != null) out.department_head_user_id = f.leadId;
  if (f.roleIds.length) out.role_ids = f.roleIds;
  return out;
}

// ── the Department pickers of other pages ────────────────────────────────────

/** What the Department field of a document says when there is nothing to pick (not while it has options). */
export function departmentPlaceholder(s: { loading?: boolean; failed?: boolean; count: number }): string {
  if (s.failed) return "Couldn't load departments";
  if (s.loading) return 'Loading departments…';
  if (s.count === 0) return 'No departments yet — an administrator adds them in Administration → Departments';
  return 'Choose a department';
}
