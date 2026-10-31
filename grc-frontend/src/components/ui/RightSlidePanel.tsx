'use client';

import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { focusIsElsewhere, overlayTakesEscape } from './dialogFocus';
import { useDialogFocus } from './useDialogFocus';
import { lockBodyScroll } from './scrollLock';
import { DiscardBar, useDiscardGuard } from './ds/DiscardBar';

export interface RightSlidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  /** Width class, defaults to 'w-full max-w-xl' */
  width?: string;
  /** Deprecated alias for width; kept for backward compatibility */
  widthClassName?: string;
  /** Footer slot rendered at the bottom of the panel */
  footer?: React.ReactNode;
  /** False: a click on the backdrop does nothing (not even ask). True (the default): it closes the panel, or asks when `dirty`. */
  closeOnBackdrop?: boolean;
  /** The caller holds typed input. Escape, the X button and a click on the backdrop then show "Discard changes?" instead of closing;
   *  Keep editing goes back, Discard calls `onClose`. */
  dirty?: boolean;
  discardLabel?: string;
  keepLabel?: string;
}

export function RightSlidePanel({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  width = 'w-full max-w-xl',
  widthClassName,
  footer,
  closeOnBackdrop = true,
  dirty = false,
  discardLabel = 'Discard',
  keepLabel = 'Keep editing',
}: RightSlidePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const subtitleId = useId();
  useDialogFocus(isOpen, panelRef);
  const { asking, requestClose, keep, discard } = useDiscardGuard({ open: isOpen, dirty, closeOnBackdrop, onClose, dialogRef: panelRef });

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      // a list inside handled it (defaultPrevented), or a menu, a preview or a dialog drawn over this one holds focus: Escape is that layer's, one layer per press
      const elsewhere = panelRef.current ? focusIsElsewhere(panelRef.current, document.activeElement, document.body) : false;
      if (!overlayTakesEscape({ key: e.key, defaultPrevented: e.defaultPrevented, focusElsewhere: elsewhere })) return;
      e.preventDefault();  // taken: an overlay under this one, whose listener may run after this one, must not take it too
      requestClose('escape');
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, dirty, requestClose]);

  // Prevent body scroll while open
  useEffect(() => (isOpen ? lockBodyScroll() : undefined), [isOpen]);

  // Portal to <body> so ancestor styles (e.g. .governance-light .fixed.inset-0
  // width/padding/centering rules) and containing blocks cannot distort the
  // full-viewport backdrop or right-docked panel.
  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex justify-end"
      data-right-slide-panel=""
    >
      {/* Backdrop — full viewport; must remain unconstrained */}
      <div
        className="absolute inset-0 bg-black/40 transition-opacity"
        onClick={() => requestClose('backdrop')}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        className={clsx(
          'relative flex h-full flex-col bg-white shadow-2xl transition-transform duration-300 focus:outline-none',
          widthClassName || width,
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 id={titleId} className="text-lg font-semibold text-gray-900">{title}</h2>
            {subtitle && (
              <p id={subtitleId} className="mt-0.5 text-sm text-gray-500">{subtitle}</p>
            )}
          </div>
          <button
            onClick={() => requestClose('close-button')}
            className="ml-4 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {asking && <DiscardBar keepLabel={keepLabel} discardLabel={discardLabel} onKeep={keep} onDiscard={discard} />}

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-gray-200 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
