'use client';

/**
 * The stages of the organisation profile as a tab strip under its heading: each stage with how far it is ("3 of 7" required fields) and a check once it has
 * been reviewed. The kit's tab keys (arrows, Home, End), the same look as the scoping stage strip; the panel under it takes `panelId(base, current)` as its
 * id and `tabId(base, current)` as its label, so the open tab names it. On a phone the strip scrolls sideways inside itself.
 */
import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { nextTab, panelId, reachableKeys, scrollDelta, tabId } from '@/lib/tabsModel';
import type { Group, OrgGroupState } from '@/lib/frameworkOnboarding';
import { stageProgress } from './profileModel';

export { panelId, tabId };

const STRIP = 'relative flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';
const TAB_OPEN = 'border-ds-primary text-ds-primary-text';
const TAB_SHUT = 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg';
const BADGE = 'inline-flex items-center justify-center rounded-full px-[6px] text-ds-label tabular-nums';

export default function ProfileStages({ base, groups, states, current, onPick }: {
  base: string;
  groups: readonly Pick<Group, 'key' | 'label'>[];
  states: Record<string, OrgGroupState> | undefined;
  current: string;
  onPick: (stage: string) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const keys = reachableKeys(groups.map((g) => ({ key: g.key })));

  // the open stage into view, sideways only (scrollIntoView would also move the page)
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
    const to = nextTab(keys, key, e.key);
    if (to === null) return;
    e.preventDefault();
    buttons.current.get(to)?.focus();
    if (to !== current) onPick(to);
  };

  return (
    <div ref={strip} role="tablist" aria-label="Stages of the organisation profile" className={STRIP}>
      {groups.map((g) => {
        const open = g.key === current;
        const progress = stageProgress(states?.[g.key]);
        return (
          <button
            key={g.key}
            ref={(el) => { if (el) buttons.current.set(g.key, el); else buttons.current.delete(g.key); }}
            type="button"
            role="tab"
            id={tabId(base, g.key)}
            aria-selected={open}
            aria-controls={panelId(base, g.key)}
            tabIndex={open ? 0 : -1}
            onClick={() => { if (!open) onPick(g.key); }}
            onKeyDown={(e) => onKeyDown(e, g.key)}
            className={clsx(TAB, open ? TAB_OPEN : TAB_SHUT)}
          >
            {progress.reviewed && <Check aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-success" strokeWidth={2} />}
            {g.label}
            {progress.text && <span className={clsx(BADGE, open ? 'bg-ds-primary-soft text-ds-primary-text' : 'bg-ds-border text-ds-fg-muted')}>{progress.text}<span className="sr-only"> filled</span></span>}
            {progress.reviewed && <span className="sr-only">, reviewed</span>}
          </button>
        );
      })}
    </div>
  );
}
