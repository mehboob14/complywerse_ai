// The Findings register as configuration of the facet explorer (components/records, via _register/registerModel.ts): every finding of every drill, with the facets that answer "who fixes
// what by when" (owner, due day, whether an issue has been raised and where it stands), the quick views and their numbers, the sorts and the export. Pure (no React), so `node --test`
// pins it (findingsRegister.test.ts). A finding's state is DERIVED from its issue (never stored here): `is_open` and `issue_status` are the server's. "Mine" is the Overview's rule: a
// finding the person owns, or one nobody owns on a drill they own.
import { dayNumber, windowOf, type FindingRow } from '../bcmModel.ts';
import { dayWindow, findingStatus, severity } from '../../../../lib/statuses/bcm.ts';
import { NONE, ownerValue, peopleOptions, textKey, type Ctx, type FacetDef, type Option, type QuickDef, type RegisterDef, type SortDef } from '../_register/registerModel.ts';

const rank = (words: readonly string[], word: string | null | undefined): number | null => { const i = words.indexOf(String(word ?? '')); return i < 0 ? null : i; };
const fromWords = (registry: { words: readonly string[]; label: (w: string) => string }): Option[] => registry.words.map((value) => ({ value, label: registry.label(value) }));

/** The person it falls to: its owner, else the owner of its drill. */
export const responsibleOf = (f: Pick<FindingRow, 'owner_id' | 'drill_owner_id'>): number | null => f.owner_id ?? f.drill_owner_id ?? null;
export const isMine = (f: Pick<FindingRow, 'owner_id' | 'drill_owner_id'>, me: number | null): boolean => me != null && responsibleOf(f) === me;

/** Where its due day stands: only an open finding is late; a closed one has no window. */
export const dueWindowOf = (f: Pick<FindingRow, 'is_open' | 'due_date'>, now: number): string | null => (f.is_open ? windowOf(f.due_date, now) : null);

const CAPA = [{ value: 'with', label: 'Issue raised' }, { value: 'without', label: 'No issue yet' }];
const RISK = [{ value: 'linked', label: 'Linked to a risk' }, { value: 'none', label: 'Not linked' }];

const FACETS: FacetDef<FindingRow>[] = [
  { key: 'severity', title: 'Severity', values: (f) => [f.severity], options: () => fromWords(severity), open: true },
  { key: 'status', title: 'Status', values: (f) => [f.issue_status], options: () => fromWords(findingStatus), open: true },
  { key: 'capa', title: 'Issue / CAPA', values: (f) => [f.linked_issue_id ? 'with' : 'without'], options: () => CAPA, open: true },
  { key: 'due', title: 'Due', values: (f, c) => { const w = dueWindowOf(f, c.now); return w ? [w] : []; }, options: () => fromWords(dayWindow) },
  { key: 'owner', title: 'Owner', values: (f) => [ownerValue(f.owner_id)], options: (rows) => peopleOptions(rows, (f) => f.owner_id, (f) => f.owner_name), searchable: true, limit: 7 },
  { key: 'risk', title: 'Risk', values: (f) => [f.linked_risk_id ? 'linked' : 'none'], options: () => RISK },
  {
    key: 'drill', title: 'Drill', values: (f) => [String(f.drill_id)], searchable: true, limit: 7,
    options: (rows) => {
      const titles = new Map<string, string>();
      rows.forEach((f) => { if (!titles.has(String(f.drill_id))) titles.set(String(f.drill_id), f.drill_title || 'A drill that is gone'); });
      return Array.from(titles.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    },
  },
  {
    key: 'plan', title: 'Plan', values: (f) => [f.plan_id == null ? NONE : String(f.plan_id)], searchable: true, limit: 7,
    options: (rows) => {
      const titles = new Map<string, string>();
      rows.forEach((f) => { if (f.plan_id != null && !titles.has(String(f.plan_id))) titles.set(String(f.plan_id), f.plan_title || 'A plan that is gone'); });
      return Array.from(titles.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    },
  },
];

const QUICK: QuickDef<FindingRow>[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'mine', label: 'Mine', test: (f, c) => isMine(f, c.me), note: (c) => (c.me == null ? 'Your account could not be read, so nothing is counted here.' : undefined) },
  { id: 'open', label: 'Open', test: (f) => f.is_open },
  { id: 'noissue', label: 'No issue yet', test: (f) => !f.linked_issue_id },
  { id: 'overdue', label: 'Overdue', test: (f, c) => dueWindowOf(f, c.now) === 'overdue' },
  { id: 'urgent', label: 'Critical or high', test: (f) => f.is_open && (f.severity === 'critical' || f.severity === 'high') },
];

const day = (v: string | null | undefined): number | null => dayNumber(v);
const createdAt = (f: FindingRow): number => Date.parse(`${f.created_at ?? ''}Z`) || 0;
/** Critical first; a closed finding after every open one. */
const urgency = (f: FindingRow): number | null => { const r = rank(severity.words, f.severity); return r === null ? null : r + (f.is_open ? 0 : severity.words.length); };

const SORTS: SortDef<FindingRow>[] = [
  { key: 'title', label: 'Finding', value: (f) => textKey(f.title) },
  { key: 'severity', label: 'Severity', value: urgency },
  { key: 'status', label: 'Status', value: (f) => rank(findingStatus.words, f.issue_status) },
  { key: 'due', label: 'Due', value: (f) => day(f.due_date) },
  { key: 'owner', label: 'Owner', value: (f) => textKey(f.owner_name) },
  { key: 'drill', label: 'Drill', value: (f) => textKey(f.drill_title) },
  { key: 'created', label: 'Raised', value: (f) => createdAt(f) || null, firstDir: 'desc' },
];

const dayText = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

export const FINDINGS: RegisterDef<FindingRow> = {
  noun: { one: 'finding', other: 'findings' },
  slug: 'findings',
  facets: FACETS,
  quick: QUICK,
  shown: ['all', 'mine', 'open', 'noissue', 'overdue', 'urgent'],
  haystack: (f) => `${f.title} ${f.drill_title ?? ''} ${f.plan_title ?? ''} ${f.owner_name ?? ''} ${f.issue_code ?? ''} ${f.linked_risk_title ?? ''} ${severity.label(f.severity)}`.toLowerCase(),
  sorts: SORTS,
  defaultSort: { key: 'severity', dir: 'asc' },
  // the rows that tie: the one due first, then the newest
  tiebreak: (a, b) => (day(a.due_date) ?? Infinity) - (day(b.due_date) ?? Infinity) || createdAt(b) - createdAt(a) || b.id - a.id,
  csvHead: ['Finding', 'Severity', 'Status', 'Issue', 'Risk', 'Owner', 'Due', 'Drill', 'Plan', 'Raised'],
  csvRow: (f: FindingRow, _c: Ctx) => [
    f.title, severity.label(f.severity), findingStatus.label(f.issue_status), f.issue_code ?? '', f.linked_risk_title ?? '', f.owner_name ?? '', dayText(f.due_date), f.drill_title ?? '', f.plan_title ?? '',
    dayText(f.created_at),
  ],
};
