'use client';

// The explorer's keyboard layer, on the page: "/" searches, j / k move the cursor row, Enter opens it, Escape closes or clears. What each key means, and when it must not act, is
// explorerModel.keyAction (tested); this reads where the key was pressed and calls the page. It listens on the document, so it stays out of every field, menu and dialog by
// asking where the event came from, and it takes the key only when the model says so (everything else keeps its own behaviour).
import { useEffect, useRef } from 'react';
import { keyAction, type KeyAction, type KeyPlace } from './explorerModel';

export interface ExplorerKeyHandlers {
  onSearch: () => void;
  onMove: (dir: 1 | -1) => void;
  onOpen: () => void;
  onEscape: () => void;
}

const FIELD = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';
const OVERLAY = '[role="menu"], [role="dialog"], [role="listbox"], [role="combobox"], [aria-modal="true"]';
const CONTROL = 'button, a[href], summary, [role="tab"], [role="menuitem"], [role="checkbox"], tr[tabindex]';

export function placeOf(target: EventTarget | null): KeyPlace {
  if (!(target instanceof Element)) return 'page';
  if (target.closest(FIELD)) return 'field';
  if (target.closest(OVERLAY)) return 'overlay';
  if (target.closest(CONTROL)) return 'control';
  return 'page';
}

/** A panel or dialog is open over the page: its keys are its own. */
export const overlayIsOpen = (): boolean => typeof document !== 'undefined' && !!document.querySelector('[aria-modal="true"], [role="menu"]');

export function useExplorerKeys(handlers: ExplorerKeyHandlers, enabled = true): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const action: KeyAction = keyAction(
        { key: e.key, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, defaultPrevented: e.defaultPrevented, composing: e.isComposing },
        placeOf(e.target),
        overlayIsOpen(),
      );
      if (!action) return;
      const h = latest.current;
      if (action === 'search') { e.preventDefault(); h.onSearch(); }
      else if (action === 'next') { e.preventDefault(); h.onMove(1); }
      else if (action === 'previous') { e.preventDefault(); h.onMove(-1); }
      else if (action === 'open') { e.preventDefault(); h.onOpen(); }
      else if (action === 'escape') h.onEscape();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
