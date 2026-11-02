'use client';

/**
 * A small (i) that holds the explanation a page used to print as a sentence: hover or focus shows it, a tap toggles it, Escape and
 * scrolling close it. For text that helps the person who wonders; text that prevents a mistake stays on the page.
 * The note is drawn on top of the page (a portal, fixed to the (i)), so it is never clipped by a card, a table or a modal body, and
 * it keeps itself on screen: under the (i) or above it when there is more room there. The words are always in the page for a
 * screen reader (`aria-describedby`), shown or not.
 *
 * The glyph is 20px; the button around it is the press area: 24px with a mouse, 44px on a touch screen (`pointer: coarse`). It is padded
 * out and pulled back by the same negative margin, so nothing on the page moves. The ring is drawn on the glyph and the note is placed
 * from the glyph, so both stay exactly where they were. An (i) trails the words it explains, so on touch the extra reach goes up, down
 * and to the right, and only 2px to the left: the label before it (a FormField label focuses its field) keeps every press on its text.
 * The wrapper is deliberately not positioned (only the hidden words are, see below): a positioned box paints over its unpositioned siblings,
 * so the extra area would take presses from the controls around it. Unpositioned, whatever comes after it in the page (a button, a count)
 * and every positioned box (a FormField's label, a TextInput) is drawn over it, and the extra area only takes presses nothing else wants.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';

const WIDTH = 256;
const GAP = 6;
const MARGIN = 8;

interface Spot { left: number; width: number; top?: number; bottom?: number }

export function InfoTip({ text, label = 'More information', align = 'start', className = '' }: {
  text: string;
  /** what a screen reader says for the button */
  label?: string;
  /** which edge of the (i) the note lines up with ('end': its right edge; either way it is kept on screen) */
  align?: 'start' | 'end';
  className?: string;
}) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const glyph = useRef<HTMLSpanElement>(null);        // the visible 20px (i): the note is placed from it, not from the larger press area
  const pinned = useRef(false);                       // opened by a click or tap: stays until it is closed
  const [spot, setSpot] = useState<Spot | null>(null);

  const show = useCallback(() => {
    const r = glyph.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
    const left = Math.max(MARGIN, Math.min(align === 'end' ? r.right - width : r.left, window.innerWidth - width - MARGIN));
    const below = window.innerHeight - r.bottom - GAP - MARGIN;
    const above = r.top - GAP - MARGIN;
    setSpot(below >= 96 || below >= above ? { left, width, top: r.bottom + GAP } : { left, width, bottom: window.innerHeight - r.top + GAP });
  }, [align]);
  const hide = useCallback(() => { pinned.current = false; setSpot(null); }, []);

  useEffect(() => {
    if (!spot) return;
    const close = () => hide();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    const onDown = (e: MouseEvent) => { if (!button.current?.contains(e.target as Node)) hide(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [spot, hide]);

  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-describedby={id}
        onMouseEnter={show}
        onMouseLeave={() => { if (!pinned.current) setSpot(null); }}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => {
          e.stopPropagation();
          if (spot && pinned.current) hide();
          else { pinned.current = true; show(); }
        }}
        className="group/tip -m-[2px] grid place-items-center p-[2px] focus-visible:outline-none [@media(pointer:coarse)]:[margin:-12px_-22px_-12px_-2px] [@media(pointer:coarse)]:[padding:12px_22px_12px_2px]"
      >
        <span
          ref={glyph}
          className="grid h-5 w-5 place-items-center rounded-full text-[#7b8794] group-hover/tip:text-[#26323d] group-focus-visible/tip:ring-2 group-focus-visible/tip:ring-[#0f766e]"
        >
          <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
        </span>
      </button>
      {/* its own small positioned box, so the hidden words stay beside the (i) (an unpositioned sr-only span lands wherever the page's nearest positioned box is, and a long page gets a scrollbar of its own) */}
      <span className="relative"><span id={id} className="sr-only">{text}</span></span>
      {spot && typeof document !== 'undefined' && createPortal(
        <span
          role="tooltip"
          aria-hidden
          style={{ left: spot.left, top: spot.top, bottom: spot.bottom, width: spot.width }}
          className="pointer-events-none fixed z-[80] rounded-lg border border-[#d5dbe1] bg-[#fff] px-2.5 py-2 text-left text-[12px] font-normal normal-case leading-4 tracking-normal text-[#26323d] shadow-elevated"
        >
          {text}
        </span>,
        document.body,
      )}
    </span>
  );
}

export default InfoTip;
