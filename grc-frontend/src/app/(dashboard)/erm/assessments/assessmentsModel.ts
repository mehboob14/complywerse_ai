// The Assessments list (ERM redesign, decision 1), apart from React so `node --test` can pin it: my assignments first, then everything else
// by unit and status, the kind and status filters, and where "Plan assessment" goes for each kind. GET /erm/assessments maps the statuses.

export type AssessmentKind = 'risk_workshop' | 'self_assessment' | 'framework_it_risk';
export type AssessmentStatus = 'Planned' | 'In progress' | 'Returned' | 'Under review' | 'Approved' | 'Closed';

export interface AssessmentRow {
  kind: AssessmentKind;
  id: number;
  title: string;
  unit: string | null;
  status: AssessmentStatus;
  raw_status: string;
  due_date: string | null;
  lead: string | null;
  lead_id: number | null;
  mine: boolean;
  url: string;
}

export const KIND_LABELS: Record<AssessmentKind, string> = {
  risk_workshop: 'Risk workshop',
  self_assessment: 'Self-assessment (RCSA)',
  framework_it_risk: 'Framework IT risk',
};

// the order work is chased in: what needs someone's hand first
export const STATUSES: AssessmentStatus[] = ['Planned', 'In progress', 'Returned', 'Under review', 'Approved', 'Closed'];

export interface Filters { kind?: AssessmentKind; status?: AssessmentStatus }
export interface UnitGroup { unit: string | null; rows: AssessmentRow[] }

const byStatusThenDue = (a: AssessmentRow, b: AssessmentRow): number =>
  STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999');

/** The rows the filters keep: mine (soonest due first), and the rest grouped by unit (A-Z, no unit last), each by status then due date. */
export function arrange(rows: readonly AssessmentRow[], filters: Filters): { mine: AssessmentRow[]; byUnit: UnitGroup[]; total: number } {
  const kept = rows.filter((r) => (!filters.kind || r.kind === filters.kind) && (!filters.status || r.status === filters.status));
  const mine = kept.filter((r) => r.mine).sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || byStatusThenDue(a, b));
  const groups = new Map<string | null, AssessmentRow[]>();
  for (const r of kept.filter((x) => !x.mine)) groups.set(r.unit, [...(groups.get(r.unit) ?? []), r]);
  const byUnit = Array.from(groups, ([unit, list]) => ({ unit, rows: list.sort(byStatusThenDue) }))
    .sort((a, b) => (a.unit === null ? 1 : b.unit === null ? -1 : a.unit.localeCompare(b.unit)));
  return { mine, byUnit, total: kept.length };
}

export interface PlanTarget { kind: AssessmentKind; label: string; href: string }

// the create flows each kind already has; the rights each one's server route accepts
const PLAN: Array<PlanTarget & { rights: string[] }> = [
  { kind: 'risk_workshop', label: 'Risk workshop', href: '/erm/risk-assessments/list?action=new', rights: ['risks:risk_assessment:create', 'erm:risks:create'] },
  { kind: 'self_assessment', label: 'Self-assessment (RCSA campaign)', href: '/erm/rcsa/campaigns?action=new', rights: ['erm:rcsa:create', 'erm:risks:create'] },
  { kind: 'framework_it_risk', label: 'Framework IT risk', href: '/erm/risk-assessments/framework', rights: ['risks:risk_assessment:create', 'erm:risks:create'] },
];

/** The kinds `can` (usePermissions().hasAnyPermission) lets the person plan. */
export function planTargets(can: (rights: string[]) => boolean): PlanTarget[] {
  return PLAN.filter((p) => can(p.rights)).map(({ kind, label, href }) => ({ kind, label, href }));
}
