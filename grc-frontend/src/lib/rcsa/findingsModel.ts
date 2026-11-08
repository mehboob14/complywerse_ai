// The findings register apart from React (findingsModel.test.ts): the row the API sends, the order of severity, when a finding is late, the next step of its life and what is offered from each
// state, and what its links say. The server lets a finding go to any status (there is no state machine behind PUT), so the page offers a natural next step and the others from a menu; it does
// not invent a rule. Dates that mean a day are compared as days.

export interface FindingRow {
  id: number;
  assessment_id: number;
  finding_type: string;
  severity: string;
  title: string;
  description?: string | null;
  ai_recommendation?: string | null;
  ai_generated?: boolean;
  status: string;
  remediation_due_date?: string | null;
  remediation_owner_id?: number | null;
  remediation_owner_name?: string | null;
  linked_risk_id?: number | null;
  linked_internal_control_id?: number | null;
  linked_mitigation_action_id?: number | null;
  created_at: string;
  closed_at?: string | null;
  campaign_id?: number | null;
  campaign_name?: string | null;
  business_unit_name?: string | null;
  linked_risk_title?: string | null;
  linked_control_name?: string | null;
  linked_action_title?: string | null;
}

export const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
export const severityRank = (s: string): number => SEVERITY_RANK[s] ?? 0;

/** Still being worked on: open or in progress. These are the "open findings" the dashboard counts. */
export const isOpen = (f: Pick<FindingRow, 'status'>): boolean => f.status === 'open' || f.status === 'in_progress';

const dayOf = (iso: string): string => iso.slice(0, 10);

/** Open and past its fix-by day (a finding due today is not late). */
export function isLate(f: Pick<FindingRow, 'status' | 'remediation_due_date'>, now: Date = new Date()): boolean {
  return isOpen(f) && !!f.remediation_due_date && dayOf(f.remediation_due_date) < now.toISOString().slice(0, 10);
}

export interface Step { to: string; label: string }

/** The natural next move of a finding, or null when it is finished. */
export function nextStep(status: string): Step | null {
  switch (status) {
    case 'open': return { to: 'in_progress', label: 'Start work' };
    case 'in_progress': return { to: 'remediated', label: 'Mark as fixed' };
    case 'remediated':
    case 'accepted': return { to: 'closed', label: 'Close finding' };
    default: return null;
  }
}

/** Every other status a finding can be set to, with the words of the move (the server accepts any). */
export function otherMoves(status: string): Step[] {
  const all: Step[] = [
    { to: 'open', label: status === 'closed' || status === 'remediated' || status === 'accepted' ? 'Reopen' : 'Back to open' },
    { to: 'in_progress', label: 'Mark as in progress' },
    { to: 'remediated', label: 'Mark as fixed' },
    { to: 'accepted', label: 'Accept the risk' },
    { to: 'closed', label: 'Close finding' },
  ];
  const next = nextStep(status);
  return all.filter((m) => m.to !== status && m.to !== next?.to);
}

/** What a move says when it is done. */
export const movedWords = (to: string, title: string): string =>
  to === 'closed' ? `Closed "${title}"` : to === 'remediated' ? `"${title}" is marked as fixed` : to === 'accepted' ? `The risk of "${title}" is accepted` : to === 'in_progress' ? `Work has started on "${title}"` : `"${title}" is open again`;

export type LinkKind = 'risk' | 'control' | 'action';

/** What a finding is linked to, in words ("Risk, Control"); "Not linked" when nothing. */
export function linksText(f: Pick<FindingRow, 'linked_risk_id' | 'linked_internal_control_id' | 'linked_mitigation_action_id'>): string {
  const parts = [f.linked_risk_id ? 'Risk' : '', f.linked_internal_control_id ? 'Control' : '', f.linked_mitigation_action_id ? 'Action' : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Not linked';
}

/** The action is made from the finding and a risk (the server needs one): from a finding without a risk it says why not. */
export function actionBlock(f: Pick<FindingRow, 'linked_risk_id' | 'linked_mitigation_action_id'>): string | null {
  if (f.linked_mitigation_action_id) return 'An action was already made from this finding.';
  if (!f.linked_risk_id) return 'Link a risk first: the action is made under it.';
  return null;
}

export const csvOf = (rows: readonly FindingRow[]): { header: string[]; rows: Array<Array<string | number>> } => ({
  header: ['Finding', 'Kind', 'Severity', 'Status', 'Campaign', 'Unit', 'Owner', 'Fix by', 'Risk', 'Control', 'Raised'],
  rows: rows.map((f) => [f.title, f.finding_type, f.severity, f.status, f.campaign_name ?? '', f.business_unit_name ?? '', f.remediation_owner_name ?? '', f.remediation_due_date ? dayOf(f.remediation_due_date) : '', f.linked_risk_title ?? '', f.linked_control_name ?? '', dayOf(f.created_at)]),
});
