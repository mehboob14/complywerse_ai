// The Drills & Invocations register as configuration of the facet explorer (components/records, via _register/registerModel.ts): facets, quick views with their numbers, sorts, the
// read-only board (Overdue, Scheduled, In progress, Done) and the export. Pure (no React), so `node --test` pins it (drillsRegister.test.ts). "Overdue" is the server's word for a drill
// still scheduled whose day has begun (`effective_status`); the day windows are the plan register's.
import { dayNumber, windowOf, type DrillRow } from '../bcmModel.ts';
import { dayWindow, drillStatus, drillType, sourceType } from '../../../../lib/statuses/bcm.ts';
import { ownerValue, peopleOptions, textKey, type Ctx, type FacetDef, type Option, type QuickDef, type RegisterDef, type SortDef } from '../_register/registerModel.ts';

const rank = (words: readonly string[], word: string | null | undefined): number | null => { const i = words.indexOf(String(word ?? '')); return i < 0 ? null : i; };
const fromWords = (registry: { words: readonly string[]; label: (w: string) => string }): Option[] => registry.words.map((value) => ({ value, label: registry.label(value) }));

/** Still to be run: scheduled (or overdue) or under way. */
export const isOpen = (d: Pick<DrillRow, 'status'>): boolean => d.status === 'scheduled' || d.status === 'in_progress';
/** Run, or finished with: the "Scheduled" facet has nothing to say about these but that they are past. */
export const HELD = 'held';

/** Where a drill stands against its day: Overdue is the server's word; a scheduled drill is in a window by its day; a drill under way or finished is `held`. */
export function whenOf(d: DrillRow, now: number): string {
  if (d.effective_status === 'overdue') return 'overdue';
  if (d.status !== 'scheduled') return HELD;
  const w = windowOf(d.scheduled_date, now);
  return w === 'overdue' ? 'overdue' : w;       // a scheduled drill whose day has gone by on the viewer's calendar but not yet on the server's clock is still late
}

const WHEN_OPTIONS: Option[] = dayWindow.words.map((value) => ({ value, label: dayWindow.label(value) })).concat([{ value: HELD, label: 'Started or finished' }]);
export type FindingsState = 'open' | 'closed' | 'none';
export const findingsOf = (d: Pick<DrillRow, 'finding_count' | 'open_finding_count'>): FindingsState => (d.open_finding_count > 0 ? 'open' : d.finding_count > 0 ? 'closed' : 'none');
const FINDINGS_OPTIONS: Option[] = [{ value: 'open', label: 'With open findings' }, { value: 'closed', label: 'All findings closed' }, { value: 'none', label: 'No findings' }];

const FACETS: FacetDef<DrillRow>[] = [
  { key: 'status', title: 'Status', values: (d) => [d.effective_status], options: () => fromWords(drillStatus), open: true },
  { key: 'when', title: 'Scheduled', values: (d, c) => [whenOf(d, c.now)], options: () => WHEN_OPTIONS, open: true },
  { key: 'findings', title: 'Findings', values: (d) => [findingsOf(d)], options: () => FINDINGS_OPTIONS, open: true },
  { key: 'type', title: 'Type', values: (d) => [d.drill_type], options: () => fromWords(drillType) },
  { key: 'source', title: 'Source', values: (d) => [d.source_type], options: () => fromWords(sourceType) },
  {
    key: 'plan', title: 'Plan', values: (d) => [String(d.plan_id)], searchable: true, limit: 7,
    options: (rows) => {
      const titles = new Map<string, string>();
      rows.forEach((d) => { if (!titles.has(String(d.plan_id))) titles.set(String(d.plan_id), d.plan_title || 'A plan that is gone'); });
      return Array.from(titles.entries()).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    },
  },
  { key: 'owner', title: 'Owner', values: (d) => [ownerValue(d.owner_id)], options: (rows) => peopleOptions(rows, (d) => d.owner_id, (d) => d.owner_name), searchable: true, limit: 7 },
];

const QUICK: QuickDef<DrillRow>[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'mine', label: 'Mine', test: (d, c) => c.me != null && d.owner_id === c.me, note: (c) => (c.me == null ? 'Your account could not be read, so nothing is counted here.' : undefined) },
  { id: 'overdue', label: 'Overdue', test: (d) => d.effective_status === 'overdue' },
  { id: 'soon', label: 'Next 30 days', test: (d, c) => d.status === 'scheduled' && d.effective_status !== 'overdue' && windowOf(d.scheduled_date, c.now) === 'soon' },
  { id: 'needresult', label: 'Needs a result', test: (d) => ['in_progress', 'completed', 'under_review'].includes(d.status) && !d.has_result },
  { id: 'openfindings', label: 'Open findings', test: (d) => d.open_finding_count > 0 },
];

const day = (v: string | null | undefined): number | null => dayNumber(v);
const SORTS: SortDef<DrillRow>[] = [
  { key: 'title', label: 'Drill', value: (d) => textKey(d.title) },
  { key: 'type', label: 'Type', value: (d) => rank(drillType.words, d.drill_type) },
  { key: 'source', label: 'Source', value: (d) => rank(sourceType.words, d.source_type) },
  { key: 'status', label: 'Status', value: (d) => rank(drillStatus.words, d.effective_status) },
  { key: 'scheduled', label: 'Scheduled', value: (d) => day(d.scheduled_date), firstDir: 'desc' },
  { key: 'owner', label: 'Owner', value: (d) => textKey(d.owner_name) },
  { key: 'findings', label: 'Findings', value: (d) => d.finding_count, firstDir: 'desc' },
];

const dayText = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

export const DRILLS: RegisterDef<DrillRow> = {
  noun: { one: 'drill', other: 'drills' },
  slug: 'drills',
  facets: FACETS,
  quick: QUICK,
  shown: ['all', 'mine', 'overdue', 'soon', 'needresult', 'openfindings'],
  haystack: (d) => `${d.title} ${d.plan_title ?? ''} ${d.owner_name ?? ''} ${drillType.label(d.drill_type)} ${sourceType.label(d.source_type)} ${drillStatus.label(d.effective_status)}`.toLowerCase(),
  sorts: SORTS,
  defaultSort: { key: 'scheduled', dir: 'desc' },
  tiebreak: (a, b) => (day(b.scheduled_date) ?? -Infinity) - (day(a.scheduled_date) ?? -Infinity) || b.id - a.id,
  csvHead: ['Drill', 'Plan', 'Type', 'Source', 'Status', 'Scheduled', 'Owner', 'Result recorded', 'Findings', 'Open findings'],
  csvRow: (d: DrillRow, _c: Ctx) => [
    d.title, d.plan_title ?? '', drillType.label(d.drill_type), sourceType.label(d.source_type), drillStatus.label(d.effective_status), dayText(d.scheduled_date), d.owner_name ?? '',
    d.has_result ? 'Yes' : 'No', d.finding_count, d.open_finding_count,
  ],
  board: {
    label: 'Drills by stage',
    columns: [
      { id: 'overdue', label: 'Overdue', test: (d) => d.effective_status === 'overdue' },
      { id: 'scheduled', label: 'Scheduled', test: (d) => d.effective_status === 'scheduled' },
      { id: 'in_progress', label: 'In progress', test: (d) => d.status === 'in_progress' },
      { id: 'done', label: 'Done', test: (d) => ['completed', 'under_review', 'closed'].includes(d.status) },
    ],
    note: (rows) => {
      const cancelled = rows.filter((d) => d.status === 'cancelled').length;
      return cancelled ? `${cancelled} cancelled ${cancelled === 1 ? 'drill is' : 'drills are'} not on the board.` : undefined;
    },
  },
};
