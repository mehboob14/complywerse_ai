'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle, BellRing, Building2, CalendarCheck, ClipboardList, FileQuestion, FileSignature, FileText, Inbox, Layers,
  LayoutDashboard,
  PackageCheck, Radio, Settings, Share2, Shield, type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';

type Item = { name: string; href: string; icon: LucideIcon; exact?: boolean };

// Grouped the way the work flows: a supplier is requested, assessed, watched and
// reported on. New pages join the group they belong to.
const GROUPS: Array<{ title: string; items: Item[] }> = [
  { title: 'Overview', items: [
    { name: 'Dashboard', href: '/vendor-risk', icon: LayoutDashboard, exact: true },
    { name: 'Attention', href: '/vendor-risk/attention', icon: BellRing },
  ] },
  { title: 'Suppliers', items: [
    { name: 'Requests', href: '/vendor-risk/intake', icon: Inbox },
    { name: 'Vendors', href: '/vendor-risk/vendors', icon: Building2 },
    { name: 'Procurement', href: '/vendor-risk/procurement', icon: PackageCheck },
    { name: 'Contracts', href: '/vendor-risk/contracts', icon: FileSignature },
  ] },
  { title: 'Assessment', items: [
    { name: 'Assessments', href: '/vendor-risk/assessments', icon: ClipboardList },
    { name: 'Questionnaires', href: '/vendor-risk/questionnaires', icon: FileQuestion },
    { name: 'Check-ins', href: '/vendor-risk/reviews', icon: CalendarCheck },
    { name: 'Findings', href: '/vendor-risk/findings', icon: AlertTriangle },
  ] },
  { title: 'Monitoring', items: [
    { name: 'Signals', href: '/vendor-risk/monitoring', icon: Radio },
    { name: 'Concentration', href: '/vendor-risk/concentration', icon: Layers },
  ] },
  { title: 'Insight', items: [
    { name: 'Risk 360°', href: '/vendor-risk/risk-360', icon: Shield },
    { name: 'Reports', href: '/vendor-risk/reports', icon: FileText },
    { name: 'Exchange', href: '/vendor-risk/exchange', icon: Share2 },
  ] },
];
const SETTINGS: Item = { name: 'Settings', href: '/vendor-risk/settings', icon: Settings };
const ALL = [...GROUPS.flatMap((g) => g.items), SETTINGS];

export default function VendorRiskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const active = (item: Item) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  const link = (item: Item, compact = false) => {
    const on = active(item);
    return (
      <Link key={item.href} href={item.href} aria-current={on ? 'page' : undefined}
        className={clsx('flex items-center gap-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          compact ? 'shrink-0 whitespace-nowrap px-3 py-1.5' : 'px-2.5 py-1.5',
          on ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {item.name}
      </Link>
    );
  };

  return (
    <div className="-m-4 flex min-h-full text-slate-900 lg:-m-5">
      <aside className="sticky top-0 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 lg:flex"
        aria-label="Third-party risk">
        <p className="flex items-center gap-2 px-2.5 text-sm font-semibold text-slate-900">
          <Building2 className="h-4 w-4 text-primary-600" /> Third-party risk
        </p>
        <nav className="mt-2 flex-1">
          {GROUPS.map((g) => (
            <div key={g.title} className="mt-4">
              <p className="mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g.title}</p>
              <div className="space-y-0.5">{g.items.map((i) => link(i))}</div>
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-100 pt-3">{link(SETTINGS)}</div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Narrow screens: the same links in one scrolling row. */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2 lg:hidden" aria-label="Third-party risk">
          {ALL.map((i) => link(i, true))}
        </nav>
        {/* Remount only when entering/leaving a vendor-detail route so moving
            between list pages reuses cached queries instead of flashing loaders. */}
        <div key={/\/vendor-risk\/vendors\/\d+/.test(pathname) ? pathname : 'vendor-risk-shell'}
          className="space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-5">
          {children}
        </div>
      </div>
    </div>
  );
}
