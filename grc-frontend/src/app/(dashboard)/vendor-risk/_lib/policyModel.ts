// What the Policy page works out: the form it edits (the policy as the server holds it, plus the reopen threshold, which lives in
// the tier policy of the program config), what changed (only that is sent), and what is wrong with it (checked before Save, the
// server checks again). Pure, so `node --test` runs policyModel.test.ts against it.

export const TIERS = ['critical', 'high', 'medium', 'low'] as const;
export type Tier = (typeof TIERS)[number];
export type PerTier<T> = Record<Tier, T>;
/** The tiers with a score band: Low is whatever falls below Medium. */
const BANDS = ['critical', 'high', 'medium'] as const;

/** GET /vendor-risk/policy: what the page edits. */
export interface PolicyView {
  thresholds: { critical: number; high: number; medium: number };
  cadence_days: PerTier<number>;
  remediation_days: PerTier<number>;
  skip_matrix: PerTier<string[]>;
  required_reviewers: PerTier<string[]>;
  /** a role's name, or null: anyone who may approve */
  approver_roles: PerTier<string | null>;
}

export interface PolicyPayload extends PolicyView {
  customised: boolean;
  can_edit: boolean;
  defaults: PolicyView;
  meta: {
    tiers: Tier[];
    severities: Tier[];
    stages: Array<{ key: string; label: string; skippable: boolean }>;
    roles: Array<{ key: string; label: string }>;
  };
}

/** From which severity a monitoring alert reopens a vendor's assessment, per tier (the tier policy of /vendor-risk/tpra/config). */
export type Reopen = PerTier<Tier>;
export const DEFAULT_REOPEN: Reopen = { critical: 'medium', high: 'high', medium: 'high', low: 'critical' };

export interface Draft extends PolicyView { reopen: Reopen }

const copy = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

export function reopenFrom(config?: { tier_policy?: Partial<Record<string, { reassess_on?: string | null }>> } | null): Reopen {
  const out = { ...DEFAULT_REOPEN };
  for (const tier of TIERS) {
    const value = config?.tier_policy?.[tier]?.reassess_on;
    if ((TIERS as readonly string[]).includes(value ?? '')) out[tier] = value as Tier;
  }
  return out;
}

export function toDraft(policy: PolicyView, reopen: Reopen): Draft {
  const { thresholds, cadence_days, remediation_days, skip_matrix, required_reviewers, approver_roles } = policy;
  return copy({ thresholds, cadence_days, remediation_days, skip_matrix, required_reviewers, approver_roles, reopen });
}

// ── what changed ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown): boolean => {
  const norm = (x: unknown) => (Array.isArray(x) ? [...x].sort() : x ?? null);       // a list of chips has no order of its own
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
};

/** The tiers of a per-tier setting that differ, as {tier: new value}; null when none does. */
function changedTiers<T>(now: PerTier<T>, was: PerTier<T>): Partial<PerTier<T>> | null {
  const out: Partial<PerTier<T>> = {};
  for (const tier of TIERS) if (!same(now[tier], was[tier])) out[tier] = now[tier];
  return Object.keys(out).length ? out : null;
}

/** The body of PUT /vendor-risk/policy: only the settings that changed, and within one, only the tiers that did (the three bands
 *  go together, as they only make sense falling). null when nothing about the policy changed. */
export function policyPatch(draft: Draft, saved: Draft): Partial<PolicyView> | null {
  const body: Partial<PolicyView> = {};
  if (BANDS.some((t) => draft.thresholds[t] !== saved.thresholds[t])) body.thresholds = { ...draft.thresholds };
  const cadence = changedTiers(draft.cadence_days, saved.cadence_days);
  if (cadence) body.cadence_days = cadence as PerTier<number>;
  const fix = changedTiers(draft.remediation_days, saved.remediation_days);
  if (fix) body.remediation_days = fix as PerTier<number>;
  const skips = changedTiers(draft.skip_matrix, saved.skip_matrix);
  if (skips) body.skip_matrix = skips as PerTier<string[]>;
  const reviewers = changedTiers(draft.required_reviewers, saved.required_reviewers);
  if (reviewers) body.required_reviewers = reviewers as PerTier<string[]>;
  const approvers = changedTiers(draft.approver_roles, saved.approver_roles);
  if (approvers) body.approver_roles = approvers as PerTier<string | null>;
  return Object.keys(body).length ? body : null;
}

/** The tier policy sent to PUT /vendor-risk/tpra/config for the reopen threshold: the tiers that changed, nothing else of the
 *  tier policy (the questionnaires and evidence are Settings'). null when none did. */
export function reopenPatch(draft: Draft, saved: Draft): Record<string, { reassess_on: Tier }> | null {
  const changed = changedTiers(draft.reopen, saved.reopen);
  return changed ? Object.fromEntries(Object.entries(changed).map(([tier, value]) => [tier, { reassess_on: value as Tier }])) : null;
}

export const isDirty = (draft: Draft, saved: Draft): boolean => policyPatch(draft, saved) !== null || reopenPatch(draft, saved) !== null;

/** The sections of the form that can be put back to the shipped defaults, one by one. */
export type Part = 'bands' | 'remediation' | 'skips' | 'reviewers' | 'approvals';

/** The draft with one section back at the shipped defaults (nothing is saved until Save). The defaults of the policy come with it
 *  (GET /vendor-risk/policy: `defaults`); the reopen threshold's are the tier policy's own (DEFAULT_REOPEN). */
export function withDefaults(draft: Draft, defaults: PolicyView, part: Part): Draft {
  const next = toDraft(draft, draft.reopen);
  const shipped = copy(defaults);
  if (part === 'bands') { next.thresholds = shipped.thresholds; next.cadence_days = shipped.cadence_days; }
  else if (part === 'remediation') next.remediation_days = shipped.remediation_days;
  else if (part === 'skips') next.skip_matrix = shipped.skip_matrix;
  else if (part === 'reviewers') next.required_reviewers = shipped.required_reviewers;
  else { next.approver_roles = shipped.approver_roles; next.reopen = { ...DEFAULT_REOPEN }; }
  return next;
}

/** Whether a section already is what the shipped defaults say (so there is nothing to put back). */
export const atDefaults = (draft: Draft, defaults: PolicyView, part: Part): boolean => !isDirty(withDefaults(draft, defaults, part), draft);

// ── what is wrong ────────────────────────────────────────────────────────────────────────────────────────────────────────

const whole = (n: unknown, low: number, high: number): boolean => typeof n === 'number' && Number.isInteger(n) && n >= low && n <= high;
const score = (n: unknown): boolean => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100;

export const cadenceBad = (n: unknown): boolean => !whole(n, 30, 1825);
export const windowBad = (n: unknown): boolean => !whole(n, 1, 365);

/** Whether the three bands are wrong: each a score from 0 to 100, falling from critical to medium (low is below medium). */
export function bandsBad(t: PolicyView['thresholds']): boolean {
  return !(score(t.critical) && score(t.high) && score(t.medium) && t.critical > t.high && t.high > t.medium);
}

/** The sentences to show beside Save, in page order, each once. */
export function problems(draft: Draft): string[] {
  const out: string[] = [];
  if (bandsBad(draft.thresholds)) out.push('Bands are scores from 0 to 100, falling: Critical above High, High above Medium');
  if (TIERS.some((t) => cadenceBad(draft.cadence_days[t]))) out.push('Reviews run every 30 to 1,825 days');
  if (TIERS.some((t) => windowBad(draft.remediation_days[t]))) out.push('Fix windows are 1 to 365 days');
  return out;
}

// ── the chips and the lists ──────────────────────────────────────────────────────────────────────────────────────────────

/** A chip list with `value` switched, kept in the order of `order` (the lifecycle's, the roster's). */
export function toggled(list: string[], value: string, order: string[]): string[] {
  const on = new Set(list);
  if (on.has(value)) on.delete(value); else on.add(value);
  return order.filter((k) => on.has(k));
}

/** The approver choices: anyone who may approve, each role, and a role the policy still names that no longer exists. */
export function approverOptions(roles: string[], current: string | null): Array<{ value: string; label: string }> {
  const out = [{ value: '', label: 'Anyone who may approve' }, ...roles.map((r) => ({ value: r, label: r }))];
  if (current && !roles.includes(current)) out.push({ value: current, label: `${current} (no such role now)` });
  return out;
}

export const REOPEN_OPTIONS: Array<{ value: Tier; label: string }> = [
  { value: 'low', label: 'Low and up' },
  { value: 'medium', label: 'Medium and up' },
  { value: 'high', label: 'High and up' },
  { value: 'critical', label: 'Critical and up' },
];

export const standing = (customised: boolean): string => (customised ? 'Tuned for this workspace' : 'On the shipped defaults');
