'use client';

// The Vendors pages' centred dialog: the platform's own portal modal (AnimatedModal: scrim, Escape, backdrop click, scroll lock)
// with a title row and a pinned footer. AnimatedModal draws the box but names nothing and keeps focus nowhere, so this also names it
// for screen readers, puts focus inside, keeps Tab inside, and hands focus back to what opened it.
import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';

// the widths are literal so Tailwind sees them; `!` beats AnimatedModal's own max-w
const WIDTH = {
  480: { size: 'md', cls: '!max-w-[480px]' },
  600: { size: 'lg', cls: '!max-w-[600px]' },
  720: { size: 'lg', cls: '!max-w-[720px]' },
  1080: { size: '2xl', cls: '!max-w-[1080px]' },
} as const;

const FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';
const TABBABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({ open, onClose, title, description, size = 480, footer, children, flush = false }: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** width in px; 480 (the default, like Verity's) suits a reason or a confirmation, 600 a form, 720 a form with a side list, 1080 a record */
  size?: 480 | 600 | 720 | 1080;
  /** the buttons, pinned under the scrolling content and aligned right */
  footer?: ReactNode;
  children: ReactNode;
  /** no padding round the content, for a body that lays itself out (added to the contract) */
  flush?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const mark = useRef<HTMLElement | null>(null);

  // runs when the content mounts (AnimatedModal mounts it a frame after `open`): name the dialog, then focus the element marked
  // data-autofocus, else the first field, if focus is not already inside; a dialog with no field gets focus on its close button
  const mount = useCallback((el: HTMLDivElement | null) => {
    mark.current = el;
    const dialog = el?.closest<HTMLElement>('[role="dialog"]');
    if (!el || !dialog) return;
    dialog.setAttribute('aria-labelledby', titleId);
    if (description) dialog.setAttribute('aria-describedby', descId);
    if (!dialog.contains(document.activeElement)) {
      (el.querySelector<HTMLElement>('[data-autofocus]') ?? el.querySelector<HTMLElement>(FIELD) ?? el.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true });
    }
  }, [titleId, descId, description]);

  useEffect(() => {
    if (!open) return undefined;
    const before = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const dialog = mark.current?.closest<HTMLElement>('[role="dialog"]');
      if (!dialog) return;
      const active = document.activeElement;
      const inside = active !== null && dialog.contains(active);
      if (!inside && active !== null && active !== document.body) return;        // focus is in a menu drawn over the dialog: that menu handles Tab
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.getClientRects().length > 0);
      if (items.length === 0) { e.preventDefault(); return; }
      const [first, last] = [items[0], items[items.length - 1]];
      if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, [open]);

  return (
    <AnimatedModal
      isOpen={open}
      onClose={onClose}
      bareHeader
      size={WIDTH[size].size}
      className={WIDTH[size].cls}
      footer={footer ? <div className="flex flex-wrap items-center justify-end gap-2">{footer}</div> : undefined}
    >
      <div ref={mount}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-[#e1e6eb] bg-[#fff] px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[16px] font-semibold leading-6 text-[#1f2933]">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-[13px] leading-5 text-[#586472]">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          >
            <X aria-hidden className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className={clsx(!flush && 'px-5 py-4')}>{children}</div>
      </div>
    </AnimatedModal>
  );
}
