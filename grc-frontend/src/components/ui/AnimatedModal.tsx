'use client';

/**
 * AnimatedModal — a centered, scrim-backed modal with a smooth enter/exit
 * (scrim fades, panel fades + scales). The app has no framer-motion, so this is
 * pure CSS transitions driven by a mount/show state machine (so the exit animation
 * actually plays before unmount). Escape-to-close + backdrop click + body-scroll lock.
 *
 * Charter: white surface, rounded-xl, single-teal accents, hairline borders,
 * shadow from the modal set — no gradients.
 */
import { useEffect, useState, useRef } from 'react';
import { X } from 'lucide-react';

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
}: AnimatedModalProps) {
  const [render, setRender] = useState(isOpen);
  const [show, setShow] = useState(false);
  const rafRef = useRef<number | null>(null);

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

  // Escape to close + lock body scroll while open
  useEffect(() => {
    if (!render) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [render, onClose]);

  if (!render) return null;

  return (
    <div
      className={`fixed inset-0 z-[60] flex items-center justify-center p-4 transition-opacity duration-200 ${show ? 'opacity-100' : 'opacity-0'}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex max-h-[90vh] w-full ${MAX_W[size]} flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${show ? 'scale-100 opacity-100' : 'scale-95 opacity-0'} ${className}`}
      >
        {!bareHeader && (
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
            <div className="min-w-0">
              {title && <div className="truncate text-base font-semibold text-slate-900">{title}</div>}
              {subtitle && <div className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</div>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {headerAccessory}
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">{children}</div>
        {footer && <div className="border-t border-slate-100 bg-slate-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export default AnimatedModal;
