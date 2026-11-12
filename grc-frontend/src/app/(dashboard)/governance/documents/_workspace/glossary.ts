// The plain meaning of the words the Documents library uses, and the six steps a document goes through, in one place and without React (glossary.test.ts checks them). The library
// attaches a meaning to a word with an (i) (PlainTerm.tsx: `<PlainTerm term="owner">Owner</PlainTerm>`), and the "How it works" sheet (HowItWorks.tsx) prints all of it. The words are
// the sample's ("Plain English", design E) made exact for this platform: an owner is not the author, an acknowledgement keeps the version read, a "published" document stays published
// while a newer version is written, expired and overdue are not the same. A meaning is one to three short sentences; no id, no model name, no word that needs a meaning of its own.

export const TERM_KEYS = ['attestation', 'acknowledgement', 'in_force', 'review_cycle', 'owner', 'approver', 'out_of_date', 'framework'] as const;
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
    plain: 'A request the owner starts for a published document: people sign that they have read it. Each name is kept against the version it was signed for.',
  },
  acknowledgement: {
    word: 'Acknowledgement',
    plain: 'Everyone a document applies to is asked to confirm, once, that they have read the published version. It starts by itself when the document is published.',
  },
  in_force: {
    word: 'Published',
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
    plain: 'Its check-up date or its end date has passed. A live document is still followed, but nobody has confirmed lately that it is right. An expired one is no longer followed.',
  },
  framework: {
    word: 'Framework',
    plain: 'An outside rulebook the company has to meet, such as ISO 27001 or GDPR. Documents are linked to the rules they help meet.',
  },
};

export const plainOf = (key: TermKey): string => GLOSSARY[key].plain;

/** What a screen reader says for the (i) of a word. */
export const termLabel = (key: TermKey): string => `What “${GLOSSARY[key].word}” means`;

export interface HowStep {
  /** the step's name: the same as the detail's stepper (tracker/detailModel.ts STEPS), checked by a test */
  title: string;
  text: string;
  /** who does this step */
  who: string;
}

export const HOW_STEPS: readonly HowStep[] = [
  { title: 'Draft', text: 'Someone writes the document. Until it is published nobody has to follow it.', who: 'The author and the owner' },
  { title: 'In review', text: 'Reviewers read it and sign, or ask for changes. A route can have several stages, one after another or all at once.', who: 'The reviewers' },
  { title: 'In approval', text: 'Approvers decide. Nothing is published without this step.', who: 'The approvers' },
  { title: 'Approved', text: 'Signed off and waiting to be published. It is not live yet.', who: 'Someone who can publish' },
  { title: 'Published', text: 'The version everyone follows. A newer version can be written while this one stays published.', who: 'Everyone it applies to' },
  { title: 'Attestation', text: 'The owner can ask people to sign that they have read the published version. It shows how many have, and by when.', who: 'The owner asks, people sign' },
  { title: 'Acknowledgement', text: 'Everyone it applies to is asked to confirm, once, that they have read the published version.', who: 'Everyone it applies to' },
];

export interface HowBlocker { title: string; text: string }

/** What can hold a document up, as the line of a document says it. */
export const HOW_BLOCKERS: readonly HowBlocker[] = [
  { title: 'Waiting on someone', text: 'A review or approval was asked and is not done. The line says who and for how long. It turns red when a due date has passed.' },
  { title: 'Stuck', text: 'Nobody can be asked: a role or department with nobody in it, or the only approver wrote the document.' },
  { title: 'Changes requested', text: 'Someone asked for changes. Everyone else waits until the author makes them and resubmits it.' },
  { title: 'Changes proposed', text: 'Someone who is not the owner changed or proposed a change. Nothing applies until the owner accepts it.' },
  { title: 'Review overdue', text: 'It is published, but nobody has confirmed lately that it is still right.' },
];
