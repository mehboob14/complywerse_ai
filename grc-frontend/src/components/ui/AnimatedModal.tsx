'use client';

/**
 * AnimatedModal — a centered, scrim-backed modal with a smooth enter/exit
 * (scrim fades, panel fades + scales). The app has no framer-motion, so this is
 * pure CSS transitions driven by a mount/show state machine (so the exit animation
 * actually plays before unmount). Escape-to-close + body-scroll lock. Keyboard focus moves in when it opens,
 * wraps inside it, and goes back to what opened it (useDialogFocus); `dirty` asks before Escape or X throws typed input away.
 *
 * Charter: white surface, rounded-xl, single-teal accents, hairline borders,
 * shadow from the modal set — no gradients.
 */
import { useEffect, useId, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { focusIsElsewhere, overlayTakesEscape } from './dialogFocus';
import { useDialogFocus } from './useDialogFocus';
import { lockBodyScroll } from './scrollLock';
import { DiscardBar, useDiscardGuard } from './ds/DiscardBar';

const MAX_W: Record<string, string> = {
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-5xl',
  '3xl': 'max-w-6xl',
};

export interface AnimatedModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerAccessory?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  children: React.ReactNode;
  /** Hide the default header (caller renders its own). */
  bareHeader?: boolean;
  className?: string;
  /** With `bareHeader`: the id of the element in `children` that names the dialog (the default header's title names it otherwise). */
  labelledBy?: string;
  /** With `bareHeader`: the id of the element that describes the dialog (the default header's subtitle otherwise). */
  describedBy?: string;
  /** False: a press on the dim area does nothing, not even ask. True (the default) leaves it as it was: a press there closed nothing
   *  (the dim layer covers the container the old check looked for); with `dirty` it asks. */
  closeOnBackdrop?: boolean;
  /** The caller holds typed input. Escape, the X button and a press on the dim area then show "Discard changes?" instead of closing;
   *  Keep editing goes back, Discard calls `onClose`. */
  dirty?: boolean;
  discardLabel?: string;
  keepLabel?: string;
}

export function AnimatedModal({
  isOpen,
  onClose,
  title,
  subtitle,
  headerAccessory,
  footer,
  size = 'xl',
  children,
  bareHeader = false,
  className = '',
  labelledBy,
  describedBy,
  closeOnBackdrop = true,
  dirty = false,
  discardLabel = 'Discard',
  keepLabel = 'Keep editing',
}: AnimatedModalProps) {
  const [render, setRender] = useState(isOpen);
  const [show, setShow] = useState(false);
  const rafRef = useRef<number | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useDialogFocus(isOpen, dialogRef, render);
  const { asking, requestClose, keep, discard } = useDiscardGuard({ open: isOpen, dirty, closeOnBackdrop, onClose, dialogRef });

  useEffect(() => {
    if (isOpen) {
      setRender(true);
      // next frame → flip to the shown state so the enter transition plays
      rafRef.current = requestAnimationFrame(() => setShow(true));
      return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }
    setShow(false);
    const t = setTimeout(() => setRender(false), 200);
    return () => clearTimeout(t);
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!render) return;
    const onKey = (e: KeyboardEvent) => {
      // a list inside handled it (defaultPrevented), or a menu, a preview or a drawer drawn over this one holds focus: Escape is that layer's, one layer per press
      const elsewhere = dialogRef.current ? focusIsElsewhere(dialogRef.current, document.activeElement, document.body) : false;
      if (!overlayTakesEscape({ key: e.key, defaultPrevented: e.defaultPrevented, focusElsewhere: elsewhere })) return;
      e.preventDefault();  // taken: an overlay under this one, whose listener may run after this one, must not take it too
      requestClose('escape');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [render, dirty, requestClose]);

  // lock body scroll while open (its own effect: it must not be undone and redone each time the listener above is re-attached)
  useEffect(() => (render ? lockBodyScroll() : undefined), [render]);

  // Rendered inline in the tree, this fixed-position overlay is at the mercy of
  // any ancestor that establishes a containing block (transform/filter/sticky
  // scroll contexts) — which distorts it. Portal to <body> so it is always
  // viewport-anchored regardless of where it is mounted.
  if (!render || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
      // only a press on this container itself ever counted, and the scrim covers it, so a press on the dim area closed nothing; `dirty` makes it ask
      onMouseDown={(e) => { if (e.target === e.currentTarget || (dirty && e.target === scrimRef.current)) requestClose('backdrop'); }}
    >
      <div
        ref={scrimRef}
        className="absolute inset-0"
        style={{
          backgroundColor: 'rgba(15, 23, 42, 0.45)',
          backdropFilter: 'blur(3px)',
          WebkitBackdropFilter: 'blur(3px)',
        }}
        aria-hidden
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? (!bareHeader && title ? titleId : undefined)}
        aria-describedby={describedBy ?? (!bareHeader && subtitle ? subtitleId : undefined)}
        tabIndex={-1}
        className={`relative flex max-h-[90vh] w-full ${MAX_W[size]} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 focus:outline-none ${show ? 'scale-100 opacity-100' : 'scale-95 opacity-0'} ${className}`}
      >
        {!bareHeader && (
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
            <div className="min-w-0">
              {title && <div id={titleId} className="truncate text-base font-semibold text-slate-900">{title}</div>}
              {subtitle && <div id={subtitleId} className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAccessory}
              <button
                onClick={() => requestClose('close-button')}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
        {asking && <DiscardBar keepLabel={keepLabel} discardLabel={discardLabel} onKeep={keep} onDiscard={discard} />}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export default AnimatedModal;
