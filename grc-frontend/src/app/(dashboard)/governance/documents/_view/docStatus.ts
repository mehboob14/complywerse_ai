// The words the document page says for a document's status, and the pill they are drawn as. Pure, so it is tested with node --test (docStatus.test.ts).
// The tone is the registry's (lib/status.ts documentStatus: the same reading as the library). The WORDS are the page's own, kept as they were before the
// registry existed: where the library says "In approval" this page says "Awaiting approval", and a status nobody named a word for reads as a sentence
// ("Exception applied"), not as the raw "exception applied" it used to print.
import { statusLabel } from '../../../../../lib/format.ts';
import { documentStatus, type Tone } from '../../../../../lib/status.ts';

export const DOC_STATUS_WORDS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  pending_review: 'In review',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  published: 'Published',
  expired: 'Expired',
  archived: 'Archived',
};

const own = (key: string): boolean => Object.prototype.hasOwnProperty.call(DOC_STATUS_WORDS, key);

/** The page's word for a status: its own list first, else the readable form of the raw word. */
export function docStatusWord(status: string | null | undefined): string {
  const key = String(status ?? '').trim().toLowerCase();
  return own(key) ? DOC_STATUS_WORDS[key] : statusLabel(status);
}

/** What a StatusPill takes for a document's status: the registry's tone, the page's word. */
export function docStatusPill(status: string | null | undefined): { tone: Tone; label: string } {
  return { tone: documentStatus.tone(status), label: docStatusWord(status) };
}
