// The words of the Auditor Portal: how a file sent for review stands, how a request to put a requirement in or out of scope stands, how the requirement
// itself stands for scope, and what an auditor's decision is called. One registry per kind of word, built with defineStatuses (lib/status.ts), so a pill
// always has its word and a word nobody registered is neutral with a readable label. Pure, so `node --test src/lib/statuses/auditPortal.test.ts` runs it.
//
// Exports (the Issue Register group reuses `decisionWord` for the words of any approve / turn-down decision):
//   fileReview     ImplementationEvidence.review_status    pending | approved | rejected
//   scopeRequest   ClauseApplicability.status              pending | approved | rejected
//   scopeState     where a requirement stands for scope    untouched | pending | in_scope | out_of_scope | rejected
//   queueKind      what a row of the review queue is       file | scope | untouched
//   decisionWord   what a decision is called               approved | rejected
// The server writes "rejected"; the platform says "Turned down" for it everywhere a person decides (the Frameworks Scope tab says the same).
import { defineStatuses } from '../status.ts';

// ImplementationEvidence.review_status (models/_16: default "pending"; certification_router.py and auditor_portal/routers/reviews.py write approved | rejected).
export const fileReview = defineStatuses('auditor file review', {
  pending: { tone: 'pending', label: 'To review' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Turned down' },
});

// ClauseApplicability.status (models/_17: pending | approved | rejected; every request is saved pending and a reviewer sets the other two).
export const scopeRequest = defineStatuses('auditor scope request', {
  pending: { tone: 'pending', label: 'Waiting for a decision' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Turned down' },
});

// Where a requirement stands for scope: controls.py `applicability.decision` (the old `state` called a turned-down request "pending").
export const scopeState = defineStatuses('auditor requirement scope', {
  untouched: { tone: 'neutral', label: 'No request yet' },
  pending: { tone: 'pending', label: 'Waiting for a decision' },
  in_scope: { tone: 'success', label: 'In scope' },
  out_of_scope: { tone: 'neutral', label: 'Out of scope' },
  rejected: { tone: 'danger', label: 'Turned down' },
});

// The kind of row in the review queue, for the Type column and the chips.
export const queueKind = defineStatuses('auditor queue row', {
  file: { tone: 'progress', label: 'File' },
  scope: { tone: 'pending', label: 'Scope request' },
  untouched: { tone: 'neutral', label: 'No scope request' },
});

// What an auditor's decision is called, wherever an Approve / Turn down sheet is used.
export const decisionWord = defineStatuses('auditor decision', {
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Turned down' },
});
