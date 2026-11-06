'use client';

// The counters band of a cockpit: what needs attention across the module, as chips that each open the records they count (the kit's CountRow, `chip`).
// Counters with something in them come first and the zeros after them, muted; every counter stays one press away. Each loads, fails and has nothing on its
// own (a skeleton, "<label>: unavailable" with its own Retry, a dash: never 0); when every counter failed the band says so once. On a phone it shows the
// first three and a button for the rest (cockpitModel.ts). The page gives the counters, their words and their addresses: nothing here knows a module.
// Layout: the title block floats left and the chips flow round it, so a second and a third row of chips start at the left edge instead of leaving a column
// of empty space under the title (eight chips are two rows on a laptop, not four).
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, CountRow, ErrorState } from '@/components/ui/ds';
import type { Tone } from '@/lib/status';
import { foldCounters, foldLabel, orderCounters, type Countable } from './cockpitModel';

export interface BandCounter extends Countable {
  key: string;
  label: string;
  /** where it opens: the records it counts, or the page that lists them */
  href: string;
  /** the colour of its dot while it is above 0 */
  tone: Tone;
  /** a counter that failed asks again */
  onRetry?: () => void;
}

export interface CounterBandProps {
  /** the anchor of the band */
  id: string;
  title: string;
  info: string;
  /** "69 in total", a skeleton while it loads, "Total unavailable"; nothing when there is none */
  total?: ReactNode;
  counters: readonly BandCounter[];
  /** a phone: the first three counters and a button for the rest */
  narrow: boolean;
  /** every counter failed: said once instead of once per counter */
  failure?: { title: string; message?: string; onRetry?: () => void };
}

// a chip is an inline-flex box that sits at the top of its line: no strut of the line's text under it, so a row of chips is exactly as tall as a chip
const CHIP = 'mb-[6px] mr-[8px] inline-flex align-top';

export function CounterBand({ id, title, info, total, counters, narrow, failure }: CounterBandProps) {
  const [all, setAll] = useState(false);
  const { shown, foldable, folded } = foldCounters(orderCounters(counters), { narrow, all });
  const busy = counters.some((c) => c.state === 'loading');
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="flow-root scroll-mt-[64px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] pb-[2px] pt-[8px]">
      <div className="float-left mb-[6px] mr-[12px] flex min-h-ds-control items-center gap-[4px]">
        <h2 id={`${id}-h`} className="min-w-0 !text-ds-body !text-ds-fg">{title}</h2>
        <InfoTip text={info} label={`About ${title.toLowerCase()}`} />
        {total && <span className="ml-[4px] text-ds-body text-ds-fg-muted">{total}</span>}
      </div>
      {failure ? (
        <ErrorState compact title={failure.title} message={failure.message} onRetry={failure.onRetry} className="overflow-hidden" />
      ) : (
        <ul aria-busy={busy || undefined} className="m-0 list-none p-0">
          {shown.map((c) => (
            <CountRow
              key={c.key}
              layout="chip"
              label={c.label}
              href={c.href}
              tone={c.tone}
              count={c.state === 'ready' ? c.value ?? null : null}
              loading={c.state === 'loading'}
              error={c.state === 'error' ? { onRetry: c.onRetry } : null}
              className={CHIP}
            />
          ))}
          {foldable && (
            <li className={CHIP}>
              <Button aria-expanded={!folded} rightIcon={folded ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />} onClick={() => setAll((v) => !v)}>
                {foldLabel(counters.length, folded)}
              </Button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
