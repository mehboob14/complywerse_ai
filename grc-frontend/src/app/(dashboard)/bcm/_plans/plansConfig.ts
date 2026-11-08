// The Continuity Plans register as configuration of the facet explorer (components/records, via _register/registerModel.ts): the facets with their values, the quick views and the
// number each would show, the sorts, the export. Pure (no React), so `node --test` pins it (plansRegister.test.ts). The words are lib/statuses/bcm.ts; the day rules (a review day within
// 30 days, tested in the last 12 months) are the ones the Overview's counters use, so a counter and the list it opens say the same number.
import { dayNumber, testedOf, windowOf, type PlanRow } from '../bcmModel.ts';
import { dayWindow, frequency, planStatus, testedState } from '../../../../lib/statuses/bcm.ts';
import { NONE, ownerValue, peopleOptions, textKey, type Ctx, type FacetDef, type Option, type QuickDef, type RegisterDef, type SortDef } from '../_register/registerModel.ts';

/** A plan in use: not retired. A retired plan has no review, testing or strategy to chase. */
export const isActive = (p: Pick<PlanRow, 'status'>): boolean => p.status !== 'retired';

const rank = (words: readonly string[], word: string | null | undefined): number | null => { const i = words.indexOf(String(word ?? '')); return i < 0 ? null : i; };
const fromWords = (registry: { words: readonly string[]; label: (w: string) => string }): Option[] => registry.words.map((value) => ({ value, label: registry.label(value) }));
const unitOf = (p: PlanRow): string => (p.business_unit ?? '').trim();

const FACETS: FacetDef<PlanRow>[] = [
  { key: 'status', title: 'Status', values: (p) => [p.status], options: () => fromWords(planStatus), open: true },
  { key: 'review', title: 'Review', values: (p, c) => (isActive(p) ? [windowOf(p.next_review_due, c.now)] : []), options: () => fromWords(dayWindow), open: true },
  { key: 'tested', title: 'Testing', values: (p, c) => (isActive(p) ? [testedOf(p.last_drill_at, c.now)] : []), options: () => fromWords(testedState), open: true },
  {
    key: 'owner', title: 'Owner', values: (p) => [ownerValue(p.owner_id)], options: (rows) => peopleOptions(rows, (p) => p.owner_id, (p) => p.owner_name), searchable: true, limit: 7,
  },
  { key: 'cadence', title: 'Testing cadence', values: (p) => [p.testing_frequency], options: () => fromWords(frequency) },
  {
    key: 'unit', title: 'Business unit', values: (p) => [unitOf(p) || NONE], searchable: true, limit: 7,
    options: (rows) => {
      const units = Array.from(new Set(rows.map(unitOf).filter(Boolean))).sort((a, b) => a.localeCompare(b)).map((value) => ({ value, label: value }));
      return rows.some((p) => !unitOf(p)) ? units.concat([{ value: NONE, label: 'No business unit' }]) : units;
    },
  },
];

const QUICK: QuickDef<PlanRow>[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'mine', label: 'Mine', test: (p, c) => c.me != null && p.owner_id === c.me, note: (c) => (c.me == null ? 'Your account could not be read, so nothing is counted here.' : undefined) },
  { id: 'review', label: 'Review due', test: (p, c) => isActive(p) && ['overdue', 'soon'].includes(windowOf(p.next_review_due, c.now)) },
  { id: 'untested', label: 'Not tested in 12 months', test: (p, c) => isActive(p) && testedOf(p.last_drill_at, c.now) !== 'recent' },
  { id: 'nostrategy', label: 'No recovery strategy', test: (p) => isActive(p) && p.bia_incomplete > 0 },
  { id: 'draft', label: 'Drafts', test: (p) => p.status === 'draft' },
];

const updatedAt = (p: PlanRow): number => Date.parse(`${p.updated_at ?? ''}Z`) || 0;
const day = (value: string | null | undefined): number | null => dayNumber(value);

const SORTS: SortDef<PlanRow>[] = [
  { key: 'title', label: 'Plan', value: (p) => textKey(p.title) },
  { key: 'status', label: 'Status', value: (p) => rank(planStatus.words, p.status) },
  { key: 'review', label: 'Review due', value: (p) => day(p.next_review_due) },
  { key: 'rto', label: 'RTO', value: (p) => p.rto_hours },
  { key: 'rpo', label: 'RPO', value: (p) => p.rpo_hours },
  { key: 'owner', label: 'Owner', value: (p) => textKey(p.owner_name) },
  { key: 'cadence', label: 'Testing cadence', value: (p) => rank(frequency.words, p.testing_frequency) },
  { key: 'bia', label: 'Processes', value: (p) => p.bia_count },
  { key: 'drills', label: 'Drills', value: (p) => p.drill_count },
  { key: 'tested', label: 'Last drill', value: (p) => (p.last_drill_at ? day(p.last_drill_at) : null) },
  { key: 'updated', label: 'Recently updated', value: (p) => updatedAt(p) || null, firstDir: 'desc' },
];

const dayText = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

export const PLANS: RegisterDef<PlanRow> = {
  noun: { one: 'plan', other: 'plans' },
  slug: 'plans',
  facets: FACETS,
  quick: QUICK,
  shown: ['all', 'mine', 'review', 'untested', 'nostrategy', 'draft'],
  haystack: (p) => `${p.title} ${p.business_unit ?? ''} ${p.owner_name ?? ''} ${planStatus.label(p.status)} ${p.document_title ?? ''}`.toLowerCase(),
  sorts: SORTS,
  defaultSort: { key: 'updated', dir: 'desc' },
  tiebreak: (a, b) => updatedAt(b) - updatedAt(a) || b.id - a.id,
  csvHead: ['Plan', 'Status', 'Business unit', 'Owner', 'RTO (hours)', 'RPO (hours)', 'Testing cadence', 'Review due', 'Last drill', 'Processes', 'Processes without a strategy', 'Drills'],
  csvRow: (p: PlanRow, _c: Ctx) => [
    p.title, planStatus.label(p.status), p.business_unit ?? '', p.owner_name ?? '', p.rto_hours ?? '', p.rpo_hours ?? '', frequency.label(p.testing_frequency),
    dayText(p.next_review_due), dayText(p.last_drill_at), p.bia_count, p.bia_incomplete, p.drill_count,
  ],
};
