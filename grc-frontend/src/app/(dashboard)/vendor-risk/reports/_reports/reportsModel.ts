// Insights > Reports, apart from React (`reportsModel.test.ts`): the kept reports, where each stands, what can be done with it and by whom, the quarters the Generate sheet offers, and the request each kind
// of report is made with. A kept report is FROZEN at generation (the server keeps its content); once approved it can be shared with an examiner through a link that needs no sign-in, expires and can be
// withdrawn. The programme's own measures (coverage, medians over 90 days, the trend lines) are the SERVER's (tpra/reports.py); nothing here recomputes them.
import { buildSchema, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { REPORT_KINDS, reportKind, reportState, type ReportKind } from '../../../../../lib/statuses/vendorInsights.ts';

export interface Share { active: boolean; expires_at: string | null; views: number; last_viewed_at: string | null; shared_by?: string | null; revoked_at?: string | null }

export interface KeptReport {
  id: number;
  kind: string;
  kind_label: string;
  title: string;
  vendor_id?: number | null;
  period_start?: string | null;
  period_end?: string | null;
  generated_at: string | null;
  generated_by: string | null;
  generated_by_id?: number | null;
  approved_at: string | null;
  approved_by: string | null;
  approved_by_id?: number | null;
  share: Share;
}
export interface KeptAnswer { items: KeptReport[]; total?: number }

export interface Measure { key: string; label: string; median_days: number | null; count: number }
export interface Measures {
  coverage: { active: number; in_date: number; overdue: number; never: number; coverage_pct: number | null; overdue_pct: number | null };
  measures: Measure[];
  trends: Record<string, Array<{ date: string; value: number }>>;
}

export type KeptState = 'draft' | 'approved' | 'shared';

/** Where a kept report stands: shared while an examiner's link is live, approved once someone has approved it, else a draft. */
export const stateOf = (r: Pick<KeptReport, 'approved_at' | 'share'>): KeptState => (r.share?.active ? 'shared' : r.approved_at ? 'approved' : 'draft');

/** What can be done with a kept report, by its state: a draft is approved or discarded, an approved one is shared, a shared one withdrawn. An approved report stays on record (the server refuses to delete it). */
export const can = {
  approve: (r: Pick<KeptReport, 'approved_at'>): boolean => !r.approved_at,
  discard: (r: Pick<KeptReport, 'approved_at'>): boolean => !r.approved_at,
  share: (r: Pick<KeptReport, 'approved_at' | 'share'>): boolean => !!r.approved_at && !r.share.active,
  withdraw: (r: Pick<KeptReport, 'share'>): boolean => !!r.share.active,
};

/** Who may do what, as the SERVER enforces it (tpra/reports.py): generate and discard need vendors:edit or the risk-edit right, approve needs approvals:approve and NOTHING in its place, share and withdraw need
 *  config:edit and nothing in its place. The page offers an action only to a person the server would let do it. */
export interface Rights { generate: boolean; approve: boolean; share: boolean }
export function rightsFrom(has: (key: string) => boolean): Rights {
  return {
    generate: has('vendor_risk:vendors:edit') || has('erm:risks:edit'),
    approve: has('vendor_risk:approvals:approve'),
    share: has('vendor_risk:config:edit'),
  };
}

/** A report the person made themselves and is about to approve: the server allows it (no separation of duties yet), so the confirm says so rather than blocks it. */
export const ownReport = (r: Pick<KeptReport, 'generated_by_id'>, me: number | null): boolean => me !== null && r.generated_by_id != null && r.generated_by_id === me;

export const SHARE_DAYS = [7, 14, 30] as const;
export const DEFAULT_SHARE_DAYS = 14;

// ── the Generate sheet ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface Quarter { label: string; start: string; end: string }
const pad = (n: number): string => String(n).padStart(2, '0');

/** This quarter to date and the four before it, newest first: "Q4 2026 to date", "Q3 2026" ... Local calendar days, as the page has always offered them. */
export function quarters(today: Date = new Date()): Quarter[] {
  const out: Quarter[] = [];
  const y0 = today.getFullYear();
  const q0 = Math.floor(today.getMonth() / 3);
  for (let i = 0; i < 5; i += 1) {
    const q = (((q0 - i) % 4) + 4) % 4;
    const y = y0 - Math.ceil(Math.max(0, i - q0) / 4);
    const end = new Date(y, q * 3 + 3, 0);
    out.push({
      label: i === 0 ? `Q${q + 1} ${y} to date` : `Q${q + 1} ${y}`,
      start: `${y}-${pad(q * 3 + 1)}-01`,
      end: i === 0 ? `${y0}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}` : `${y}-${pad(q * 3 + 3)}-${pad(end.getDate())}`,
    });
  }
  return out;
}

export const needsPeriod = (kind: string): boolean => kind === 'committee_pack' || kind === 'ratings_quarter';
export const needsSupplier = (kind: string): boolean => kind === 'vendor_file' || kind === 'vendor_summary';

export interface ReportRequest { kind: ReportKind; period_start?: string; period_end?: string; vendor_id?: number }

/** The body of a preview, a generate: the kind plus its period or its supplier. */
export function requestOf(kind: ReportKind, period: Quarter | undefined, vendorId: number | null): ReportRequest {
  if (needsPeriod(kind) && period) return { kind, period_start: period.start, period_end: period.end };
  if (needsSupplier(kind) && vendorId !== null) return { kind, vendor_id: vendorId };
  return { kind };
}

/** Whether the request is complete: a supplier report needs its supplier. */
export const ready = (kind: ReportKind, vendorId: number | null): boolean => !needsSupplier(kind) || vendorId !== null;

/** What each kind is, in a line, for the Generate sheet. */
export const KIND_ABOUT: Readonly<Record<ReportKind, string>> = {
  committee_pack: 'The portfolio by tier and residual risk, coverage and what is overdue, the programme’s own measures, concentration, incidents, the age of open findings and the decisions taken in the period.',
  register: 'The critical or important functions and the suppliers behind them, and each contract obligation mapped to the requirements of the frameworks in scope.',
  vendor_file: 'One supplier’s evidence file: assessments, questionnaires and answers, evidence, findings, decisions and alerts.',
  ratings_quarter: 'The period’s security ratings of the critical suppliers: who was rated, how each moved, what is still open from outside and what is waived.',
  vendor_summary: 'One supplier on a few pages: who they are, how they scored, what is open.',
};

// ── the register's definition ───────────────────────────────────────────────────────────────────────────────────────────

const STATES: KeptState[] = ['draft', 'approved', 'shared'];

export function reportsDef(me: number | null): RegisterDef<KeptReport> {
  return {
    key: 'tpreport',
    noun: { one: 'report', other: 'reports' },
    idOf: (r) => r.id,
    text: (r) => [r.title, r.kind_label, r.generated_by ?? '', r.approved_by ?? ''].join(' '),
    facets: [
      { key: 'state', label: 'Status', defaultOpen: true, values: (r) => [stateOf(r)], options: () => STATES.map((value) => ({ value, label: reportState.label(value) })) },
      { key: 'kind', label: 'Report', defaultOpen: true, values: (r) => [r.kind], options: () => REPORT_KINDS.map((value) => ({ value, label: reportKind.label(value) })) },
      {
        key: 'by', label: 'Made by', searchable: true,
        values: (r) => [r.generated_by ?? 'unknown'],
        options: (rows) => Array.from(new Set(rows.map((r) => r.generated_by ?? 'unknown'))).sort().map((value) => ({ value, label: value === 'unknown' ? 'Not recorded' : value })),
      },
    ],
    quick: [
      { key: 'draft', label: 'Waiting for approval', test: (r) => stateOf(r) === 'draft', title: 'Kept reports nobody has approved yet' },
      { key: 'shared', label: 'Shared now', test: (r) => stateOf(r) === 'shared', title: 'An examiner’s link is live' },
      { key: 'mine', label: 'Made by me', test: (r) => ownReport(r, me), title: 'Reports you generated' },
    ],
    sorts: [
      { key: 'generated', label: 'Newest first', firstDir: 'desc', value: (r) => r.generated_at },
      { key: 'title', label: 'Title', firstDir: 'asc', value: (r) => r.title },
      { key: 'kind', label: 'Report', firstDir: 'asc', value: (r) => r.kind_label },
      { key: 'state', label: 'Status', firstDir: 'asc', value: (r) => STATES.indexOf(stateOf(r)) },
      { key: 'approved', label: 'Approved', firstDir: 'desc', value: (r) => r.approved_at },
    ],
    defaultSort: { key: 'generated', dir: 'desc' },
    pageSize: 25,
  };
}

export const REPORTS_SCHEMA = buildSchema(reportsDef(null));

/** The head's line: how many are kept and how many wait for approval; when the server holds more than the 200 it returns, it says so. */
export function headLine(items: readonly KeptReport[], total?: number): string {
  const waiting = items.filter((r) => stateOf(r) === 'draft').length;
  const n = total ?? items.length;
  const bits = [`${n.toLocaleString('en-GB')} ${n === 1 ? 'report' : 'reports'} kept`];
  if (waiting) bits.push(`${waiting} waiting for approval`);
  return bits.join(' · ');
}

// ── programme health ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HealthTile { key: string; label: string; value: string | null; note: string | null; trend: Array<{ date: string; value: number }> | null }

/** The tiles of "How the programme is running", in the order of the page: the two coverage figures, then each measure in days. A figure the server does not have is null (never 0). */
export function healthTiles(m: Measures): HealthTile[] {
  const c = m.coverage;
  return [
    { key: 'coverage', label: 'Assessed and in date', value: c.coverage_pct != null ? `${c.coverage_pct}%` : null, note: `${c.in_date} of ${c.active} vendors`, trend: m.trends.tprm_coverage_pct ?? null },
    { key: 'overdue', label: 'Reassessments overdue', value: c.overdue_pct != null ? `${c.overdue_pct}%` : null, note: `${c.overdue} vendors, ${c.never} never approved`, trend: m.trends.tprm_overdue_pct ?? null },
    ...m.measures.map((x): HealthTile => ({
      key: x.key, label: x.label, value: x.median_days != null ? `${x.median_days} days` : null, note: `${x.count} ${x.count === 1 ? 'case' : 'cases'}`, trend: m.trends[`tprm_${x.key}_days`] ?? null,
    })),
  ];
}

/** The line a report's row says about when and who: "Generated 12 Nov 2026 by A. Khan · approved 14 Nov 2026 by B. Ali" (the dates come already formatted). */
export function whoWhen(r: Pick<KeptReport, 'generated_by' | 'approved_by'>, generated: string, approved: string | null): string {
  const made = `Generated ${generated}${r.generated_by ? ` by ${r.generated_by}` : ''}`;
  return approved ? `${made} · approved ${approved}${r.approved_by ? ` by ${r.approved_by}` : ''}` : `${made} · waiting for approval`;
}
