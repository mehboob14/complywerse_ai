// The words of one requirement of a framework journey (the Requirements tab of /frameworks/[id]): how far its evidence is, whether it is in scope, how a file stands in
// review and what the AI rating of a file says, and a sub-control's own state. The status of the requirement itself ("Not implemented", "Implemented"...) is
// `requirementState` in frameworkJourney.ts. One registry per kind of word (defineStatuses, lib/status.ts): a pill always has its word, a word nobody registered is neutral
// with a readable label. Pure, so `node --test src/lib/statuses/frameworkRequirements.test.ts` runs it.
import { defineStatuses } from '../status.ts';

// How far a requirement's evidence is (reqModel.evidenceStateOf): the files it holds against what it asks for.
export const evidenceState = defineStatuses('requirement evidence', {
  none: { tone: 'neutral', label: 'No evidence' },
  review: { tone: 'pending', label: 'Waiting for review' },
  rejected: { tone: 'danger', label: 'Turned down' },
  partial: { tone: 'progress', label: 'Partly approved' },
  complete: { tone: 'success', label: 'Fully approved' },
  not_asked: { tone: 'neutral', label: 'None asked for' },
});

// Whether a requirement counts: ControlImplementation.is_applicable (false = a reviewer approved leaving it out; it is in no figure).
export const requirementScope = defineStatuses('requirement scope', {
  in_scope: { tone: 'neutral', label: 'In scope' },
  out_of_scope: { tone: 'warning', label: 'Out of scope' },
});

// ImplementationEvidence.review_status.
export const fileReview = defineStatuses('evidence file review', {
  pending: { tone: 'pending', label: 'Waiting for review' },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Turned down' },
});

// ImplementationEvidence.ai_assessment_status (a file the library holds shows its maturity instead).
export const fileRating = defineStatuses('evidence file rating', {
  completed: { tone: 'success', label: 'Rated by AI' },
  processing: { tone: 'progress', label: 'AI is rating it' },
  pending_assessment: { tone: 'neutral', label: 'Ready for the AI' },
  pending_ocr: { tone: 'neutral', label: 'Reading the file' },
  pending: { tone: 'neutral', label: 'Not rated yet' },
});

// A sub-control of the standard (UAE IA): met when ticked; under way when it has an owner or a file but is not ticked (the tick stays the only source of "met").
export const subControlState = defineStatuses('sub-control', {
  met: { tone: 'success', label: 'Met' },
  progress: { tone: 'progress', label: 'In progress' },
});
