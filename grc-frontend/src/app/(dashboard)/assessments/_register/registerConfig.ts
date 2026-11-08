// All assessments as configuration of the facet explorer (components/records, via bcm/_register/registerModel.ts, the pure model every register of the platform reads): the rows (a list
// row joined to the board's score for it and to what waits for the signed-in person), the facets, the quick views and the number each would show, the sorts, the board and the export.
// Pure (no React), so `node --test` pins it (registerConfig.test.ts). The words are lib/statuses/assessments.ts and workspace/kinds.ts; the grade scale is the server's (85 / 70 / 50).
import { dayNumber, dueWords, windowOf } from '../../bcm/bcmModel.ts';
import { NONE, csvOf, ownerValue, peopleOptions, textKey, type Ctx, type FacetDef, type Option, type QuickDef, type RegisterDef, type SortDef } from '../../bcm/_register/registerModel.ts';
import { grade as gradeWords, lifecycle, lifecycleOf } from '../../../../lib/statuses/assessments.ts';
import { KINDS, kindOf } from '../../../../components/assessments/workspace/kinds.ts';
import { gradeOf } from '../../../../components/assessments/workspace/workspaceModel.ts';
import { subjectOf } from '../../../../components/compliance/scoping/scopingModel.ts';
import { CATEGORIES, slugOf } from '../_data/categories.ts';
import type { Board, BoardEntry, ListRow, MyWork } from '../_data/types.ts';

export { csvOf, dueWords, windowOf };

/** A list row joined to the board's score of it and to what waits for the signed-in person. */
export interface RegisterRow extends ListRow {
  /** the board's score of it; null when the board does not count it (a draft being scoped, a plain upload, a questionnaire already started from), or when the board did not answer */
  entry: BoardEntry | null;
  /** the board answered, so a null `entry` means "not counted" and not "unknown" */
  boardKnown: boolean;
  /** something waits for the signed-in person in it: a control assigned to them, a draft to scope, evidence to decide */
  waiting: boolean;
}

/** The register's rows: every list row, the board's entry for it by id, and whether something waits for the person. `board` / `work` are undefined while they have not answered (or failed). */
export function joinRows(list: readonly ListRow[], board: Board | undefined, work: MyWork | undefined): RegisterRow[] {
  const entries = new Map<number, BoardEntry>();
  board?.categories.forEach((c) => c.assessments.forEach((a) => entries.set(a.id, a)));
  const waiting = new Set<number>();
  work?.assigned_items.forEach((i) => waiting.add(i.assessment_id));
  work?.scoping.forEach((d) => waiting.add(d.id));
  work?.approvals.forEach((a) => { if (a.assessment_id != null) waiting.add(a.assessment_id); });
  return list.map((r) => ({ ...r, entry: entries.get(r.id) ?? null, boardKnown: !!board, waiting: waiting.has(r.id) }));
}

// ── words ───────────────────────────────────────────────────────────────────────

export const isDone = (r: Pick<ListRow, 'status' | 'phase'>): boolean => ['completed', 'archived'].includes(lifecycleOf(r));
export const typeLabel = (r: Pick<ListRow, 'assessment_format'>): string => kindOf(r.assessment_format).label;
/** What the assessment is of: the application, the function, or (for an uploaded workbook) its own name. */
export const subjectName = (r: Pick<ListRow, 'name' | 'primary_asset_name' | 'scope_model' | 'assessment_format'>): string => (r.scope_model ? subjectOf({ ...r, scope_model: r.scope_model }) : '');

/** What goes under the name in a row: the kind and the subject, each only when the name does not say it already (a scoped assessment is named "<kind> - <subject>"). '' when the name is all there is. */
export function sublineOf(r: Pick<ListRow, 'name' | 'primary_asset_name' | 'scope_model' | 'assessment_format'>): string {
  const has = (word: string): boolean => !word || r.name.toLowerCase().includes(word.toLowerCase());
  const kind = kindOf(r.assessment_format).label;
  const subject = r.scope_model ? subjectName(r) : '';
  return [has(kind) ? '' : kind, has(subject) ? '' : subject].filter(Boolean).join(' · ');
}

const GRADE_NONE = 'none';
const GRADE_UNCOUNTED = 'uncounted';
/** The score band of a row: the server's grade of its content score; "none" when the board counts it and nothing is answered; "uncounted" when the board does not count it. null while the board has not answered. */
export function gradeValue(r: RegisterRow): string | null {
  if (!r.boardKnown) return null;
  if (!r.entry) return GRADE_UNCOUNTED;
  return gradeOf(r.entry.content) ?? GRADE_NONE;
}

const fromWords = (registry: { words: readonly string[]; label: (w: string) => string }): Option[] => registry.words.map((value) => ({ value, label: registry.label(value) }));
const rank = (words: readonly string[], word: string): number | null => { const i = words.indexOf(word); return i < 0 ? null : i; };

type Due = 'overdue' | 'soon' | 'later' | 'none';
/** Where the due date stands; a finished assessment has none to chase. */
export const dueValue = (r: Pick<ListRow, 'due_date' | 'status' | 'phase'>, now: number): Due => (isDone(r) ? 'none' : windowOf(r.due_date, now));

const DUE_OPTIONS: Option[] = [
  { value: 'overdue', label: 'Overdue' }, { value: 'soon', label: 'Next 30 days' }, { value: 'later', label: 'Later' }, { value: 'none', label: 'No due date' },
];

// ── facets ──────────────────────────────────────────────────────────────────────

const FACETS: FacetDef<RegisterRow>[] = [
  { key: 'category', title: 'Category', values: (r) => [slugOf(r.category)], options: () => CATEGORIES.map((c) => ({ value: c.slug, label: c.name })), open: true },
  {
    key: 'type', title: 'Type', values: (r) => [r.assessment_format], searchable: true, limit: 7, open: true,
    // every kind there is plus any the rows hold that nobody named: a kind with no assessment is dropped from the rail unless a link chose it, and then it has its name (a link from Types or an old address)
    options: (rows) => Array.from(new Set([...Object.keys(KINDS), ...rows.map((r) => r.assessment_format)])).map((value) => ({ value, label: kindOf(value).label })).sort((a, b) => a.label.localeCompare(b.label)),
  },
  { key: 'status', title: 'Status', values: (r) => [lifecycleOf(r)], options: () => fromWords(lifecycle), open: true },
  { key: 'owner', title: 'Owner', values: (r) => [ownerValue(r.owner_id)], options: (rows) => peopleOptions(rows, (r) => r.owner_id, (r) => r.owner_name), searchable: true, limit: 7 },
  { key: 'due', title: 'Due', values: (r, c) => [dueValue(r, c.now)], options: () => DUE_OPTIONS },
  {
    key: 'subject', title: 'Subject', searchable: true, limit: 7,
    values: (r) => [r.scope_model ? subjectName(r) : NONE],
    options: (rows) => {
      const names = Array.from(new Set(rows.filter((r) => r.scope_model).map(subjectName).filter(Boolean))).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
      return rows.some((r) => !r.scope_model) ? names.concat([{ value: NONE, label: 'Uploaded workbook' }]) : names;
    },
  },
  {
    key: 'grade', title: 'Score',
    values: (r) => { const g = gradeValue(r); return g === null ? [] : [g]; },
    options: () => [...fromWords(gradeWords), { value: GRADE_NONE, label: 'Nothing answered yet' }, { value: GRADE_UNCOUNTED, label: 'Not scored' }],
  },
];

// ── quick views ─────────────────────────────────────────────────────────────────

const QUICK: QuickDef<RegisterRow>[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'waiting', label: 'Waiting for me', test: (r) => r.waiting, note: (c) => (c.me == null ? 'Your account could not be read, so nothing is counted here.' : 'Assessments with a control assigned to you, a draft you own to scope, or evidence for you to decide.') },
  { id: 'mine', label: 'Mine', test: (r, c) => c.me != null && r.owner_id === c.me, note: (c) => (c.me == null ? 'Your account could not be read, so nothing is counted here.' : undefined) },
  { id: 'scoping', label: 'To scope', test: (r, c) => c.me != null && r.phase === 'scoping' && r.owner_id === c.me, note: () => 'Drafts you own that are still being scoped.' },
  { id: 'overdue', label: 'Overdue gaps', test: (r) => (r.entry?.sla_counts?.overdue ?? 0) > 0 },
  { id: 'notstarted', label: 'Not started', test: (r) => !!r.entry && r.entry.content === null },
  { id: 'due30', label: 'Due in 30 days', test: (r, c) => dueValue(r, c.now) === 'soon' },
];

// ── sorts ───────────────────────────────────────────────────────────────────────

const updatedAt = (r: ListRow): number => Date.parse(`${r.updated_at ?? r.created_at ?? ''}Z`) || 0;
const day = (value: string | null | undefined): number | null => dayNumber(value);

const SORTS: SortDef<RegisterRow>[] = [
  { key: 'name', label: 'Assessment', value: (r) => textKey(r.name) },
  { key: 'type', label: 'Type', value: (r) => textKey(typeLabel(r)) },
  { key: 'status', label: 'Status', value: (r) => rank(lifecycle.words, lifecycleOf(r)) },
  { key: 'score', label: 'Score', value: (r) => r.entry?.content ?? null, firstDir: 'desc' },
  { key: 'gaps', label: 'Open gaps', value: (r) => (r.entry?.sla_counts ? r.entry.sla_counts.open ?? 0 : null), firstDir: 'desc' },
  { key: 'overdue', label: 'Overdue gaps', value: (r) => (r.entry?.sla_counts ? r.entry.sla_counts.overdue ?? 0 : null), firstDir: 'desc' },
  { key: 'due', label: 'Due date', value: (r) => day(r.due_date) },
  { key: 'owner', label: 'Owner', value: (r) => textKey(r.owner_name) },
  { key: 'updated', label: 'Recently updated', value: (r) => updatedAt(r) || null, firstDir: 'desc' },
];

// ── the board and the export ────────────────────────────────────────────────────

/** The board's columns by status; a column is a set of the Status facet, which "Show all" opens in the list. */
export const BOARD_STATUS: Record<string, string[]> = {
  scoping: ['scoping'],
  draft: ['draft'],
  in_progress: ['in_progress'],
  in_review: ['in_review'],
  done: ['completed', 'archived'],
};

const dayText = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

export const REGISTER: RegisterDef<RegisterRow> = {
  noun: { one: 'assessment', other: 'assessments' },
  slug: 'assessments',
  facets: FACETS,
  quick: QUICK,
  shown: ['all', 'waiting', 'mine', 'scoping', 'overdue', 'notstarted'],
  haystack: (r) => `${r.name} ${typeLabel(r)} ${r.category} ${subjectName(r)} ${r.owner_name ?? ''} ${r.assessor ?? ''} ${r.file_name ?? ''} ${lifecycle.label(lifecycleOf(r))}`.toLowerCase(),
  sorts: SORTS,
  defaultSort: { key: 'updated', dir: 'desc' },
  tiebreak: (a, b) => updatedAt(b) - updatedAt(a) || b.id - a.id,
  csvHead: ['Assessment', 'Type', 'Category', 'Status', 'Subject', 'Owner', 'Assessor', 'Due date', 'Score', 'Score band', 'Open gaps', 'Overdue gaps', 'Controls'],
  csvRow: (r: RegisterRow, _c: Ctx) => [
    r.name, typeLabel(r), r.category, lifecycle.label(lifecycleOf(r)), subjectName(r), r.owner_name ?? '', r.assessor ?? '', dayText(r.due_date),
    r.entry?.content ?? '', r.entry ? (gradeOf(r.entry.content) ? gradeWords.label(gradeOf(r.entry.content) as string) : '') : '',
    r.entry?.sla_counts?.open ?? '', r.entry?.sla_counts?.overdue ?? '', r.total_items ?? '',
  ],
  board: {
    label: 'Assessments by status',
    columns: [
      { id: 'scoping', label: 'Scoping', test: (r) => lifecycleOf(r) === 'scoping' },
      { id: 'draft', label: 'Draft', test: (r) => lifecycleOf(r) === 'draft' },
      { id: 'in_progress', label: 'In progress', test: (r) => lifecycleOf(r) === 'in_progress' },
      { id: 'in_review', label: 'In review', test: (r) => lifecycleOf(r) === 'in_review' },
      { id: 'done', label: 'Completed', test: () => true },
    ],
  },
};

/** "assessments-2026-11-08-42-assessments.csv" (the BCM model names its files after BCM, so this area names its own). */
export function exportName(day: string, count: number, selectionOnly: boolean): string {
  return `assessments-${day}-${selectionOnly ? 'selected-' : ''}${count}-${count === 1 ? REGISTER.noun.one : REGISTER.noun.other}.csv`;
}
