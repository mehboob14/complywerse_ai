'use client';

// The frames the Vendors pages put content in: a panel (title, count, action), a chart card (centred title), and the states of a
// view that has nothing to show or failed. White cards with the library's hairline; explicit hex (platform CSS repaints slate/white).
import { useId, type ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { BTN } from './buttons';
import { TONE } from './tones';

/** A bordered card: title with a grey count, an action on the right, an optional grey description line, then the content. */
export function Panel({ title, count, description, action, children, className, info, flush = false }: {
  title: string;
  count?: number;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** the explanation, shown from an (i) beside the title (added to the contract) */
  info?: string;
  /** no padding round the content, for a table or a list that runs edge to edge (added to the contract) */
  flush?: boolean;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={clsx('rounded-xl border border-[#d5dbe1] bg-[#fff]', className)}>
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 pt-4">
        <div className="flex min-w-0 items-center gap-2">
          <h2 id={id} className="text-[15px] font-semibold leading-6 text-[#1f2933]">{title}</h2>
          {count != null && <span className="text-[13px] font-medium tabular-nums text-[#64707e]">{count}</span>}
          {info && <InfoTip text={info} label={`About ${title}`} />}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      {description && <p className="px-5 pt-0.5 text-[13px] leading-5 text-[#64707e]">{description}</p>}
      <div className={flush ? 'pt-3' : 'px-5 pb-5 pt-3'}>{children}</div>
    </section>
  );
}

/** The card a chart or a dashboard number sits in: the title centred on top, a link to the right of it. */
export function ChartCard({ title, link, children, className, info }: {
  title: string;
  link?: { href: string; label: string };
  children: ReactNode;
  className?: string;
  /** the explanation, shown from an (i) beside the title (added to the contract) */
  info?: string;
}) {
  return (
    <section className={clsx('rounded-xl border border-[#d5dbe1] bg-[#fff] p-5', className)}>
      <header className="relative mb-4 flex min-h-6 items-center justify-center">
        <div className={clsx('flex items-center justify-center gap-1.5', link && 'px-16')}>
          <h2 className="text-center text-[15px] font-semibold leading-6 text-[#1f2933]">{title}</h2>
          {info && <InfoTip text={info} label={`About ${title}`} />}
        </div>
        {link && (
          <Link
            href={link.href}
            className="absolute right-0 top-1/2 -translate-y-1/2 rounded-sm text-[13px] font-medium text-[#0f766e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          >
            {link.label}
          </Link>
        )}
      </header>
      {children}
    </section>
  );
}

/** Nothing here yet: an icon, a few words, and the one button that fills it. */
export function EmptyState({ title, hint, action, icon: Icon = Inbox, bare = false }: {
  title: string;
  hint?: string;
  action?: ReactNode;
  /** the icon above the title (added to the contract) */
  icon?: LucideIcon;
  /** no border or fill, for use inside a Panel that already has them (added to the contract) */
  bare?: boolean;
}) {
  return (
    <div className={clsx('flex flex-col items-center justify-center px-6 py-10 text-center', !bare && 'rounded-xl border border-dashed border-[#c3ccd5] bg-[#fff]')}>
      <span aria-hidden className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-[#f3f6f8] text-[#64707e]">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3 className="text-[15px] font-semibold leading-5 text-[#1f2933]">{title}</h3>
      {hint && <p className="mt-1 max-w-sm text-[13px] leading-5 text-[#586472]">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A view that could not load. "Try again" only when trying again can help; the reference id only when the server gave one. */
export function ErrorState({ title = "Couldn't load this view", message, reference, onRetry }: {
  title?: string;
  message?: string;
  reference?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-[#d5dbe1] bg-[#fff] px-6 py-10 text-center">
      <span aria-hidden className="mb-3 grid h-10 w-10 place-items-center rounded-lg" style={{ background: TONE.danger.tint, color: TONE.danger.text }}>
        <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h2 className="text-[15px] font-semibold leading-6 text-[#1f2933]">{title}</h2>
      {message && <p className="mt-1 max-w-md text-[13px] leading-5 text-[#586472]">{message}</p>}
      {onRetry && <button type="button" onClick={onRetry} className={clsx(BTN, 'mt-4')}>Try again</button>}
      {reference && <p className="mt-3 text-[12px] leading-4 text-[#64707e]">Reference: <span className="tabular-nums">{reference}</span></p>}
    </div>
  );
}

/** A grey block that pulses while a view loads (no text: the D41 charter). Size it with className. Added to the contract. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-lg bg-[#e1e6eb]', className)} />;
}
