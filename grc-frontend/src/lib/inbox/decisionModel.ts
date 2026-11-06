// The decision dialog of Needs my action, apart from React: which choices a request offers, what each needs before it can be sent, the request each one makes, how a failure is told, and
// which lists to refresh afterwards. NO NEW TRANSITION: the choices and the payloads are the ones the document page's SignoffAction and the assessment approvals page already send
// (governanceApi.signDocumentOff / rejectDocumentSignoff / requestSignoffChanges; POST /compliance/assessments/evidence/{id}/approval). `node --test src/lib/inbox/decisionModel.test.ts`.
import { SIGN_LABEL, type StageKind } from '../approvalRoutes.ts';
import { canRetry, errorMessage, statusOf } from '../../components/ui/ds/reportOutcome.ts';
import { SOURCE_DEFS } from './buildInbox.ts';

export type Choice = 'sign' | 'changes' | 'reject' | 'approve' | 'return';

export interface ChoiceSpec {
  id: Choice;
  /** the option's name */
  label: string;
  /** the button that sends it */
  submit: string;
  /** a drawn signature is required */
  signature: boolean;
  reason: 'none' | 'optional' | 'required';
  destructive: boolean;
  /** one line under the options once chosen */
  note: string;
}

/** The step the person may take now (GET .../signoff `my_step`), as far as the choices depend on it. */
export interface StepFacts {
  kind?: StageKind | null;
  can_reject?: boolean | null;
  /** the proposer after the owner rejected their change: they may sign it as it is, nothing else */
  may_sign_as_is?: boolean | null;
}

/** What a reviewer, an approver or a signer may do on a document: sign it (the stage's own words), ask for the changes, or reject it back to draft where the stage allows. A
 *  proposer signing "as it is" has only the signature. `role` names the stage when the server sent no step (an older server): review for a reviewer. */
export function documentChoices(step: StepFacts | null | undefined, role: 'reviewer' | 'approver' | null, asIs = false): ChoiceSpec[] {
  const kind: StageKind = step?.kind ?? (role === 'reviewer' ? 'review' : 'approval');
  const sign: ChoiceSpec = { id: 'sign', label: SIGN_LABEL[kind] ?? 'Sign', submit: SIGN_LABEL[kind] ?? 'Sign', signature: true, reason: 'optional', destructive: false,
    note: 'Your drawn signature is kept with this sign-off, with your name, the time and your IP address, and added to the audit trail.' };
  if (asIs) return [sign];
  const out: ChoiceSpec[] = [sign, { id: 'changes', label: 'Ask for changes', submit: 'Ask for changes', signature: false, reason: 'required', destructive: false,
    note: 'The review pauses until the author resubmits.' }];
  if (step ? step.can_reject !== false : true) {
    out.push({ id: 'reject', label: 'Reject', submit: 'Reject and send back', signature: false, reason: 'required', destructive: true, note: 'The document goes back to draft with your reason.' });
  }
  return out;
}

/** What may be done to evidence waiting for approval: approve it, return it to whoever submitted it, or reject it. */
export function evidenceChoices(): ChoiceSpec[] {
  return [
    { id: 'approve', label: 'Approve', submit: 'Approve', signature: false, reason: 'optional', destructive: false, note: 'It moves to the next tier, or is approved when this is the last.' },
    { id: 'return', label: 'Return for changes', submit: 'Return', signature: false, reason: 'optional', destructive: false, note: 'It goes back to whoever submitted it, who may submit it again.' },
    { id: 'reject', label: 'Reject', submit: 'Reject', signature: false, reason: 'optional', destructive: true, note: 'The evidence is rejected.' },
  ];
}

export const NEEDS_SIGNATURE = 'Draw your signature to sign.';

/** What is missing before the choice can be sent ("" when nothing). */
export function problemWith(choice: ChoiceSpec, typed: { signature: string | null; comment: string }): string {
  if (choice.signature && !typed.signature) return NEEDS_SIGNATURE;
  if (choice.reason === 'required' && !typed.comment.trim()) return choice.id === 'reject' ? 'Say why you reject it.' : 'Say what should change.';
  return '';
}

/** The answer GET .../signoff gave, as far as a decision sends it back: the version shown and the review round, so a document that changed meanwhile is refused (409). */
export interface Shown { version?: string | null; round_at?: string | null }

export type DocumentRequest =
  | { api: 'sign'; body: { comment?: string; signature_image?: string; version?: string; round_at?: string | null } }
  | { api: 'reject' | 'changes'; body: { comment: string; version?: string; round_at?: string | null } };

/** The request a document choice makes: the payload of SignoffAction. */
export function documentRequest(choice: Choice, typed: { signature: string | null; comment: string }, shown: Shown): DocumentRequest {
  const seen = { version: shown.version ?? undefined, round_at: shown.round_at };
  if (choice === 'sign') return { api: 'sign', body: { comment: typed.comment.trim() || undefined, signature_image: typed.signature || undefined, ...seen } };
  return { api: choice === 'reject' ? 'reject' : 'changes', body: { comment: typed.comment.trim(), ...seen } };
}

/** The request an evidence choice makes: POST /compliance/assessments/evidence/{id}/approval. */
export function evidenceRequest(choice: Choice, comment: string): { action: 'approve' | 'reject' | 'return'; comments?: string } {
  const action = choice === 'return' ? 'return' : choice === 'reject' ? 'reject' : 'approve';
  return { action, comments: comment.trim() || undefined };
}

/** The confirmation of a choice. */
export function doneWords(choice: Choice, evidence: boolean): { title: string; message: string } {
  if (choice === 'sign') return { title: 'Signed', message: 'Your electronic signature was recorded on the document.' };
  if (choice === 'changes') return { title: 'Changes asked for', message: 'The author is asked to make them; it comes back to you when it is resubmitted.' };
  if (choice === 'approve') return { title: 'Approved', message: 'Your approval was recorded.' };
  if (choice === 'return') return { title: 'Returned', message: 'It went back to whoever submitted it.' };
  return evidence ? { title: 'Rejected', message: 'The evidence was rejected.' } : { title: 'Rejected', message: 'The document went back to draft with your reason.' };
}

export type FailureKind =
  /** the server says it is not the person's to decide (403) or not there (404): it is no longer waiting for them */
  | 'stale'
  /** the document changed since the dialog opened (409): read it again, draw again */
  | 'changed'
  /** nothing came back, or the server failed: trying again can help */
  | 'retry'
  /** the server refused the request (400, 422...): its words, nothing to repeat */
  | 'refused';

export interface Failure { kind: FailureKind; headline: string; message: string }

/** How a failed decision is told: the server's own words always, under a headline that says what to do. A repeated decision is refused by the server (403/409), so Retry never decides twice. */
export function failureOf(error: unknown): Failure {
  const status = statusOf(error);
  const message = errorMessage(error);
  if (status === 403 || status === 404) return { kind: 'stale', headline: 'This is no longer waiting for you', message };
  if (status === 409) return { kind: 'changed', headline: 'The document changed', message };
  if (canRetry(error)) return { kind: 'retry', headline: 'Your decision could not be sent', message };
  return { kind: 'refused', headline: 'Your decision was not accepted', message };
}

/** Whether the evidence a decision is about still waits at the step the person saw, in a FRESH answer of the assessment approvals list. The server refuses a document's second
 *  signature (403) and a document that changed (409), but it does not check that evidence is still pending where the decision names it: a repeated approval, or one from a list a minute
 *  old, would count for the NEXT tier (an administrator or an editor may decide every tier). So the dialog asks again right before it sends, and a retry after a lost answer never repeats a
 *  decision the server already took. `key` is the item's key, which names the step (buildInbox: pending_tier_1...). */
export function evidenceStillWaits(raw: unknown, key: string): boolean {
  return SOURCE_DEFS['assessment.evidence'].toItems(raw, new Date()).items.some((i) => i.key === key);
}

/** What the dialog says when that fresh answer no longer holds the evidence where the person saw it. */
export const EVIDENCE_MOVED: Failure = {
  kind: 'stale',
  headline: 'This is no longer waiting for you',
  message: 'Someone decided it, or it moved to another step, since this list was drawn. Nothing was sent.',
};

/** The query keys to refresh after a decision, so the row is gone and the badge drops on the next draw: the four lists, and what the document page reads. */
export function keysAfterDecision(documentId: number | null): Array<readonly unknown[]> {
  const lists: Array<readonly unknown[]> = [['my-document-requests'], ['my-signoff-pending'], ['header-pending-approvals'], ['my-document-requests-sent'], ['pending-approvals']];
  return documentId == null ? lists : lists.concat([['doc-signoff', documentId], ['governance-document', documentId], ['document-lifecycle']]);
}
