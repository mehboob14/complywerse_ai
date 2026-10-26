'use client';

/**
 * The Frameworks cell of the library table. A document can be mapped to a dozen frameworks and more, and a row must never grow for
 * them: the first two sit on ONE line as chips (the frameworks the library is filtered by come first, so a row shows why it matched),
 * and the rest are behind a "+N" button that opens the whole list, A to Z, with a search once it is long (FrameworkList, the same list
 * as the drawer's Frameworks tab). Chips are one fixed height and never wrap, the line is clipped, and "+N" sits outside the clipped
 * part, so 0, 1, 2 or 40 frameworks make the same row height.
 *
 * The list is portaled to the body and fixed to the button (never clipped by the table's scroll), opens below it or above when
 * there is more room there, takes focus when it opens, and closes on Escape, a click outside, a scroll of the page or the table, a
 * resize, or Tab out of it. A click on a chip, on "+N" or inside the list stops here (the row behind it opens the drawer); a click on
 * the blank part of the cell is a click on the row.
 */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { FrameworkChip } from './atoms';
import { FrameworkList } from './FrameworkList';
import { shownFrameworkIds } from './library';
import { frameworkDisplay, type FrameworkInfo } from './libraryModel';

const MAX_CHIPS = 2;
const WIDTH = 320;
const MAX_HEIGHT = 360;
const GAP = 4;
const MARGIN = 8;
/** px of the popover that are not the list: its padding, the heading, the search box and the "n of N" line */
const CHROME = 112;

interface Placement { left: number; top?: number; bottom?: number; maxHeight: number }

/** Under the button, or above it when there is more room there; never off screen. The side is chosen once, when it opens. */
function placeBeside(r: DOMRect): Placement {
  const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
  const left = Math.max(MARGIN, Math.min(r.left, window.innerWidth - width - MARGIN));
  const below = window.innerHeight - r.bottom - GAP - MARGIN;
  const above = r.top - GAP - MARGIN;
  return below >= Math.min(above, MAX_HEIGHT)
    ? { left, top: r.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) }
    : { left, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) };
}

export function FrameworksCell({ doc, info, prefer = [], onPick }: {
  doc: { applicable_framework_ids?: number[] | null; framework_ids?: number[] | null };
  /** framework id -> its short label and full name */
  info: Record<string, FrameworkInfo>;
  /** the frameworks the library is filtered by (Filters.frameworks): their chips come first */
  prefer?: readonly string[];
  /** a chip or a row of the list was clicked: the page filters by that framework */
  onPick: (id: number) => void;
}) {
  const ids = shownFrameworkIds(doc);
  const { chips, hidden, total } = frameworkDisplay(ids, info, { max: MAX_CHIPS, prefer });
  const [place, setPlace] = useState<Placement | null>(null);       // null while the list is closed
  const open = place != null;
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();
  const close = useCallback((refocus = false) => { setPlace(null); if (refocus) btnRef.current?.focus(); }, []);

  useEffect(() => {
    if (!open) return;
    // the list is outside the row's tab order (it sits at the end of the body): focus goes into it
    const pop = popRef.current;
    (pop?.querySelector<HTMLElement>('input, button') ?? pop)?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !popRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(true); };
    const onScroll = (e: Event) => { if (!popRef.current?.contains(e.target as Node)) close(); };    // the list's own scrolling is not a reason
    // a width change moves the button; a height change alone is a phone's keyboard opening for the search box and must not close the list
    const width = window.innerWidth;
    const onResize = () => { if (window.innerWidth !== width) close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close]);

  // Escape here is the list's own (it must not also close a drawer behind it); Tab past either end leaves the list for the button
  const onPopKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
    if (e.key !== 'Tab') return;
    const items = Array.from(popRef.current?.querySelectorAll<HTMLElement>('input, button') ?? []);
    if (!items.length || document.activeElement === items[e.shiftKey ? 0 : items.length - 1]) { e.preventDefault(); close(true); }
  };

  if (total === 0) {
    return (
      <span className="text-[13px] leading-5 text-[#586472]" title="No framework is mapped">
        <span aria-hidden>—</span>
        <span className="sr-only">No framework is mapped</span>
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      {/* a click on the chips, or on the button, is not a click on the row; the blank part of the cell still is */}
      <div className="-m-0.5 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden p-0.5" onClick={(e) => e.stopPropagation()}>
        {chips.map((c) => <FrameworkChip key={c.id} chip={c} active={prefer.includes(String(c.id))} onClick={() => onPick(c.id)} />)}
      </div>
      {hidden.length > 0 && (
        <button
          ref={btnRef}
          type="button"
          aria-label={`Show all ${total} frameworks`}
          title={`Show all ${total} frameworks`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popId : undefined}
          onClick={(e) => {
            e.stopPropagation();
            if (open) close();
            else setPlace(placeBeside(e.currentTarget.getBoundingClientRect()));
          }}
          className="inline-flex h-5 shrink-0 items-center rounded-md border border-[#b8c4c8] bg-[#fff] px-1.5 text-[11px] font-semibold leading-none text-[#26323d] hover:bg-[#eef2f6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
        >
          +{hidden.length}
        </button>
      )}
      {place && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            id={popId}
            role="dialog"
            aria-label={`Frameworks, ${total}`}
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onPopKey}
            style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight, width: WIDTH }}
            className="fixed z-[70] max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-[#d5dbe1] bg-[#fff] p-3 text-left shadow-elevated focus:outline-none"
          >
            <p className="mb-2 text-[13px] font-semibold text-[#1f2933]">Frameworks · {total}</p>
            <FrameworkList
              ids={ids}
              info={info}
              active={prefer}
              maxHeight={Math.max(96, Math.min(260, place.maxHeight - CHROME))}
              autoFocus
              onPick={(id) => { close(); onPick(id); }}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

export default FrameworksCell;
