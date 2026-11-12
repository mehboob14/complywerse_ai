'use client';

// The cockpit frame of a module's Overview (the Governance Overview is its first content; Compliance, Risk and Performance can fill the same slots). Overview v2
// order (rule R1, posture first): `hero` (the KpiRow), `visuals` (a ChartGrid of ChartCards), `work` (the compact MyWorkCard) and nothing else is required.
// `band` (the counters chips), `posture` (a card beside the work) and `breakdowns` (cards below) are optional and absent by default: the chip wall is the
// attention list Overview v2 removes, so a page that passes none gets the three slots above and the work card across the page. Where `band` IS given it
// keeps its old place under the hero. The frame only arranges what the page hands it, and the layout rules are cockpitModel.ts:
//   full       work (8 parts, at least 600px: a row of it needs that for its title to have a line of its own) beside posture (5 parts, at least 340px);
//              stacked when the page is narrower than the two need (under 956px: a laptop with the rail, a window with the panel docked is 1032px)
//   solo       the person has little to do: a short strip of work, the posture across the page
//   work-only  the programme's scores may not be read: `refusal` says so ONCE, the person's own work takes the page, nothing else is drawn
// The breakdowns are cards in a grid (two across from 768px, three from 1280px; a card may take two cells or the whole row); on a phone each is a closed
// disclosure, so the first screen is the work. The two-part top row wraps by what each part needs (flex bases), not by the window, so a docked side panel
// that narrows the page stacks it at the right moment. Tokens and arbitrary values only (kit rules).
import { useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Disclosure, SectionCard } from '@/components/ui/ds';
import type { CockpitMode } from './cockpitModel';

/** `normal` is one cell; `wide` two of the grid's columns; `band` a whole row of the three-column grid (one cell below it). */
export type BreakdownSize = 'normal' | 'wide' | 'band';

export interface Breakdown {
  id: string;
  title: string;
  info?: string;
  meta?: ReactNode;
  /** the card's own controls (a pivot, a filter): in the header on a screen, at the top of the opened card on a phone */
  actions?: ReactNode;
  size?: BreakdownSize;
  children: ReactNode;
}

export interface CockpitProps {
  /** the layout (default `full`: with a posture card the work stands beside it; without one it takes the row) */
  mode?: CockpitMode;
  /** a phone: the breakdowns are closed disclosures (default false) */
  narrow?: boolean;
  /** the counters band (a CounterBand): optional and absent by default, Overview v2 has no chip wall */
  band?: ReactNode;
  /** the figures a dashboard leads with (a KpiRow of KpiTiles, components/overview/charts), above the band: drawn in every layout but `work-only`, never folded on a phone */
  hero?: ReactNode;
  /** the graphical part (a ChartGrid of ChartCards), under the band and above the person's work: drawn in every layout but `work-only`, never folded on a phone */
  visuals?: ReactNode;
  /** `work-only`: the one notice that says why nothing else is drawn */
  refusal?: ReactNode;
  /** the person's work: a MyWorkCard (slim, three one-line rows) or a WorkListCard (the long list) */
  work: ReactNode;
  /** the compact posture card, beside the work */
  posture?: ReactNode;
  breakdowns?: readonly Breakdown[];
}

const SPAN: Record<BreakdownSize, string> = { normal: '', wide: 'md:col-span-2', band: 'xl:col-span-3' };

/** The first thing a keyboard reaches on the page: past the counters to the person's own work. It shows when it has focus. */
export function SkipToWork({ href = '#work' }: { href?: string }) {
  return (
    <a
      href={href}
      className="sr-only focus:not-sr-only focus:inline-flex focus:min-h-ds-control focus:items-center focus:self-start focus:rounded-ds-control focus:border focus:border-ds-border-strong focus:bg-ds-surface focus:px-[12px] focus:text-ds-body focus:font-[600] focus:text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      Skip to my work
    </a>
  );
}

/** A phone's breakdown: a closed disclosure. Its content is drawn once it is opened: a chart in a shut panel has no width to measure. */
function FoldedCard({ b }: { b: Breakdown }) {
  const [open, setOpen] = useState(false);
  return (
    <section id={b.id} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface px-[12px]">
      <Disclosure label={b.title} level={2} open={open} onOpenChange={setOpen}>
        {open && (
          <>
            {(b.meta || b.actions) && (
              <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[8px] px-[8px] pb-[8px] text-ds-body text-ds-fg-muted">{b.meta}{b.actions}</div>
            )}
            <div className="px-[8px] pb-[8px]">{b.children}</div>
          </>
        )}
      </Disclosure>
    </section>
  );
}

function BreakdownCard({ b, narrow }: { b: Breakdown; narrow: boolean }) {
  if (narrow) return <FoldedCard b={b} />;
  return (
    <div className={clsx('min-w-0', SPAN[b.size ?? 'normal'])}>
      <SectionCard id={b.id} title={b.title} info={b.info} meta={b.meta} actions={b.actions}>{b.children}</SectionCard>
    </div>
  );
}

export function Cockpit({ mode = 'full', narrow = false, band, hero, visuals, refusal, work, posture, breakdowns = [] }: CockpitProps) {
  if (mode === 'work-only') {
    return (
      <div className="flex flex-col gap-[16px]">
        {refusal}
        {work}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[16px]">
      {hero}
      {band}
      {visuals}
      {mode === 'solo' || !posture ? (
        <div className="flex flex-col gap-[16px]">
          {work}
          {posture}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-[16px]">
          <div className="min-w-0 flex-[8_1_600px]">{work}</div>
          <div className="min-w-0 flex-[5_1_340px]">{posture}</div>
        </div>
      )}
      {breakdowns.length > 0 && (
        <div className="grid items-start gap-[16px] md:grid-cols-2 xl:grid-cols-3">
          {breakdowns.map((b) => <BreakdownCard key={b.id} b={b} narrow={narrow} />)}
        </div>
      )}
    </div>
  );
}
