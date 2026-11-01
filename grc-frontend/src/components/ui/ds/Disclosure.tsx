'use client';

// Disclosure and AccordionRow: a header that opens and shuts a panel, the accessible way (WAI-ARIA accordion): the header is a BUTTON inside a heading,
// it says `aria-expanded` and `aria-controls` the panel, and the panel is a `role="region"` named by the button (turn that off with `region={false}` in a long
// stack of them: more than about six regions is landmark noise). Enter and Space are the button's own. The panel stays in the page while it is shut (hidden,
// not removed) so what was typed or scrolled to inside it survives, and `aria-controls` always points at something.
// Two looks, one behaviour:
//   Disclosure    a facet group header: its name, how many are chosen in it (a filled number), a chevron, and a `search` slot at the top of the open group
//   AccordionRow  a row of a list that opens in place (an agenda item): a lead (number, icon), a title cut at two lines (the whole of it is repeated in the
//                 open row when it is long), a line of facts, a trailing status (a pill, a count: not interactive, it is part of the button) and a chevron
// Controlled when `open` is passed (the page holds it; `onOpenChange` says what a press asks for), else uncontrolled from `defaultOpen`. Rules: disclosureModel.ts.
//
//   <Disclosure label="Department" count={2} search={<TextInput … />}>…the options…</Disclosure>
//   <AccordionRow lead={<span>3</span>} title="Review the minutes of the last meeting" meta="Presenter · 15 min" trailing={<StatusPill … />}>…</AccordionRow>
import { createElement, useId, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { disclosureIds, groupCount, headingLevel, isOpen, pressedState, repeatsTitle } from './disclosureModel';

export interface DisclosureProps {
  /** The group's name: the text of the header. */
  label: string;
  /** How many are chosen in the group; drawn as a filled number after the name (and read as "2 selected"). 0 and missing draw nothing. */
  count?: number | null;
  /** The word that follows the number for a screen reader (default "selected"): the number itself is drawn, so the name reads "Status 2 selected". */
  countLabel?: string;
  /** A search box (or any control) at the top of the open group. */
  search?: ReactNode;
  /** Controlled: the page holds the open state. */
  open?: boolean;
  /** Uncontrolled: whether it starts open. */
  defaultOpen?: boolean;
  /** A press asks for this state (controlled or not). */
  onOpenChange?: (open: boolean) => void;
  /** The heading level of the header, 2 to 6 (default 3). */
  level?: 2 | 3 | 4 | 5 | 6;
  /** The panel is a `region` named by the header (default). Pass false in a long stack of disclosures. */
  region?: boolean;
  /** Shown, cannot be opened or shut. */
  disabled?: boolean;
  /** The group: the options, the list. */
  children: ReactNode;
  /** Layout only (margin). */
  className?: string;
}

export interface AccordionRowProps {
  /** The row's title: cut at two lines in the header; a long one is repeated in full in the open row. */
  title: string;
  /** A line under the title ("Presenter · 15 min"). */
  meta?: ReactNode;
  /** Before the title: a number badge, an icon. It is part of the header's name (a number is read as "3 Review the minutes"): hide an icon with aria-hidden, not a number. */
  lead?: ReactNode;
  /** After the title, before the chevron: a status pill, a count. It is inside the button, so it must not be interactive. */
  trailing?: ReactNode;
  /** Controlled: the page holds the open state. */
  open?: boolean;
  /** Uncontrolled: whether it starts open. */
  defaultOpen?: boolean;
  /** A press asks for this state (controlled or not). */
  onOpenChange?: (open: boolean) => void;
  /** The heading level of the header, 2 to 6 (default 3). */
  level?: 2 | 3 | 4 | 5 | 6;
  /** The panel is a `region` named by the header (default). Pass false in a long stack of rows. */
  region?: boolean;
  /** Shown, cannot be opened or shut. */
  disabled?: boolean;
  /** What opens: the description, the votes, the actions. */
  children: ReactNode;
  /** Layout only (margin). */
  className?: string;
}

// the ring is inset: the header spans its container, which may clip an outer one
const HEADER = 'flex w-full min-w-0 items-center rounded-ds-control text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-not-allowed disabled:opacity-50';
const HEADING = '!m-0 !text-ds-body !text-ds-fg';

function useDisclosure({ open, defaultOpen = false, onOpenChange }: { open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [inner, setInner] = useState(defaultOpen);
  const shown = isOpen({ open, inner });
  const press = () => {
    const { next, keep } = pressedState({ open, inner });
    if (keep) setInner(next);
    onOpenChange?.(next);
  };
  return { shown, press };
}

function Heading({ level, children }: { level: number | undefined; children: ReactNode }) {
  return createElement(`h${headingLevel(level)}`, { className: HEADING }, children);
}

export function Disclosure({ label, count, countLabel = 'selected', search, open, defaultOpen, onOpenChange, level, region = true, disabled = false, children, className }: DisclosureProps) {
  const ids = disclosureIds(useId());
  const { shown, press } = useDisclosure({ open, defaultOpen, onOpenChange });
  const chosen = groupCount(count);
  return (
    <div className={clsx('min-w-0 border-b border-ds-border py-[2px] last:border-b-0', className)}>
      <Heading level={level}>
        <button type="button" id={ids.button} aria-expanded={shown} aria-controls={ids.panel} disabled={disabled} onClick={press} className={clsx(HEADER, 'min-h-ds-control gap-[6px] px-[8px] text-ds-body font-[600]')}>
          <ChevronRight aria-hidden className={clsx('h-[14px] w-[14px] shrink-0 text-ds-fg-muted transition-transform', shown && 'rotate-90')} strokeWidth={2} />
          <span className="min-w-0 flex-1 break-words">{label}</span>
          {chosen && (
            <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ds-primary px-[5px] text-ds-label font-[600] tabular-nums text-ds-on-primary">
              {chosen}
              <span className="sr-only">{countLabel}</span>
            </span>
          )}
        </button>
      </Heading>
      <div id={ids.panel} {...(region ? { role: 'region', 'aria-labelledby': ids.button } : {})} hidden={!shown} className="min-w-0">
        {search && <div className="px-[8px] pb-[4px] pt-[2px]">{search}</div>}
        {children}
      </div>
    </div>
  );
}

export function AccordionRow({ title, meta, lead, trailing, open, defaultOpen, onOpenChange, level, region = true, disabled = false, children, className }: AccordionRowProps) {
  const ids = disclosureIds(useId());
  const { shown, press } = useDisclosure({ open, defaultOpen, onOpenChange });
  return (
    <div className={clsx('min-w-0 border-b border-ds-border last:border-b-0', className)}>
      <Heading level={level}>
        {/* the title asks for 10rem and takes the rest: when the status does not fit beside it, it drops to the next line instead of squeezing the words into a sliver; the chevron is pinned to the end */}
        <button type="button" id={ids.button} aria-expanded={shown} aria-controls={ids.panel} disabled={disabled} onClick={press} className={clsx(HEADER, 'relative min-h-ds-control flex-wrap gap-x-[10px] gap-y-[4px] py-[8px] pl-[4px] pr-[28px]')}>
          {lead && <span className="shrink-0">{lead}</span>}
          <span className="min-w-0 flex-1 basis-[10rem]">
            <span className="line-clamp-2 break-words text-ds-body font-medium text-ds-fg [overflow-wrap:anywhere]">{title}</span>
            {meta && <span className="block break-words text-ds-label font-normal text-ds-fg-muted">{meta}</span>}
          </span>
          {trailing && <span className="flex shrink-0 flex-wrap items-center gap-[6px] text-ds-label font-normal text-ds-fg-muted">{trailing}</span>}
          <ChevronDown aria-hidden className={clsx('absolute right-[8px] top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ds-fg-muted transition-transform', shown && 'rotate-180')} strokeWidth={2} />
        </button>
      </Heading>
      <div id={ids.panel} {...(region ? { role: 'region', 'aria-labelledby': ids.button } : {})} hidden={!shown} className={clsx('min-w-0 pb-[12px] pr-[8px]', lead ? 'pl-[38px]' : 'pl-[8px]')}>
        {repeatsTitle(title) && <p className="mb-[8px] break-words text-ds-body font-medium text-ds-fg [overflow-wrap:anywhere]">{title}</p>}
        {children}
      </div>
    </div>
  );
}
