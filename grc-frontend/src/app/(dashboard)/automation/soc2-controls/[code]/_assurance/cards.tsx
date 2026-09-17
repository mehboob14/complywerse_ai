'use client';

// Building blocks for the one-screen tabs on a control: a summary card that
// states where a topic stands, and the side panel that opens with the full,
// working detail. A tab then fits on one screen and nothing is more than one
// click away.

import { ChevronRight } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';

export function SummaryCard({
  title, meta, action, onAction, className = '', children,
}: {
  title: string;
  meta?: React.ReactNode;
  action?: string;
  onAction?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`flex min-h-[12.5rem] min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        {meta && <div className="shrink-0 text-xs text-slate-500">{meta}</div>}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {action && onAction && (
        <button type="button" onClick={onAction}
          className="mt-3 inline-flex items-center gap-0.5 self-start text-xs font-semibold text-primary-700 hover:text-primary-800">
          {action}<ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </section>
  );
}

export function DetailPanel({
  open, onClose, title, subtitle, wide = false, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title={title} subtitle={subtitle}
      width={wide ? 'w-full max-w-4xl' : 'w-full max-w-2xl'}>
      {open ? children : null}
    </RightSlidePanel>
  );
}

/** A small count with a coloured dot, for "3 missing · 1 pending" style lines. */
export function Tally({ n, label, dot }: { n: number; label: string; dot: string }) {
  if (!n) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-slate-600">
      <span className={`size-1.5 rounded-full ${dot}`} />
      <span className="font-semibold tabular-nums text-slate-800">{n}</span>{label}
    </span>
  );
}
