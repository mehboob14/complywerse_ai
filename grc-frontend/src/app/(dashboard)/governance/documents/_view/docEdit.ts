// The top bar's Edit button: what it says, whether it can be pressed, and WHY when it cannot (a disabled button says nothing, so the reason is shown beside it as an (i)).
// Pure, so node --test checks the words (docEdit.test.ts). The words are the page's own from before: the server's `reason` first, else the archive sentence.

export interface EditInput {
  /** the person may change the document (`can_edit`) and it is not archived */
  mayChange: boolean;
  /** the server says the document can be opened for editing (GET .../access `openable`) */
  openable: boolean | undefined;
  /** the server's sentence when it cannot (GET .../access `reason`) */
  reason?: string | null;
  archived: boolean;
  /** the person's own draft of it, when they have one */
  draft?: { unsaved?: boolean; updated_at?: string | null; behind?: boolean } | null;
  /** "5 min ago" for the draft's last change */
  ago?: (at: string) => string;
}

export interface EditState {
  /** "Edit", or "Continue editing" while a draft has changes that were not saved */
  label: string;
  disabled: boolean;
  /** why it cannot be pressed; null when it can */
  why: string | null;
  /** the tooltip when it can: what pressing it does */
  title: string;
}

const ARCHIVED = 'This document is archived. Restore it to change it.';
const CLOSED = 'This document cannot be opened for editing right now.';

export function editState(i: EditInput): EditState {
  const disabled = !i.mayChange || !i.openable;
  const why = disabled ? (i.reason?.trim() || (i.archived ? ARCHIVED : CLOSED)) : null;
  const d = i.draft ?? null;
  const when = d?.updated_at && i.ago ? `, ${i.ago(d.updated_at)}` : '';
  return {
    label: d?.unsaved ? 'Continue editing' : 'Edit',
    disabled,
    why,
    title: why ?? (d ? `Your draft${when}${d.behind ? ' · the document has changed since' : ''}` : 'Edit in Comply AI Studio'),
  };
}
