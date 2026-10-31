'use client';

// SectionCard: one card of a settings or detail page: a title with its (i), an optional line of facts, the card's own actions on the right, then the
// content. It is a <section> named by its heading, so a screen reader lists it as a region and the page can link to it (#due: the `id` is the anchor,
// kept clear of a sticky header by scroll-margin).
//
//   <SectionCard id="reminders" title="Reminders" info="Sent to the person asked until they have done it.">...</SectionCard>
//   <SectionCard id="departments" title="Departments" meta="6 departments · 1 inactive" actions={<Button variant="primary">Add department</Button>}>...</SectionCard>
//
// `meta` is facts, not prose. The heading takes `!` (`!text-ds-section !text-ds-fg`) on purpose, as PageHeading's h1 does: globals.css has
// `h2 { @apply text-lg font-semibold text-slate-800 }`, and Tailwind copies every platform rule written for `.text-lg` / `.text-slate-800` onto
// the bare element, so inside the shell an h2 is remapped whatever class it carries unless the utility is important.
import type { ReactNode } from 'react';
import { InfoTip } from '../InfoTip';

export interface SectionCardProps {
  /** the card's anchor, and what names its heading: `#due` */
  id: string;
  title: string;
  /** what the card used to explain in a sentence, shown from an (i) beside the title */
  info?: string;
  /** one line of facts: "6 departments · 1 inactive" */
  meta?: ReactNode;
  /** the card's actions, on the right of the title row (wrapping under it on a phone) */
  actions?: ReactNode;
  children: ReactNode;
}

export function SectionCard({ id, title, info, meta, actions, children }: SectionCardProps) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
      <div className="mb-[12px] flex flex-wrap items-center gap-x-[4px] gap-y-[8px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">{title}</h2>
        {info && <InfoTip text={info} label={`About ${title.toLowerCase()}`} />}
        {meta && <span className="ml-[4px] text-ds-body text-ds-fg-muted">{meta}</span>}
        {actions && <div className="ml-auto flex max-w-full flex-wrap items-center gap-[8px]">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
