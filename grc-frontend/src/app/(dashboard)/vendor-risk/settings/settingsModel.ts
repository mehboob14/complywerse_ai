// What the Settings page works out, apart from React so `node --test` pins it (settingsModel.test.ts). Settings is a section nav (Tiering, Reviews and reminders, Monitoring, Supplier records, Questionnaire
// scoring, Exposure model, Emails): each section holds its own draft keys, saves them on its own and says so when they are unsaved. Nothing here calls the server; `bodyOf` builds what PUT
// /vendor-risk/tpra/config is sent and is the one place that says which part of the config a key writes (the approver role and the reopen threshold are the Policy page's: a stale copy here must
// never overwrite them, so only the questionnaires and the evidence of a tier are sent). The old Settings addresses (#questions, #exposure ...) keep landing on the right place: `legacyTarget`.
import type { BuiltinSection, CustomQuestion, QuestionsDraft } from './_Questions.tsx';
import type { Quant } from './exposureModel.ts';
import { exposureProblems } from './exposureModel.ts';

export interface ReminderPolicy {
  enabled: boolean; remind_before_days: number; repeat_every_days: number; escalate_after_days: number;
  escalate_to: string[]; checkin_every_days?: number; contract_before_days?: number; contract_notify?: string[];
  alert_min_severity?: string; alert_notify?: string[]; digest_to?: string[]; digest_weekday?: number;
}
export interface TierRules { template_ids: number[]; evidence: string[]; approver_role: string | null; reassess_on: string }
export interface MonitoringPolicy {
  adverse_media: boolean; outside_in: boolean; grip_daily?: boolean; leak_search?: boolean; own_domains?: string[];
  check_every_days: Record<string, number>; scan_every_days: Record<string, number>;
  scan_points: Record<string, number>; scan_category_cap: number; grades: Record<string, number>;
}
export interface Named { key: string; label: string; archived?: boolean }
export interface EvidenceDraft { evidence: Named[]; evidence_builtin: Record<string, { label?: string; hidden?: boolean }> }
export interface Defaults {
  weights: Record<string, number>; thresholds: Record<string, number>; cadence_days: Record<string, number>;
  reminder_policy: ReminderPolicy; scoring_policy?: { partial_credit: number }; tier_policy?: Record<string, TierRules>;
  quantification?: Quant; monitoring_policy?: Partial<MonitoringPolicy>;
}
export interface Customisation extends QuestionsDraft, EvidenceDraft { factors: Named[] }
export interface ConfigResp extends Defaults {
  customisation?: Customisation;
  defaults: Defaults;
  meta: {
    factor_keys: string[]; factor_labels: Record<string, string>; tier_keys: string[]; cadence_keys: string[];
    evidence_kinds?: Record<string, string>; severities?: string[];
    builtin?: { sections: BuiltinSection[]; factors: Record<string, string>; evidence: Record<string, string> };
  };
}

/** What the page edits, one entry per part that saves. */
export interface Draft {
  weights: Record<string, number>;            // percentages; the server normalises to 100
  tier_policy: Record<string, TierRules>;
  reminder_policy: ReminderPolicy;
  monitoring_policy: Pick<MonitoringPolicy, 'adverse_media' | 'outside_in' | 'grip_daily' | 'leak_search' | 'own_domains' | 'check_every_days' | 'scan_every_days'>;
  scan_scoring: Pick<MonitoringPolicy, 'scan_points' | 'scan_category_cap' | 'grades'>;   // sent within monitoring_policy
  scoring_policy: { partial_credit: number };
  quantification: Quant;
  custom_questions: QuestionsDraft;          // these three are sent together as `customisation`
  custom_factors: Named[];
  custom_evidence: EvidenceDraft;
}
export type DraftKey = keyof Draft;

export const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function toDraft(c: ConfigResp, from: Defaults): Draft {
  const m = { ...(c.defaults.monitoring_policy || {}), ...(from.monitoring_policy || {}) } as MonitoringPolicy;
  // The defaults have none of the organisation's own questions, factors or evidence types.
  const cu = from === c ? c.customisation : undefined;
  return {
    weights: Object.fromEntries(c.meta.factor_keys.map((k) => [k, Math.round((from.weights[k] ?? 0) * 100)])),
    tier_policy: clone(from.tier_policy || {}),
    reminder_policy: { ...clone(from.reminder_policy), escalate_to: [...(from.reminder_policy.escalate_to || [])] },
    monitoring_policy: {
      adverse_media: !!m.adverse_media, outside_in: !!m.outside_in, grip_daily: !!m.grip_daily, leak_search: !!m.leak_search, own_domains: [...(m.own_domains || [])],
      check_every_days: { ...m.check_every_days }, scan_every_days: { ...m.scan_every_days },
    },
    scan_scoring: { scan_points: { ...m.scan_points }, scan_category_cap: m.scan_category_cap, grades: { ...m.grades } },
    scoring_policy: { partial_credit: from.scoring_policy?.partial_credit ?? 0.5 },
    quantification: clone((from.quantification || c.quantification) as Quant),
    custom_questions: {
      sections: clone(cu?.sections || []), builtin_sections: clone(cu?.builtin_sections || {}), builtin: clone(cu?.builtin || {}),
      questions: clone(cu?.questions || []) as CustomQuestion[], section_roles: clone(cu?.section_roles || {}),
    },
    custom_factors: clone(cu?.factors || []),
    custom_evidence: { evidence: clone(cu?.evidence || []), evidence_builtin: clone(cu?.evidence_builtin || {}) },
  };
}

// ── the sections ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SECTION_IDS = ['tiering', 'reminders', 'monitoring', 'records', 'scoring', 'exposure', 'emails'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export interface SectionDef {
  id: SectionId;
  /** what the nav says */
  label: string;
  /** the page's heading words under the section's name: what it is for, in a line */
  about: string;
  /** the draft keys that save with this section's Save (none: the section saves with its own buttons) */
  keys: readonly DraftKey[];
}

export const SECTIONS: readonly SectionDef[] = [
  { id: 'tiering', label: 'Tiering', about: 'How a supplier is tiered at onboarding: the questions asked, the factors and weights behind the score, the evidence types and what each tier asks for.', keys: ['custom_questions', 'weights', 'custom_factors', 'custom_evidence', 'tier_policy'] },
  { id: 'reminders', label: 'Reviews and reminders', about: 'Who is reminded of what, when, and who hears when it is overdue.', keys: ['reminder_policy'] },
  { id: 'monitoring', label: 'Monitoring', about: 'What is watched about each supplier, how often, and how a scan from outside is scored.', keys: ['monitoring_policy', 'scan_scoring'] },
  { id: 'records', label: 'Supplier records', about: 'Your own fields on the supplier form and the choices in its dropdowns.', keys: [] },
  { id: 'scoring', label: 'Questionnaire scoring', about: 'What a Partial answer is worth.', keys: ['scoring_policy'] },
  { id: 'exposure', label: 'Exposure model', about: 'The figures that put a money range on every supplier.', keys: ['quantification'] },
  { id: 'emails', label: 'Emails', about: 'The subject and wording of each email, with a preview and a test to yourself.', keys: [] },
];

export const sectionOf = (id: string): SectionDef => SECTIONS.find((s) => s.id === id) ?? SECTIONS[0];

/** The parts of a section a link can jump to (the anchor id of the card) and the draft keys each one resets to the defaults. */
export const PART_KEYS: Readonly<Record<string, readonly DraftKey[]>> = {
  questions: ['custom_questions'],
  factors: ['weights', 'custom_factors'],
  'evidence-types': ['custom_evidence'],
  'tier-asks': ['tier_policy'],
  reminders: ['reminder_policy'],
  monitoring: ['monitoring_policy'],
  'scan-scoring': ['scan_scoring'],
  scoring: ['scoring_policy'],
  exposure: ['quantification'],
};

/** An address the module used to have, as it is now: `#questions` on Settings becomes `?section=tiering#questions`. A hash the new page has no card for, or one that moved to the Policy page, goes
 *  where its setting lives. null when the hash is not one of the old ones. */
export function legacyTarget(hash: string): string | null {
  const id = hash.replace(/^#/, '');
  const S = '/vendor-risk/settings';
  const at = (section: SectionId, anchor?: string) => `${S}?section=${section}${anchor ? `#${anchor}` : ''}`;
  switch (id) {
    case 'questions': case 'factors': case 'evidence-types': case 'tier-asks': return at('tiering', id);
    case 'reminders': return at('reminders', id);
    case 'monitoring': return at('monitoring', id);
    case 'scan-scoring': return at('monitoring', id);
    case 'record': return at('records');
    case 'scoring': return at('scoring', id);
    case 'exposure': return at('exposure', id);
    case 'emails': return at('emails');
    case 'thresholds': case 'cadence': return '/vendor-risk/policy#bands';
    case 'alert-rules': return '/vendor-risk/policy#alert-rules';
    default: return null;
  }
}

/** Which section an anchor belongs to (the one that is open when the address has `#anchor` and no `?section=`). */
export function sectionOfAnchor(hash: string): SectionId | null {
  const to = legacyTarget(hash);
  const m = to ? /[?&]section=([a-z]+)/.exec(to) : null;
  return m && (SECTION_IDS as readonly string[]).includes(m[1]) ? (m[1] as SectionId) : null;
}

// ── what changed, and what to send ───────────────────────────────────────────────────────────────────────────────────────

/** The keys whose value differs from the saved one. */
export function dirtyKeys(draft: Draft, saved: Draft): DraftKey[] {
  return (Object.keys(draft) as DraftKey[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(saved[k]));
}

/** The dirty keys of one section. */
export const dirtyOf = (section: SectionDef, dirty: readonly DraftKey[]): DraftKey[] => dirty.filter((k) => section.keys.includes(k));

/** The body of PUT /vendor-risk/tpra/config for these keys: only what the page edits. */
export function bodyOf(keys: readonly DraftKey[], draft: Draft): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const custom: Record<string, unknown> = {};
  keys.forEach((k) => {
    if (k === 'custom_questions') Object.assign(custom, draft.custom_questions);
    else if (k === 'custom_factors') custom.factors = draft.custom_factors;
    else if (k === 'custom_evidence') Object.assign(custom, draft.custom_evidence);
    else if (k === 'scan_scoring') body.monitoring_policy = { ...(body.monitoring_policy as object || {}), ...draft.scan_scoring };
    else if (k === 'monitoring_policy') body.monitoring_policy = { ...(body.monitoring_policy as object || {}), ...draft.monitoring_policy };
    // the approver role and the reopen threshold are the Policy page's: send only what this page edits, so a stale copy cannot overwrite them
    else if (k === 'tier_policy') body.tier_policy = Object.fromEntries(Object.entries(draft.tier_policy).map(([tier, rules]) => [tier, { template_ids: rules.template_ids, evidence: rules.evidence }]));
    else body[k] = draft[k];
  });
  if (Object.keys(custom).length) body.customisation = custom;
  return body;
}

/** The evidence types in use, by key, in this organisation's words. */
export function activeEvidence(builtin: Record<string, string>, d: EvidenceDraft): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(builtin).forEach(([k, l]) => { if (!d.evidence_builtin[k]?.hidden) out[k] = d.evidence_builtin[k]?.label || l; });
  d.evidence.filter((e) => !e.archived).forEach((e) => { out[e.key] = e.label; });
  return out;
}

/** What stops a section being saved, in words, for the save bar. `questions` are the onboarding editor's own (its file computes them). */
export function problemsOf(keys: readonly DraftKey[], draft: Draft, questions: readonly string[] = []): string[] {
  const has = (k: DraftKey) => keys.includes(k);
  const out: string[] = [];
  if (has('weights') && !(Object.values(draft.weights).reduce((a, b) => a + (Number(b) || 0), 0) > 0)) out.push('At least one risk factor needs a weight');
  if (has('reminder_policy') && !(draft.reminder_policy.repeat_every_days >= 1)) out.push('Overdue reminders must repeat at least every day');
  if (has('quantification')) exposureProblems(draft.quantification).forEach((p) => out.push(`Exposure model: ${p}`));
  if (has('custom_questions')) questions.forEach((p) => out.push(`Onboarding questions: ${p}`));
  if (has('custom_factors') && draft.custom_factors.some((f) => !f.archived && !f.label.trim())) out.push('Every factor needs a name');
  if (has('custom_evidence') && draft.custom_evidence.evidence.some((e) => !e.archived && !e.label.trim())) out.push('Every evidence type needs a name');
  if (has('scan_scoring')) {
    const pts = draft.scan_scoring.scan_points;
    const g = draft.scan_scoring.grades;
    if (!(pts.critical >= pts.high && pts.high >= pts.medium && pts.medium >= pts.low)) out.push('Scan scoring: a more severe finding must take off at least as many points');
    if (!(g.A > g.B && g.B > g.C && g.C > g.D)) out.push('Scan scoring: each grade must start above the next');
  }
  return out;
}

/** "every day", "every year", "every 3 months", "every 2 weeks", "every 45 days": a number of days in words. */
export function days(d: number): string {
  if (!d) return '—';
  if (d === 1) return 'every day';
  if (d % 365 === 0) return d === 365 ? 'every year' : `every ${d / 365} years`;
  if (d % 30 === 0 && d < 365) return d === 30 ? 'every month' : `every ${d / 30} months`;
  if (d % 7 === 0 && d < 60) return d === 7 ? 'every week' : `every ${d / 7} weeks`;
  return `every ${d} days`;
}
