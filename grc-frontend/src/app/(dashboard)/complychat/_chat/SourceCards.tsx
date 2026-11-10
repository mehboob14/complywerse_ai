'use client';

// The sources of an answer: one line "Sources (3)" that opens a list of plain cards (what kind of source, its title, a short extract, an Open link when the
// record has a page). No type key, no id, no score (sourceModel.ts decides the words). A button that opens and shuts a region, so it works from the keyboard.
import { useId, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import { sourcesLabel, viewsOf } from './sourceModel';
import type { ChatSource } from './chatModel';

export function SourceCards({ sources }: { sources: readonly ChatSource[] | undefined }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const views = viewsOf(sources);
  if (views.length === 0) return null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="mt-[12px] border-t border-ds-border pt-[8px]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="-ml-[6px] inline-flex min-h-ds-control items-center gap-[6px] rounded-ds-control px-[6px] text-ds-body font-medium text-ds-fg-body hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
      >
        <Chevron aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
        {sourcesLabel(views.length)}
      </button>
      <ul id={id} className={open ? 'mt-[8px] grid gap-2' : 'hidden'}>
        {views.map((v) => (
          <li key={v.key} className="rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
              <span className="rounded-full bg-ds-primary-soft px-[8px] py-[1px] text-ds-label font-medium text-ds-primary-text">{v.label}</span>
              <span className="min-w-0 flex-1 basis-[12rem] break-words text-ds-body font-[600] text-ds-fg">{v.title}</span>
              {v.href && (
                <Link href={v.href} className="inline-flex min-h-ds-control items-center gap-[4px] rounded-ds-control px-[6px] text-ds-body font-medium text-ds-primary-text hover:bg-ds-primary-soft focus-visible:outline-none focus-visible:shadow-ds-ring" aria-label={`Open ${v.title}`}>
                  Open
                  <ExternalLink aria-hidden className="h-[14px] w-[14px]" strokeWidth={1.75} />
                </Link>
              )}
            </div>
            {v.snippet && <p className="mt-[4px] break-words text-ds-label text-ds-fg-muted [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] overflow-hidden">{v.snippet}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
