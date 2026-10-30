'use client';

// The two heads of a Vendors page: the module header (icon, title, one line of facts, actions) on every portfolio page, and the
// record header (back link, tile, title, chips, meta, actions) on a drill-down page. Verity's layouts in Compliverse's colours;
// the D41 charter: no intro sentence (an optional (i) holds the explanation), the title and a line of facts.
// Headings: inside the dashboard shell the platform CSS sets every h1 to 17px and every h2 to 15.6px whatever class they carry (the
// rules out-rank a utility). The module title keeps that scale like every other module's; the record's own name is the page's
// headline, so it takes `!` to stand out.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowLeft, type LucideIcon } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';

export function ModuleHeader({ icon: Icon, title, stats, actions, info }: {
  icon: LucideIcon;
  title: string;
  /** facts, not prose: "12 vendors · 2 critical · 1 open finding" */
  stats?: string;
  actions?: ReactNode;
  /** the explanation, shown from an (i) beside the title (added to the contract) */
  info?: string;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e6f6f3] text-[#0f766e]">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h1 className="truncate text-[17px] font-semibold leading-6 text-[#1f2933]">{title}</h1>
            {info && <InfoTip text={info} label={`About ${title}`} />}
          </div>
          {stats && <p className="text-[13px] leading-5 text-[#586472]">{stats}</p>}
        </div>
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function DetailHeader({ backHref, backLabel, icon: Icon, logo, title, chips, meta, actions }: {
  backHref: string;
  /** "Back to vendors": worded like the page it goes back to */
  backLabel: string;
  /** the kind of record, in a 48px tile beside the title */
  icon?: LucideIcon;
  /** a logo (e.g. the vendor's) in place of the icon tile */
  logo?: ReactNode;
  title: string;
  /** status pills and badges, under the title */
  chips?: ReactNode;
  /** one line of context under the chips */
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header>
      <Link
        href={backHref}
        className="-ml-1.5 mb-3 inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-[#586472] hover:bg-[#e4e9ee] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
      >
        <ArrowLeft aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        {backLabel}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-[16rem] items-start gap-3.5">
          {(logo || Icon) && (
            // arbitrary 48px: the platform's compact density shrinks `h-12 w-12` to 40px
            <span className={clsx('flex h-[48px] w-[48px] shrink-0 items-center justify-center', !logo && 'rounded-lg bg-[#e6f6f3] text-[#0f766e]')}>
              {logo ?? (Icon && <Icon aria-hidden className="h-6 w-6" strokeWidth={1.75} />)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="break-words !text-[22px] font-semibold leading-7 text-[#1f2933]">{title}</h1>
            {chips && <div className="mt-2 flex flex-wrap items-center gap-2">{chips}</div>}
            {meta && <div className="mt-1.5 text-[13px] leading-5 text-[#586472]">{meta}</div>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
