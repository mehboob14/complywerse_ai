'use client';
// Access Reviews: one place to find your way around. The three things you do here are
// listed once, as a navigation landmark, on every page of the module — Reviews (certify and
// report), Sources (where the people and accounts come from) and the Rule library (what gets
// tested) — instead of buttons that only some pages offered.
//
// The platform's muted text colour is 4.3:1 on the page background; inside this module it is a
// shade darker (5.4:1) so secondary text, breadcrumbs and subtitles clear WCAG AA everywhere.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ListChecks, Plug, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { FOCUS } from './_components/ui';

const BASE = '/compliance/access-reviews';
const SECTIONS = [
  { href: BASE, label: 'Reviews', Icon: ShieldCheck, match: (p: string) => p === BASE || p === `${BASE}/new` || /^\/compliance\/access-reviews\/\d+/.test(p) },
  { href: `${BASE}/connect`, label: 'Sources', Icon: Plug, match: (p: string) => p.startsWith(`${BASE}/connect`) },
  { href: `${BASE}/rules`, label: 'Rule library', Icon: ListChecks, match: (p: string) => p.startsWith(`${BASE}/rules`) },
];

export default function AccessReviewsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  return (
    <div className="mx-auto w-full max-w-[1280px] space-y-5 [--color-muted:#586472]">
      <nav aria-label="Access reviews" className="border-b border-slate-200">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {SECTIONS.map(({ href, label, Icon, match }) => {
            const current = match(pathname);
            return (
              <li key={href}>
                <Link href={href} aria-current={current ? 'page' : undefined}
                  className={clsx('inline-flex min-h-[44px] items-center gap-2 whitespace-nowrap border-b-2 px-4 text-sm font-semibold',
                    current ? 'border-teal-700 text-slate-900' : 'border-transparent text-slate-600 hover:text-slate-900', FOCUS)}>
                  <Icon size={16} aria-hidden /> {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {children}
    </div>
  );
}
