// The words of the Frameworks hub (/frameworks): where a framework of the library stands on its way to a journey and through it, and how a journey's target date stands.
// One registry per kind of word, built with defineStatuses (lib/status.ts), so a pill always has its word and a word nobody registered is neutral with a readable label.
// Pure, so `node --test src/lib/statuses/frameworkHub.test.ts` runs it. The journey's own words (journeyStatus) and the readiness bands live in frameworkJourney.ts.
import { defineStatuses } from '../status.ts';

// A row of the hub has ONE state. A framework with a journey has the journey's status; one without has the stage of its onboarding (the gate of the journey):
//   idle        no journey and no onboarding yet            onboarding  an onboarding that is a draft or waits for its approval
//   ready       the onboarding is approved (or the framework was marked underway): the journey may start
//   unknown     there is no journey and the onboarding register could not be read: the server decides at Start
export const frameworkState = defineStatuses('framework state', {
  idle: { tone: 'neutral', label: 'No journey yet' },
  onboarding: { tone: 'pending', label: 'Onboarding' },
  ready: { tone: 'progress', label: 'Ready to start' },
  not_started: { tone: 'neutral', label: 'Not started' },
  in_progress: { tone: 'progress', label: 'In progress' },
  on_hold: { tone: 'warning', label: 'On hold' },
  completed: 'success',
  cancelled: 'neutral',
  unknown: { tone: 'neutral', label: 'Not known' },
});

// A journey's target date against today (lib/journeyModel.ts targetState): the words of the Target column and of its facet.
export const targetWords = defineStatuses('framework target', {
  overdue: { tone: 'danger', label: 'Overdue' },
  soon: { tone: 'warning', label: 'Due in 30 days' },
  later: { tone: 'neutral', label: 'Later' },
  none: { tone: 'neutral', label: 'No target date' },
  done: { tone: 'success', label: 'Completed' },
});
