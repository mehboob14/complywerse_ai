/**
 * What the version review decides without a server or a screen: the banner of an onboarding whose framework changed since it was approved, the stale answers
 * grouped by step, the counts in one sentence, which outcomes a person may choose and what each says, the note rule, the pill of a register row, and the words
 * of the check and of a refusal. Whether something changed, and exactly what, is the server's (`versioning.py`); this only arranges its answer in plain words.
 */
import type { Problem, RegisterReview, VersionOutcome, VersionStaleAnswer, VersionStatus } from '@/lib/frameworkOnboarding';
import type { Tone } from '@/lib/status';
import { splitRef } from './workspaceModel.ts';

/** The note a review needs when the register has not said (the server's own minimum; it checks again). */
export const MIN_NOTE = 10;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// ── the banner ──────────────────────────────────────────────────────────────────────────────────────────────────
export interface VersionBanner { tone: 'info' | 'warning'; title: string; text: string; action: 'review' | 'successor' | null }

/** The first sentences of what changed (the server writes them in plain words). */
export const reasonsText = (v: Pick<VersionStatus, 'reasons'>, max = 2): string => v.reasons.slice(0, max).map((r) => r.text.trim()).filter(Boolean).join(' ');

/** The banner under the heading: a warning while the framework changed and nobody has decided, an info line once a later entry has its own onboarding. */
export function versionBannerOf(v: VersionStatus | null | undefined): VersionBanner | null {
  if (!v) return null;
  if (v.state === 'needs_review') {
    const why = reasonsText(v);
    const text = v.review_state === 'changes_needed'
      ? `${why} It was reopened to change: the answers listed under Review changes are the ones to look at.`
      : `${why} Nothing was changed. Look at what it affects and decide what to do.`;
    return { tone: 'warning', title: 'The framework changed since approval', text: text.trim(), action: 'review' };
  }
  if (v.state === 'superseded') {
    return {
      tone: 'info', title: 'A later entry has taken over',
      text: 'The later entry has its own onboarding. This one stays as it was approved.',
      action: v.successor?.onboarding_id ? 'successor' : null,
    };
  }
  return null;
}

/** "Changes are tracked from 12 Nov 2026." for an onboarding that was approved before tracking began; nothing otherwise. `fmt` writes a server time as a date. */
export function trackedFrom(v: Pick<VersionStatus, 'tracking'> | null | undefined, fmt: (iso: string | null) => string): string {
  const t = v?.tracking;
  if (!t || t.source !== 'first_check' || !t.since || !fmt(t.since)) return '';
  return `Changes are tracked from ${fmt(t.since)}.`;
}

// ── the stale answers ───────────────────────────────────────────────────────────────────────────────────────────
export interface StaleGroup { step: string; label: string; items: VersionStaleAnswer[] }

/** The stale answers grouped by step, in the order the server listed them. */
export function staleByStep(answers: readonly VersionStaleAnswer[]): StaleGroup[] {
  const out: StaleGroup[] = [];
  for (const a of answers) {
    let g = out.find((x) => x.step === a.step);
    if (!g) { g = { step: a.step, label: a.step_label, items: [] }; out.push(g); }
    g.items.push(a);
  }
  return out;
}

/**
 * Where a stale answer can be opened: its field when the question is still asked and shown, its step when the question is hidden now, nowhere when the question
 * was removed (there is nothing to open). `field` is '' for the step itself, as the workspace's jump takes it.
 */
export function jumpFor(a: Pick<VersionStaleAnswer, 'ref' | 'step' | 'reasons'>, steps: ReadonlyArray<{ key: string }>): { stage: string; field: string } | null {
  if (a.reasons.some((r) => r.code === 'removed') || !steps.some((s) => s.key === a.step)) return null;
  if (a.reasons.some((r) => r.code === 'not_asked')) return { stage: a.step, field: '' };
  return { stage: a.step, field: splitRef(a.ref).field };
}

/** The reasons of the stale answers that are still drawn as a field (a changed option or kind of answer), by "step.field": the line under that field. */
export function staleMarks(v: Pick<VersionStatus, 'state' | 'stale'> | null | undefined): Record<string, string> {
  if (!v || v.state !== 'needs_review') return {};
  const out: Record<string, string> = {};
  for (const a of v.stale.answers) {
    const text = a.reasons.filter((r) => r.code === 'option' || r.code === 'type').map((r) => r.text.trim()).join(' ');
    if (text) out[a.ref] = `Review: ${text}`;
  }
  return out;
}

/** "2 answers, 1 decision, 1 new question, 3 controls": what the change touches, in one line; empty when it touches nothing. */
export function countsSentence(v: Pick<VersionStatus, 'counts'>): string {
  const c = v.counts ?? {};
  const controls = (c.controls_added ?? 0) + (c.controls_removed ?? 0) + (c.controls_changed ?? 0);
  return [
    c.answers ? plural(c.answers, 'answer', 'answers') : '',
    c.decisions ? plural(c.decisions, 'decision', 'decisions') : '',
    c.new_questions ? plural(c.new_questions, 'new question', 'new questions') : '',
    controls ? plural(controls, 'control', 'controls') : '',
    c.gate ? plural(c.gate, 'check', 'checks') : '',
  ].filter(Boolean).join(', ');
}

/** What a journey says of itself in the impact list: "In progress: 3 of 40 controls are on changed ones, 2 evidence files". */
export function journeyImpact(j: { status: string; controls: number; affected: number; evidence_files: number }): string {
  const status = j.status.replace(/[_-]+/g, ' ').trim();
  const head = status ? `${status.charAt(0).toUpperCase()}${status.slice(1)}: ` : '';
  if (j.affected === 0) return `${head}none of its ${plural(j.controls, 'control', 'controls')} is on a changed one`;
  return `${head}${j.affected} of ${plural(j.controls, 'control is', 'controls are')} on changed ones${j.evidence_files ? `, ${plural(j.evidence_files, 'evidence file', 'evidence files')}` : ''}`;
}

// ── the outcomes ────────────────────────────────────────────────────────────────────────────────────────────────
export interface OutcomeOption { value: VersionOutcome; label: string; text: string }

/**
 * Which decisions a person may choose: "Still correct" always; "Reopen to change" for an approved or underway onboarding; "Start for the later entry" only when the
 * library has a later entry and nobody has started its onboarding. The server decides who may do each, and checks all of it again.
 */
export function outcomesOf(view: { state: string; version: Pick<VersionStatus, 'successor'> }): OutcomeOption[] {
  const out: OutcomeOption[] = [{ value: 'confirmed', label: 'Still correct', text: 'The approved answers still hold after the change. Nothing is changed; your decision is recorded.' }];
  if (view.state === 'complete' || view.state === 'underway') {
    out.push({
      value: 'changes_needed', label: 'Reopen to change',
      text: view.state === 'underway'
        ? 'The answers stay editable. Approve it again when they are right.'
        : 'Reopens it as a draft so answers can be changed, then approved again.',
    });
  }
  const s = view.version.successor;
  if (s?.framework_id && !s.onboarding_id) {
    out.push({ value: 'start_new_version', label: 'Start for the later entry', text: 'Starts a draft for the later entry with the answers that still fit. This approval stays as it is.' });
  }
  return out;
}

/** The words of a finished decision, for the toast. */
export const OUTCOME_DONE: Record<VersionOutcome, string> = {
  confirmed: 'Recorded: the approved answers still hold.',
  changes_needed: 'Reopened so the answers can be changed.',
  start_new_version: 'Started a draft for the later entry.',
};

/** The note a review needs: null when it is long enough, else what is missing. */
export function noteProblem(note: string, min: number = MIN_NOTE): string | null {
  const n = note.trim().length;
  return n >= min ? null : `Write at least ${min} characters (${n} so far).`;
}

/** Words for a refused review: who may do it when the answer is 403, else what the server said. */
export function reviewRefusal(outcome: VersionOutcome | '', p: Pick<Problem, 'status' | 'message'>): string {
  if (p.status === 403) {
    if (outcome === 'confirmed') return 'You need the approve right to confirm this. Ask an administrator.';
    if (outcome === 'changes_needed') return 'You need the override right to reopen it. Ask an administrator.';
    return 'You need the right to edit frameworks to start the later entry. Ask an administrator.';
  }
  return p.message;
}

// ── the register ────────────────────────────────────────────────────────────────────────────────────────────────
export interface VersionCell { pill: { tone: Tone; label: string } | null; line: string }

/** The pill under a row's state and the one line that says why: needs review (the server's first reason), superseded, or replaced without a problem. */
export function versionCell(row: { review?: RegisterReview | null; version?: string | null }): VersionCell {
  const v = row.review;
  if (!v) return { pill: null, line: '' };
  if (v.state === 'needs_review') return { pill: { tone: 'warning', label: 'Needs review' }, line: v.text ?? '' };
  if (v.state === 'superseded') return { pill: { tone: 'neutral', label: 'Superseded' }, line: v.text ?? 'A later entry has its own onboarding.' };
  if (v.replaced) return { pill: { tone: 'neutral', label: 'Replaced' }, line: row.version ? `Version ${row.version} is no longer the active entry.` : 'No longer the active entry in the library.' };
  return { pill: null, line: '' };
}

/** What "Check for changes" says when it is done. */
export function checkWords(r: { checked: number; started: number; needs_review: number }): string {
  if (r.needs_review > 0) return `Checked ${plural(r.checked, 'onboarding', 'onboardings')}. ${r.needs_review} ${r.needs_review === 1 ? 'needs' : 'need'} review.`;
  return r.started > 0 ? `Nothing changed. Tracking started for ${r.started}.` : 'Nothing changed.';
}

/** A refused check: who may run it when the answer is 403. */
export function checkRefusal(status: number | null, message: string): string {
  return status === 403 ? 'You need the right to edit frameworks to check for changes. Ask an administrator.' : message;
}

/** "Last checked 3 days ago"; nothing when it has never run. `rel` writes a server time relative to today. */
export function lastCheckedWords(iso: string | null | undefined, rel: (iso: string) => string): string {
  const when = iso ? rel(iso) : '';
  return when ? `Last checked ${when}` : '';
}
