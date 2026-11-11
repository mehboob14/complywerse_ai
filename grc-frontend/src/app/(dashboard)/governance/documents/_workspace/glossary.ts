// The plain meaning of the words the Documents library uses, and the six steps a document goes through, in one place and without React (glossary.test.ts checks them). The library
// attaches a meaning to a word with an (i) (PlainTerm.tsx: `<PlainTerm term="owner">Owner</PlainTerm>`), and the "How it works" sheet (HowItWorks.tsx) prints all of it. The words are
// the sample's ("Plain English", design E) made exact for this platform: an owner is not the author, an acknowledgement keeps the version read, a document "in force" stays in force
// while a newer version is written, expired and overdue are not the same. A meaning is one to three short sentences; no id, no model name, no word that needs a meaning of its own.

export const TERM_KEYS = ['attestation', 'in_force', 'review_cycle', 'owner', 'approver', 'out_of_date', 'framework'] as const;
export type TermKey = (typeof TERM_KEYS)[number];

export interface Term {
  /** the word as the library says it */
  word: string;
  /** what it means, for someone who does not work in compliance */
  plain: string;
}

export const GLOSSARY: Record<TermKey, Term> = {
  attestation: {
    word: 'Attestation',
    plain: 'A formal "I have read this". Your name is kept against the version you read, so there is proof later.',
  },
  in_force: {
    word: 'In force',
    plain: 'The live version. Everyone it applies to has to follow it right now, even while a newer version is being written.',
  },
  review_cycle: {
    word: 'Review cycle',
    plain: 'How often the owner has to check that the document is still right, for example every 6 or 12 months.',
  },
  owner: {
    word: 'Owner',
    plain: 'The person responsible for keeping the document right. Not always the person who wrote it.',
  },
  approver: {
    word: 'Approver',
    plain: 'Someone senior enough to sign the document off. Nothing goes live without that.',
  },
  out_of_date: {
    word: 'Out of date',
    plain: 'Its check-up date or its end date has passed. A live document is still followed, but nobody has confirmed lately that it is right. An expired one is no longer in force.',
  },
  framework: {
    word: 'Framework',
    plain: 'An outside rulebook the company has to meet, such as ISO 27001 or GDPR. Documents are linked to the rules they help meet.',
  },
};

/** The word a card's label leans on, so its (i) can say it: "Live" is "in force", the two late ones are "out of date". Labels that are plain on their own have none. */
export const BADGE_TERM: Record<string, TermKey> = {
  'Live': 'in_force',
  'Update on its way': 'in_force',
  'Needs a fresh look': 'out_of_date',
  'Out of date': 'out_of_date',
};

export const plainOf = (key: TermKey): string => GLOSSARY[key].plain;

/** What a screen reader says for the (i) of a word. */
export const termLabel = (key: TermKey): string => `What “${GLOSSARY[key].word}” means`;

export interface HowStep {
  /** the step's name: the same as the tracker's stage (libraryTracker.STAGES), checked by a test */
  title: string;
  text: string;
  /** who does this step */
  who: string;
}

export const HOW_STEPS: readonly HowStep[] = [
  { title: 'Being written', text: 'Someone drafts the document. Until it is published nobody has to follow it.', who: 'The author' },
  { title: 'Being checked', text: 'Colleagues who know the subject read it and suggest changes. Most of the back and forth happens here.', who: 'The reviewers' },
  { title: 'Being signed off', text: 'An approver decides. Nothing becomes official without this step.', who: 'The approvers' },
  { title: 'Ready to publish', text: 'It is approved and waits to be published. It is not live yet.', who: 'Someone who can publish' },
  { title: 'Live', text: 'It is published. This is the version in force: everyone it applies to has to follow it, and the older one stops counting.', who: 'Everyone it applies to' },
  { title: 'Everyone’s read it', text: 'People it applies to confirm they have read it. Only documents with such a request show progress here; the rest say they were not asked.', who: 'Everyone it applies to' },
];
