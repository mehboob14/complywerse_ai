// The Access tab's rules, apart from React so `node --test` can pin them (accessModel.test.ts): the words of the four levels, how a person's way in and the place their level
// comes from are said ("Granted here", "Inherited from Operations", "Blocked here"), which requests removing a person makes, what the picker for a new grant lists, and the
// body of each write. The data is `GET /admin/departments/{id}/access` (lib/directoryAccessApi.ts); a field a backend leaves out reads as "nothing", never as a made-up level.

/** `none` is the explicit block: it stops what a unit above gave that person or role, here and below. */
export type Level = 'none' | 'view' | 'edit' | 'manage';
/** What can be given (a block is its own action). */
export type GrantLevel = Exclude<Level, 'none'>;
export type PrincipalType = 'user' | 'role';
export type How = 'head' | 'manual' | 'role' | 'grant';

export interface LevelFrom {
  department_id: number;
  name: string;
  /** given on a unit above (true), or on this one (false) */
  inherited: boolean;
  /** `owner` when it is the owner's own reading of the unit */
  principal_type: PrincipalType | 'owner';
  principal_label: string;
}

export interface AccessPerson {
  user_id: number;
  name: string;
  email: string | null;
  how: How[];
  level: Level;
  level_from: LevelFrom | null;
  can_remove: boolean;
  remove_blocked: string | null;
  /** what still holds after the person is removed (a role, an owner's seat), in words */
  remains: string | null;
}

export interface Grant { id: number; principal_type: PrincipalType; principal_id: number; principal_label: string; level: Level }

export interface InheritedGrant {
  from_department_id: number;
  from_name: string;
  principal_type: PrincipalType;
  principal_id: number;
  principal_label: string;
  level: Level;
  /** a grant on a nearer unit for the same person or role wins here */
  overridden: boolean;
}

export interface Access {
  people: AccessPerson[];
  grants: Grant[];
  inherited: InheritedGrant[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const LEVELS: readonly Level[] = ['none', 'view', 'edit', 'manage'];
const HOWS: readonly How[] = ['head', 'manual', 'role', 'grant'];
const levelOf = (v: unknown): Level => (LEVELS.includes(v as Level) ? (v as Level) : 'none');
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const whole = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);
const principal = (v: unknown): PrincipalType | null => (v === 'user' || v === 'role' ? v : null);

function levelFrom(raw: unknown): LevelFrom | null {
  if (!isRecord(raw)) return null;
  const id = whole(raw.department_id);
  const kind = raw.principal_type === 'owner' ? 'owner' : principal(raw.principal_type);
  if (id === null || kind === null) return null;
  return { department_id: id, name: text(raw.name), inherited: raw.inherited === true, principal_type: kind, principal_label: text(raw.principal_label) };
}

/** What `GET /admin/departments/{id}/access` answered, as the tab reads it. null when it is not that answer (the tab then says it could not be read). */
export function fromAccess(payload: unknown): Access | null {
  if (!isRecord(payload) || !Array.isArray(payload.people)) return null;
  const people: AccessPerson[] = [];
  for (const raw of payload.people) {
    if (!isRecord(raw)) return null;
    const id = whole(raw.user_id);
    if (id === null) return null;
    people.push({
      user_id: id, name: text(raw.name) || 'Unnamed person', email: text(raw.email) || null,
      how: (Array.isArray(raw.how) ? raw.how : []).filter((h): h is How => HOWS.includes(h as How)),
      level: levelOf(raw.level), level_from: levelFrom(raw.level_from), can_remove: raw.can_remove === true,
      remove_blocked: text(raw.remove_blocked) || null, remains: text(raw.remains) || null,
    });
  }
  const grants: Grant[] = [];
  for (const raw of Array.isArray(payload.grants) ? payload.grants : []) {
    const id = whole(isRecord(raw) ? raw.id : null), kind = principal(isRecord(raw) ? raw.principal_type : null), pid = whole(isRecord(raw) ? raw.principal_id : null);
    if (!isRecord(raw) || id === null || kind === null || pid === null) return null;
    grants.push({ id, principal_type: kind, principal_id: pid, principal_label: text(raw.principal_label) || (kind === 'role' ? 'Unnamed role' : 'Unnamed person'), level: levelOf(raw.level) });
  }
  const inherited: InheritedGrant[] = [];
  for (const raw of Array.isArray(payload.inherited_grants) ? payload.inherited_grants : []) {
    const from = whole(isRecord(raw) ? raw.from_department_id : null), kind = principal(isRecord(raw) ? raw.principal_type : null), pid = whole(isRecord(raw) ? raw.principal_id : null);
    if (!isRecord(raw) || from === null || kind === null || pid === null) return null;
    inherited.push({
      from_department_id: from, from_name: text(raw.from_name), principal_type: kind, principal_id: pid,
      principal_label: text(raw.principal_label) || (kind === 'role' ? 'Unnamed role' : 'Unnamed person'), level: levelOf(raw.level), overridden: raw.overridden === true,
    });
  }
  return { people, grants, inherited };
}

// ── the words ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What each level allows, said once: the (i) beside the Level field. */
export const LEVEL_NOTE = 'View reads the unit\'s documents and the units under it. Edit also changes them. Manage also runs the unit here: its details, people, access and defaults.';
/** The two sentences behind the tab: how a level travels down, which one wins, and that it only adds. */
export const ACCESS_NOTE = 'A level given on a unit applies to every unit under it, and the nearest one wins: a level given lower down overrides one above, and Block here stops it. Access only adds: it never takes away a right someone already holds.';

export const GRANT_LEVELS: ReadonlyArray<{ value: GrantLevel; label: string }> = [
  { value: 'view', label: 'View' },
  { value: 'edit', label: 'Edit' },
  { value: 'manage', label: 'Manage' },
];

const WORD: Record<Level, string> = { none: 'Blocked', view: 'View', edit: 'Edit', manage: 'Manage' };
/** "View", "Edit", "Manage", "Blocked". */
export const levelWord = (level: Level): string => WORD[level];

type Tone = 'success' | 'danger' | 'warning' | 'progress' | 'pending' | 'neutral';
const TONE: Record<Level, Tone> = { none: 'danger', view: 'neutral', edit: 'progress', manage: 'pending' };
/** The pill of a level: a word with a tone behind it (the word always says which). */
export const levelPill = (level: Level): { tone: Tone; label: string } => ({ tone: TONE[level], label: WORD[level] });

/** The pill for a person's row: a person with no level of their own is a member only (membership gives no access to documents). */
export function personPill(p: Pick<AccessPerson, 'level' | 'level_from'>): { tone: Tone; label: string } {
  return p.level === 'none' && !p.level_from ? { tone: 'neutral', label: 'Member only' } : levelPill(p.level);
}

/** Where a level comes from, in words: "Granted here", "Inherited from Operations", "Blocked here", "Blocked from Operations", "Owner of this unit". A level given to a role
 *  names the role. null when the person has no level of their own. */
export function whereText(from: LevelFrom | null, level: Level): string | null {
  if (!from) return null;
  if (from.principal_type === 'owner') return from.inherited ? `Owner of ${from.name}` : 'Owner of this unit';
  const base = level === 'none' ? (from.inherited ? `Blocked from ${from.name}` : 'Blocked here') : from.inherited ? `Inherited from ${from.name}` : 'Granted here';
  return from.principal_type === 'role' && from.principal_label ? `${base} · role ${from.principal_label}` : base;
}

/** "Owner", "Added by hand", "Through role", "Given access": why the person is on the list, in the order the server gives. */
const HOW_WORD: Record<How, string> = { head: 'Owner', manual: 'Added by hand', role: 'Through role', grant: 'Given access' };
export const howWords = (p: Pick<AccessPerson, 'how'>): Array<{ key: How; label: string }> => p.how.map((key) => ({ key, label: HOW_WORD[key] }));

/** "6 people" / "1 person", and how many hold a level of their own. */
export function peopleSummary(people: readonly Pick<AccessPerson, 'level'>[]): string {
  const withLevel = people.filter((p) => p.level !== 'none').length;
  return `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${withLevel} with a level`;
}

/** The words of a grant row of this unit: "Blocked here" for a block, else the level. */
export const grantWord = (g: Pick<Grant, 'level'>): string => (g.level === 'none' ? 'Blocked here' : levelWord(g.level));

// ── removing a person ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What "Remove" does to a person: take them out of the members added by hand, and take off the grant they hold on this very unit (a block of theirs stays: it is not access,
 *  and Unblock is its own button). The server says in `can_remove` whether there is anything to do. */
export function removeSteps(p: Pick<AccessPerson, 'user_id' | 'how'>, grants: readonly Grant[]): { member: boolean; grantId: number | null } {
  const own = grants.find((g) => g.principal_type === 'user' && g.principal_id === p.user_id && g.level !== 'none');
  return { member: p.how.includes('manual'), grantId: own ? own.id : null };
}

// ── the picker for a new grant ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PrincipalRow { id: number; name: string; email?: string | null; user_count?: number; granted?: string | null }
export interface Principals { people: PrincipalRow[]; roles: PrincipalRow[] }

export interface PickRow { key: string; type: PrincipalType; id: number; label: string; sub: string; granted: Level | null }

const rowsOf = (v: unknown): PrincipalRow[] => (Array.isArray(v) ? v.filter((r): r is PrincipalRow => isRecord(r) && whole(r.id) !== null && typeof r.name === 'string') : []);

/** What `GET .../principals` answered, or empty lists. */
export const fromPrincipals = (payload: unknown): Principals => (isRecord(payload) ? { people: rowsOf(payload.people), roles: rowsOf(payload.roles) } : { people: [], roles: [] });

/** The choices of the picker: people first, then roles, each with a second line (an e-mail; how many hold the role) and the level it already has on this very unit. */
export function pickItems(p: Principals): PickRow[] {
  const granted = (v: unknown): Level | null => (LEVELS.includes(v as Level) ? (v as Level) : null);
  return [
    ...p.people.map<PickRow>((r) => ({ key: `user:${r.id}`, type: 'user', id: r.id, label: r.name, sub: r.email ?? '', granted: granted(r.granted) })),
    ...p.roles.map<PickRow>((r) => ({ key: `role:${r.id}`, type: 'role', id: r.id, label: r.name, sub: typeof r.user_count === 'number' ? `${r.user_count} ${r.user_count === 1 ? 'person' : 'people'}` : '', granted: granted(r.granted) })),
  ];
}

/** What a picked row says about itself when it already has a level here: "Has Edit here", "Blocked here". */
export const grantedText = (granted: Level | null): string | null => (granted === null ? null : granted === 'none' ? 'Blocked here' : `Has ${levelWord(granted)} here`);

// ── what a write says ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CAN: Record<GrantLevel, string> = { view: 'view', edit: 'edit', manage: 'manage' };
/** "Pat can now edit Support", "Pat is blocked on Support": said when the server has confirmed a grant. */
export const givenText = (who: string, level: Level, unit: string): string => (level === 'none' ? `${who} is blocked on ${unit}` : `${who} can now ${CAN[level]} ${unit}`);
/** Said when a row of the unit has been taken off: a block is lifted, a level is taken back. */
export const removedText = (who: string, level: Level, unit: string): string => (level === 'none' ? `The block on ${who} is lifted` : `${who} no longer has a level given on ${unit}`);
/** Said when a person is taken off the unit's list. */
export const takenOffText = (who: string, unit: string): string => `${who} removed from ${unit}`;

// ── the writes ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface GrantBody { principal_type: PrincipalType; principal_id: number; level: Level }

export const addBody = (pick: PickRow, level: GrantLevel): GrantBody => ({ principal_type: pick.type, principal_id: pick.id, level });
/** Overriding or blocking a grant of a unit above is a grant of the same person or role on this unit. */
export const overrideBody = (g: Principal, level: Level): GrantBody => ({ principal_type: g.principal_type, principal_id: g.principal_id, level });
export const levelBody = (g: Principal, level: Level): GrantBody => ({ principal_type: g.principal_type, principal_id: g.principal_id, level });
type Principal = { principal_type: PrincipalType; principal_id: number };

/** An inherited row can be blocked or overridden here only while a nearer grant has not already done it. */
export const canOverride = (g: Pick<InheritedGrant, 'overridden'>): boolean => !g.overridden;
