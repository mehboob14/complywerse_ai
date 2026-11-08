// The words of one framework journey (the page /frameworks/[id]): where the journey stands, how a requirement stands, how ready the whole journey is
// and the three words a scope decision goes through. One registry per kind of word, built with defineStatuses (lib/status.ts), so a pill always has
// its word and a word nobody registered is neutral with a readable label. Pure, so `node --test src/lib/statuses/frameworkJourney.test.ts` runs it.
import { defineStatuses } from '../status.ts';

// CertificationJourney.status (models/_16: default "in_progress"; PATCH /certifications/{id} sets "completed" and stamps completed_at).
export const journeyStatus = defineStatuses('framework journey', {
  not_started: 'neutral',
  in_progress: { tone: 'progress', label: 'In progress' },
  on_hold: { tone: 'warning', label: 'On hold' },
  completed: 'success',
  cancelled: 'neutral',
});

// ControlImplementation.status as the journey shows a requirement ("Compliant" is the word the page always used for implemented and verified).
export const requirementState = defineStatuses('framework requirement', {
  not_started: { tone: 'neutral', label: 'Not implemented' },
  in_progress: { tone: 'progress', label: 'In progress' },
  implemented: { tone: 'success', label: 'Implemented' },
  verified: { tone: 'success', label: 'Verified' },
  not_applicable: { tone: 'neutral', label: 'Not applicable' },
});

// ClauseApplicability.status (governance/routers/applicability.py: every decision is saved "pending" and a reviewer sets "approved" or "rejected").
export const scopeDecision = defineStatuses('scope decision', {
  pending: { tone: 'pending', label: 'Waiting for a reviewer' },
  approved: 'success',
  rejected: 'danger',
});

// How ready a journey is, from lib/journeyModel.ts readinessBand (one set of lines for every page: 75, 50, 25).
export const readinessBandWords = defineStatuses('framework readiness', {
  strong: { tone: 'success', label: 'Strong' },
  building: { tone: 'progress', label: 'Building' },
  early: { tone: 'warning', label: 'Early' },
  start: { tone: 'neutral', label: 'Just starting' },
});
