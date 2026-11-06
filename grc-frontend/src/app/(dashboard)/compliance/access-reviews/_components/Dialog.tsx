'use client';
// A modal dialog or a side drawer that behaves like one for the keyboard and for screen
// readers: it is labelled, it takes focus when it opens and gives it back when it closes,
// Tab stays inside it, Escape closes it, and the page behind does not scroll.

import { clsx } from 'clsx';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FOCUS } from './ui';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement | null) =>
  root ? Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement) : [];

export function Dialog({ open, onClose, title, description, children, footer, side = false, width = 'max-w-2xl', busy = false }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode;
  /** a drawer on the right instead of a centred modal */
  side?: boolean; width?: string;
  /** while something is saving, Escape and the backdrop do not close it */
  busy?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // the panel is in the DOM by the time this runs, so focus can move now (not a frame later)
    const el = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(panel.current)[0] ?? panel.current;
    el?.focus();
    return () => {
      document.body.style.overflow = overflow;
      opener?.focus?.();                       // back to the control that opened it
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && !busy) { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const nodes = focusables(panel.current);
    if (!nodes.length) { e.preventDefault(); return; }
    const first = nodes[0]; const last = nodes[nodes.length - 1]; const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };

  return createPortal(
    // It is portalled out of the page, so it re-enters the platform's colour scope (and the module's darker muted text).
    <div className={clsx('platform-ui cw-dashboard [--color-muted:#586472] fixed inset-0 z-50 flex', side ? 'justify-end' : 'items-center justify-center p-4')}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      style={{ background: 'var(--color-overlay)' }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descId : undefined}
        tabIndex={-1} onKeyDown={onKeyDown}
        className={clsx('flex flex-col bg-white shadow-2xl outline-none',
          side ? 'h-full w-full border-l border-slate-200' : 'max-h-full w-full rounded-xl border border-slate-200', width)}>
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-slate-900">{title}</h2>
            {description && <p id={descId} className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label={`Close ${title}`}
            className={clsx('flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 disabled:opacity-50', FOCUS)}>
            <X size={18} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
