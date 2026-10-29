'use client';

// The amber box that says a request may already be on record: each match is a link with the reason it matched. Shown on the
// request's card, on its own page, and in the request dialog after it was filed. Explicit hex: the platform CSS repaints amber
// utilities and sizes a bare <p> (PITFALLS 100).
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { Duplicate } from '../../_lib/intakeApi';
import { matchHref, matchNote } from '../../_lib/intakeModel';

export default function DuplicateBox({ title, matches, footnote }: {
  title: string;
  matches: Duplicate[];
  /** a closing line in small grey, e.g. what approving would do */
  footnote?: string;
}) {
  if (matches.length === 0) return null;
  return (
    <section aria-label={title} className="mt-3 rounded-lg border border-[#f0d2a9] bg-[#fbf1e4] px-4 py-3">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold leading-5 text-[#9a5007]">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2} />
        {title}
      </h3>
      <ul className="mt-1.5 space-y-1">
        {matches.map((m) => (
          <li key={m.id} className="text-[13px] leading-5 text-[#26323d]">
            <Link href={matchHref(m)} className="rounded-sm font-medium text-[#0f766e] underline underline-offset-2 hover:text-[#115e59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
              {m.name}
            </Link>
            {matchNote(m)}: {m.reason}
          </li>
        ))}
      </ul>
      {footnote && <p className="mt-2 text-[12px] leading-4 text-[#64707e]">{footnote}</p>}
    </section>
  );
}
