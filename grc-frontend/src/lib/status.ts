// Status words -> tone, the colours of each tone, and one registry of words per record type. Pure, so `node --test` runs status.test.ts
// against it (and vendor-risk/_ui/tones.test.ts, which still imports the tone model through the vendor kit's tones.ts).
//
// The six tone families are Verity's shipped ones (tprm-verity-ux-reference, "Colours actually shipped"), spelled as hex because the
// platform CSS repaints slate/green/blue utilities inside the shell (PITFALLS 100). A word nobody registered reads as neutral with its own
// readable label, never as a guess.
import { statusLabel } from './format.ts';

export type Tone = 'success' | 'danger' | 'warning' | 'progress' | 'pending' | 'neutral';

export interface ToneColors {
  /** the dot, a bar, a chart slice */
  dot: string;
  /** words on the tint (4.5:1 or better, checked in status.test.ts) */
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

/** "Under review", "under-review" and " UNDER_REVIEW " are one word: lower case, runs of spaces and hyphens become "_". */
export const norm = (s?: string | null): string => String(s ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');

const own = (o: object, key: string): boolean => Object.prototype.hasOwnProperty.call(o, key);

/** The tone of `word` in `map` (keys written the way `norm` writes them). A word the map does not have, or none, is neutral. A plain
 *  `map[word]` would answer a function for "constructor", so the lookup only reads the map's own keys. */
export function toneOf(map: Record<string, Tone>, word?: string | null): Tone {
  const key = norm(word);
  return own(map, key) ? map[key] : 'neutral';
}

// ── registries ────────────────────────────────────────────────────────────────
/** A word's tone; or its tone and the label to show when `statusLabel(word)` is not what the page says ("pending_review" reads "In review"). */
export type StatusEntry = Tone | { tone: Tone; label: string };

/** The words of one record type ("document", "exception"...), what each means (tone) and how it is said (label). */
export interface Statuses {
  readonly record: string;
  /** every word defined, written as `norm` writes it, in the order they were given */
  readonly words: readonly string[];
  has(word?: string | null): boolean;
  /** neutral for a word that is not defined, or none */
  tone(word?: string | null): Tone;
  /** the defined label; else the readable form of the word ("in_remediation" -> "In remediation"); "—" when there is no word */
  label(word?: string | null): string;
}

/** Registers the words of one record type: `defineStatuses('document', { draft: 'neutral', pending_review: { tone: 'pending', label: 'In review' } })`.
 *  Throws when two spellings are the same word, a word is blank or a tone does not exist, so a typo fails the first test run. */
export function defineStatuses(record: string, entries: Record<string, StatusEntry>): Statuses {
  const tones: Record<string, Tone> = {};
  const labels: Record<string, string> = {};
  const words: string[] = [];
  Object.keys(entries).forEach((raw) => {
    const entry = entries[raw];
    const key = norm(raw);
    const tone = typeof entry === 'string' ? entry : entry.tone;
    if (!key) throw new Error(`${record}: a status word is blank`);
    if (own(tones, key)) throw new Error(`${record}: "${raw}" is the same word as an earlier one`);
    if (!own(TONE, tone)) throw new Error(`${record}: "${raw}" has no tone called "${tone}"`);
    tones[key] = tone;
    if (typeof entry !== 'string') labels[key] = entry.label;
    words.push(key);
  });
  return {
    record,
    words,
    has: (word) => own(tones, norm(word)),
    tone: (word) => toneOf(tones, word),
    label: (word) => {
      const key = norm(word);
      return own(labels, key) ? labels[key] : statusLabel(word);
    },
  };
}

/** What a StatusPill takes for a record's word: `<StatusPill {...statusPill(documentStatus, doc.status)} />`. */
export const statusPill = (statuses: Statuses, word?: string | null): { tone: Tone; label: string } => ({
  tone: statuses.tone(word),
  label: statuses.label(word),
});

// ── Governance ────────────────────────────────────────────────────────────────
// The words are the ones the code writes (each registry names where; status.test.ts re-reads those backend lists, so a word the server
// starts writing fails a test until it is registered here). The tones are one reading of what a word means to the person looking at the
// row: pending = waiting for someone, progress = moving or ready for its next step, success = in force or done, danger = refused, overdue
// or lapsed, warning = needs a look, neutral = at rest. The reader of this file (the Phase 1 reviewer) is asked to confirm the mapping.

// GovernanceDocument.status: models/_13 (the comment on the column), routers/documents.py (`valid_statuses`), governance/permissions.py
// (ON_ITS_WAY, LAPSED); the workflow engine sets review_required (action_handlers.py). The labels are the Documents library's own words
// (libraryModel.STATUS_LABEL); the Change log says "Exception applied" for exception_applied: one of the two wants aligning.
export const documentStatus = defineStatuses('document', {
  draft: 'neutral',
  pending_review: { tone: 'pending', label: 'In review' },
  pending_approval: { tone: 'pending', label: 'In approval' },
  approved: 'progress',
  published: 'success',
  expired: 'danger',
  archived: 'neutral',
  exception_applied: { tone: 'warning', label: 'Exception' },
  review_required: 'warning',
});

// PolicyException.status: routers/policy_exception_router.py (draft -> pending_approval -> approved | rejected; an approved one can be
// revoked). "expired" is what the page filters on and the dashboards count; nothing in the router writes it.
export const exceptionStatus = defineStatuses('exception', {
  draft: 'neutral',
  pending_approval: 'pending',
  approved: 'success',
  rejected: 'danger',
  revoked: 'neutral',
  expired: 'danger',
});

// GovernanceCommittee has `is_active` (a boolean), not a status column; "active" and "inactive" are the words the committees pages show.
// (A charter's own status is not registered: the model says draft/active/expired, the page's type says draft/active/superseded.)
export const committeeStatus = defineStatuses('committee', {
  active: 'success',
  inactive: 'neutral',
});

// Department has `is_active` (a boolean) too; Governance > Settings and Administration > Departments say "Active" / "Inactive". A department is never
// deleted (decision D43): it is deactivated, so "inactive" is the only way one ends and the word that is not in force.
export const departmentStatus = defineStatuses('department', {
  active: 'success',
  inactive: 'neutral',
});

// CommitteeMeeting.status: models/_29.
export const meetingStatus = defineStatuses('meeting', {
  scheduled: 'pending',
  in_progress: 'progress',
  completed: 'success',
  cancelled: 'neutral',
});

// OversightAction.status: models/_29.
export const actionStatus = defineStatuses('action', {
  open: 'pending',
  in_progress: 'progress',
  completed: 'success',
  overdue: 'danger',
});

// Governance > Reviews has two lists. PolicyReviewHistory.review_status is the review cycle of a document (models/_13); the other,
// GovernanceActionReview.review_status, is the log of governance actions that ask for a review. The words do not overlap, so one registry.
// The last three are where a document's review date stands against today: the keys of `by_status` in GET /governance/reviews/statistics (routers/reviews.py),
// which the Reviews list and calendar show on every row (overdue = the date has begun, due soon = under eight days away, on track = further off).
export const reviewStatus = defineStatuses('review', {
  scheduled: 'pending',
  in_progress: 'progress',
  completed: 'success',
  skipped: 'neutral',
  pending_review: 'pending',
  in_review: 'progress',
  approved: 'success',
  rejected: 'danger',
  archived: 'neutral',
  overdue: 'danger',
  due_soon: 'warning',
  on_track: 'success',
});

// Attestation campaigns (models/_27: AttestationCampaign draft/active/closed/archived, AttestationRequest pending/completed/overdue/escalated;
// routers/attestations.py: an attestation can be completed or revoked; DocumentAttestationCampaign takes draft/active/closed).
export const attestationStatus = defineStatuses('attestation', {
  draft: 'neutral',
  active: 'progress',
  closed: 'neutral',
  archived: 'neutral',
  pending: 'pending',
  completed: 'success',
  overdue: 'danger',
  escalated: 'warning',
  revoked: 'neutral',
});

// The Governance priority scale (OversightAction.priority names critical / high / medium / low / info for its SLA days; exceptions use the
// first four). REVIEWER TO CONFIRM: critical = danger, high = warning, medium = progress, low = neutral. "info" has no urgency, so neutral.
export const priority = defineStatuses('priority', {
  critical: 'danger',
  high: 'warning',
  medium: 'progress',
  low: 'neutral',
  info: 'neutral',
});
