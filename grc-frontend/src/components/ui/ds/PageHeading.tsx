'use client';

// The page head of the new standard, drawn by PageHeader when it is given variant="page": an optional back link, the title as the page's <h1>, an
// (i) for what used to be an intro sentence, one line of facts, status chips, and the page's actions on the right. It lives in the ds folder so
// kitGuard.test.ts holds it to the kit rules even though PageHeader (shared with Access Reviews) is not.
//
// On a phone the actions drop under the title as a row of their own instead of squeezing it: the title block asks for 16rem and takes the rest,
// the actions never shrink, so there is room for one or the other on the line. A 500-character title wraps (`break-words`) and cannot widen
// the page. The title takes `!` (`!text-ds-title !text-ds-fg`) on purpose, the one place the kit does: globals.css has `@apply text-xl ...` in its
// base `h1` rule, and Tailwind copies every platform rule written for `.text-xl` / `.text-slate-900` onto the bare element, so inside
// `.platform-ui.compact-density main` every h1 is 17px and #1a1a1a whatever class it carries, out-ranking a plain utility (measured: 17px).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { InfoTip } from '../InfoTip';
import { truncate } from '@/lib/format';

export interface PageHeadingProps {
  title: string;
  /** One line of facts, not prose: "44 documents · updated 5 d ago". Text or inline elements: a bare <p> would get the platform's 11.5px. */
  meta?: ReactNode;
  /** What the page used to explain in a sentence, shown from an (i) beside the title. */
  info?: string;
  /** A link back to the list the record belongs to; the label says where it goes: "Back to vendors". */
  back?: { href: string; label: string };
  /** Status pills under the title. */
  chips?: ReactNode;
  actions?: ReactNode;
  /** layout only (margin): the head adds no space around itself */
  className?: string;
}

const BACK = '-ml-[6px] mb-[8px] inline-flex min-h-ds-control-sm max-w-full items-center gap-1 rounded-ds-control px-[6px] text-ds-body font-medium text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring';

export function PageHeading({ title, meta, info, back, chips, actions, className }: PageHeadingProps) {
  return (
    <header className={className}>
      {back && (
        <Link href={back.href} className={BACK}>
          <ArrowLeft aria-hidden className="h-[16px] w-[16px] shrink-0" strokeWidth={1.75} />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-[16px] gap-y-[12px]">
        <div className="min-w-0 flex-1 basis-[16rem]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
            <h1 className="min-w-0 break-words !text-ds-title !text-ds-fg">{title}</h1>
            {info && <InfoTip text={info} label={`About ${truncate(title, 80).text}`} />}
            {meta && <span className="text-ds-body text-ds-fg-muted">{meta}</span>}
          </div>
          {chips && <div className="mt-[8px] flex flex-wrap items-center gap-2">{chips}</div>}
        </div>
        {actions && <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
