// The rules of the Business Continuity pages, apart from React so `node --test` can pin them (bcmModel.test.ts): the shapes the API answers with, how hours are
// read and written, what a list shows (the filters, the sort, the page, the count and what it says when the server cut it), what each form sends (the payloads
// are the ones the pages have always sent), what each form refuses before sending, what a confirmation says it will take with it, and what the Overview's
// figures say. The figures themselves (RTO/RPO pass rates, drill coverage, open findings) are the SERVER's: this only words them.
import { EMPTY, formatCount, truncate } from '../../../lib/format.ts';
import { oneOf, text, integer, sortOf, flag } from '../../../lib/addressState.ts';
import { pageRange } from '../../../lib/pagerModel.ts';
import { sortRows, type SortState, type SortValue } from '../../../components/ui/ds/tableModel.ts';
import { canRetry } from '../../../components/ui/ds/reportOutcome.ts';
import { drillStatus, frequency, planStatus, severity } from '../../../lib/statuses/bcm.ts';

// ── the shapes of what the API answers (the serializers of backend/grc/modules/bcm/routers/_common.py) ──
export interface Dependency { id: number; bia_id: number; dependency_type: string; name: string; criticality: string | null; external_bcp_status: string | null; notes: string | null }
export interface Strategy { id: number; bia_id: number; strategy_type: string; description: string | null; status: string; approved_by_name?: string | null; approved_date?: string | null; review_comments?: string | null }
export interface LinkedAsset { id: number; name: string; asset_type?: string | null }
export interface Bia {
  id: number; plan_id: number; process_name: string; description: string | null; criticality_rating: string;
  rto_hours: number | null; rpo_hours: number | null; mtpd_hours: number | null;
  linked_risk_id: number | null; linked_risk_title?: string | null; linked_asset_ids?: number[]; linked_assets?: LinkedAsset[];
  is_complete: boolean; dependency_count: number; strategy_count: number; dependencies?: Dependency[]; recovery_strategies?: Strategy[];
}
export interface Finding {
  id: number; drill_id: number; title: string; description: string | null; severity: string;
  linked_issue_id: number | null; issue_code: string | null; issue_status: string; is_open: boolean; linked_risk_id: number | null; linked_risk_title: string | null;
}
export interface DrillResult {
  id: number; drill_id: number; rto_met: boolean | null; rpo_met: boolean | null; actual_rto_hours: number | null; actual_rpo_hours: number | null;
  summary: string | null; recorded_by_name: string | null; recorded_at: string | null;
}
export interface Drill {
  id: number; plan_id: number; plan_title: string | null; title: string; drill_type: string; scenario: string | null;
  scheduled_date: string | null; actual_start: string | null; actual_end: string | null; owner_id: number | null; owner_name: string | null;
  status: string; is_overdue: boolean; effective_status: string; source_type: string; linked_incident_id: number | null; linked_incident_title: string | null;
  has_result: boolean; finding_count: number; result?: DrillResult | null; findings?: Finding[];
}
export interface Plan {
  id: number; title: string; description: string | null; business_unit: string | null; status: string;
  document_ref_id: number | null; document_title: string | null; owner_id: number | null; owner_name: string | null;
  rto_hours: number | null; rpo_hours: number | null; testing_frequency: string; version: number | null;
  approved_by_name: string | null; approved_date: string | null; next_review_due: string | null;
  bia_count: number; drill_count: number; bia_records?: Bia[]; drills?: Drill[];
}
export interface Dashboard {
  totals: { plans: number; active_plans: number; drills: number; overdue_drills: number; bia_records: number; open_findings: number };
  plans_by_status: Record<string, number>;
  drills_by_status: Record<string, number>;
  drill_coverage_pct: number;
  coverage_detail: { covered: number; active_plans: number };
  rto_pass_rate: number | null;
  rpo_pass_rate: number | null;
  results_scored: number;
  open_findings_by_severity: Record<string, number>;
  linkage?: { open_capas: number; total_capas: number; risks_linked: number; incident_invocations: number };
  recent_drills: Drill[];
  overdue_drills: Drill[];
}
/** What the plans and drills lists answer: the rows (at most `limit`, 200 by default) and the TRUE number the server holds. */
export interface Page<T> { items: T[]; total: number }

/** A list route's answer as a page, or null when it is not one (the page then says it could not read the answer instead of drawing an empty list). A missing
 *  `total` is the number of rows that came, which is all that is known. */
export function asPage<T>(data: unknown): Page<T> | null {
  const o = data && typeof data === 'object' ? (data as { items?: unknown; total?: unknown }) : null;
  if (!o || !Array.isArray(o.items)) return null;
  const items = o.items as T[];
  return { items, total: typeof o.total === 'number' && Number.isFinite(o.total) && o.total >= items.length ? o.total : items.length };
}

/** A read is tried twice more when trying again can help (the server is down, the network dropped); a refusal (403) or a missing record (404) is said at
 *  once. React Query's default (three more tries with a back-off) made a refusal a seven-second spinner. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

// ── hours ──
/** "—" when none is recorded, else "8h": how the module has always written an hours figure. */
export const fmtHours = (h: number | null | undefined): string => (h == null ? EMPTY : `${h}h`);
/** The largest number the column holds (a Postgres integer): more is a bare 500 from the server. */
export const HOURS_MAX = 2147483647;
export const HOURS_WORDS = 'Enter whole hours, 0 or more.';

export type Hours = { ok: true; value: number | null } | { ok: false; message: string };

/** What a person typed in an hours field: nothing is "none recorded" (null), a whole number from 0 up is that number, anything else is refused with a sentence
 *  (the server answers a fraction with a 422 list and a huge number with a 500). */
export function parseHours(input: string | number | null | undefined): Hours {
  const t = String(input ?? '').trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d+$/.test(t)) return { ok: false, message: HOURS_WORDS };
  const n = Number(t);
  return n <= HOURS_MAX ? { ok: true, value: n } : { ok: false, message: 'That is more hours than can be stored.' };
}
const hoursOrNull = (input: string): number | null => { const h = parseHours(input); return h.ok ? h.value : null; };
const hoursText = (n: number | null | undefined): string => (n == null ? '' : String(n));

/** The longest title, name or business unit the server stores (String(255)): a longer one is a bare 500. */
export const NAME_MAX = 255;

/** "1 drill", "2 drills", "0 drills". */
export const plural = (n: number, one: string, other: string = `${one}s`): string => `${formatCount(n)} ${n === 1 ? one : other}`;
const orNull = (s: string): string | null => (s ? s : null);

// ── the plan form (create, edit) ──
export interface PlanForm {
  title: string; business_unit: string; description: string; owner_id: number | null; owner_name: string; document_ref_id: number | null; document_title: string;
  rto_hours: string; rpo_hours: string; testing_frequency: string; next_review_due: string;
}
export const blankPlanForm = (): PlanForm => ({
  title: '', business_unit: '', description: '', owner_id: null, owner_name: '', document_ref_id: null, document_title: '',
  rto_hours: '', rpo_hours: '', testing_frequency: 'annual', next_review_due: '',
});
/** The form of a plan being edited: what it holds today (a review day is the first ten characters of the stored moment). */
export const planFormFrom = (p: Plan): PlanForm => ({
  title: p.title, business_unit: p.business_unit || '', description: p.description || '', owner_id: p.owner_id, owner_name: p.owner_name || '',
  document_ref_id: p.document_ref_id, document_title: p.document_title || '', rto_hours: hoursText(p.rto_hours), rpo_hours: hoursText(p.rpo_hours),
  testing_frequency: p.testing_frequency, next_review_due: p.next_review_due ? p.next_review_due.slice(0, 10) : '',
});
export interface PlanErrors { title?: string; rto_hours?: string; rpo_hours?: string }
/** What a plan form refuses before it is sent. The title is required (as before: the button was off while it was blank) and a title the column cannot hold is said, not sent. */
export function planErrors(f: PlanForm): PlanErrors {
  const e: PlanErrors = {};
  if (!f.title.trim()) e.title = 'Enter a title.';
  else if (f.title.length > NAME_MAX) e.title = `Use at most ${NAME_MAX} characters.`;
  const rto = parseHours(f.rto_hours); if (!rto.ok) e.rto_hours = rto.message;
  const rpo = parseHours(f.rpo_hours); if (!rpo.ok) e.rpo_hours = rpo.message;
  return e;
}
/** Exactly what Add Plan has always sent. */
export const planCreatePayload = (f: PlanForm) => ({
  title: f.title, business_unit: orNull(f.business_unit), description: orNull(f.description), owner_id: f.owner_id, document_ref_id: f.document_ref_id,
  rto_hours: hoursOrNull(f.rto_hours), rpo_hours: hoursOrNull(f.rpo_hours), testing_frequency: f.testing_frequency, next_review_due: orNull(f.next_review_due),
});
/** Exactly what Edit plan has always sent (an emptied field clears the value). */
export const planUpdatePayload = (f: PlanForm) => ({
  title: f.title, business_unit: orNull(f.business_unit), description: orNull(f.description),
  rto_hours: hoursOrNull(f.rto_hours), rpo_hours: hoursOrNull(f.rpo_hours), testing_frequency: f.testing_frequency, next_review_due: orNull(f.next_review_due),
  document_ref_id: f.document_ref_id, owner_id: f.owner_id,
});
const PLAN_FIELDS: Array<keyof PlanForm> = ['title', 'business_unit', 'description', 'owner_id', 'document_ref_id', 'rto_hours', 'rpo_hours', 'testing_frequency', 'next_review_due'];
/** Typed input that would be lost: a field differs from where the form opened (the names of a picked owner or document are display, not input). */
export const planDirty = (opened: PlanForm, now: PlanForm): boolean => PLAN_FIELDS.some((k) => opened[k] !== now[k]);

// ── the drill forms (create, schedule from a plan, edit) ──
export interface DrillForm {
  plan_id: string; title: string; drill_type: string; source_type: string; scheduled_date: string; scenario: string;
  incident_id: number | null; incident_title: string; owner_id: number | null; owner_name: string;
}
export const blankDrillForm = (): DrillForm => ({
  plan_id: '', title: '', drill_type: 'tabletop', source_type: 'scheduled_test', scheduled_date: '', scenario: '', incident_id: null, incident_title: '', owner_id: null, owner_name: '',
});
export const drillFormFrom = (d: Drill): DrillForm => ({
  plan_id: String(d.plan_id), title: d.title, drill_type: d.drill_type, source_type: d.source_type, scheduled_date: d.scheduled_date ? d.scheduled_date.slice(0, 10) : '',
  scenario: d.scenario || '', incident_id: d.linked_incident_id, incident_title: d.linked_incident_title || '', owner_id: d.owner_id, owner_name: d.owner_name || '',
});
export interface DrillErrors { plan_id?: string; title?: string; incident_id?: string }
/** `needsPlan`: the form that creates a drill from the Drills page picks the plan; scheduling from a plan and editing do not. */
export function drillErrors(f: DrillForm, { needsPlan }: { needsPlan: boolean }): DrillErrors {
  const e: DrillErrors = {};
  if (needsPlan && !f.plan_id) e.plan_id = 'Choose a plan.';
  if (!f.title.trim()) e.title = 'Enter a title.';
  else if (f.title.length > NAME_MAX) e.title = `Use at most ${NAME_MAX} characters.`;
  if (f.source_type === 'incident_triggered' && !f.incident_id) e.incident_id = 'Choose the incident this activation answered.';
  return e;
}
/** What Schedule Drill (the Drills page) has always sent. */
export const drillCreatePayload = (f: DrillForm) => ({
  plan_id: Number(f.plan_id), title: f.title, drill_type: f.drill_type, source_type: f.source_type, scheduled_date: orNull(f.scheduled_date), scenario: orNull(f.scenario),
  linked_incident_id: f.source_type === 'incident_triggered' ? f.incident_id : null,
});
/** What Schedule drill (a plan's page) has always sent. */
export const drillSchedulePayload = (planId: number, f: DrillForm) => ({
  plan_id: planId, title: f.title, drill_type: f.drill_type, scheduled_date: orNull(f.scheduled_date), scenario: orNull(f.scenario), source_type: 'scheduled_test',
});
/** What Edit drill has always sent. */
export const drillUpdatePayload = (f: DrillForm, isIncident: boolean) => ({
  title: f.title, drill_type: f.drill_type, scenario: orNull(f.scenario), scheduled_date: orNull(f.scheduled_date), owner_id: f.owner_id,
  linked_incident_id: isIncident ? f.incident_id : null,
});
const DRILL_FIELDS: Array<keyof DrillForm> = ['plan_id', 'title', 'drill_type', 'source_type', 'scheduled_date', 'scenario', 'incident_id', 'owner_id'];
export const drillDirty = (opened: DrillForm, now: DrillForm): boolean => DRILL_FIELDS.some((k) => opened[k] !== now[k]);

// ── the BIA forms: a process, a dependency, a strategy ──
export interface BiaForm { process_name: string; criticality_rating: string; rto_hours: string; rpo_hours: string; mtpd_hours: string; description: string; linked_asset_ids: number[] }
export const blankBiaForm = (): BiaForm => ({ process_name: '', criticality_rating: 'medium', rto_hours: '', rpo_hours: '', mtpd_hours: '', description: '', linked_asset_ids: [] });
export interface BiaErrors { process_name?: string; rto_hours?: string; rpo_hours?: string; mtpd_hours?: string }
/** The same rule the server enforces ("RTO must be shorter than MTPD") is said before the request when both are set. */
export function biaErrors(f: BiaForm): BiaErrors {
  const e: BiaErrors = {};
  if (!f.process_name.trim()) e.process_name = 'Enter a process name.';
  else if (f.process_name.length > NAME_MAX) e.process_name = `Use at most ${NAME_MAX} characters.`;
  const rto = parseHours(f.rto_hours); if (!rto.ok) e.rto_hours = rto.message;
  const rpo = parseHours(f.rpo_hours); if (!rpo.ok) e.rpo_hours = rpo.message;
  const mtpd = parseHours(f.mtpd_hours); if (!mtpd.ok) e.mtpd_hours = mtpd.message;
  if (rto.ok && mtpd.ok && rto.value !== null && mtpd.value !== null && rto.value >= mtpd.value) e.mtpd_hours = 'RTO must be shorter than MTPD.';
  return e;
}
/** What Add process has always sent. */
export const biaCreatePayload = (f: BiaForm) => ({
  process_name: f.process_name, criticality_rating: f.criticality_rating, description: orNull(f.description),
  rto_hours: hoursOrNull(f.rto_hours), rpo_hours: hoursOrNull(f.rpo_hours), mtpd_hours: hoursOrNull(f.mtpd_hours), linked_asset_ids: f.linked_asset_ids,
});
export const biaDirty = (f: BiaForm): boolean => {
  const b = blankBiaForm();
  return (Object.keys(b) as Array<keyof BiaForm>).some((k) => (k === 'linked_asset_ids' ? f.linked_asset_ids.length > 0 : f[k] !== b[k]));
};

export interface DependencyForm { dependency_type: string; name: string; criticality: string; external_bcp_status: string }
export const blankDependencyForm = (): DependencyForm => ({ dependency_type: 'system', name: '', criticality: 'medium', external_bcp_status: '' });
export function dependencyErrors(f: DependencyForm): { name?: string } {
  if (!f.name.trim()) return { name: 'Enter the name.' };
  return f.name.length > NAME_MAX ? { name: `Use at most ${NAME_MAX} characters.` } : {};
}
/** What Add dependency has always sent: a vendor with no choice made is "requested" (the server needs one for a vendor). A dependency that is not a vendor sends none
 *  (the field is not on the form for it; the old form could send a choice made for a vendor before the type was changed). */
export const dependencyPayload = (f: DependencyForm) => ({
  dependency_type: f.dependency_type, name: f.name, criticality: f.criticality,
  external_bcp_status: f.dependency_type === 'vendor' ? (f.external_bcp_status || 'requested') : null,
});
export interface StrategyForm { strategy_type: string; description: string }
export const blankStrategyForm = (): StrategyForm => ({ strategy_type: 'alternate_site', description: '' });
/** What Add strategy has always sent. */
export const strategyPayload = (f: StrategyForm) => ({ strategy_type: f.strategy_type, description: orNull(f.description) });

export interface FindingForm { title: string; description: string; severity: string }
export const blankFindingForm = (): FindingForm => ({ title: '', description: '', severity: 'medium' });
export function findingErrors(f: FindingForm): { title?: string } {
  if (!f.title.trim()) return { title: 'Enter a title.' };
  return f.title.length > NAME_MAX ? { title: `Use at most ${NAME_MAX} characters.` } : {};
}
/** What Raise finding has always sent. */
export const findingPayload = (f: FindingForm) => ({ title: f.title, description: orNull(f.description), severity: f.severity });

// ── the drill's result ──
export type Tri = '' | 'yes' | 'no';
export const triOf = (v: boolean | null | undefined): Tri => (v === true ? 'yes' : v === false ? 'no' : '');
export const TRI_OPTIONS: Array<{ value: Tri; label: string }> = [
  { value: '', label: 'Not assessed' },
  { value: 'yes', label: 'Yes — met' },
  { value: 'no', label: 'No — missed' },
];
export const triLabel = (v: boolean | null | undefined): string => (TRI_OPTIONS.find((o) => o.value === triOf(v)) as { label: string }).label;
export interface ResultForm { rto_met: Tri; rpo_met: Tri; actual_rto_hours: string; actual_rpo_hours: string; summary: string }
export const resultFormFrom = (r: DrillResult | null | undefined): ResultForm => ({
  rto_met: triOf(r?.rto_met), rpo_met: triOf(r?.rpo_met), actual_rto_hours: hoursText(r?.actual_rto_hours), actual_rpo_hours: hoursText(r?.actual_rpo_hours), summary: r?.summary ?? '',
});
export function resultErrors(f: ResultForm): { actual_rto_hours?: string; actual_rpo_hours?: string } {
  const e: { actual_rto_hours?: string; actual_rpo_hours?: string } = {};
  const a = parseHours(f.actual_rto_hours); if (!a.ok) e.actual_rto_hours = a.message;
  const b = parseHours(f.actual_rpo_hours); if (!b.ok) e.actual_rpo_hours = b.message;
  return e;
}
/** What Save result has always sent. */
export const resultPayload = (f: ResultForm) => ({
  rto_met: f.rto_met === '' ? null : f.rto_met === 'yes', rpo_met: f.rpo_met === '' ? null : f.rpo_met === 'yes',
  actual_rto_hours: hoursOrNull(f.actual_rto_hours), actual_rpo_hours: hoursOrNull(f.actual_rpo_hours), summary: orNull(f.summary),
});
export const resultDirty = (saved: ResultForm, now: ResultForm): boolean => (Object.keys(saved) as Array<keyof ResultForm>).some((k) => saved[k] !== now[k]);

// ── status moves ──
/** The states a plan can be moved to from `current`: every other one (the server only asks RTO and RPO of "approved"). */
export const planMoves = (current: string): string[] => planStatus.words.filter((s) => s !== current);
/** The states a drill can be moved to: every stored state but its own (`overdue` is derived, never stored; the server asks a result of "closed"). */
export const DRILL_FLOW: readonly string[] = ['scheduled', 'in_progress', 'completed', 'under_review', 'closed', 'cancelled'];
export const drillMoves = (current: string): string[] => DRILL_FLOW.filter((s) => s !== current);

// ── the lists: what they filter, how they sort, what they say ──
/** Rows in the plans' and drills' sorts that are not words: a plan or drill's position in its own flow, a severity's in its scale (critical first). */
const rank = (words: readonly string[], word: string | null | undefined): number | null => { const i = words.indexOf(String(word ?? '')); return i < 0 ? null : i; };
/** A day as a sortable text ("2026-11-05"): the first ten characters of the stored moment, none when there is none. */
const dayOf = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null);

export const PLAN_SORT_KEYS = ['title', 'status', 'rto', 'rpo', 'review', 'owner', 'cadence', 'bia', 'drills'] as const;
export function planSortValue(p: Plan, key: string): SortValue {
  switch (key) {
    case 'title': return p.title;
    case 'status': return rank(planStatus.words, p.status);
    case 'rto': return p.rto_hours;
    case 'rpo': return p.rpo_hours;
    case 'review': return dayOf(p.next_review_due);
    case 'owner': return p.owner_name;
    case 'cadence': return rank(frequency.words, p.testing_frequency);
    case 'bia': return p.bia_count;
    case 'drills': return p.drill_count;
    default: return null;
  }
}
/** The old rules, unchanged: a status filter is the plan's own status; a search is any part of the title or the business unit, in any case. */
export function filterPlans(plans: readonly Plan[], { q, status }: { q: string; status: string }): Plan[] {
  let rows = plans.slice();
  if (status !== 'all') rows = rows.filter((p) => p.status === status);
  const needle = q.trim().toLowerCase();
  if (needle) rows = rows.filter((p) => (p.title || '').toLowerCase().includes(needle) || (p.business_unit || '').toLowerCase().includes(needle));
  return rows;
}

export const DRILL_SORT_KEYS = ['title', 'type', 'source', 'status', 'scheduled', 'owner', 'findings'] as const;
export function drillSortValue(d: Drill, key: string): SortValue {
  switch (key) {
    case 'title': return d.title;
    case 'type': return rank(['tabletop', 'simulation', 'full_failover', 'call_tree'], d.drill_type);
    case 'source': return d.source_type;
    case 'status': return rank(drillStatus.words, d.effective_status);
    case 'scheduled': return dayOf(d.scheduled_date);
    case 'owner': return d.owner_name;
    case 'findings': return d.finding_count;
    default: return null;
  }
}
/** The old rules, unchanged: the status filter is the EFFECTIVE status (a scheduled drill past its day reads overdue); a search is any part of the title or the plan's title. */
export function filterDrills(drills: readonly Drill[], { q, status, type, source }: { q: string; status: string; type: string; source: string }): Drill[] {
  let rows = drills.slice();
  if (status !== 'all') rows = rows.filter((d) => d.effective_status === status);
  if (type !== 'all') rows = rows.filter((d) => d.drill_type === type);
  if (source !== 'all') rows = rows.filter((d) => d.source_type === source);
  const needle = q.trim().toLowerCase();
  if (needle) rows = rows.filter((d) => (d.title || '').toLowerCase().includes(needle) || (d.plan_title || '').toLowerCase().includes(needle));
  return rows;
}

export const BIA_SORT_KEYS = ['process', 'criticality', 'rto', 'rpo', 'mtpd', 'assets', 'dependencies', 'strategies', 'complete'] as const;
export function biaSortValue(b: Bia, key: string): SortValue {
  switch (key) {
    case 'process': return b.process_name;
    case 'criticality': return rank(severity.words, b.criticality_rating);
    case 'rto': return b.rto_hours;
    case 'rpo': return b.rpo_hours;
    case 'mtpd': return b.mtpd_hours;
    case 'assets': return b.linked_assets?.length ?? 0;
    case 'dependencies': return b.dependency_count;
    case 'strategies': return b.strategy_count;
    case 'complete': return b.is_complete ? 1 : 0;
    default: return null;
  }
}
export const FINDING_SORT_KEYS = ['title', 'severity', 'status'] as const;
export function findingSortValue(f: Finding, key: string): SortValue {
  switch (key) {
    case 'title': return f.title;
    case 'severity': return rank(severity.words, f.severity);
    case 'status': return f.issue_status;
    default: return null;
  }
}

/** Rows in the order a sort asks for (no sort: the order they came in: the server's, most recently updated plans first). */
export function ordered<T>(rows: readonly T[], sort: SortState, valueOf: (row: T, key: string) => SortValue): T[] {
  return sortRows(rows, sort, valueOf);
}
/** The rows of page `page` out of `rows` (the range is clamped into the pages that exist). */
export function pageOf<T>(rows: readonly T[], page: number, size: number): { rows: T[]; range: ReturnType<typeof pageRange> } {
  const range = pageRange(page, size, rows.length);
  return { rows: range.to === 0 ? [] : rows.slice(range.from - 1, range.to), range };
}

/** What the address of the Continuity Plans list holds. (`new` opens the Add plan form: the Overview's first-use action and a link someone shares.) */
export const PLAN_FILTERS: string[] = ['all'].concat(planStatus.words);
export const PLAN_LIST_SCHEMA = {
  q: text(),
  status: oneOf(PLAN_FILTERS, 'all'),
  sort: sortOf(PLAN_SORT_KEYS, null),
  page: integer(1, { min: 1 }),
  size: integer(25, { min: 1, max: 200 }),
  new: flag(),
};
export const DRILL_STATUS_FILTERS: string[] = ['all'].concat(drillStatus.words);
export const DRILL_TYPE_FILTERS: string[] = ['all', 'tabletop', 'simulation', 'full_failover', 'call_tree'];
export const DRILL_SOURCE_FILTERS: string[] = ['all', 'scheduled_test', 'incident_triggered'];
/** What the address of the Drills & Invocations list holds (`?status=overdue` is where the Overview's overdue counter opens). */
export const DRILL_LIST_SCHEMA = {
  q: text(),
  status: oneOf(DRILL_STATUS_FILTERS, 'all'),
  type: oneOf(DRILL_TYPE_FILTERS, 'all'),
  source: oneOf(DRILL_SOURCE_FILTERS, 'all'),
  sort: sortOf(DRILL_SORT_KEYS, null),
  page: integer(1, { min: 1 }),
  size: integer(25, { min: 1, max: 200 }),
  new: flag(),
};
export const PAGE_SIZES: readonly number[] = [10, 25, 50, 100];

/** The line above a list the server cut: the true total, and what the page's own search, filters and sort do (they work on the rows that came). null when it is all there. */
export function cutNotice({ loaded, total, noun, order = 'most recently updated' }: { loaded: number; total: number; noun: { one: string; other: string }; order?: string }): { title: string; message: string } | null {
  if (total <= loaded) return null;
  return {
    title: `Showing ${formatCount(loaded)} of ${formatCount(total)} ${noun.other}`,
    message: `The server sends the ${formatCount(loaded)} ${order}. Search, filters and sorting work on these ${formatCount(loaded)}.`,
  };
}

// ── what a delete says it will take with it ──
const quoted = (title: string): string => `“${truncate(title, 80).text}”`;
export function planDeleteWords(p: Pick<Plan, 'title' | 'bia_count' | 'drill_count'>): { title: string; message: string; confirmLabel: string } {
  return {
    title: 'Delete this plan?',
    message: `${quoted(p.title)} will be deleted with its ${plural(p.bia_count, 'business impact analysis process', 'business impact analysis processes')} and ${plural(p.drill_count, 'drill')} (and their results and findings). Issues and risks raised from them stay. This can't be undone.`,
    confirmLabel: 'Delete plan',
  };
}
export function drillDeleteWords(d: Pick<Drill, 'title' | 'finding_count'>): { title: string; message: string; confirmLabel: string } {
  return {
    title: 'Delete this drill?',
    message: `${quoted(d.title)} will be deleted with its result and ${plural(d.finding_count, 'finding')}. Issues and risks raised from the findings stay. This can't be undone.`,
    confirmLabel: 'Delete drill',
  };
}
export const dependencyDeleteWords = (name: string) => ({ title: 'Remove this dependency?', message: `${quoted(name)} will be removed from this process. This can't be undone.`, confirmLabel: 'Remove dependency' });
export const strategyDeleteWords = (label: string) => ({
  title: 'Delete this recovery strategy?',
  message: `The ${label} strategy will be deleted. If it is the process's last one, the process is marked as needing a recovery strategy again. This can't be undone.`,
  confirmLabel: 'Delete strategy',
});
export const findingDeleteWords = (title: string) => ({ title: 'Delete this finding?', message: `${quoted(title)} will be deleted. An issue or a risk raised from it stays. This can't be undone.`, confirmLabel: 'Delete finding' });

// ── the pickers: what the server lists, how it is offered, and what is said when it was cut ──
export type OptionKind = 'documents' | 'incidents' | 'risks' | 'users' | 'assets';
/** How many rows each picker route returns at most (its default `limit` in dashboard.py): a list this long may have been cut. */
export const OPTION_CAPS: Record<OptionKind, number> = { documents: 50, incidents: 50, risks: 50, users: 100, assets: 100 };
export interface OptionRow { value: number; label: string; subLabel?: string | null }
export interface PickOption { value: string; label: string; description?: string }
/** The options a picker offers: `extra` first (the record already linked, so its name always shows even when the server's list was cut), then what the server listed, each id once. */
export function pickOptions(extra: readonly OptionRow[] | undefined, listed: readonly OptionRow[] | undefined): PickOption[] {
  const seen: Record<number, true> = {};
  const out: PickOption[] = [];
  (extra || []).concat(listed || []).forEach((o) => {
    if (seen[o.value]) return;
    seen[o.value] = true;
    out.push({ value: String(o.value), label: o.label, description: o.subLabel || undefined });
  });
  return out;
}
export const optionsCut = (kind: OptionKind, listed: number): boolean => listed >= OPTION_CAPS[kind];
export const OPTION_NOUN: Record<OptionKind, string> = { documents: 'documents', incidents: 'incidents', risks: 'risks', users: 'people', assets: 'assets' };
export const cutHint = (kind: OptionKind): string => `Only the first ${OPTION_CAPS[kind]} ${OPTION_NOUN[kind]} are listed here.`;

// ── the Overview ──
/** A rate as the server gives it ("11.6%", "100%"): its own number and a percent sign, never rounded again. */
export const percentText = (n: number | null | undefined): string => (n == null ? EMPTY : `${n}%`);
/** The colour of a pass rate's bar: 80 and over is on track, 50 and over is a watch, below is off target (the rule the page has always drawn); none for no rate. */
export function rateTone(v: number | null | undefined): 'success' | 'warning' | 'danger' | null {
  if (v == null) return null;
  return v >= 80 ? 'success' : v >= 50 ? 'warning' : 'danger';
}
/** The coverage tile: the server's percentage with the words under it. While there is no active plan to cover (0 of 0) there is no rate to say: the tile reads "Not recorded"
 *  (value null), it is not 0%. */
export function coverageTile(d: Dashboard): { value: string | null; progress: number | null; note: string } {
  const { covered, active_plans: active } = d.coverage_detail;
  if (active === 0) return { value: null, progress: null, note: '' };
  return {
    value: percentText(d.drill_coverage_pct), progress: d.drill_coverage_pct,
    note: `${formatCount(covered)} of ${formatCount(active)} active ${active === 1 ? 'plan' : 'plans'} tested in the last 12 months`,
  };
}
/** Nothing has been recorded: no plan and no drill. The Overview then shows how to start instead of a page of zeros. */
export const isEmptyTenant = (d: Dashboard): boolean => d.totals.plans === 0 && d.totals.drills === 0;
/** The rollup across modules, or null when the server did not send it (an older server): the page says "Not recorded", it does not invent zeros. */
export const linkageOf = (d: Dashboard): NonNullable<Dashboard['linkage']> | null => d.linkage ?? null;
/** "Showing 6 of 15": the server cuts the Overview's two drill lists at six; the line says so next to the count that is not cut. */
export function listCut(shown: number, total: number): string | null {
  return total > shown ? `Showing ${formatCount(shown)} of ${formatCount(total)}` : null;
}
/** The number of plans in a status, 0 when the server lists none (a status with no plan is absent from `plans_by_status`: a true zero). */
export const planCount = (d: Dashboard, status: string): number => d.plans_by_status[status] ?? 0;
/** The number of open findings of a severity (the server sends all four). */
export const findingCount = (d: Dashboard, sev: string): number => d.open_findings_by_severity[sev] ?? 0;

export const FINDING_HINT = 'Findings at or above the tenant\'s issue threshold (High by default) automatically open an Issue/CAPA for remediation.';
/** What a BIA process says about its recovery strategy: the server marks it complete once it has one. */
export const biaCompleteness = (b: Pick<Bia, 'is_complete'>): { complete: boolean; label: string } =>
  b.is_complete ? { complete: true, label: 'Complete' } : { complete: false, label: 'Needs a recovery strategy' };
