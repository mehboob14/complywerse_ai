'use client';

/**
 * The stages of one onboarding (the framework's steps, then Review) as a tab strip under the page heading, the way the Cyber Security scoping stages are:
 * the kit's tab keys (arrows, Home, End), how many required answers of a stage are in beside its name ("3/7"), a check once a stage needs nothing more.
 * The panel under it is the page's: it takes `panelId(base, current)` as its id and `tabId(base, current)` as its label, so the open tab names it.
 */
import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { nextTab, reachableKeys, scrollDelta, tabId, panelId } from '@/lib/tabsModel';
import type { Readiness } from '@/lib/frameworkOnboarding';
import { stageCount, type Stage } from './workspaceModel';

export { panelId, tabId };

// the strip's baseline is an inset shadow so the open tab's underline sits on it without being clipped by the scrolling strip (as in the kit's Tabs)
const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const TAB_OPEN = 'border-ds-primary text-ds-primary-text';
const TAB_SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';
const BADGE = 'inline-flex items-center justify-center rounded-full px-[6px] text-ds-label tabular-nums';

export default function StageStrip({ base, stages, readiness, current, onPick }: { base: string; stages: readonly Stage[]; readiness: Readiness; current: string; onPick: (stage: string) => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const reachable = reachableKeys(stages.map((s) => ({ key: s.key })));

  // the open stage into view, sideways only: on a narrow screen the strip scrolls (scrollIntoView would also move the page)
  useEffect(() => {
    const box = strip.current;
    const tab = buttons.current.get(current);
    if (!box || !tab) return;
    const b = box.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const by = scrollDelta({ start: b.left, end: b.right }, { start: t.left, end: t.right });
    if (by !== 0) box.scrollLeft += by;
  }, [current]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;                                 // Alt+Left is the browser's Back
    const to = nextTab(reachable, key, e.key);
    if (to === null) return;
    e.preventDefault();
    buttons.current.get(to)?.focus();
    if (to !== current) onPick(to);
  };

  return (
    <div ref={strip} role="tablist" aria-label="Stages of this onboarding" className={STRIP}>
      {stages.map((stage) => {
        const open = stage.key === current;
        const n = stageCount(readiness, stage.key);
        const done = n.total > 0 && n.complete;
        return (
          <button
            key={stage.key}
            ref={(el) => { if (el) buttons.current.set(stage.key, el); else buttons.current.delete(stage.key); }}
            type="button"
            role="tab"
            id={tabId(base, stage.key)}
            aria-selected={open}
            aria-controls={panelId(base, stage.key)}
            tabIndex={open ? 0 : -1}
            onClick={() => { if (!open) onPick(stage.key); }}
            onKeyDown={(e) => onKeyDown(e, stage.key)}
            className={clsx(TAB, open ? TAB_OPEN : TAB_SHUT)}
          >
            {done && <Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />}
            {stage.label}
            {n.badge && <span aria-hidden className={clsx(BADGE, open ? 'bg-ds-primary-soft text-ds-primary-text' : 'bg-ds-border text-ds-fg-muted')}>{n.badge}</span>}
            <span className="sr-only">{n.total > 0 ? `, ${n.words}${done ? ', done' : ''}` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
