'use client';

// Tabs and their panels. A real tab list: role="tablist" / "tab" / "tabpanel", aria-selected, aria-controls, and only the open tab is a tab stop;
// ArrowLeft / ArrowRight (wrapping), Home and End move to a tab and open it (automatic activation), and Enter or Space on a focused tab is a click.
// The strip scrolls sideways on a narrow screen without making the page wider, and the open tab is scrolled into view. The open tab is the
// caller's (`value` / `onChange`): keep it in the address with useTabParam. Keys and the count badge are decided in lib/tabsModel.ts (tested).
//
//   <Tabs tabs={[{ key: 'overview', label: 'Overview' }, { key: 'risk', label: 'Risk', count: 12 }]} value={tab} onChange={setTab} ariaLabel="Vendor record">
//     <TabPanel tabKey="overview">…</TabPanel>
//     <TabPanel tabKey="risk" lazy>…</TabPanel>
//   </Tabs>
import { createContext, useContext, useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { countLabel, nextTab, panelId, reachableKeys, scrollDelta, tabId, type TabLike } from '@/lib/tabsModel';

export interface TabItem extends TabLike {
  label: string;
  /** a number beside the name ("Findings 12"); 100 and over read "99+" */
  count?: number;
}

// `K` is the type of the tab keys the page works with ('overview' | 'findings' | 'history', what useTabParam gives): `onChange` receives one, so a
// useTabParam setter is passed as it is, with no cast. Without a typed value K is plain string, as it always was.
export interface TabsProps<K extends string = string> {
  tabs: TabItem[];
  /** the key of the open tab: one of the tabs that are shown (a `value` that matches none leaves every tab unselected) */
  value: K;
  /** a tab was picked (click, arrow keys, Home, End): its key, which is one of the `tabs` keys, so it is a `K` when the keys are */
  onChange: (key: K) => void;
  /** names the tab list for a screen reader: "Vendor record sections" */
  ariaLabel: string;
  /** the TabPanels */
  children?: ReactNode;
  /** layout only (margin, width) */
  className?: string;
}

const Context = createContext<{ base: string; value: string } | null>(null);

// The strip's baseline is an inset shadow, so the open tab's 2px underline can sit on it without being clipped by the scrolling strip; the focus
// ring is inset for the same reason (an outer ring would be cut off at the strip's edge).
const STRIP = 'flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center gap-[6px] whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)] disabled:cursor-not-allowed disabled:opacity-50';
const TAB_OPEN = 'border-ds-primary text-ds-primary-text';
const TAB_SHUT = 'border-transparent text-ds-fg-muted enabled:hover:border-ds-border-strong enabled:hover:text-ds-fg';
const BADGE = 'inline-flex min-w-[20px] items-center justify-center rounded-full px-[6px] text-ds-label tabular-nums';

export function Tabs<K extends string = string>({ tabs, value, onChange, ariaLabel, children, className }: TabsProps<K>) {
  const base = useId();
  const strip = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const shown = tabs.filter((t) => !t.hidden);
  const reachable = reachableKeys(tabs);
  // the one tab the Tab key lands on: the open one, else the first that can be reached, so the list is never skipped
  const stop = reachable.indexOf(value) >= 0 ? value : reachable[0];

  // the open tab into view, sideways only (scrollIntoView would also scroll the page up or down to reach the strip)
  useEffect(() => {
    const box = strip.current;
    const tab = buttons.current.get(value);
    if (!box || !tab) return;
    const b = box.getBoundingClientRect();
    const t = tab.getBoundingClientRect();
    const by = scrollDelta({ start: b.left, end: b.right }, { start: t.left, end: t.right });
    if (by !== 0) box.scrollLeft += by;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;                         // Alt+Left is the browser's Back
    const to = nextTab(reachable, key, e.key);
    if (to === null) return;
    e.preventDefault();
    buttons.current.get(to)?.focus();
    if (to !== value) onChange(to as K);
  };

  return (
    <Context.Provider value={{ base, value }}>
      <div className={className}>
        <div ref={strip} role="tablist" aria-label={ariaLabel} className={STRIP}>
          {shown.map((t) => {
            const open = t.key === value;
            const count = countLabel(t.count);
            return (
              <button
                key={t.key}
                ref={(el) => { if (el) buttons.current.set(t.key, el); else buttons.current.delete(t.key); }}
                type="button"
                role="tab"
                id={tabId(base, t.key)}
                aria-selected={open}
                aria-controls={panelId(base, t.key)}
                tabIndex={t.key === stop ? 0 : -1}
                disabled={t.disabled}
                onClick={() => { if (!open) onChange(t.key as K); }}
                onKeyDown={(e) => onKeyDown(e, t.key)}
                className={clsx(TAB, open ? TAB_OPEN : TAB_SHUT)}
              >
                {t.label}
                {count && <span className={clsx(BADGE, open ? 'bg-ds-primary-soft text-ds-primary-text' : 'bg-ds-border text-ds-fg-muted')}>{count}</span>}
              </button>
            );
          })}
        </div>
        {children}
      </div>
    </Context.Provider>
  );
}

export interface TabPanelProps {
  /** the key of the tab this panel belongs to */
  tabKey: string;
  /** Draw the content only once the tab has been opened for the first time, then keep it (hidden while another tab is open) so what the person
   *  typed or scrolled to is still there. Without it every panel is drawn from the start and only the open one is shown. */
  lazy?: boolean;
  children?: ReactNode;
  /** layout only (margin, padding): the panel adds no spacing of its own, and no display classes (the open/shut state is the `hidden` attribute) */
  className?: string;
}

export function TabPanel({ tabKey, lazy = false, children, className }: TabPanelProps) {
  const tabs = useContext(Context);
  const seen = useRef(false);
  if (!tabs) throw new Error('<TabPanel> must be inside <Tabs>');
  const open = tabs.value === tabKey;
  if (open) seen.current = true;
  return (
    <div
      role="tabpanel"
      id={panelId(tabs.base, tabKey)}
      aria-labelledby={tabId(tabs.base, tabKey)}
      hidden={!open}
      tabIndex={0}
      className={clsx('min-w-0 focus-visible:outline-none focus-visible:shadow-ds-ring', className)}
    >
      {!lazy || seen.current ? children : null}
    </div>
  );
}
