// Administration > Users: what the register shows, filters, counts and sends, as decisions apart from React so `node --test` can pin them (usersModel.test.ts).
// Relative imports only.
//
// THE LIST: `GET /admin/users` answers every platform account (active or not) with its roles; the register holds the whole list and filters it here, so every count is
// the real one. ACCESS HYGIENE (G12 pattern 2): "Never signed in", "No sign-in for 90 days" and "No role" count ACTIVE accounts only: an inactive account cannot sign in,
// so it is not a risk. Times are the server's naive UTC (parseUtc).
// WHAT IS SENT: only what changed (display_name, e-mail, is_active, role_ids): the server takes each as optional. Nothing about Department, Group, Division or Designation:
// the server never stored them (G12 P-4).
import { parseUtc } from '../serverTime.ts';
import { sortRows, type SortState } from '../../components/ui/ds/tableModel.ts';

export interface UserRole { id: number; name: string }

/** One item of `GET /admin/users`. */
export interface UserRecord {
  id: number;
  username: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string | null;
  last_login: string | null;
  roles: UserRole[];
}

export const STALE_DAYS = 90;
const DAY = 86_400_000;

/** The name to show for a person: the display name, else the username. */
export const nameOf = (user: Pick<UserRecord, 'display_name' | 'username'>): string => (user.display_name ?? '').trim() || user.username;

// ── views (the chips) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type UserView = 'all' | 'active' | 'inactive' | 'never' | 'stale' | 'norole';
export const USER_VIEWS: readonly UserView[] = ['all', 'active', 'inactive', 'never', 'stale', 'norole'];
export const VIEW_LABEL: Record<UserView, string> = {
  all: 'All',
  active: 'Active',
  inactive: 'Inactive',
  never: 'Never signed in',
  stale: `No sign-in for ${STALE_DAYS} days`,
  norole: 'No role',
};
/** What a chip counts, said once (the chip's tooltip). */
export const VIEW_HELP: Record<UserView, string> = {
  all: 'Every account',
  active: 'Accounts that can sign in',
  inactive: 'Accounts that cannot sign in',
  never: 'Active accounts that have never signed in',
  stale: `Active accounts whose last sign-in was more than ${STALE_DAYS} days ago`,
  norole: 'Active accounts that hold no role, so they can open very little',
};

export function lastSeenAt(user: Pick<UserRecord, 'last_login'>): Date | null {
  return parseUtc(user.last_login);
}

export function isStale(user: UserRecord, now: number): boolean {
  const seen = lastSeenAt(user);
  return user.is_active && seen !== null && now - seen.getTime() > STALE_DAYS * DAY;
}

export function inView(user: UserRecord, view: UserView, now: number): boolean {
  switch (view) {
    case 'active': return user.is_active;
    case 'inactive': return !user.is_active;
    case 'never': return user.is_active && lastSeenAt(user) === null;
    case 'stale': return isStale(user, now);
    case 'norole': return user.is_active && user.roles.length === 0;
    default: return true;
  }
}

/** The true count behind each chip, from the complete list. */
export function countsOf(users: readonly UserRecord[], now: number): Record<UserView, number> {
  const counts = { all: 0, active: 0, inactive: 0, never: 0, stale: 0, norole: 0 };
  users.forEach((u) => USER_VIEWS.forEach((v) => { if (inView(u, v, now)) counts[v] += 1; }));
  return counts;
}

/** "24 people, 3 inactive": the line under the title. */
export function peopleLine(users: readonly UserRecord[]): string {
  const inactive = users.filter((u) => !u.is_active).length;
  const people = `${users.length} ${users.length === 1 ? 'person' : 'people'}`;
  return inactive > 0 ? `${people} · ${inactive} inactive` : people;
}

// ── filter and sort ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface UserFilter { q: string; view: UserView; roleId: number }
export const NO_USER_FILTER: UserFilter = { q: '', view: 'all', roleId: 0 };

export const isFiltering = (f: UserFilter): boolean => f.q.trim() !== '' || f.view !== 'all' || f.roleId !== 0;

export function filterUsers(users: readonly UserRecord[], filter: UserFilter, now: number): UserRecord[] {
  const q = filter.q.trim().toLowerCase();
  return users.filter((u) => {
    if (!inView(u, filter.view, now)) return false;
    if (filter.roleId !== 0 && !u.roles.some((r) => r.id === filter.roleId)) return false;
    if (!q) return true;
    return nameOf(u).toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q);
  });
}

export const USER_SORT_KEYS = ['name', 'seen', 'added'] as const;
export const DEFAULT_USER_SORT: SortState = { key: 'name', dir: 'asc' };

/** The order the register asks for. A person who never signed in is last when sorting by last sign-in, whichever way (the kit's rule: nothing in the column is last). */
export function sortUsers(users: readonly UserRecord[], sort: SortState): UserRecord[] {
  return sortRows(users, sort, (u, key) => {
    if (key === 'seen') return lastSeenAt(u);
    if (key === 'added') return parseUtc(u.created_at);
    return nameOf(u).toLowerCase();
  });
}

/** A short sentence for the "Roles" cell when a person holds none. */
export const NO_ROLE_WORDS = 'No role';

// ── the sheet: validation and what is sent ───────────────────────────────────────────────────────────────────────────────────────
export interface UserForm { username: string; email: string; displayName: string; password: string; roleIds: number[] }

export const blankForm = (): UserForm => ({ username: '', email: '', displayName: '', password: '', roleIds: [] });

export const formOfUser = (user: UserRecord): UserForm => ({
  username: user.username, email: user.email ?? '', displayName: user.display_name ?? '', password: '', roleIds: user.roles.map((r) => r.id),
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string): boolean => EMAIL.test(value.trim());

export type FormErrors = Partial<Record<'username' | 'email' | 'password', string>>;

/** What stops a save, in words, field by field. The server has the last word (domain, duplicates, the password policy). */
export function formErrors(form: UserForm, mode: 'create' | 'edit', passwordProblems: readonly string[] = []): FormErrors {
  const errors: FormErrors = {};
  if (mode === 'create' && form.username.trim() === '') errors.username = 'Enter a username.';
  if (form.email.trim() === '') errors.email = 'Enter an e-mail address.';
  else if (!isEmail(form.email)) errors.email = 'Enter an e-mail address like name@company.com.';
  if (mode === 'create') {
    if (form.password === '') errors.password = 'Enter a password.';
    else if (passwordProblems.length > 0) errors.password = `The password still needs: ${passwordProblems.join(', ')}.`;
  }
  return errors;
}

const sameIds = (a: readonly number[], b: readonly number[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

export function isDirty(saved: UserForm, form: UserForm): boolean {
  return saved.email.trim() !== form.email.trim() || saved.displayName.trim() !== form.displayName.trim() || !sameIds(saved.roleIds, form.roleIds);
}

/** The body of PUT /admin/users/{id}: only what changed. role_ids go only when the ticked set changed (and only when the roles were loaded, so a failed role list
 *  can never wipe a person's roles: the caller passes `rolesKnown`). */
export function updateBody(saved: UserForm, form: UserForm, rolesKnown: boolean): { display_name?: string; email?: string; role_ids?: number[] } {
  const body: { display_name?: string; email?: string; role_ids?: number[] } = {};
  if (saved.displayName.trim() !== form.displayName.trim()) body.display_name = form.displayName.trim();
  if (saved.email.trim() !== form.email.trim()) body.email = form.email.trim();
  if (rolesKnown && !sameIds(saved.roleIds, form.roleIds)) body.role_ids = form.roleIds.slice();
  return body;
}

/** The body of POST /admin/users. */
export function createBody(form: UserForm): { username: string; email: string; password: string; display_name?: string; role_ids: number[] } {
  const body: { username: string; email: string; password: string; display_name?: string; role_ids: number[] } = {
    username: form.username.trim(), email: form.email.trim(), password: form.password, role_ids: form.roleIds.slice(),
  };
  if (form.displayName.trim() !== '') body.display_name = form.displayName.trim();
  return body;
}

export function toggleId(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : ids.concat(id);
}

// ── the password, against the policy ─────────────────────────────────────────────────────────────────────────────────────────────
/** The part of `GET /admin/password-policy` that applies to a new password (services/password_policy.validate_password). */
export interface PasswordRules { min_length: number; require_uppercase: boolean; require_lowercase: boolean; require_digit: boolean; require_special: boolean }

export interface PasswordCheck { key: string; label: string; met: boolean }

/** One line per rule the policy asks for, met or not. The server's check is the same in spirit (a special character is anything that is not a letter or digit of
 *  A-Z, a-z, 0-9); it stays the judge. */
export function passwordChecks(rules: PasswordRules | null | undefined, password: string): PasswordCheck[] {
  if (!rules) return [];
  const checks: PasswordCheck[] = [{ key: 'length', label: `at least ${rules.min_length} characters`, met: Array.from(password).length >= (rules.min_length || 0) }];
  if (rules.require_uppercase) checks.push({ key: 'upper', label: 'an uppercase letter', met: /\p{Lu}/u.test(password) });
  if (rules.require_lowercase) checks.push({ key: 'lower', label: 'a lowercase letter', met: /\p{Ll}/u.test(password) });
  if (rules.require_digit) checks.push({ key: 'digit', label: 'a digit', met: /\p{Nd}/u.test(password) });
  if (rules.require_special) checks.push({ key: 'special', label: 'a special character (like ! or @)', met: /[^a-zA-Z0-9]/.test(password) });
  return checks;
}

/** The labels of the rules a password does not meet yet. */
export const passwordProblems = (rules: PasswordRules | null | undefined, password: string): string[] => passwordChecks(rules, password).filter((c) => !c.met).map((c) => c.label);

// ── actions on a person ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Why an action on this account is not offered, or null. The server refuses a person deleting themselves; it does not refuse deactivating oneself, so the page does
 *  (it would lock them out). */
export function ownAccountReason(user: Pick<UserRecord, 'id'>, myId: number | null): string | null {
  return myId !== null && user.id === myId ? "You can't do this to your own account." : null;
}

export const deactivateText = (name: string) => ({
  title: `Deactivate ${name}?`,
  message: `${name} will no longer be able to sign in. Their roles, history and everything they created stay as they are, and you can reactivate the account at any time.`,
  confirmLabel: 'Deactivate',
});

export const removeText = (name: string) => ({
  title: `Remove ${name} permanently?`,
  message: `This deletes the account and cannot be undone. If you only want to stop ${name} signing in, deactivate the account instead: nothing is lost and it can be turned back on.`,
  confirmLabel: 'Remove permanently',
});

/** What a failed removal says when the server gave no better words (a person records still refer to cannot be deleted). */
export const REMOVE_FAILED = "The account wasn't removed. If records still refer to this person, deactivate the account instead.";
