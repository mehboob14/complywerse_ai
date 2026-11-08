// The NCA cybersecurity audit plan lens: the form of an entry, what is sent, and how the plan is counted. Pure (`node --test auditPlanModel.test.ts`).

export const ENTRY_TYPES = ['Audit', 'Review'] as const;
export const TEAMS = ['Cybersecurity Org', 'Internal Audit', 'Third Party'] as const;
export const AUDIT_TYPES = ['Design effectiveness', 'Operational effectiveness', 'Both'] as const;
export const PLAN_STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'] as const;
export const PLAN_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;

export interface PlanEntry {
  id: number;
  entry_type: string | null; audit_id: string | null; audit_name: string | null; team_responsible: string | null; lead_auditor: string | null; audit_type: string | null;
  scope: string | null; methods: string | null; criteria: string | null; sampling: string | null; evidence_needed: string | null; duration: string | null; schedule: string | null;
  audit_start: string | null; audit_end: string | null; cost: string | null; comment: string | null; status: string | null; priority: string | null;
  ai_recommendation: string | null; ai_recommendation_generated_at: string | null;
  sla?: { state?: string; label?: string } | null;
}

/** What the form holds: text for every field ('' is empty), dates as "2026-09-01". */
export interface PlanForm {
  entry_type: string; audit_name: string; team_responsible: string; lead_auditor: string; audit_type: string; scope: string; methods: string; criteria: string; sampling: string;
  evidence_needed: string; duration: string; schedule: string; audit_start: string; audit_end: string; cost: string; comment: string; status: string; priority: string;
}
export const EMPTY_FORM: PlanForm = {
  entry_type: 'Audit', audit_name: '', team_responsible: '', lead_auditor: '', audit_type: '', scope: '', methods: '', criteria: '', sampling: '',
  evidence_needed: '', duration: '', schedule: '', audit_start: '', audit_end: '', cost: '', comment: '', status: 'planned', priority: '',
};

export function formOf(e: PlanEntry | null): PlanForm {
  if (!e) return { ...EMPTY_FORM };
  const s = (v: string | null): string => v ?? '';
  return {
    entry_type: e.entry_type || 'Audit', audit_name: s(e.audit_name), team_responsible: s(e.team_responsible), lead_auditor: s(e.lead_auditor), audit_type: s(e.audit_type), scope: s(e.scope),
    methods: s(e.methods), criteria: s(e.criteria), sampling: s(e.sampling), evidence_needed: s(e.evidence_needed), duration: s(e.duration), schedule: s(e.schedule),
    audit_start: s(e.audit_start).slice(0, 10), audit_end: s(e.audit_end).slice(0, 10), cost: s(e.cost), comment: s(e.comment), status: e.status || 'planned', priority: s(e.priority),
  };
}

/** The body sent: an empty field is null (it clears). */
export function bodyOf(f: PlanForm): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(f)) out[k] = v.trim() === '' ? null : v.trim();
  return out;
}

/** What stops a save: the entry needs its name; it cannot end before it starts. */
export function formProblem(f: PlanForm): string {
  if (!f.audit_name.trim()) return 'Give the audit or review a name.';
  if (f.audit_start && f.audit_end && f.audit_end < f.audit_start) return 'The end date is before the start date.';
  return '';
}

export interface PlanCounts { total: number; audits: number; reviews: number; planned: number; inProgress: number; completed: number }
export function countPlan(entries: readonly Pick<PlanEntry, 'entry_type' | 'status'>[]): PlanCounts {
  const status = (e: Pick<PlanEntry, 'status'>): string => e.status || 'planned';
  return {
    total: entries.length, audits: entries.filter((e) => (e.entry_type || 'Audit') === 'Audit').length, reviews: entries.filter((e) => e.entry_type === 'Review').length,
    planned: entries.filter((e) => status(e) === 'planned').length, inProgress: entries.filter((e) => status(e) === 'in_progress').length, completed: entries.filter((e) => status(e) === 'completed').length,
  };
}

/** The AI recommendation of an entry: a JSON of summary, scope advice, methods and evidence; a plain sentence when it is not JSON. */
export interface PlanAdvice { summary: string; scope: string[]; methods: string[]; evidence: string[] }
export function adviceOf(json: string | null | undefined): PlanAdvice | null {
  if (!json) return null;
  let d: Record<string, unknown> = {};
  try { const v = JSON.parse(json); d = v && typeof v === 'object' ? v : { summary: String(v) }; } catch { d = { summary: json }; }
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return { summary: typeof d.summary === 'string' ? d.summary : '', scope: list(d.scope_advice), methods: list(d.methods), evidence: list(d.evidence) };
}
