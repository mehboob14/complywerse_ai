'use client';

/**
 * "Move to…": the small popover that asks which department one document, or the ticked ones, go to. A search box and the departments in
 * use by their full name ("Operations › Security"), "No department" last. It is portaled to <body> and fixed to the button it came from
 * (never clipped by the table's scroll), opens below that button or above it when there is more room there, takes focus when it opens
 * and gives it back when it closes. ArrowUp / ArrowDown and Enter choose, Escape or a click outside closes it. What it offers and how
 * the search narrows are rules in libraryFolders.ts; the moving itself (and what is said afterwards) is the page's. Every size and
 * colour is explicit: the platform CSS repaints white and slate and gives every button 12px text.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Loader2, Search } from 'lucide-react';
import { filterTargets, type MoveTarget } from './libraryFolders';

const WIDTH = 288;
const MAX_HEIGHT = 340;
const GAP = 6;
const MARGIN = 8;

interface Spot { left: number; width: number; top?: number; bottom?: number; maxHeight: number }

/** Under the button, or above it when there is more room there; never off screen. Chosen once, when it opens. */
function placeBeside(r: DOMRect | null): Spot {
  const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
  if (!r) return { left: Math.max(MARGIN, (window.innerWidth - width) / 2), width, top: 96, maxHeight: MAX_HEIGHT };
  const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
  const below = window.innerHeight - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  return below >= Math.min(above, MAX_HEIGHT)
    ? { left, width, top: r.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) }
    : { left, width, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) };
}

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

export function MovePopover({ anchor, targets, current, count, busy = false, onPick, onClose }: {
  /** the button it came from (its box when it was clicked) */
  anchor: DOMRect | null;
  /** libraryFolders.moveTargets: the departments in use, then "No department" */
  targets: MoveTarget[];
  /** the department every document is in now (null: none; undefined: they differ): shown ticked, and choosing it does nothing */
  current: number | null | undefined;
  /** how many documents are being moved */
  count: number;
  /** the move is running: nothing can be chosen or closed */
  busy?: boolean;
  onPick: (target: MoveTarget) => void;
  onClose: () => void;
}) {
  const [spot] = useState(() => placeBeside(anchor));
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const list = useMemo(() => filterTargets(targets, query), [targets, query]);
  const active = Math.min(at, Math.max(0, list.length - 1));
  const isCurrent = (t: MoveTarget) => current !== undefined && t.id === current;
  const latest = useRef({ busy, onClose });
  latest.current = { busy, onClose };

  useEffect(() => {
    const before = document.activeElement;
    inputRef.current?.focus({ preventScroll: true });
    // (the button that opened it, marked data-move-trigger, closes it with its own click: a press on it is not "outside")
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!latest.current.busy && !popRef.current?.contains(target) && !target.closest?.('[data-move-trigger]')) latest.current.onClose();
    };
    const onScroll = (e: Event) => { if (!latest.current.busy && !popRef.current?.contains(e.target as Node)) latest.current.onClose(); };
    // a width change moves the button; a height change alone is a phone's keyboard opening for the search box
    const width = window.innerWidth;
    const onResize = () => { if (!latest.current.busy && window.innerWidth !== width) latest.current.onClose(); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      if (before instanceof HTMLElement && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // the highlighted row stays in view as the arrow keys move it
  useEffect(() => { document.getElementById(`${uid}-${active}`)?.scrollIntoView({ block: 'nearest' }); }, [active, uid]);

  const choose = (t: MoveTarget | undefined) => { if (t && !busy && !isCurrent(t)) onPick(t); };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); if (!busy) onClose(); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.length > 0) setAt((active + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(list[active]);
    } else if (e.key === 'Tab') {
      e.preventDefault();                       // one field and its list: Tab leaves it, and focus goes back to where it was
      if (!busy) onClose();
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={count === 1 ? 'Move document to' : `Move ${count} documents to`}
      aria-busy={busy || undefined}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width: spot.width, maxHeight: spot.maxHeight }}
      className="fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff] text-[13px] text-[#26323d] shadow-elevated"
    >
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-2.5">
        <p className="text-[13px] font-semibold text-[#1f2933]">Move to</p>
        <p className="flex items-center gap-1.5 text-[12px] text-[#586472]" role="status">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.75} aria-hidden />}
          {busy ? 'Moving…' : count === 1 ? '1 document' : `${count} documents`}
        </p>
      </div>
      <div className="relative px-2 pb-2">
        <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-[60%] text-[#586472]" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={list.length > 0 ? `${uid}-${active}` : undefined}
          aria-label="Search departments"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setAt(0); }}
          placeholder="Search departments"
          className={`h-8 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] pl-8 pr-2 text-xs text-[#1f2933] placeholder:text-[#586472] ${FOCUS}`}
        />
      </div>
      <ul id={`${uid}-list`} role="listbox" aria-label="Departments" className="min-h-0 flex-1 overflow-y-auto border-t border-[#e1e6eb] p-1 scrollbar-thin">
        {list.length === 0 && <li role="presentation" className="px-2 py-3 text-center text-[12px] text-[#586472]">No match</li>}
        {list.map((t, i) => {
          const on = i === active;
          const here = isCurrent(t);
          return (
            <li
              key={t.id ?? 'none'}
              id={`${uid}-${i}`}
              role="option"
              aria-selected={on}
              aria-disabled={here || busy || undefined}
              title={here ? 'Already here' : t.label}
              onMouseEnter={() => setAt(i)}
              onClick={() => choose(t)}
              className={`flex min-h-[32px] items-center gap-2 rounded-md px-2 py-1.5 ${t.id === null && i > 0 ? 'mt-1 border-t border-[#e1e6eb] pt-2' : ''} ${
                here || busy ? 'cursor-default' : 'cursor-pointer'} ${on && !here && !busy ? 'bg-[#f0fdfa]' : ''} ${here ? 'text-[#586472]' : 'text-[#26323d]'}`}
            >
              <span className={`min-w-0 flex-1 truncate ${t.id === null ? 'text-[#586472]' : ''}`}>{t.label}</span>
              {here && <Check aria-hidden strokeWidth={2} className="h-4 w-4 shrink-0 text-[#0f766e]" />}
            </li>
          );
        })}
      </ul>
    </div>,
    document.body,
  );
}

export default MovePopover;
