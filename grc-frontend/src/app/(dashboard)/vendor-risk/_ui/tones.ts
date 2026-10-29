// Status words -> tone, and the colours of each tone. Pure, so `node --test` runs tones.test.ts against it.
// The six families are Verity's shipped ones (tprm-verity-ux-reference, "Colours actually shipped"), spelled as hex because the
// platform CSS repaints slate/green/blue utilities inside the shell (PITFALLS 100). Words are the ones Verity uses plus the ones
// Compliverse's own rows carry (a vendor is "suspended", a request "in_review"); anything else reads as neutral, never as a guess.

export type Tone = 'success' | 'danger' | 'warning' | 'progress' | 'pending' | 'neutral';

export interface ToneColors {
  /** the dot, a bar, a chart slice */
  dot: string;
  /** words on the tint (4.5:1 or better, checked in tones.test.ts) */
  text: string;
  /** the soft fill behind a pill */
  tint: string;
  /** the dot at 30% over white: a pill's outline, so a column of pale pills still reads */
  border: string;
}

export const TONE: Record<Tone, ToneColors> = {
  success: { dot: '#059669', text: '#08794F', tint: '#E7F5EF', border: '#B4E0D2' },
  danger: { dot: '#E11D48', text: '#C01741', tint: '#FDEEF1', border: '#F6BBC8' },
  warning: { dot: '#D97706', text: '#9A5007', tint: '#FBF1E4', border: '#F0D2A9' },
  progress: { dot: '#0284C7', text: '#0369A1', tint: '#EAF4FB', border: '#B3D9EE' },
  pending: { dot: '#7C5CD6', text: '#6947C7', tint: '#F3EFFC', border: '#D7CCF1' },
  neutral: { dot: '#64748B', text: '#566072', tint: '#F0F2F5', border: '#D1D7DF' },
};

const norm = (s?: string | null): string => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const word = (map: Record<string, Tone>) => (s?: string | null): Tone => map[norm(s)] ?? 'neutral';

const STAGE: Record<string, Tone> = {
  not_started: 'pending', in_progress: 'progress', complete: 'success', completed: 'success', skipped: 'neutral', blocked: 'warning',
};

const LIFECYCLE: Record<string, Tone> = {
  ...STAGE,
  requested: 'pending', prospect: 'pending',
  onboarding: 'progress', under_review: 'progress', in_review: 'progress',
  approved: 'success', active: 'success',
  flagged: 'danger', rejected: 'danger',
  on_hold: 'warning', suspended: 'warning', offboarding: 'warning',
  offboarded: 'neutral', inactive: 'neutral', retired: 'neutral', terminated: 'neutral', archived: 'neutral',
};

const FINDING: Record<string, Tone> = {
  open: 'danger', overdue: 'danger',
  in_remediation: 'progress', in_progress: 'progress',
  accepted: 'pending', risk_accepted: 'pending',
  closed: 'success', remediated: 'success', resolved: 'success', verified: 'success',
};

// the four gate decisions, and how an intake request ends
const DECISION: Record<string, Tone> = {
  approve: 'success', approved: 'success', auto_approved: 'success',
  approve_with_conditions: 'warning', approved_with_conditions: 'warning',
  defer: 'pending', deferred: 'pending', pending: 'pending', submitted: 'pending',
  in_review: 'progress',
  draft: 'neutral',
  reject: 'danger', rejected: 'danger', declined: 'danger',
};

const CONDITION: Record<string, Tone> = { open: 'warning', met: 'success', overdue: 'danger', waived: 'neutral' };

const ASSESSMENT: Record<string, Tone> = {
  pending: 'pending', not_started: 'pending',
  draft: 'neutral',
  sent: 'progress', in_progress: 'progress', submitted: 'progress', in_review: 'progress',
  reviewed: 'success', scored: 'success', completed: 'success',
  expired: 'danger', declined: 'danger',
  cancelled: 'neutral', superseded: 'neutral', archived: 'neutral',
};

// what we collected from a vendor: asked for, in, read; plus how fresh a certificate or report is
const DOCUMENT: Record<string, Tone> = {
  requested: 'pending', pending: 'pending',
  received: 'progress',
  reviewed: 'success', approved: 'success', valid: 'success', current: 'success',
  expiring: 'warning', outdated: 'warning',
  expired: 'danger', missing: 'danger', overdue: 'danger', rejected: 'danger',
  not_requested: 'neutral',
};

const CONTRACT: Record<string, Tone> = {
  draft: 'neutral', terminated: 'neutral',
  pending: 'pending',
  active: 'success',
  expiring: 'warning', renewal_due: 'warning',
  expired: 'danger',
};

const URGENCY: Record<string, Tone> = { low: 'neutral', normal: 'progress', high: 'warning', urgent: 'danger' };

const SCREENING: Record<string, Tone> = {
  pending: 'pending', not_screened: 'pending',
  passed: 'success', clear: 'success',
  flagged: 'warning',
  failed: 'danger',
};

const GRADE: Record<string, Tone> = { a: 'success', b: 'success', c: 'progress', d: 'warning', e: 'danger', f: 'danger' };

export const tones = {
  lifecycle: word(LIFECYCLE),
  finding: word(FINDING),
  decision: word(DECISION),
  assessment: word(ASSESSMENT),
  document: word(DOCUMENT),
  contract: word(CONTRACT),
  urgency: word(URGENCY),
  screening: word(SCREENING),
  grade: word(GRADE),
  // added to the contract: a stage's own status, and a decision's conditions ("open" means warning here, danger on a finding)
  stage: word(STAGE),
  condition: word(CONDITION),
};
