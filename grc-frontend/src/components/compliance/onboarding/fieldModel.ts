/**
 * What the field inputs of framework onboarding and the organisation profile decide without a screen: whether a value counts as filled (the same rules as
 * the server's `engine.py`, which has the last word), table rows (which are started, which lack a required cell, what the server would keep), when a
 * conditional field is asked (`when`), how a choice is laid out, how a person is read from three boxes, and how a profile row is named. Pure, so
 * `node --test` pins it (fieldModel.test.ts).
 */
import type { Column, Confidence, Department, Field, Level, OrgPickOf, OrgRows, Row, When } from '@/lib/frameworkOnboarding';

export type AnyField = Field | Column;
export type Lookup = (ref: string) => { field: AnyField | undefined; value: unknown };

// ── filled or not ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Nothing there: null, blank text, an empty list or object. A number (0) and false are values. */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') return Object.keys(v as object).length === 0;
  return false;
}

const columnsOf = (f: AnyField): readonly Column[] => (('columns' in f ? f.columns : undefined) ?? []) as readonly Column[];
const minRows = (f: AnyField): number => Math.max(1, Number(('min_rows' in f ? f.min_rows : undefined) ?? 1) || 1);

/** Has anyone begun this row: some column holds something (a row made by "Add" and left alone has not been begun, and the server drops it). */
export function rowStarted(columns: readonly Column[], row: Record<string, unknown>): boolean {
  return columns.some((c) => !isBlank(row[c.key]));
}
/** The required columns a started row leaves empty (none for a row nobody has begun). */
export function rowMissing(columns: readonly Column[], row: Record<string, unknown>): Column[] {
  return rowStarted(columns, row) ? columns.filter((c) => c.required && isBlank(row[c.key])) : [];
}
export function rowComplete(columns: readonly Column[], row: Record<string, unknown>): boolean {
  return rowStarted(columns, row) && rowMissing(columns, row).length === 0;
}

/** A required question has an answer: a yes or a no counts; a list needs its minimum number of rows (complete ones for a table). */
export function answered(f: AnyField, v: unknown): boolean {
  switch (f.type) {
    case 'bool': return v === true || v === false;
    case 'table': return (Array.isArray(v) ? v : []).filter((r) => r && rowComplete(columnsOf(f), r as Row)).length >= minRows(f);
    case 'asset_refs': case 'org_pick': case 'countries': case 'multichoice': case 'departments_derived':
      return (Array.isArray(v) ? v.length : 0) >= minRows(f);
    case 'person': return personKind(v) !== null;
    default: return !isBlank(v) && v !== false;
  }
}

/** A statement holds: a tick is ticked, a list has something, text is there. */
export function hasValue(f: AnyField, v: unknown): boolean {
  switch (f.type) {
    case 'bool': return v === true;
    case 'table': return (Array.isArray(v) ? v : []).some((r) => r && rowComplete(columnsOf(f), r as Row));
    case 'asset_refs': case 'org_pick': case 'countries': case 'multichoice': case 'departments_derived': return Array.isArray(v) && v.length > 0;
    case 'person': return personKind(v) !== null;
    default: return !isBlank(v);
  }
}

// ── table rows ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A row gets its id when it is made, so it keeps its identity from the first key stroke (the server keeps an id it is given, and a scope picks rows by it). */
export function newRowId(random: () => number = Math.random): string {
  let out = 'n';
  for (let i = 0; i < 9; i++) out += Math.floor(random() * 36).toString(36);
  return out;
}

/** What the server would keep of a row: its id and the columns that hold something. */
export function cleanRow(columns: readonly Column[], row: Record<string, unknown>): Row {
  const out: Record<string, unknown> = { id: typeof row.id === 'string' ? row.id : '' };
  for (const c of columns) if (!isBlank(row[c.key])) out[c.key] = row[c.key];
  return out as Row;
}
/** The rows the server would keep: started ones only, each cleaned. */
export function cleanRows(columns: readonly Column[], rows: readonly Record<string, unknown>[]): Row[] {
  return rows.filter((r) => r && rowStarted(columns, r)).map((r) => cleanRow(columns, r));
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
/** Two row lists hold the same thing once the rows nobody has begun are left out. */
export function sameRows(columns: readonly Column[], a: readonly Record<string, unknown>[], b: readonly Record<string, unknown>[]): boolean {
  return stable(cleanRows(columns, a)) === stable(cleanRows(columns, b));
}

/** How the rows of a table are drawn: with at most five columns they line up under a header on a wide screen; more of them are cards with a label on every cell. */
export function tableLayout(columns: readonly Column[]): 'grid' | 'cards' {
  return columns.length <= 5 ? 'grid' : 'cards';
}

// ── a number typed into a box ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** null for an empty box, the number for a number, undefined while the text is not (yet) a number ("-", "1e"): the page keeps waiting. */
export function parseNumberText(text: string): number | null | undefined {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

// ── yes / no ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type YesNo = 'yes' | 'no' | '';
export const toYesNo = (v: unknown): YesNo => (v === true ? 'yes' : v === false ? 'no' : '');
export const fromYesNo = (s: string): boolean | null => (s === 'yes' ? true : s === 'no' ? false : null);

// ── choices ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Two to four short answers read best as segments; anything longer or more is a list. */
export function choiceLayout(options: readonly string[]): 'segmented' | 'select' {
  const longest = Math.max(0, ...options.map((o) => o.length));
  const total = options.reduce((n, o) => n + o.length, 0);
  return options.length >= 2 && options.length <= 4 && longest <= 16 && total <= 44 ? 'segmented' : 'select';
}

/** The options to offer: the field's own, plus a saved value that is not among them (an older catalog), so it is still seen and can be changed. */
export function withSaved(options: readonly string[], saved: readonly unknown[]): string[] {
  const extra = saved.filter((s): s is string => typeof s === 'string' && s !== '' && !options.includes(s));
  return [...options, ...extra.filter((s, i) => extra.indexOf(s) === i)];
}

/** Ticking or unticking one option of a group: the choice in the order of the options. A saved value no option names is dropped. */
export function toggleOption(options: readonly string[], current: unknown, option: string, on: boolean): string[] {
  const now = new Set(Array.isArray(current) ? (current as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  if (on) now.add(option); else now.delete(option);
  return options.filter((o) => now.has(o));
}

/** Ticking one id in a list of ids (asset ids, row ids, department ids), keeping the order already chosen. */
export function toggleId<T extends string | number>(list: readonly T[], id: T, on: boolean): T[] {
  const without = list.filter((x) => x !== id);
  return on ? [...without, id] : without;
}

// ── when a field is asked ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const norm = (v: unknown): unknown => (v === undefined ? null : v);
const same = (a: unknown, b: unknown): boolean => (typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null) ? stable(a) === stable(b) : norm(a) === norm(b);

/** The server's rule (`engine.condition`): eq, ne, in, includes, truthy against another field's answer; the field it points at must itself be asked. */
export function whenHolds(when: When | undefined | null, look: Lookup, visible?: (ref: string) => boolean): boolean {
  if (!when) return true;
  const { field, value } = look(when.field);
  if (visible && !visible(when.field)) return false;
  if ('eq' in when) return same(value, when.eq);
  if ('ne' in when) return !same(value, when.ne);
  if ('in' in when) return (when.in ?? []).some((x) => same(value, x));
  if ('includes' in when) return Array.isArray(value) && value.some((x) => same(x, when.includes));
  if ('truthy' in when) return Boolean(field && hasValue(field, value)) === Boolean(when.truthy);
  return true;
}

/** Is a field asked: its own `when` holds, and the field that `when` points at is itself asked (a stale answer to a hidden question is ignored). */
export function makeVisible(fields: Record<string, AnyField & { when?: When }>, look: Lookup): (ref: string) => boolean {
  const memo = new Map<string, boolean>();
  const visible = (ref: string): boolean => {
    const known = memo.get(ref);
    if (known !== undefined) return known;
    memo.set(ref, true);                                            // guards a cycle
    const f = fields[ref];
    const ok = !f || !f.when ? true : whenHolds(f.when, look, visible);
    memo.set(ref, ok);
    return ok;
  };
  return visible;
}

// ── the words around a field ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The quiet marker beside a label: a required field has none (most fields are), the others say what they are. */
export function levelWord(level: Level | undefined): 'advised' | 'optional' | null {
  return level === 'advised' ? 'advised' : level === 'optional' ? 'optional' : null;
}

/** A source is shown as verified unless it says otherwise: only the weaker two get a word. */
export function confidenceWord(confidence: Confidence | undefined): string | null {
  return confidence === 'secondary' ? 'Secondary source' : confidence === 'unverified' ? 'Unverified' : null;
}

/** "Asked by certification body, auditor"; nothing when the source names nobody. */
export function askedByText(askedBy: string | undefined | null): string {
  const who = (askedBy ?? '').trim();
  return who ? `Asked by ${who}` : '';
}

/** Links worth opening: web addresses only, each once. */
export function safeUrls(urls: readonly string[] | undefined | null): string[] {
  return (urls ?? []).filter((u, i, all) => typeof u === 'string' && /^https?:\/\//i.test(u) && all.indexOf(u) === i);
}

/** Does a label point at a single control with the field's id (a text box, a list, a picker button)? Groups of controls name themselves. */
export function hasSingleControl(f: AnyField): boolean {
  switch (f.type) {
    case 'text': case 'longtext': case 'number': case 'date': case 'country': case 'countries': case 'vendor_ref': return true;
    case 'choice': return choiceLayout(f.options ?? []) === 'select';
    default: return false;
  }
}

// ── a person ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PersonDraft { name: string; email: string; organisation: string }

/** Who a saved person value is: someone on the platform, someone outside, or nobody. */
export function personKind(v: unknown): 'user' | 'outside' | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (p.user_id !== undefined && p.user_id !== null && p.user_id !== '') return 'user';
  return typeof p.name === 'string' && p.name.trim() ? 'outside' : null;
}

export function draftOfPerson(v: unknown): PersonDraft {
  const p = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const text = (x: unknown) => (typeof x === 'string' ? x : '');
  return personKind(v) === 'outside' ? { name: text(p.name), email: text(p.email), organisation: text(p.organisation) } : { name: '', email: '', organisation: '' };
}

/**
 * What three boxes say as a person value: null when they are all empty (cleared), 'incomplete' while there is an email or an organisation but no name
 * (the server refuses a person with no name, which would stop every other save), else the person without the empty parts.
 */
export function personFromDraft(d: PersonDraft): { name: string; email?: string; organisation?: string } | null | 'incomplete' {
  const name = d.name.trim();
  const email = d.email.trim();
  const organisation = d.organisation.trim();
  if (!name) return email || organisation ? 'incomplete' : null;
  return { name, ...(email ? { email } : {}), ...(organisation ? { organisation } : {}) };
}

// ── rows of the organisation profile, and departments ───────────────────────────────────────────────────────────────────────

type ProfileRows = Exclude<OrgPickOf, 'systems' | 'departments'>;
/** Which columns name a row of each list, and which describe it. */
const ROW_WORDS: Record<ProfileRows, { title: readonly string[]; about: readonly string[] }> = {
  entities: { title: ['name'], about: ['kind', 'country'] },
  sites: { title: ['name'], about: ['kind', 'city', 'country'] },
  third_parties: { title: ['name'], about: ['kind', 'service'] },
  data_types: { title: ['type'], about: ['classification', 'volume'] },
};
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** What a row of the profile is called on a picker: its name; "Unnamed row" when it has none (so the picker never shows an id). */
export function rowTitle(of: ProfileRows, row: Record<string, unknown>): string {
  for (const key of ROW_WORDS[of].title) if (text(row[key])) return text(row[key]);
  for (const key of ['name', 'type', 'title']) if (text(row[key])) return text(row[key]);
  return 'Unnamed row';
}
/** The second line of a picker row: what kind it is and where. */
export function rowAbout(of: ProfileRows, row: Record<string, unknown>): string {
  return ROW_WORDS[of].about.map((key) => text(row[key])).filter(Boolean).join(' · ');
}
export function orgRowsOf(rows: OrgRows | undefined, of: OrgPickOf): Row[] {
  return of === 'systems' || of === 'departments' ? [] : rows?.[of] ?? [];
}

/** Departments in tree order (a parent, then its children by name), each with its depth; a loop or a missing parent cannot hide one. */
export function departmentTree(departments: readonly Department[]): Array<{ id: number; name: string; depth: number }> {
  const byParent = new Map<number | null, Department[]>();
  const ids = new Set(departments.map((d) => d.id));
  for (const d of departments) {
    const parent = d.parent_id !== null && ids.has(d.parent_id) && d.parent_id !== d.id ? d.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), d]);
  }
  const out: Array<{ id: number; name: string; depth: number }> = [];
  const seen = new Set<number>();
  const walk = (parent: number | null, depth: number) => {
    for (const d of (byParent.get(parent) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.push({ id: d.id, name: d.name, depth });
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const d of departments) if (!seen.has(d.id)) out.push({ id: d.id, name: d.name, depth: 0 });          // a loop: still listed
  return out;
}
