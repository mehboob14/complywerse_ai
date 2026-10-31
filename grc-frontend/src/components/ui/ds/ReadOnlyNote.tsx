'use client';

// ReadOnlyNote: the notice of a page or a card that can be read and not changed: a lock and the page's words, as a `role="note"` so it is read out
// where it stands. The words are the page's, and an InfoTip after them says who can change it:
//
//   <ReadOnlyNote>View only <InfoTip text="Only an administrator can change them." label="Why these settings are view only" /></ReadOnlyNote>
//
// It is a line of facts, an inline element in the muted words colour: for the `meta` of a page head or the `actions` of a SectionCard.
import type { ReactNode } from 'react';
import { Lock } from 'lucide-react';

export interface ReadOnlyNoteProps {
  /** the words ("View only"), then an InfoTip if there is more to say */
  children: ReactNode;
}

export function ReadOnlyNote({ children }: ReadOnlyNoteProps) {
  return (
    <span role="note" className="inline-flex items-center gap-[6px] text-ds-body text-ds-fg-muted">
      <Lock size={14} aria-hidden />
      {children}
    </span>
  );
}
