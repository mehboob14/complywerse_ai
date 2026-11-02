'use client';

// Scope and filter controls of the Vendors pages: a segmented control (what is shown), filter facets (pills that read "Label: value"),
// the ghost "Clear filters", and toggle chips. Explicit hex throughout: the platform CSS repaints slate/white and sizes bare buttons.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { Check, ChevronDown, Search, X } from 'lucide-react';

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

/** A local switch between views of the same data (Pending / Approved / Declined / All). It does not navigate. One tab stop; the
 *  arrow keys, Home and End move the choice, as in a radio group. */
export function SegmentedControl<T extends string>({ value, onChange, ariaLabel, options }: {
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  options: Array<{ value: T; label: string; count?: number }>;
}) {
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.findIndex((o) => o.value === value);
  const move = (to: number) => {
    const next = (to + options.length) % options.length;
    onChange(options[next].value);
    buttons.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(options.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex max-w-full overflow-x-auto rounded-lg border border-[#c3ccd5] bg-[#fff] p-0.5">
      {options.map((o, i) => {
        const on = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => { buttons.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === Math.max(current, 0) ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={clsx(
              'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-sm',
              FOCUS,
              on ? 'bg-[#e6f6f3] font-semibold text-[#0f766e]' : 'font-medium text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933]',
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={clsx('rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px]', on ? 'bg-[#0f766e] text-[#fff]' : 'bg-[#e1e6eb] text-[#586472]')}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

interface Spot { left: number; width: number; top?: number; bottom?: number; maxHeight: number }
const GAP = 6;
const MARGIN = 8;

/** Where the menu goes: under the pill, or above it when there is more room there, and always on screen. */
function measure(el: HTMLElement): Spot {
  const r = el.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 224), 300, window.innerWidth - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
  const below = window.innerHeight - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  return below >= 240 || below >= above
    ? { left, width, top: r.bottom + GAP, maxHeight: Math.max(160, Math.min(below, 400)) }
    : { left, width, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.max(160, Math.min(above, 400)) };
}

/** A toolbar pill that states its own selection: "Tier: All", "Tier: High", "Tier: 2 selected". It opens a checklist (a search box
 *  past 8 options, "Clear filter" at the foot) and turns teal while it filters. `single` keeps only the last pick. The menu is drawn
 *  on <body>, so no card or table can clip it; Escape closes it and gives focus back to the pill. */
export function FilterFacet({ label, options, selected, onChange, single = false }: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  single?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [spot, setSpot] = useState<Spot | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const pointer = useRef(false);                          // the last thing done in the menu was a click, not a key
  const popId = useId();

  const active = selected.length > 0;
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? selected[0]) : `${selected.length} selected`;
  const withSearch = options.length > 8;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    setQuery('');
    setSpot(null);
    if (refocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (open && trigger.current) setSpot(measure(trigger.current));
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    // capture, so the Escape that closes this menu is spent before a dialog around the pill sees it
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(true); } };
    const onScroll = (e: Event) => { if (!pop.current?.contains(e.target as Node)) close(); };
    const onResize = () => { if (trigger.current) setSpot(measure(trigger.current)); };   // follows a phone's keyboard instead of closing (PITFALLS 103)
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  const placed = spot !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const root = pop.current;
    (root?.querySelector<HTMLElement>('input[type="search"]') ?? root?.querySelector<HTMLElement>('input:checked') ?? root?.querySelector<HTMLElement>('input') ?? root)?.focus({ preventScroll: true });
  }, [open, placed]);

  const pick = (value: string, checked: boolean) => {
    if (single) {
      onChange(checked ? [value] : []);
      if (pointer.current) close(true);                   // a click settles a one-answer filter; moving through it with the keys does not
      return;
    }
    onChange(checked ? [...selected, value] : selected.filter((v) => v !== value));
  };

  // Tab off the end of the list gives focus back to the pill (the menu lives on <body>, so the browser would lose it); arrows move between rows
  const onPopKey = (e: KeyboardEvent<HTMLDivElement>) => {
    pointer.current = false;
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'));
    const at = items.indexOf(e.target as HTMLElement);
    if (e.key === 'Tab') {
      if (items.length === 0 || (e.shiftKey ? at <= 0 : at === items.length - 1)) close(true);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && at >= 0) {
      e.preventDefault();
      items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className={clsx(
          'inline-flex h-9 max-w-[260px] items-center gap-1.5 rounded-full border px-3.5 text-sm',
          FOCUS,
          active ? 'border-[#99d5cf] bg-[#f0fdfa] text-[#0f766e]' : 'border-[#c3ccd5] bg-[#fff] text-[#586472] hover:bg-[#f3f6f8]',
        )}
      >
        <span className="shrink-0 font-medium">{label}:</span>
        <span className={clsx('truncate', active ? 'font-semibold' : 'text-[#26323d]')}>{summary}</span>
        <ChevronDown aria-hidden className={clsx('h-3.5 w-3.5 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </button>
      {open && spot && typeof document !== 'undefined' && createPortal(
        <div
          ref={pop}
          id={popId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onPopKey}
          onPointerDown={() => { pointer.current = true; }}
          style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width: spot.width, maxHeight: spot.maxHeight }}
          className="fixed z-[90] flex flex-col overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff] p-1 shadow-elevated outline-none"
        >
          {withSearch && (
            <div className="mb-1 flex shrink-0 items-center gap-2 border-b border-[#e1e6eb] px-2.5 py-2">
              <Search aria-hidden className="h-4 w-4 shrink-0 text-[#64707e]" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label={`Search ${label}`}
                className="min-w-0 flex-1 bg-transparent text-sm text-[#1f2933] outline-none placeholder:text-[#64707e]"
              />
            </div>
          )}
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-3 py-4 text-center text-[13px] text-[#64707e]">No matches</p>
            ) : shown.map((o) => {
              const on = selected.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="relative flex min-h-9 cursor-pointer items-center rounded-md py-1.5 pl-8 pr-3 text-sm text-[#26323d] hover:bg-[#f3f6f8] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[#0f766e]"
                >
                  <input type="checkbox" checked={on} onChange={(e) => pick(o.value, e.target.checked)} className="sr-only" />
                  <span aria-hidden className="absolute left-2.5 grid h-4 w-4 place-items-center">
                    {on && <Check className="h-4 w-4 text-[#0f766e]" strokeWidth={2.25} />}
                  </span>
                  <span className={clsx('truncate', on && 'font-medium')}>{o.label}</span>
                </label>
              );
            })}
          </div>
          <div aria-hidden className="my-1 h-px shrink-0 bg-[#e1e6eb]" />
          <button
            type="button"
            disabled={!active}
            onClick={() => { onChange([]); close(true); }}
            className={clsx('flex h-9 w-full shrink-0 items-center rounded-md px-3 text-left text-sm font-medium text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] disabled:cursor-not-allowed disabled:text-[#9aa5b1] disabled:hover:bg-transparent', FOCUS)}
          >
            Clear filter
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/** The ghost button that undoes every filter at once; nothing at all while nothing is filtered. */
export function ClearFilters({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  if (!visible) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx('inline-flex h-9 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium text-[#586472] hover:bg-[#e4e9ee] hover:text-[#1f2933]', FOCUS)}
    >
      <X aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />
      Clear filters
    </button>
  );
}

/** A rounded chip that is on or off (policy skips, reviewers, library templates): teal with a tick while on. */
export function ToggleChip({ on, onClick, children, disabled, title }: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={clsx(
        'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50',
        FOCUS,
        on ? 'border-[#0f766e] bg-[#f0fdfa] text-[#0f766e]' : 'border-[#c3ccd5] bg-[#fff] text-[#586472] hover:bg-[#f3f6f8] disabled:hover:bg-[#fff]',
      )}
    >
      {on && <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2.25} />}
      {children}
    </button>
  );
}
