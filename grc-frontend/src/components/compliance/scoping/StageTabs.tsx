'use client';

/**
 * The stages of one assessment (Scope, People, Plan, Assessment) as a tab strip across the top of the page, under its heading. It is the kit's tab strip
 * (components/ui/ds/Tabs.tsx: the same tokens, the same keys: arrows, Home, End) with what each stage still needs beside its name ("2 to do"), a check
 * once it needs nothing, and the last stage locked until the assessment starts. The panel under it is the page's: it takes `panelId(base, current)` as its
 * id and `tabId(base, current)` as its label, so the open tab names it.
 */
import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Check, Lock } from 'lucide-react';
import { nextTab, reachableKeys, scrollDelta, tabId, panelId } from '@/lib/tabsModel';
import { STAGE_LABEL, STAGES, stageState, type Stage } from './scopingModel';
import type { ScopeView } from './scopingApi';

export { panelId, tabId };

// the strip's baseline is an inset shadow so the open tab's underline sits on it without being clipped by the scrolling strip (as in the kit's Tabs)
const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-not-allowed disabled:opacity-50';
const TAB_OPEN = 'border-ds-primary text-ds-primary-text';
const TAB_SHUT = 'border-transparent text-ds-fg-muted enabled:hover:border-ds-border-strong enabled:hover:text-ds-fg';
const BADGE = 'inline-flex items-center justify-center rounded-full px-[6px] text-ds-label tabular-nums';

export default function StageTabs({ base, view, current, onPick }: { base: string; view: ScopeView; current: Stage; onPick: (stage: Stage) => void }) {
  const started = view.phase === 'in_progress';
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const tabs = STAGES.map((key) => ({ key, disabled: key === 'assessment' && !started }));
  const reachable = reachableKeys(tabs);
  const stop = reachable.includes(current) ? current : reachable[0];

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

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, key: Stage) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;                                 // Alt+Left is the browser's Back
    const to = nextTab(reachable, key, e.key);
    if (to === null) return;
    e.preventDefault();
    buttons.current.get(to)?.focus();
    if (to !== current) onPick(to as Stage);
  };

  return (
    <div ref={strip} role="tablist" aria-label="Stages of this assessment" className={STRIP}>
      {tabs.map(({ key, disabled }) => {
        const open = key === current;
        const state = stageState(view, key);
        const todo = key !== 'assessment' && state.missing > 0 ? `${state.missing} to do` : '';
        const questions = key === 'assessment' && started ? `${view.total_items} questions` : '';
        const done = key !== 'assessment' && state.missing === 0;
        const badge = todo || questions;
        return (
          <button
            key={key}
            ref={(el) => { if (el) buttons.current.set(key, el); else buttons.current.delete(key); }}
            type="button"
            role="tab"
            id={tabId(base, key)}
            aria-selected={open}
            aria-controls={panelId(base, key)}
            tabIndex={key === stop ? 0 : -1}
            disabled={disabled}
            onClick={() => { if (!open) onPick(key); }}
            onKeyDown={(e) => onKeyDown(e, key)}
            className={clsx(TAB, open ? TAB_OPEN : TAB_SHUT)}
          >
            {disabled && <Lock aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={1.75} />}
            {done && <Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />}
            {STAGE_LABEL[key]}
            {badge && <span className={clsx(BADGE, open ? 'bg-ds-primary-soft text-ds-primary-text' : 'bg-ds-border text-ds-fg-muted')}>{badge}</span>}
            {done && <span className="sr-only">, done</span>}
            {disabled && <span className="sr-only">, opens when started</span>}
          </button>
        );
      })}
    </div>
  );
}
