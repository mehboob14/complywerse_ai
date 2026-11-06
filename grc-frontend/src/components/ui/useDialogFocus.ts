'use client';

// Keyboard focus for a dialog or a drawer, once, for both overlays (AnimatedModal and RightSlidePanel; the vendor Dialog sits on AnimatedModal):
//  - it opens: the element that had focus is remembered and focus moves in (unless a field inside took it already, an autoFocus)
//  - while it is open: Tab and Shift+Tab wrap inside it
//  - it closes: focus goes back to the element that opened it, if that is still on the page and focus has not been put somewhere on purpose
// The decisions are pure functions in dialogFocus.ts (node --test); this file applies them to the page.
import { useEffect, useState, type RefObject } from 'react';
import { AUTOFOCUS, FIELD, TABBABLE, focusIsElsewhere, initialFocusTarget, nextFocusIndex, visibleOnly } from './dialogFocus';

const visible = (root: HTMLElement, selector: string) => visibleOnly(root.querySelectorAll<HTMLElement>(selector));

/** Focus the element a dialog starts on: what a caller marked data-autofocus, else the first field, else the first button, else the dialog itself
 *  (on a touch screen, a marked element or the dialog itself: no on-screen keyboard just because a dialog opened). */
export function focusInto(dialog: HTMLElement): void {
  const touch = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  initialFocusTarget<HTMLElement>(
    { autofocus: visible(dialog, AUTOFOCUS), fields: visible(dialog, FIELD), buttons: visible(dialog, 'button:not(:disabled)') },
    dialog,
    touch,
  ).focus({ preventScroll: true });
}

/**
 * `open` is the caller's own state; `mounted` says the dialog element exists (AnimatedModal mounts it a frame after `open` and keeps it for
 * its exit animation; a drawer is there whenever it is open). `dialogRef` is the element with role="dialog": give it tabIndex={-1}, it takes
 * focus when it holds nothing else to focus.
 */
export function useDialogFocus(open: boolean, dialogRef: RefObject<HTMLElement>, mounted: boolean = open): void {
  // What had focus when this component first rendered: the opener of a dialog that is mounted already open (`{show && <AnimatedModal isOpen …/>}`),
  // whose own autoFocus field takes focus before any effect runs.
  const [firstActive] = useState<Element | null>(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const now = document.activeElement;
    const opener = dialog && now && dialog.contains(now) ? firstActive : now;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const el = dialogRef.current;
      if (!el) return;
      const active = document.activeElement;
      if (focusIsElsewhere(el, active, document.body)) return;                   // a menu or a dialog drawn over this one: it handles Tab
      const items = visible(el, TABBABLE);
      if (items.length === 0) { e.preventDefault(); el.focus({ preventScroll: true }); return; }
      const to = nextFocusIndex(items.length, active ? items.indexOf(active as HTMLElement) : -1, e.shiftKey);
      if (to === null) return;                                                    // not at an end: the browser's own move stays inside
      e.preventDefault();
      items[to].focus({ preventScroll: true });
    };
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      const here = document.activeElement;
      const lost = !here || here === document.body || !!dialogRef.current?.contains(here);       // else the page put focus somewhere on purpose
      if (lost && opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref and the first-render opener never change
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && mounted && dialog && !dialog.contains(document.activeElement)) focusInto(dialog);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref never changes
  }, [open, mounted]);
}
