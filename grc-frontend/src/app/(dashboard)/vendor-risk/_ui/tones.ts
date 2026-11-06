// Status words -> tone, and the colours of each tone. Pure, so `node --test` runs tones.test.ts against it.
// The tone model (Tone, TONE and the word lookup) lives in src/lib/status.ts, the platform's status registry, and is re-exported here, so
// every import of this kit and tones.test.ts stay as they were. What stays here are the vendor kit's own word maps: the words Verity uses
// plus the ones Compliverse's own rows carry (a vendor is "suspended", a request "in_review"); anything else reads as neutral, never as a guess.
import { toneOf, type Tone } from '../../../../lib/status.ts';

export { TONE, type Tone, type ToneColors } from '../../../../lib/status.ts';

const word = (map: Record<string, Tone>) => (s?: string | null): Tone => toneOf(map, s);

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
