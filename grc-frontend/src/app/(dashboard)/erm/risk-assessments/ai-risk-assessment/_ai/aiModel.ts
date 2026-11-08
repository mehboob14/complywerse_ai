// What the AI System Risks register decides, apart from React so `node --test` pins it (aiModel.test.ts). This tab is a register of the risks of the organisation's OWN AI/ML systems
// (the old tab was called "AI Risk Assessment", which read as an AI that assesses risks). Its score is likelihood x impact, shown on the area's one band system (critical >= 20, high >= 12,
// medium >= 6, low below; the old page said 15 / 8); the "residual level" is the word the person (or the server's rule) recorded and is shown as recorded. The server's own residual
// rule (15 / 8 when the field is left to "Auto") is not touched: it only fills the recorded word.
import { flag, listOf, oneOf, text, type ParamSpec } from '../../../../../../lib/addressState.ts';
import { bandOf, fold, searchTerms, type Band } from '../../_register/assessmentModel.ts';

export interface AiEntry {
  id: number;
  risk_id_external: string | null;
  ai_system_use_case: string | null;
  risk_description: string | null;
  risk_category: string | null;
  likelihood: number | null;
  impact: number | null;
  risk_score: number | null;
  existing_controls: string | null;
  residual_risk_level: string | null;
  mitigation_plan: string | null;
  risk_owner: string | null;
  risk_owner_user_id: number | null;
  target_review_date: string | null;
  status: string | null;
  bridged_risk_id: number | null;
  ai_suggested_mitigation: string | null;
  ai_suggested_controls: string | null;
  ai_suggested_likelihood: number | null;
  ai_suggested_impact: number | null;
  ai_suggested_residual_level: string | null;
  ai_rationale: string | null;
  ai_generated_at: string | null;
  ai_model: string | null;
  ai_suggestion_accepted: boolean;
  source?: string | null;
  source_file_name?: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export const CATEGORIES = ['Ethical / Fairness', 'Data Privacy', 'Operational', 'Regulatory Compliance', 'Intellectual Property', 'Security', 'Explainability/Trust', 'Other'] as const;
export const STATUSES = ['Open', 'In Progress', 'Closed', 'Accepted'] as const;
export const RESIDUALS = ['High', 'Medium', 'Low'] as const;

const norm = (s: string | null | undefined): string => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

/** Likelihood x impact when the stored score is missing; the band of it. A system with no score is "not scored". */
export const scoreOf = (e: Pick<AiEntry, 'risk_score' | 'likelihood' | 'impact'>): number | null => e.risk_score ?? (e.likelihood && e.impact ? e.likelihood * e.impact : null);
export const levelOf = (e: Pick<AiEntry, 'risk_score' | 'likelihood' | 'impact'>): Band => bandOf(scoreOf(e));

export const isClosed = (e: Pick<AiEntry, 'status'>): boolean => norm(e.status) === 'closed';
/** The Overview's own rule for "Overdue AI reviews": not closed, and the target review date is before today. Dates are compared as written (no time zone). */
export function isOverdue(e: Pick<AiEntry, 'status' | 'target_review_date'>, today: string): boolean {
  return !isClosed(e) && !!e.target_review_date && e.target_review_date.slice(0, 10) < today;
}
export const isoToday = (d: Date = new Date()): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Where the suggestion on an entry came from: none yet, the rules (a template) or the AI. */
export function suggestionOf(e: Pick<AiEntry, 'ai_generated_at' | 'ai_model'>): 'none' | 'rules' | 'ai' {
  if (!e.ai_generated_at) return 'none';
  return e.ai_model === 'rules.v1' ? 'rules' : 'ai';
}

// ── quick views, filters ─────────────────────────────────────────────────────────────────────────────────────────────────

export type QuickId = 'all' | 'open' | 'high' | 'overdue' | 'ready';
export const QUICK_IDS: readonly QuickId[] = ['all', 'open', 'high', 'overdue', 'ready'];
export const QUICK_LABEL: Record<QuickId, string> = { all: 'All', open: 'Not closed', high: 'High or critical', overdue: 'Review overdue', ready: 'Suggestion to check' };

export function inQuick(id: QuickId, e: AiEntry, today: string): boolean {
  switch (id) {
    case 'open': return !isClosed(e);
    case 'high': { const b = levelOf(e); return b === 'critical' || b === 'high'; }
    case 'overdue': return isOverdue(e, today);
    case 'ready': return suggestionOf(e) !== 'none' && !e.ai_suggestion_accepted;
    default: return true;
  }
}

export interface AiFilters { search: string; category: string[]; status: string[]; quick: QuickId }
export const NO_AI_FILTERS: AiFilters = { search: '', category: [], status: [], quick: 'all' };
export const filterCount = (f: AiFilters): number => (f.search.trim() ? 1 : 0) + f.category.length + f.status.length + (f.quick !== 'all' ? 1 : 0);

const haystack = (e: AiEntry): string => fold([e.ai_system_use_case, e.risk_description, e.risk_owner, e.risk_id_external, e.risk_category].filter(Boolean).join(' '));

export function filterEntries(rows: readonly AiEntry[], f: AiFilters, today: string): AiEntry[] {
  const terms = searchTerms(f.search);
  return rows.filter((e) => {
    if (f.category.length && !f.category.includes(e.risk_category || '')) return false;
    if (f.status.length && !f.status.includes(e.status || 'Open')) return false;
    if (!inQuick(f.quick, e, today)) return false;
    if (terms.length) { const t = haystack(e); if (!terms.every((w) => t.includes(w))) return false; }
    return true;
  });
}

// ── sorting ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SORT_KEYS = ['updated', 'name', 'score', 'status', 'review'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort { key: SortKey; dir: 'asc' | 'desc' }
export const DEFAULT_SORT: Sort = { key: 'updated', dir: 'desc' };
export const FIRST_DIR: Record<SortKey, 'asc' | 'desc'> = { updated: 'desc', name: 'asc', score: 'desc', status: 'asc', review: 'asc' };
export function nextSort(cur: Sort, key: SortKey): Sort {
  if (cur.key !== key) return { key, dir: FIRST_DIR[key] };
  if (cur.dir === FIRST_DIR[key]) return { key, dir: FIRST_DIR[key] === 'asc' ? 'desc' : 'asc' };
  return DEFAULT_SORT;
}
export function sortEntries(rows: readonly AiEntry[], s: Sort): AiEntry[] {
  const dir = s.dir === 'asc' ? 1 : -1;
  const val = (e: AiEntry): number | string => {
    switch (s.key) {
      case 'name': return (e.ai_system_use_case || e.risk_description || '').toLowerCase();
      case 'score': return scoreOf(e) ?? -1;
      case 'status': return (STATUSES as readonly string[]).indexOf(e.status || 'Open');
      case 'review': return e.target_review_date ? e.target_review_date.slice(0, 10) : '9999-12-31';
      default: return e.updated_at || '';
    }
  };
  return rows.slice().sort((a, b) => { const x = val(a); const y = val(b); return dir * (x < y ? -1 : x > y ? 1 : 0) || a.id - b.id; });
}

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const quick = (): ParamSpec<QuickId> => ({
  default: 'all',
  read: ([first]) => ((QUICK_IDS as readonly string[]).includes((first ?? '').trim()) ? ((first ?? '').trim() as QuickId) : undefined),
  write: (v) => (v === 'all' ? [] : [v]),
});
const sort = (): ParamSpec<Sort> => ({
  default: DEFAULT_SORT,
  read: ([first]) => {
    const [key, dir, ...rest] = (first ?? '').trim().split(':');
    return rest.length === 0 && (SORT_KEYS as readonly string[]).includes(key) && (dir === 'asc' || dir === 'desc') ? { key: key as SortKey, dir } : undefined;
  },
  write: (v) => (v.key === DEFAULT_SORT.key && v.dir === DEFAULT_SORT.dir ? [] : [`${v.key}:${v.dir}`]),
});
/** ?q=chatbot&cat=Security&status=Open&quick=overdue&sort=score:desc&open=12&new=1 . */
export const AI_SCHEMA = { q: text(), cat: listOf(), status: listOf(), quick: quick(), sort: sort(), open: text(), new: flag(), view: oneOf(['list'] as const, 'list') };
export interface AiAddress { q: string; cat: string[]; status: string[]; quick: QuickId; sort: Sort; open: string; new: boolean }
export const filtersOf = (a: AiAddress): AiFilters => ({ search: a.q, category: a.cat, status: a.status, quick: a.quick });
export const filtersPatch = (f: AiFilters): Partial<AiAddress> => ({ q: f.search, cat: f.category, status: f.status, quick: f.quick });
export function openIdOf(a: Pick<AiAddress, 'open'>): number | null { const n = Number(a.open); return Number.isInteger(n) && n > 0 ? n : null; }

// ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AiForm {
  risk_id_external: string; ai_system_use_case: string; risk_description: string; risk_category: string; likelihood: number | undefined; impact: number | undefined;
  existing_controls: string; residual_risk_level: string; mitigation_plan: string; risk_owner: string; risk_owner_user_id: number | undefined; target_review_date: string; status: string;
}
export const EMPTY_FORM: AiForm = {
  risk_id_external: '', ai_system_use_case: '', risk_description: '', risk_category: '', likelihood: undefined, impact: undefined, existing_controls: '', residual_risk_level: '', mitigation_plan: '',
  risk_owner: '', risk_owner_user_id: undefined, target_review_date: '', status: 'Open',
};
export function formOf(e: AiEntry): AiForm {
  return {
    risk_id_external: e.risk_id_external || '', ai_system_use_case: e.ai_system_use_case || '', risk_description: e.risk_description || '', risk_category: e.risk_category || '', likelihood: e.likelihood ?? undefined,
    impact: e.impact ?? undefined, existing_controls: e.existing_controls || '', residual_risk_level: e.residual_risk_level || '', mitigation_plan: e.mitigation_plan || '', risk_owner: e.risk_owner || '',
    risk_owner_user_id: e.risk_owner_user_id ?? undefined, target_review_date: (e.target_review_date || '').slice(0, 10), status: e.status || 'Open',
  };
}
/** What a save sends: the form, without an empty score or date (the server takes null as "none", and an empty string is not a date). */
export function bodyOf(f: AiForm): Record<string, unknown> {
  const body: Record<string, unknown> = { ...f };
  if (body.likelihood === undefined) delete body.likelihood;
  if (body.impact === undefined) delete body.impact;
  if (!body.target_review_date) delete body.target_review_date;
  if (body.risk_owner_user_id === undefined) delete body.risk_owner_user_id;
  return body;
}
export const sameForm = (a: AiForm, b: AiForm): boolean => JSON.stringify(a) === JSON.stringify(b);

const blank = (v: unknown): boolean => v === undefined || v === null || String(v).trim() === '';
/**
 * "Accept the suggestion" fills the blanks of the entry on the server (the mitigation plan, the controls, the likelihood, the impact, the residual word). The open form still holds those
 * blanks, and a "Save changes" that follows would send them back and ERASE what was just accepted (the old page did exactly that). After an accept the form takes the server's value for
 * every one of those fields that is still blank in the form; whatever the person has typed is kept.
 */
export function mergeAccepted(form: AiForm, entry: AiEntry): AiForm {
  const next = { ...form };
  if (blank(form.mitigation_plan) && !blank(entry.mitigation_plan)) next.mitigation_plan = entry.mitigation_plan as string;
  if (blank(form.existing_controls) && !blank(entry.existing_controls)) next.existing_controls = entry.existing_controls as string;
  if (blank(form.likelihood) && entry.likelihood != null) next.likelihood = entry.likelihood;
  if (blank(form.impact) && entry.impact != null) next.impact = entry.impact;
  if (blank(form.residual_risk_level) && !blank(entry.residual_risk_level)) next.residual_risk_level = entry.residual_risk_level as string;
  return next;
}
