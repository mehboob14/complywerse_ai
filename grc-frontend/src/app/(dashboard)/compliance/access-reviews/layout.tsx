'use client';
// src/app/(dashboard)/compliance/access-reviews/layout.tsx
// Module shell for the whole Access Reviews workspace: a dark "ops console"
// header + persistent tab bar (Reviews / Sources / Rule library), replacing
// the old per-page back-link navigation. Wraps page.tsx, [id]/page.tsx,
// connect/page.tsx and rules/page.tsx.
//
// Scoping strategy (no shared/global file touched): CSS custom properties
// are set via inline `style` on the root node, so they cascade to every
// descendant without a global stylesheet. `-m-4 lg:-m-5` exactly cancels
// (dashboard)/layout.tsx's `<main>` padding (`p-4 lg:p-5`) so this module
// runs full-bleed within the content area; every other route is untouched.

import { usePathname, useRouter } from 'next/navigation';
import { ShieldCheck, Plug, ListChecks, ChevronLeft } from 'lucide-react';
import { useDashboard } from './api';

const BASE = '/compliance/access-reviews';
const TABS = [
  { key: 'reviews', label: 'Reviews', href: BASE, Icon: ShieldCheck },
  { key: 'sources', label: 'Sources', href: `${BASE}/connect`, Icon: Plug },
  { key: 'rules', label: 'Rule library', href: `${BASE}/rules`, Icon: ListChecks },
] as const;

// The module's own design tokens — deliberately distinct from the platform's
// teal brand (this module opted out of the shared design system). Data
// surfaces (tables, drawers, severity/decision badges) stay light so nothing
// here changes readability of the unmodified pipeline.ts color helpers.
const CONSOLE_VARS = {
  '--ar-shell': '#12141B',
  '--ar-shell-alt': '#1C1F2A',
  '--ar-shell-border': '#272B38',
  '--ar-shell-text': '#ECEDF2',
  '--ar-shell-muted': '#9297AA',
  '--ar-accent': '#6366F1',
  '--ar-accent-strong': '#4F46E5',
  '--ar-accent-soft': '#EEF0FF',
  '--ar-surface': '#FFFFFF',
  '--ar-surface-alt': '#F4F5F8',
  '--ar-border': '#E3E5EC',
  '--ar-text': '#15171E',
  '--ar-text-muted': '#676C7C',
  // CSS custom properties aren't named keys on React.CSSProperties, so a
  // direct `as` cast can be rejected as a non-overlapping type; go through
  // `unknown` first (the standard idiom for this).
} as unknown as React.CSSProperties;

export default function AccessReviewsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const router = useRouter();
  const { data: dash } = useDashboard();

  const activeKey = pathname.startsWith(`${BASE}/connect`) ? 'sources'
    : pathname.startsWith(`${BASE}/rules`) ? 'rules'
    : 'reviews'; // the list AND the /[id] detail both live under "Reviews"
  const isDetail = /^\/compliance\/access-reviews\/\d+/.test(pathname);

  return (
    <div data-ar-console="" className="-m-4 lg:-m-5" style={CONSOLE_VARS}>
      <div className="sticky top-0 z-30" style={{ background: 'var(--ar-shell)', borderBottom: '1px solid var(--ar-shell-border)' }}>
        <div className="flex items-center gap-5 px-6 pt-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--ar-accent)' }}>
              <ShieldCheck size={15} className="text-white" />
            </div>
            <span className="text-[14px] font-bold tracking-tight" style={{ color: 'var(--ar-shell-text)' }}>Access Reviews</span>
          </div>
          {dash && (
            <div className="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:flex" style={{ background: 'var(--ar-shell-alt)', color: 'var(--ar-shell-muted)' }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: dash.campaigns_total ? '#34D399' : '#5B6072' }} />
              {dash.campaigns_total} review{dash.campaigns_total === 1 ? '' : 's'} · {dash.findings_open} open finding{dash.findings_open === 1 ? '' : 's'}
            </div>
          )}
          <nav className="ml-auto flex items-center gap-1">
            {TABS.map((t) => {
              const active = activeKey === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => router.push(t.href)}
                  className="flex items-center gap-1.5 rounded-t-lg px-3.5 py-2.5 text-[12.5px] font-semibold transition-colors"
                  style={active
                    ? { background: 'var(--ar-surface-alt)', color: 'var(--ar-text)' }
                    : { color: 'var(--ar-shell-muted)' }}
                >
                  <t.Icon size={14} /> {t.label}
                </button>
              );
            })}
          </nav>
        </div>
        {isDetail && (
          <div className="flex items-center gap-1.5 px-6 py-2 text-[12px] font-medium" style={{ background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}>
            <button onClick={() => router.push(BASE)} className="inline-flex items-center gap-1 hover:text-[color:var(--ar-text)]">
              <ChevronLeft size={13} /> Reviews
            </button>
          </div>
        )}
      </div>
      <div className="min-h-[70vh]" style={{ background: 'var(--ar-surface-alt)' }}>
        {children}
      </div>
    </div>
  );
}
