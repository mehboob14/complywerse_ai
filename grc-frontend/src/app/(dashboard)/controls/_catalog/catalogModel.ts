// The Control Catalog's rules as pure functions (no React), so `node --test` pins them: the posture numbers of the hub, the grade, what asks for attention, the figures of a stat strip, how a list
// is asked of the server (the same query names the page always used: source, q, framework_id, canonical_domain, status, effectiveness, due, skip, limit), when a test is overdue, and the
// words a row says. The formulas are the ones the page had (audit G10 section 5, "Catalog posture"): nothing here redefines a number.
//   tested %    = tested / controls                     effective % = effective / tested (of the tested ones)
//   not tested  = controls - effective - partial - ineffective (never below 0)
//   grade       = no test at all: Not started; effective % >= 80 Strong; >= 60 Fair; else Needs work
//   attention   = overdue + ineffective + partially effective + evidence waiting for a review
import { formatCount } from '../../../../lib/format.ts';
import type { Tone } from '../../../../lib/status.ts';

export type SourceType = 'framework' | 'internal' | 'normalized';
export const SOURCES = ['all', 'framework', 'internal', 'normalized'] as const;
export type SourceFilter = (typeof SOURCES)[number];
export const PROGRESS = ['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'] as const;
export const EFFECTIVENESS = ['effective', 'partially_effective', 'ineffective', 'not_tested'] as const;
export type EffectivenessWord = (typeof EFFECTIVENESS)[number];
export const VIEWS = ['domain', 'framework', 'all', 'mine'] as const;
export type CatalogView = (typeof VIEWS)[number];
export const MODES = ['framework', 'internal'] as const;
export type CatalogMode = (typeof MODES)[number];
export const PAGE_SIZE = 50;
export const PAGE_SIZES = [25, 50, 100] as const;

export interface Assignee { id: number; display_name: string }
export interface CatalogRow {
  source_type: SourceType;
  source_id: number;
  work_item_id: number | null;
  code?: string;
  name?: string;
  domain?: string;
  canonical_domain?: string | null;
  framework_name?: string;
  member_count?: number;
  status?: string | null;
  implementation_status?: string;
  design_effectiveness?: string | null;
  operating_effectiveness?: string | null;
  assigned_user_ids?: number[];
  assignees?: Assignee[];
  is_key_control?: boolean;
  next_test_date?: string | null;
  overdue?: boolean;
}
export interface BySource { framework: number; internal: number; normalized: number }
export interface WorkStats {
  controls: number; assigned: number; tested: number; effective: number; partially_effective: number; ineffective: number; evidence_pending: number; overdue?: number;
}
export interface DomainStat extends WorkStats { domain: string; frameworks: number; by_source?: BySource }
export interface Trend { since: string; tested: number; effective: number; assigned: number; overdue: number }
export interface CatalogOverview {
  domains: DomainStat[];
  totals: WorkStats & { by_source?: BySource };
  internal?: WorkStats;
  frameworks: { id: number; name: string; controls: number }[];
  trend?: Trend | null;
  scope: { framework_ids: number[]; scoped: boolean };
}
export interface DomainGroup { type: SourceType; framework_id: number | null; name: string; controls: number; tested: number; effective: number; partially_effective: number; ineffective: number }
export interface CatalogList { total: number; items: CatalogRow[]; source_counts?: Partial<Record<SourceFilter, number>>; scope?: { framework_ids: number[]; scoped: boolean } }

// ── a control's detail (GET /workbench/controls/{source_type}/{source_id}: workbench.py `_full_detail`) ───────────────────────────────────

export interface ControlTest {
  id: number; test_type: string; test_date: string | null; tester: string | null; reviewer: string | null; reviewed_at: string | null;
  sample_size: number | null; exceptions_found: number | null; result: string | null; findings: string | null; recommendations: string | null; status: string;
}
export interface ControlProcedure { id: number; seq: number; procedure_type: string | null; description: string; frequency: string | null; sample_size: number | null; source: string | null; is_checked: boolean }
export interface ControlEvidence { id: number; test_procedure_id: number | null; evidence_id: number | null; file_name: string | null; review_status: string; uploaded_by: string | null; uploaded_at: string | null }
export interface RiskLink {
  id: number; risk_id: number; link_type: string | null; effectiveness_rating: string | null; notes: string | null;
  risk_title: string | null; risk_category: string | null; risk_residual_score: number | null;
}
export interface ControlDetail extends CatalogRow {
  work_item_id: number;
  description?: string | null;
  category?: string | null;
  priority?: string | null;
  frequency?: string | null;
  last_tested_at?: string | null;
  test_procedures: ControlProcedure[];
  tests: ControlTest[];
  evidence: ControlEvidence[];
  risk_links: RiskLink[];
}

export const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);

// ── the hub's posture ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type GradeId = 'not_started' | 'strong' | 'fair' | 'needs_work';
export const GRADE: Record<GradeId, { label: string; tone: Tone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  strong: { label: 'Strong', tone: 'success' },
  fair: { label: 'Fair', tone: 'warning' },
  needs_work: { label: 'Needs work', tone: 'danger' },
};

export type AttentionKey = 'overdue' | 'ineffective' | 'partial' | 'evidence';
export interface AttentionRow { key: AttentionKey; label: string; n: number; tone: Tone }

export interface Posture {
  total: number; tested: number; notTested: number; effective: number; partial: number; ineffective: number;
  testedPct: number; effPct: number; grade: GradeId; attention: AttentionRow[]; attentionTotal: number;
}

export function gradeOf(testedPct: number, effPct: number): GradeId {
  if (testedPct === 0) return 'not_started';
  if (effPct >= 80) return 'strong';
  if (effPct >= 60) return 'fair';
  return 'needs_work';
}

export function postureOf(t: WorkStats): Posture {
  const divisor = t.controls || 1;                                    // never 0: with no controls every share reads 0 (the old page also counted that 1 as "not tested")
  const effective = t.effective, partial = t.partially_effective, ineffective = t.ineffective, tested = t.tested;
  const testedPct = Math.round((tested / divisor) * 100);
  const effPct = tested ? Math.round((effective / tested) * 100) : 0;
  const attention: AttentionRow[] = [
    { key: 'overdue', label: 'Tests overdue', n: t.overdue ?? 0, tone: 'danger' },
    { key: 'ineffective', label: 'Ineffective controls', n: ineffective, tone: 'danger' },
    { key: 'partial', label: 'Partially effective', n: partial, tone: 'warning' },
    { key: 'evidence', label: 'Evidence to review', n: t.evidence_pending, tone: 'warning' },
  ];
  return {
    total: t.controls, tested, effective, partial, ineffective, testedPct, effPct,
    notTested: Math.max(0, t.controls - effective - partial - ineffective),
    grade: gradeOf(testedPct, effPct),
    attention,
    attentionTotal: attention.reduce((a, x) => a + x.n, 0),
  };
}

/** What a click on an attention row opens: the All controls view with the filter that finds those controls (Evidence to review has no control filter, as before). */
export function attentionFilter(key: AttentionKey): { effectiveness?: EffectivenessWord; due?: 'overdue' } {
  if (key === 'overdue') return { due: 'overdue' };
  if (key === 'ineffective') return { effectiveness: 'ineffective' };
  if (key === 'partial') return { effectiveness: 'partially_effective' };
  return {};
}

// ── a stat strip ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Kpi { key: string; label: string; value: string; hint: string | null; tone: 'default' | 'success' | 'warning' | 'danger'; delta?: number; goodUp?: boolean }

/** The six figures over a set of controls (the whole catalog, a domain, the internal controls). `delta` is the change since the last snapshot, only where the server sends a trend. */
export function kpisOf(s: WorkStats & { by_source?: BySource }, trend?: Trend | null): Kpi[] {
  const src = s.by_source;
  const split = src ? [src.framework ? `${formatCount(src.framework)} framework` : '', src.internal ? `${formatCount(src.internal)} internal` : '', src.normalized ? `${formatCount(src.normalized)} unified` : ''].filter(Boolean).join(' · ') : '';
  const overdue = s.overdue ?? 0;
  return [
    { key: 'controls', label: 'Controls', value: formatCount(s.controls), hint: split || null, tone: 'default' },
    { key: 'assigned', label: 'Assigned', value: formatCount(s.assigned), hint: s.controls ? `${pct(s.assigned, s.controls)}%` : null, tone: 'default', delta: trend?.assigned, goodUp: true },
    { key: 'tested', label: 'Tested', value: `${pct(s.tested, s.controls)}%`, hint: `${formatCount(s.tested)} of ${formatCount(s.controls)}`, tone: 'default', delta: trend?.tested, goodUp: true },
    { key: 'effective', label: 'Effective', value: s.tested ? `${pct(s.effective, s.tested)}%` : '—', hint: s.tested ? 'of those tested' : 'no tests yet', tone: s.tested ? 'success' : 'default', delta: trend?.effective, goodUp: true },
    { key: 'overdue', label: 'Overdue', value: formatCount(overdue), hint: overdue ? 'tests past due' : 'none due', tone: overdue ? 'danger' : 'default', delta: trend?.overdue, goodUp: false },
    { key: 'evidence', label: 'Evidence to review', value: formatCount(s.evidence_pending), hint: s.evidence_pending ? 'waiting' : 'none waiting', tone: s.evidence_pending ? 'warning' : 'default' },
  ];
}

/** A change since the last snapshot in words, for a stat tile ("up 3 since 4 Nov"): nothing when nothing changed or the server sent no trend. */
export function deltaWords(delta: number | undefined, goodUp: boolean | undefined): { text: string; good: boolean } | null {
  if (delta == null || delta === 0) return null;
  const up = delta > 0;
  return { text: `${up ? 'up' : 'down'} ${formatCount(Math.abs(delta))}`, good: goodUp === false ? !up : up };
}

// ── domains ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The domain filter box of the hub: a case-insensitive "contains" over the domain names. */
export function shownDomains(domains: readonly DomainStat[], q: string): DomainStat[] {
  const needle = q.trim().toLowerCase();
  return needle ? domains.filter((d) => d.domain.toLowerCase().includes(needle)) : [...domains];
}

/** "Unclassified" is the server's name for controls that no domain claimed. */
export const isUnclassified = (domain: string): boolean => domain === 'Unclassified';

// ── asking the server for a list ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface ListFilters {
  source: SourceFilter; q: string; framework: string; domain: string; progress: string; effectiveness: string; due: string;
}
export const NO_LIST_FILTERS: ListFilters = { source: 'all', q: '', framework: '', domain: '', progress: '', effectiveness: '', due: '' };

/** The query string of GET /control-library/workbench/controls for the All controls view: the names the page always sent, in this order, and only the ones set. */
export function listQuery(f: ListFilters, page: number, pageSize: number): string {
  const p = new URLSearchParams();
  if (f.source !== 'all') p.set('source', f.source);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.framework) p.set('framework_id', f.framework);
  if (f.domain) p.set('canonical_domain', f.domain);
  if (f.progress) p.set('status', f.progress);
  if (f.effectiveness) p.set('effectiveness', f.effectiveness);
  if (f.due) p.set('due', f.due);
  p.set('skip', String(Math.max(0, page - 1) * pageSize));
  p.set('limit', String(pageSize));
  return p.toString();
}

/** The query of the rows of one group of a domain (a framework's controls in that domain, or the unified ones), paged. */
export function groupQuery(domain: string, group: Pick<DomainGroup, 'type' | 'framework_id'>, page: number, pageSize: number): string {
  const p = new URLSearchParams({ canonical_domain: domain });
  if (group.type === 'framework' && group.framework_id) p.set('framework_id', String(group.framework_id));
  else p.set('source', group.type);
  p.set('skip', String(Math.max(0, page - 1) * pageSize));
  p.set('limit', String(pageSize));
  return p.toString();
}

/** The query of one framework's controls, paged. */
export const frameworkQuery = (frameworkId: number, page: number, pageSize: number): string =>
  new URLSearchParams({ framework_id: String(frameworkId), skip: String(Math.max(0, page - 1) * pageSize), limit: String(pageSize) }).toString();

/** The query of the internal controls, paged. */
export const internalQuery = (page: number, pageSize: number): string =>
  new URLSearchParams({ source: 'internal', skip: String(Math.max(0, page - 1) * pageSize), limit: String(pageSize) }).toString();

/** Whether any filter of the All controls view is set (the "Clear filters" door). */
export function isFiltered(f: ListFilters): boolean {
  return f.source !== 'all' || f.q.trim() !== '' || f.framework !== '' || f.domain !== '' || f.progress !== '' || f.effectiveness !== '' || f.due !== '';
}

/** The pages a list of `total` rows has at `pageSize`, never below 1. */
export const pageCount = (total: number, pageSize: number): number => Math.max(1, Math.ceil(total / pageSize));

// ── a control's test schedule and its words ──────────────────────────────────────────────────────────────────────────────────────────

export interface Schedule { state: 'none' | 'overdue' | 'scheduled'; days: number | null }

/** Whether the next test is past (the page's rule: the date is before now) and how many days away it is (rounded, as before). */
export function scheduleOf(nextTestDate: string | null | undefined, now: Date, parse: (v: string) => Date | null): Schedule {
  const at = nextTestDate ? parse(nextTestDate) : null;
  if (!at) return { state: 'none', days: null };
  return { state: at.getTime() < now.getTime() ? 'overdue' : 'scheduled', days: Math.round((at.getTime() - now.getTime()) / 86400000) };
}

/** "3 days ago" / "in 5 days" / "today" for a schedule with a date. */
export function daysWords(days: number | null): string {
  if (days == null) return '';
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = n === 1 ? 'day' : 'days';
  return days < 0 ? `${formatCount(n)} ${unit} ago` : `in ${formatCount(n)} ${unit}`;
}

/** The cadences a test can set (the server's own list: workbench.py `_FREQ_DAYS`), "" meaning no schedule. */
export const CADENCES: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: 'No schedule' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annually', label: 'Twice a year' }, { value: 'annually', label: 'Yearly' },
];

/** "n=25" style sample note of a procedure: frequency and sample size, in words. */
export function procedureNote(frequency?: string | null, sampleSize?: number | null): string {
  const f = frequency ? frequency.replace(/_/g, ' ') : '';
  const s = sampleSize ? `sample of ${formatCount(sampleSize)}` : '';
  return [f, s].filter(Boolean).join(' · ');
}

/** The colour class of a residual risk score as the Catalog has always drawn it (15 and over high, 8 and over medium, below that low). The Risk Management pages cut at 20 / 12 / 6: kept as it was
 *  here, in one place, and listed for the user. */
export function residualTone(score: number | null | undefined): Tone {
  if (score == null) return 'neutral';
  if (score >= 15) return 'danger';
  if (score >= 8) return 'warning';
  return 'success';
}
export const residualWord = (score: number | null | undefined): string => (score == null ? 'Not scored' : score >= 15 ? 'High' : score >= 8 ? 'Medium' : 'Low');

/** Two letters for an avatar-less name. */
export const initials = (name?: string): string => (name || 'U').split(/\s+/).slice(0, 2).map((s) => s[0]).join('').toUpperCase();

/** The line under a control's name: its code and where it comes from. */
export function subtitleOf(row: Pick<CatalogRow, 'code' | 'framework_name'>): string {
  return [row.code, row.framework_name].filter(Boolean).join(' · ');
}
