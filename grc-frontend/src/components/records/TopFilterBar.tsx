'use client';

// The filters of a record explorer as a bar ABOVE the list (railPlacement "top"), so the list has the whole width: "Mine" first (what the page puts in `railHead`), then one button for
// each facet group with how many are chosen in it and a chevron, and "Clear all" while anything is on. A button opens that group in a panel under the bar: the same body the side rail
// has (FacetRail's FacetGroupBody: options with live counts, a search in a long group, "Show N more", "Clear ...") with an indented group as a tree that opens and shuts.
// One panel is open at a time. A button is a disclosure: Enter or Space open it (aria-expanded, aria-controls), Tab goes on into the options (the panel follows its button), Escape shuts
// it and puts the focus back on the button, a press outside or a Tab out of the group shuts it, and nothing needs a hover. The panel is in the page's flow (absolute under the bar, no
// portal), kept under its button and inside the bar by CSS alone. The filters that are on stay visible as chips (AppliedFilters) under the toolbar, which is the page's.
import { useId, useLayoutEffect, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/ds';
import { FacetGroupBody, type FacetGroupView, type FacetRailProps } from './FacetRail';
import { useContainerWidth } from './useContainerWidth';

export interface TopFilterBarProps {
  groups: FacetGroupView[];
  onToggle: FacetRailProps['onToggle'];
  onClear: FacetRailProps['onClear'];
  onClearAll: () => void;
  /** how many filters are on: "Clear all" shows while it is above 0 */
  filtering: number;
  /** false where the row of applied filters under the bar already has its own "Clear all" (one is enough) */
  clearAll?: boolean;
  /** before the groups: a check such as "Mine" */
  railHead?: ReactNode;
  /** the filters wait for the data: `waiting` stands in their place */
  ready: boolean;
  waiting?: ReactNode;
  /** names this bar among others on the page */
  idPrefix: string;
}

/** What a panel asks for: wide enough for a name and its count, never wider than the bar (CSS max-width), under its button and inside the bar (CSS clamp). */
const PANEL_WIDTH = 360;
const CHIP = 'inline-flex h-ds-control max-w-full items-center gap-[6px] rounded-ds-control border px-[10px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-ds-ring';

// a layout effect on the client (the panel is placed before anything is painted), a plain one where the page is drawn on the server and layout effects only warn
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function TopFilterBar({ groups, onToggle, onClear, onClearAll, filtering, clearAll = true, railHead, ready, waiting, idPrefix }: TopFilterBarProps) {
  const uid = useId();
  const bar = useRef<HTMLDivElement>(null);
  const chips = useRef<Record<string, HTMLButtonElement | null>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [left, setLeft] = useState(0);
  const width = useContainerWidth(bar);
  const shown = ready && openKey != null && groups.some((g) => g.key === openKey) ? openKey : null;

  // the panel stands under its own button (the bar is its positioned parent): measured when it opens and when the bar's room changes, before anything is painted
  useBeforePaint(() => {
    const chip = shown ? chips.current[shown] : null;
    if (chip) setLeft(chip.offsetLeft);
  }, [shown, width]);

  // a press anywhere outside the bar shuts the open panel (a press inside it is the bar's own)
  useEffect(() => {
    if (!shown) return undefined;
    const outside = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) setOpenKey(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [shown]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !shown) return;
    e.preventDefault();                                   // the page's own Escape (close the details, clear the selection) is not also taken
    e.stopPropagation();
    const key = shown;
    setOpenKey(null);
    chips.current[key]?.focus();
  };

  if (!ready) return <>{waiting}</>;
  return (
    <div ref={bar} role="group" aria-label="Filters" data-top-filters={idPrefix} onKeyDown={onKeyDown} className="relative flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[6px]">
      {railHead}
      {groups.map((g) => {
        const open = shown === g.key;
        const chipId = `${uid}-chip-${g.key}`;
        const panelId = `${uid}-panel-${g.key}`;
        return (
          <div
            key={g.key}
            className="min-w-0"
            // a Tab that leaves this group (to the next button, or out of the bar) shuts its panel; a press inside it that lands on nothing focusable has no destination, and is not a Tab
            onBlur={(e) => { if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpenKey(null); }}
          >
            <button
              ref={(el) => { chips.current[g.key] = el; }}
              type="button"
              id={chipId}
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => setOpenKey(open ? null : g.key)}
              className={clsx(CHIP, g.chosen > 0 ? 'border-ds-primary bg-ds-primary-soft text-ds-primary-text' : open ? 'border-ds-border-strong bg-ds-surface-hover text-ds-fg' : 'border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover')}
            >
              <span className="min-w-0 truncate">{g.label}</span>
              {g.chosen > 0 && (
                <span className="inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-ds-primary px-[5px] text-ds-label font-[600] tabular-nums text-ds-on-primary">
                  {g.chosen}
                  <span className="sr-only">selected</span>
                </span>
              )}
              <ChevronDown aria-hidden className={clsx('h-[14px] w-[14px] shrink-0 transition-transform', open && 'rotate-180')} strokeWidth={2} />
            </button>
            {/* the panel stays in the page while shut (hidden), so what was typed in its search and which branches were open survive, and aria-controls always points at something */}
            <div
              id={panelId}
              role="group"
              aria-label={g.label}
              hidden={!open}
              tabIndex={-1}
              style={{ left: `clamp(0px, ${left}px, calc(100% - ${PANEL_WIDTH}px))`, width: PANEL_WIDTH }}
              className="absolute top-full z-[50] mt-[4px] max-h-[420px] max-w-full overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-[4px] shadow-ds-pop focus-visible:outline-none"
            >
              <FacetGroupBody group={g} onToggle={onToggle} onClear={onClear} nested />
            </div>
          </div>
        );
      })}
      {clearAll && filtering > 0 && <Button variant="link" size="sm" onClick={onClearAll}>Clear all</Button>}
    </div>
  );
}
