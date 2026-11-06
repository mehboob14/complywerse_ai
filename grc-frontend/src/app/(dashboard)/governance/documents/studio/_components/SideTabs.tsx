'use client';

// The five sections of the assistant (Assistant, References, Instructions, Checks, Changes) as real tabs: a tab list whose tabs name the panels they
// open (aria-controls / aria-labelledby, ids from tabsModel), only the open tab is a tab stop, and ArrowLeft / ArrowRight (wrapping), Home and End move
// to a tab and open it. The keys and the ids are the kit's own (lib/tabsModel.ts, the same Tabs uses).
//
// It is the Studio's own strip and not the kit's `Tabs` because five labelled tabs do not fit the 26rem assistant pane in one line (the kit's tabs
// scroll sideways and would hide the last two): here each tab is a column, the icon over its name, with the count badge on its corner. A kit gap, see
// the audit ("Tabs has no stacked, equal-width variant"). The badge is part of the tab's name ("Checks, 53"), and "working" stands for the dots.
import { useRef, type KeyboardEvent } from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { countLabel, nextTab, panelId, reachableKeys, tabId } from '@/lib/tabsModel';

export interface SideTab {
  key: string;
  label: string;
  icon: LucideIcon;
  /** a number on the tab's corner; 0 or missing: none */
  count?: number;
  /** what the number counts, said after it in the tab's name ("2 changes waiting"); without it only the number is said */
  noun?: string;
  /** a short mark on the corner instead of a number ("…" while Comply Agent is working) and what it says in words */
  mark?: { text: string; words: string };
}

const TAB = 'relative flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-[2px] border-b-2 px-[4px] py-[6px] text-ds-label font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export function SideTabs({ tabs, value, onChange, base, ariaLabel }: {
  tabs: readonly SideTab[];
  value: string;
  onChange: (key: string) => void;
  /** unique on the page; the panels use the same base (`panelId(base, key)`) */
  base: string;
  ariaLabel: string;
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const keys = reachableKeys(tabs);
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;                         // Alt+Left is the browser's Back
    const to = nextTab(keys, key, e.key);
    if (to === null) return;
    e.preventDefault();
    buttons.current.get(to)?.focus();
    if (to !== value) onChange(to);
  };
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex border-b border-ds-border bg-ds-surface">
      {tabs.map((t) => {
        const open = t.key === value;
        const Icon = t.icon;
        const badge = t.mark ? t.mark.text : countLabel(t.count || undefined);
        const words = t.mark ? t.mark.words : badge && t.noun ? `${badge} ${t.noun}` : badge;
        return (
          <button
            key={t.key}
            ref={(el) => { if (el) buttons.current.set(t.key, el); else buttons.current.delete(t.key); }}
            type="button"
            role="tab"
            id={tabId(base, t.key)}
            aria-selected={open}
            aria-controls={panelId(base, t.key)}
            aria-label={words ? `${t.label}, ${words}` : t.label}
            tabIndex={open ? 0 : -1}
            onClick={() => { if (!open) onChange(t.key); }}
            onKeyDown={(e) => onKeyDown(e, t.key)}
            className={clsx(TAB, open ? 'border-ds-primary text-ds-primary-text' : 'border-transparent text-ds-fg-muted hover:text-ds-fg')}
          >
            <Icon aria-hidden className="h-[16px] w-[16px]" strokeWidth={1.75} />
            <span className="max-w-full truncate">{t.label}</span>
            {badge && <span aria-hidden className="absolute right-[4px] top-[4px] min-w-[18px] rounded-full bg-ds-primary px-[4px] text-center text-ds-label leading-[16px] text-ds-on-primary">{badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
