'use client';

/**
 * A small (i) that holds the explanation a page used to print as a sentence: hover or focus shows it, a tap toggles it, Escape and
 * scrolling close it. For text that helps the person who wonders; text that prevents a mistake stays on the page.
 * The note is drawn on top of the page (a portal, fixed to the (i)), so it is never clipped by a card, a table or a modal body, and
 * it keeps itself on screen: under the (i) or above it when there is more room there. The words are always in the page for a
 * screen reader (`aria-describedby`), shown or not.
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
  const pinned = useRef(false);                       // opened by a click or tap: stays until it is closed
  const [spot, setSpot] = useState<Spot | null>(null);

  const show = useCallback(() => {
    const r = button.current?.getBoundingClientRect();
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
    <span className={`relative inline-flex align-middle ${className}`}>
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
        className="grid h-5 w-5 place-items-center rounded-full text-[#7b8794] hover:text-[#26323d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
      >
        <Info className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      <span id={id} className="sr-only">{text}</span>
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
