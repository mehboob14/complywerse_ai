// The campaign register and workspace apart from React (campaignsModel.test.ts): a campaign's progress and lateness, the units of its table by state, the launch form's rules and
// the body the server takes. Progress is the server's own definition (approved units / assigned units, whole percent: GET /campaigns sends both counts); a campaign is late when it
// is running, its due day has passed and not every unit is approved. Dates that mean a day are compared as days (a unit due today is not late at 00:00).

export interface CampaignRow {
  id: number;
  name: string;
  description?: string | null;
  template_id: number;
  template_name?: string | null;
  period_type?: string | null;
  period_label?: string | null;
  start_date: string;
  due_date: string;
  status: string;
  assessment_count: number;
  completed_count: number;
  status_counts?: Record<string, number>;
  open_findings?: number;
  created_by_name?: string | null;
}

const dayOf = (iso: string): string => iso.slice(0, 10);
export const todayKey = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

export function progressOf(c: Pick<CampaignRow, 'assessment_count' | 'completed_count'>): number {
  return c.assessment_count > 0 ? Math.floor((c.completed_count * 100) / c.assessment_count) : 0;
}

/** Running, past its due day and not every unit approved. */
export function isLate(c: Pick<CampaignRow, 'status' | 'due_date' | 'assessment_count' | 'completed_count'>, now: Date = new Date()): boolean {
  return c.status === 'active' && dayOf(c.due_date) < todayKey(now) && c.completed_count < c.assessment_count;
}

/** Whole days from today to the due day: negative once past. */
export function daysToDue(dueIso: string, now: Date = new Date()): number {
  const due = Date.parse(`${dayOf(dueIso)}T00:00:00Z`);
  const today = Date.parse(`${todayKey(now)}T00:00:00Z`);
  return Math.round((due - today) / 86_400_000);
}

export function dueWords(c: Pick<CampaignRow, 'status' | 'due_date'>, now: Date = new Date()): string {
  if (c.status === 'closed') return 'Closed';
  const d = daysToDue(c.due_date, now);
  return d < 0 ? `${-d} ${d === -1 ? 'day' : 'days'} late` : d === 0 ? 'Due today' : `${d} ${d === 1 ? 'day' : 'days'} left`;
}

export const QUICK = ['active', 'draft', 'closed', 'late'] as const;

// ── the units of one campaign ───────────────────────────────────────────────────────────

export interface UnitRow {
  id: number;
  business_unit_id: number;
  business_unit_name: string;
  assessor_id: number | null;
  assessor_name: string | null;
  status: string;
  progress: number;
  risk_score: number | null;
  control_score: number | null;
  findings_count: number;
  open_findings_count?: number;
  current_approval_tier?: number;
  submitted_at: string | null;
}

/** The units in the order a chaser reads them: not started, then in progress, sent back, waiting for review, approved, rejected. */
const UNIT_ORDER = ['not_started', 'in_progress', 'requires_changes', 'submitted', 'under_review', 'approved', 'rejected'];
export function sortUnits(units: readonly UnitRow[]): UnitRow[] {
  const rank = (s: string) => { const i = UNIT_ORDER.indexOf(s); return i < 0 ? UNIT_ORDER.length : i; };
  return units.slice().sort((a, b) => rank(a.status) - rank(b.status) || a.business_unit_name.localeCompare(b.business_unit_name));
}

/** The units that still hold the campaign up (neither approved nor rejected), for "N units still to finish". */
export const unfinished = (units: readonly UnitRow[]): UnitRow[] => units.filter((u) => u.status !== 'approved' && u.status !== 'rejected');

/** Units nobody is assigned to: the chaser's first job. */
export const unassigned = (units: readonly UnitRow[]): UnitRow[] => units.filter((u) => u.assessor_id == null && u.status !== 'approved' && u.status !== 'rejected');

// ── the launch form ─────────────────────────────────────────────────────────────────────

export const PERIOD_TYPES = [
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Half-yearly' },
  { value: 'annual', label: 'Yearly' },
  { value: 'adhoc', label: 'One-off' },
] as const;

export interface LaunchForm { templateId: string; name: string; description: string; periodType: string; periodLabel: string; start: string; due: string }

export function launchProblems(f: LaunchForm): Partial<Record<keyof LaunchForm, string>> {
  const p: Partial<Record<keyof LaunchForm, string>> = {};
  if (!f.templateId) p.templateId = 'Choose the questionnaire the units will answer.';
  if (!f.name.trim()) p.name = 'Give the campaign a name.';
  if (!f.start) p.start = 'Choose the day it starts.';
  if (!f.due) p.due = 'Choose the day it is due.';
  if (f.start && f.due && f.due < f.start) p.due = 'The due day cannot be before the start day.';
  return p;
}

/** A label for the period the person is likely to want: "Q2 2026" for a quarter, "H1 2026", "2026". */
export function suggestPeriodLabel(periodType: string, startIso: string): string {
  const [y, m] = startIso.split('-').map(Number);
  if (!y || !m) return '';
  if (periodType === 'quarterly') return `Q${Math.ceil(m / 3)} ${y}`;
  if (periodType === 'semi_annual') return `H${m <= 6 ? 1 : 2} ${y}`;
  if (periodType === 'annual') return `${y}`;
  return '';
}

/** The body of POST /campaigns. The days are sent as written with no zone: a day must not move with the browser's clock (the old page sent toISOString()). */
export function launchBody(f: LaunchForm): Record<string, unknown> {
  return {
    template_id: Number(f.templateId), name: f.name.trim(), description: f.description.trim() || null, period_type: f.periodType,
    period_label: f.periodLabel.trim() || null, start_date: `${f.start}T00:00:00`, due_date: `${f.due}T00:00:00`, business_unit_ids: [],
  };
}

/** What closing and deleting say they do, in the words of the confirmation. */
export const CLOSE_ASK = {
  title: 'Close this campaign?',
  message: 'Units can no longer be answered. Approved answers and findings are kept. This cannot be undone from here.',
  confirmLabel: 'Close campaign',
};
export const DELETE_ASK = (name: string, units: number) => ({
  title: `Delete ${name}?`,
  message: `This deletes the campaign with its ${units} ${units === 1 ? 'unit' : 'units'}, every answer, finding and review step in it. It cannot be undone.`,
  confirmLabel: 'Delete campaign',
});
export const ACTIVATE_ASK = (units: number) => ({
  title: 'Start this campaign?',
  message: units > 0
    ? `${units} ${units === 1 ? 'unit' : 'units'} can start answering at once. Nobody is emailed: units appear on their assessor's worklist.`
    : 'Every active department becomes a unit and its team lead becomes the assessor. Nobody is emailed: units appear on their assessor\'s worklist.',
  confirmLabel: 'Start campaign',
});

/** Csv rows of the campaign register. */
export const csvOf = (rows: readonly CampaignRow[]): { header: string[]; rows: Array<Array<string | number>> } => ({
  header: ['Campaign', 'Questionnaire', 'Period', 'Status', 'Starts', 'Due', 'Units', 'Approved', 'Open findings', 'Owner'],
  rows: rows.map((c) => [c.name, c.template_name ?? '', c.period_label ?? '', c.status, dayOf(c.start_date), dayOf(c.due_date), c.assessment_count, c.completed_count, c.open_findings ?? 0, c.created_by_name ?? '']),
});
