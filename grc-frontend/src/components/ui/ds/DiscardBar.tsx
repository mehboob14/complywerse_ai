'use client';

// "Discard changes?": the bar a dialog or a drawer shows when Escape, the X button or a click outside would throw away typed input
// (the `dirty` prop of AnimatedModal and RightSlidePanel). useDiscardGuard holds the state and the focus; DiscardBar is the bar.
// Written with the design-system tokens only (kitGuard.test.ts checks it), because the legacy classes of the two overlays around it are not.
import { useEffect, useRef, useState, type RefObject } from 'react';
import { FIELD, closeAction, type CloseSource } from '../dialogFocus';
import { focusInto } from '../useDialogFocus';

export function useDiscardGuard({ open, dirty, closeOnBackdrop, onClose, dialogRef }: {
  open: boolean;
  dirty: boolean;
  closeOnBackdrop: boolean;
  onClose: () => void;
  dialogRef: RefObject<HTMLElement>;
}) {
  const [asking, setAsking] = useState(false);
  const shown = asking && dirty;                                    // with nothing left to lose the question goes away
  const before = useRef<Element | null>(null);                      // what had focus when the question came up
  const wasShown = useRef(false);

  useEffect(() => { if (!open || !dirty) setAsking(false); }, [open, dirty]);

  // the question went away and the dialog is still open: focus goes back to where the typing was
  useEffect(() => {
    const dialog = dialogRef.current;
    if (wasShown.current && !shown && open && dialog) {
      const prev = before.current;
      if (prev instanceof HTMLElement && prev.isConnected && dialog.contains(prev) && prev.matches(FIELD)) prev.focus({ preventScroll: true });
      else focusInto(dialog);
    }
    wasShown.current = shown;
  }, [shown, open, dialogRef]);

  /** Escape, the X button or a click on the backdrop: close, ask first, or go back to editing, as closeAction decides. */
  const requestClose = (source: CloseSource) => {
    const action = closeAction({ dirty, asking: shown, closeOnBackdrop }, source);
    if (action === 'close') onClose();
    else if (action === 'ask' && open) { if (!shown) before.current = document.activeElement; setAsking(true); }     // not while it fades out
    else if (action === 'keep') setAsking(false);
  };

  return { asking: shown, requestClose, keep: () => setAsking(false), discard: () => { setAsking(false); onClose(); } };
}

const BUTTON = 'inline-flex h-ds-control items-center rounded-ds-control px-[12px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring';

export function DiscardBar({ message = 'Discard changes?', keepLabel = 'Keep editing', discardLabel = 'Discard', onKeep, onDiscard }: {
  message?: string;
  keepLabel?: string;
  discardLabel?: string;
  onKeep: () => void;
  onDiscard: () => void;
}) {
  return (
    <div role="alert" className="flex shrink-0 flex-wrap items-center justify-between gap-[8px] border-b border-ds-danger-border bg-ds-danger-soft px-[16px] py-[8px]">
      <span className="text-ds-body text-ds-fg">{message}</span>
      <span className="flex items-center gap-[8px]">
        <button type="button" autoFocus onClick={onKeep} className={`${BUTTON} bg-ds-primary text-ds-on-primary hover:bg-ds-primary-hover`}>{keepLabel}</button>
        <button type="button" onClick={onDiscard} className={`${BUTTON} border border-ds-danger-border bg-ds-surface text-ds-danger hover:bg-ds-danger-soft`}>{discardLabel}</button>
      </span>
    </div>
  );
}
