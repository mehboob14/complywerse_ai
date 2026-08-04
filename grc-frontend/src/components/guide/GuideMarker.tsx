'use client';

/**
 * A small numbered marker placed beside a real UI element. Renders nothing
 * when guide mode is off (purely additive — see GuideContext). When on, it
 * is a quiet 16px outlined circle in the teal accent; clicking it opens the
 * matching entry from GUIDE_NOTES in the GuidePanel slide-over.
 *
 * `n` is the marker's number as shown to the user. Numbering is per-screen
 * and sequential in DOM order — the caller assigns it explicitly (in the
 * order the markers appear on that screen) rather than this component
 * inferring it, which keeps the numbering deterministic regardless of
 * render timing.
 */

import { useGuide } from './GuideContext';
import { GUIDE_NOTES } from '@/lib/guide-notes';

type GuideMarkerProps = {
  /** Stable dotted key into GUIDE_NOTES, e.g. "asset.riskScore". */
  id: string;
  /** 1-based position of this marker within its screen, in DOM order. */
  n: number;
  /** Extra classes for positioning only (e.g. "absolute -top-1.5 -right-1.5"). */
  className?: string;
};

export default function GuideMarker({ id, n, className }: GuideMarkerProps) {
  const { enabled, activeId, select } = useGuide();

  if (!enabled) return null;

  const note = GUIDE_NOTES[id];
  if (!note && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn(`GuideMarker: no GUIDE_NOTES entry for id "${id}"`);
  }

  const isActive = activeId === id;

  return (
    <button
      type="button"
      onClick={() => select(id)}
      aria-label={`Guide note ${n}: ${note?.title ?? id}`}
      aria-expanded={isActive}
      title={note?.title ?? id}
      className={
        'guide-marker inline-flex h-4 w-4 flex-shrink-0 select-none items-center justify-center ' +
        'rounded-full border border-primary-500 bg-white text-[9px] font-semibold leading-none ' +
        'text-primary-600 shadow-sm transition-colors hover:bg-primary-50 focus:outline-none ' +
        'focus-visible:ring-2 focus-visible:ring-primary-400 focus-visible:ring-offset-1 ' +
        (isActive ? 'border-primary-600 bg-primary-500 text-white hover:bg-primary-500 ' : '') +
        (className ?? '')
      }
    >
      {n}
    </button>
  );
}
