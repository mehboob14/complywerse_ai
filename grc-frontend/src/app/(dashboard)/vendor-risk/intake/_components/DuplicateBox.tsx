'use client';

// The amber notice that says a request may already be on record: each match is a link with the reason it matched. Shown on the selected request, on its own page, and in the request sheet
// after it was filed.
import Link from 'next/link';
import { Notice, linkClasses } from '@/components/ui/ds';
import type { Duplicate } from '../../_lib/intakeApi';
import { matchHref, matchNote } from '../../_lib/intakeModel';

export default function DuplicateBox({ title, matches, footnote, className }: {
  title: string;
  matches: Duplicate[];
  /** a closing line in small grey, e.g. what approving would do */
  footnote?: string;
  className?: string;
}) {
  if (matches.length === 0) return null;
  return (
    <Notice tone="warning" title={title} className={className}>
      <ul className="m-0 flex list-none flex-col gap-[2px] p-0">
        {matches.map((m) => (
          <li key={m.id} className="text-ds-body text-ds-fg-body">
            <Link href={matchHref(m)} className={linkClasses({ tone: 'text' })}>{m.name}</Link>
            {matchNote(m)}: {m.reason}
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-[4px] text-ds-label text-ds-fg-muted">{footnote}</p>}
    </Notice>
  );
}
