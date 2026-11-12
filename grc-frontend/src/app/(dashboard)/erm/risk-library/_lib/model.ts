// Pure rules of the Risk Library page (no React): its pop-ups (propose to an owner, the owner's draft, an administrator's "Add to
// register"), what each starts with and when it may be sent, the score band, the review's side by side, the list's chips and labels,
// and the address the page keeps its filters and tab in.

/** `installed`: this organisation's framework library holds the control, so it can be linked (absent until the server says). */
export interface LibraryControl { control_id: string; title: string; priority?: string | null; applicability?: string | null; installed?: boolean }

export interface LibraryRisk {
  id: string;
  framework_key: string;
  title: string;
  description: string;
  family_id: string;
  family_name: string;
  family_kind: string;
  objective_id: string;
  objective_title: string;
  objective: string;
  suggested_category: string;
  controls: LibraryControl[];
  /** In the register (a draft is not yet): the first risk, how many, and the units whose registers hold it. */
  in_register: { risk_id: number; title: string; status: string; times: number; units?: string[] } | null;
  /** Proposals still in hand (proposed, drafted or returned), one per unit. */
  proposals?: ProposalMark[];
}

export interface ProposalMark {
  id: number; status: ProposalStatus; business_unit_id: number | null; unit_name: string | null;
  owner_id: number; owner_name: string | null; risk_id: number | null;
}

/** A library risk the library suggests for a unit, with why. */
export interface Suggestion extends LibraryRisk { reasons: string[]; score: number }

export type ProposalStatus = 'proposed' | 'drafted' | 'returned' | 'declined' | 'accepted';

export interface DraftRisk {
  id: number; title: string; description: string | null; category: string; status: string;
  inherent_likelihood: number | null; inherent_impact: number | null; inherent_score: number | null; priority: string | null;
}

export interface Proposal {
  id: number; library_item_id: string; title: string | null; objective_id: string | null; objective_title: string | null;
  business_unit_id: number | null; unit_name: string | null; owner_id: number; owner_name: string | null;
  proposed_by: number | null; proposed_by_name: string | null; proposed_at: string | null; note: string | null;
  status: ProposalStatus; drafted_by: number | null; drafted_at: string | null; decline_reason: string | null;
  reviewed_by: number | null; reviewed_by_name: string | null; reviewed_at: string | null; review_comment: string | null;
  risk: DraftRisk | null;
  /** What the person looking may do now (the server decides; the drafter never challenges their own draft). */
  you: { may_draft: boolean; may_decline: boolean; may_challenge: boolean };
  library_risk?: LibraryRisk | null;
}

export const STATUS_LABEL: Record<ProposalStatus, string> = {
  proposed: 'Proposed', drafted: 'Waiting for challenge', returned: 'Returned to owner', declined: 'Declined', accepted: 'In register',
};

/** The list's register action: the first proposal, or another unit once the risk is in a register or proposed somewhere. */
export const proposeLabel = (risk: LibraryRisk): string =>
  risk.in_register || risk.proposals?.length ? 'Propose for another unit' : 'Propose to owner';

/** "Proposed · Retail, Treasury" for the chip; null when nothing is in hand. */
export function proposedText(risk: LibraryRisk): string | null {
  const units = (risk.proposals || []).map((p) => p.unit_name).filter((u): u is string => !!u);
  if (!risk.proposals?.length) return null;
  return units.length ? `Proposed · ${units.join(', ')}` : 'Proposed';
}

/** Where the risk is already used: the units whose registers hold it, then the units it is proposed to. */
export function whereUsed(risk: LibraryRisk): string[] {
  const inRegister = (risk.in_register?.units || []).map((u) => `${u} (in register)`);
  const proposed = (risk.proposals || []).map((p) => `${p.unit_name || 'No unit'} (${STATUS_LABEL[p.status].toLowerCase()})`);
  return [...inRegister, ...proposed];
}

export interface ProposeForm { business_unit_id: string; owner_id: string; note: string }

export function proposeProblem(f: ProposeForm): string | null {
  if (!f.business_unit_id) return 'Choose the unit';
  if (!f.owner_id) return 'Choose the risk owner';
  return null;
}

export const proposeBody = (f: ProposeForm) => ({
  business_unit_id: Number(f.business_unit_id), owner_id: Number(f.owner_id), note: f.note.trim() || undefined,
});

export interface DraftForm { title: string; description: string; inherent_likelihood: string; inherent_impact: string }

/** The owner's draft opens with the library's words (or, after a return, their last draft). */
export function startDraft(p: Proposal, risk: LibraryRisk | null | undefined): DraftForm {
  const d = p.risk;
  return {
    title: d?.title || p.title || risk?.title || '', description: d?.description ?? risk?.description ?? '',
    inherent_likelihood: d?.inherent_likelihood ? String(d.inherent_likelihood) : '',
    inherent_impact: d?.inherent_impact ? String(d.inherent_impact) : '',
  };
}

export function draftProblem(f: DraftForm): string | null {
  if (!f.title.trim()) return 'Give the risk a title';
  if (!f.inherent_likelihood) return 'Choose how likely it is';
  if (!f.inherent_impact) return 'Choose how severe it would be';
  return null;
}

export const draftBody = (f: DraftForm) => ({
  title: f.title.trim(), description: f.description.trim(),
  inherent_likelihood: Number(f.inherent_likelihood), inherent_impact: Number(f.inherent_impact),
});

/** The review's side by side: what the library says against the owner's draft, row by row, marking what the owner changed. */
export function sideBySide(p: Proposal): { label: string; library: string; draft: string; changed: boolean }[] {
  const lib = p.library_risk, d = p.risk;
  const score = d?.inherent_score ? `${d.inherent_score} (likelihood ${d.inherent_likelihood} × impact ${d.inherent_impact})` : 'Not drafted';
  const rows = [
    { label: 'Risk', library: lib?.title || p.title || '', draft: d?.title || '' },
    { label: 'Description', library: lib?.description || '', draft: d?.description || '' },
    { label: 'Category', library: lib?.suggested_category || '', draft: d?.category || '' },
  ].map((r) => ({ ...r, changed: r.library.trim() !== r.draft.trim() }));
  return [...rows, { label: 'Before controls score', library: 'The library does not score', draft: score, changed: false }];
}

/** The page's tabs (kept in the address by useTabParam). */
export const TABS = ['library', 'suggestions', 'proposals'] as const;
export type Tab = (typeof TABS)[number];

/** What else the address holds: the unit picked for suggestions and the proposal a notification opens. */
export function openedFrom(get: (k: string) => string | null): { unit: string; proposal: number | null } {
  const proposal = Number(get('proposal'));
  return { unit: get('unit') || '', proposal: Number.isInteger(proposal) && proposal > 0 ? proposal : null };
}

export const CATEGORIES: { value: string; label: string }[] = [
  { value: 'strategic', label: 'Strategic' },
  { value: 'operational', label: 'Operational' },
  { value: 'financial', label: 'Financial' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'technology', label: 'Technology' },
  { value: 'third_party', label: 'Third party' },
  { value: 'project_change', label: 'Project / change' },
  { value: 'internal', label: 'Internal' },
];

export const LIKELIHOOD = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'];
export const IMPACT = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Severe'];

export type Band = 'critical' | 'high' | 'medium' | 'low';

/** The bands the register's dashboard uses: 20+ critical, 12+ high, 6+ medium, else low. */
export function bandOf(score: number | null | undefined): Band | null {
  if (!score) return null;
  return score >= 20 ? 'critical' : score >= 12 ? 'high' : score >= 6 ? 'medium' : 'low';
}

export const BAND_LABEL: Record<Band, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };

export interface AddForm {
  title: string;
  description: string;
  category: string;
  owner_id: string;
  business_owner_id: string;
  team_id: string;
  inherent_likelihood: string;
  inherent_impact: string;
  residual_likelihood: string;
  residual_impact: string;
  treatment_plan: string;
  review_date: string;
  /** The ids of the objective's controls to link to the new risk (only ones the organisation's framework library holds). */
  controls: string[];
}

/** The controls of a library risk that can be linked here: the ones this organisation's framework library holds. */
export const linkable = (risk: LibraryRisk): string[] => risk.controls.filter((c) => c.installed !== false).map((c) => c.control_id);

/** What the pop-up opens with: the library's words, the family's suggested category and every linkable control; the person fills in the rest. */
export function startForm(risk: LibraryRisk): AddForm {
  return {
    title: risk.title, description: risk.description, category: risk.suggested_category,
    owner_id: '', business_owner_id: '', team_id: '', inherent_likelihood: '', inherent_impact: '',
    residual_likelihood: '', residual_impact: '', treatment_plan: '', review_date: '', controls: linkable(risk),
  };
}

/** Tick or untick one control (the order stays the objective's). */
export function toggleControl(all: string[], chosen: string[], id: string): string[] {
  return all.filter((c) => (c === id ? !chosen.includes(c) : chosen.includes(c)));
}

export function inherentScore(f: Pick<AddForm, 'inherent_likelihood' | 'inherent_impact'>): number | null {
  const l = Number(f.inherent_likelihood), i = Number(f.inherent_impact);
  return l >= 1 && i >= 1 ? l * i : null;
}

/** The first thing that stops the pop-up being sent, as a sentence; null when it can be. */
export function problem(f: AddForm): string | null {
  if (!f.title.trim()) return 'Give the risk a title';
  if (!f.owner_id) return 'Choose who owns the risk';
  if (!f.inherent_likelihood) return 'Choose how likely it is';
  if (!f.inherent_impact) return 'Choose how severe it would be';
  if (!!f.residual_likelihood !== !!f.residual_impact) return 'Give both residual answers, or neither';
  return null;
}

/** The body for POST /erm/risk-library/{id}/add-to-register (an administrator's shortcut; the risk starts as a draft, so no status
 *  is sent). Empty optional answers are left out; `custom` is the tenant's own field values from the Custom fields tab (undefined =
 *  none to send), `controls` always goes (an empty list links none). */
export function requestBody(f: AddForm, again: boolean, custom?: Record<string, unknown>): Record<string, unknown> {
  const num = (v: string) => (v ? Number(v) : undefined);
  const text = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    title: f.title.trim(), description: f.description.trim(), category: f.category,
    owner_id: Number(f.owner_id), business_owner_id: num(f.business_owner_id), team_id: num(f.team_id),
    inherent_likelihood: Number(f.inherent_likelihood), inherent_impact: Number(f.inherent_impact),
    residual_likelihood: num(f.residual_likelihood), residual_impact: num(f.residual_impact),
    treatment_plan: text(f.treatment_plan), review_date: f.review_date ? `${f.review_date}T00:00:00` : undefined,
    custom_values: custom, control_codes: f.controls, allow_duplicate: again || undefined,
  };
}

/** What the toast says after an add: the new risk and how many controls it was linked to. */
export function addedText(added: { risk: { id: number; title: string }; linked_controls: string[] }): string {
  const n = added.linked_controls.length;
  return `Risk #${added.risk.id}: ${added.risk.title}${n ? ` · ${n} ${n === 1 ? 'control' : 'controls'} linked` : ''}`;
}

// ── the page's filters, kept in the address ─────────────────────────────────

export type View = 'all' | 'open' | 'added';
export interface Filters { framework: string; family: string; objective: string; q: string; view: View; page: number }
export const PAGE_SIZE = 25;

export function filtersFrom(get: (k: string) => string | null): Filters {
  const view = get('view');
  const page = Number(get('page'));
  return {
    framework: get('framework') || '', family: get('family') || '', objective: get('objective') || '', q: get('q') || '',
    view: view === 'open' || view === 'added' ? view : 'all', page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

/** The address query for a set of filters: only what differs from "everything" is written. */
export function addressOf(f: Filters): string {
  const p = new URLSearchParams();
  if (f.framework) p.set('framework', f.framework);
  if (f.family) p.set('family', f.family);
  if (f.objective) p.set('objective', f.objective);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.view !== 'all') p.set('view', f.view);
  if (f.page > 1) p.set('page', String(f.page));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** The API's query for a set of filters (the register mark is `in_register`: true = only added, false = only not yet). */
export function apiParams(f: Filters): Record<string, string | number | boolean> {
  const params: Record<string, string | number | boolean> = { skip: (f.page - 1) * PAGE_SIZE, limit: PAGE_SIZE };
  if (f.framework) params.framework = f.framework;
  if (f.family) params.family = f.family;
  if (f.objective) params.objective = f.objective;
  if (f.q.trim()) params.q = f.q.trim();
  if (f.view === 'added') params.in_register = true;
  if (f.view === 'open') params.in_register = false;
  return params;
}

/** "26-50 of 159" for the page the person is on. */
export function rangeText(page: number, total: number): string {
  if (!total) return '0 of 0';
  const from = (page - 1) * PAGE_SIZE + 1;
  return `${from}-${Math.min(page * PAGE_SIZE, total)} of ${total}`;
}
