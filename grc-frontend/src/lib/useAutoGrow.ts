'use client';

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

/** what a message box measures, in px: `content` is its text with the padding (a copy's scrollHeight) */
export interface GrowInput { content: number; line: number; padding: number; border: number; rows: number; minHeight: number; room: number }

const MAX_LINES = 10;
const ROOM_SHARE = 0.4;

/** The box's height: what its text needs, never below its own empty height (its rows or CSS min-height) and never above
 *  10 lines or 40% of the window (`room`), whichever is less; past that it stops growing and scrolls inside. */
export function growHeight({ content, line, padding, border, rows, minHeight, room }: GrowInput): { height: number; scrolls: boolean } {
  const lines = (n: number) => n * line + padding + border;
  const floor = Math.max(lines(rows), minHeight);
  const cap = Math.max(floor, Math.min(lines(MAX_LINES), Math.floor(room * ROOM_SHARE)));
  const need = Math.ceil(content + border);
  return { height: Math.min(Math.max(need, floor), cap), scrolls: need > cap };
}

const px = (v: string) => parseFloat(v) || 0;

/** fits the box to its text; true when its height changed. Assumes border-box sizing (Tailwind's preflight). */
function fit(box: HTMLTextAreaElement): boolean {
  if (!box.offsetWidth) return false;                       // not on screen (a hidden tab): fitted once it shows
  const cs = getComputedStyle(box);
  // measured on a hidden copy, so nothing else on the page moves meanwhile (a chat's message list keeps its scroll position)
  const copy = box.cloneNode() as HTMLTextAreaElement;
  copy.removeAttribute('placeholder');
  copy.style.cssText += `;position:absolute;visibility:hidden;height:0;min-height:0;overflow:hidden;width:${cs.width}`;
  copy.value = box.value;
  box.after(copy);
  const content = copy.scrollHeight;
  copy.remove();
  const { height, scrolls } = growHeight({
    content,
    line: px(cs.lineHeight) || px(cs.fontSize) * 1.2,
    padding: px(cs.paddingTop) + px(cs.paddingBottom),
    border: px(cs.borderTopWidth) + px(cs.borderBottomWidth),
    rows: box.rows,
    minHeight: px(cs.minHeight),
    room: window.innerHeight,
  });
  const before = box.style.height;
  box.style.height = `${height}px`;
  box.style.overflowY = scrolls ? 'auto' : 'hidden';
  return box.style.height !== before;
}

/**
 * A message box to an assistant that grows with its text — typed, pasted or put there by the page (a suggestion, a draft,
 * cleared after sending) — from its own height up to the cap of `growHeight`, then scrolls inside. It refits when its width
 * changes (window, side panel, a tab shown again). `onResize` runs after its height changed. Don't give the box a CSS
 * max-height or height: the hook sets them.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement>, value: string, onResize?: () => void) {
  const [box, setBox] = useState<HTMLTextAreaElement | null>(null);
  const resized = useRef(onResize);
  resized.current = onResize;
  // follows the box as it mounts and unmounts (a tab that renders it again with its text): set only when it is another element
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (ref.current !== box) setBox(ref.current); });
  useLayoutEffect(() => { if (box && fit(box)) resized.current?.(); }, [box, value]);
  useEffect(() => {
    if (!box || typeof ResizeObserver === 'undefined') return;
    let width = box.offsetWidth;
    // a frame later: changing the height inside the observer's own callback is reported as a loop
    const watch = new ResizeObserver(() => requestAnimationFrame(() => {
      if (box.offsetWidth === width) return;
      width = box.offsetWidth;
      if (fit(box)) resized.current?.();
    }));
    watch.observe(box);
    return () => watch.disconnect();
  }, [box]);
}
