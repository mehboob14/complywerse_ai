'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle, BellRing, Building2, CalendarCheck, CalendarClock, ClipboardList, Cpu, FileQuestion, FileSignature, FileText, Inbox, Layers,
  EyeOff, ScrollText, ShieldAlert, Sigma,
  LayoutDashboard,
  PackageCheck, Radar, Radio, Settings, Share2, Shield, Users, type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import ModuleHead from './_lib/ModuleHead';
import { usePortfolioCounts, useRefreshCountsAfterChanges } from './_lib/portfolioApi';
import { badgeText, isActive, isDrillDown, shellKey, type Counts } from './_lib/portfolioModel';

/** `count`: the number the rail shows beside it (what waits there), from the module's counts. */
type Item = { name: string; href: string; icon: LucideIcon; exact?: boolean; count?: keyof Counts; waiting?: string };

// Grouped the way the work flows: a vendor is requested, assessed, watched and
// reported on. New pages join the group they belong to.
const GROUPS: Array<{ title: string; items: Item[] }> = [
  { title: 'Overview', items: [
    { name: 'Overview', href: '/vendor-risk', icon: LayoutDashboard, exact: true },
    { name: 'Attention', href: '/vendor-risk/attention', icon: BellRing },
    { name: 'Planned actions', href: '/vendor-risk/actions', icon: CalendarClock },
  ] },
  { title: 'Vendors', items: [
    { name: 'Register', href: '/vendor-risk/vendors', icon: Building2 },
    { name: 'Intake', href: '/vendor-risk/intake', icon: Inbox, count: 'intake_pending', waiting: 'pending' },
    { name: 'Procurement', href: '/vendor-risk/procurement', icon: PackageCheck },
    { name: 'Contracts', href: '/vendor-risk/contracts', icon: FileSignature },
    { name: 'Shadow SaaS', href: '/vendor-risk/shadow-saas', icon: EyeOff },
  ] },
  { title: 'Assessment', items: [
    { name: 'Assessments', href: '/vendor-risk/assessments', icon: ClipboardList },
    { name: 'Questionnaires', href: '/vendor-risk/questionnaires', icon: FileQuestion },
    { name: 'Check-ins', href: '/vendor-risk/reviews', icon: CalendarCheck },
    { name: 'Findings', href: '/vendor-risk/findings', icon: AlertTriangle, count: 'open_findings', waiting: 'open' },
  ] },
  { title: 'Monitoring', items: [
    { name: 'Signals', href: '/vendor-risk/monitoring', icon: Radio },
    { name: 'Breach alerts', href: '/vendor-risk/alerts', icon: ShieldAlert },
    { name: 'Security ratings', href: '/vendor-risk/security', icon: Radar },
    { name: 'Technology', href: '/vendor-risk/technology', icon: Cpu },
    { name: 'Concentration', href: '/vendor-risk/concentration', icon: Layers },
  ] },
  { title: 'Insight', items: [
    { name: 'Risk 360°', href: '/vendor-risk/risk-360', icon: Shield },
    { name: 'Comply analyses', href: '/vendor-risk/comply-analysis', icon: Sigma },
    { name: 'Reports', href: '/vendor-risk/reports', icon: FileText },
    { name: 'Exchange', href: '/vendor-risk/exchange', icon: Share2 },
  ] },
  { title: 'Setup', items: [
    { name: 'Roster', href: '/vendor-risk/roster', icon: Users },
    { name: 'Policy', href: '/vendor-risk/policy', icon: ScrollText },
    { name: 'Settings', href: '/vendor-risk/settings', icon: Settings },
  ] },
];
const ALL = GROUPS.flatMap((g) => g.items);

export default function VendorRiskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const counts = usePortfolioCounts();
  useRefreshCountsAfterChanges();

  const link = (item: Item, compact = false) => {
    const on = isActive(pathname, item.href, item.exact);
    const n = badgeText(item.count ? counts?.[item.count] : 0);
    return (
      <Link key={item.href} href={item.href} aria-current={on ? 'page' : undefined}
        className={clsx('relative flex items-center gap-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          compact ? 'shrink-0 whitespace-nowrap px-3 py-1.5' : 'px-2.5 py-1.5',
          on ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {item.name}
        {n && (
          // explicit colours: the platform CSS repaints slate and primary utilities
          <span className={clsx('ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px]', on ? 'bg-[#0f766e] text-[#fff]' : 'bg-[#e1e6eb] text-[#586472]')}>
            {n}<span className="sr-only"> {item.waiting}</span>
          </span>
        )}
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
      </aside>

      <div className="min-w-0 flex-1">
        {/* Narrow screens: the same links in one scrolling row. */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2 lg:hidden" aria-label="Third-party risk">
          {ALL.map((i) => link(i, true))}
        </nav>
        {/* Remount only when entering/leaving a vendor-detail route so moving
            between list pages reuses cached queries instead of flashing loaders. */}
        <div key={shellKey(pathname)} className="space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-5">
          {/* a vendor's record and the questionnaire builder draw their own header */}
          {!isDrillDown(pathname) && <ModuleHead />}
          {children}
        </div>
      </div>
    </div>
  );
}
