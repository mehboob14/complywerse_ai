'use client';

import Link from 'next/link';
import { Layers, Shield, FileText, Library } from 'lucide-react';
import ComplianceOverviewCards from '@/components/dashboard/ComplianceOverviewCards';

/**
 * Compliance — Overview. A board-level roll-up of the four compliance pages
 * (Frameworks · Controls · Evidence · Control Library), each a scored section
 * with its formulas one click away. Purpose-built, no legacy widgets.
 */

const QUICK_LINKS = [
  { name: 'Frameworks', href: '/frameworks', icon: Layers, hint: 'upload · parse · publish' },
  { name: 'Controls', href: '/controls', icon: Shield, hint: 'evidence · verification' },
  { name: 'Evidence', href: '/evidence', icon: FileText, hint: 'library · freshness · review' },
  { name: 'Control Library', href: '/control-library', icon: Library, hint: 'normalize · harmonize' },
];

export default function ComplianceOverviewPage() {
  return (
    <div className="space-y-5">
      {/* Board-level posture — every compliance page as a scored section. */}
      <ComplianceOverviewCards />

      {/* Jump into the four compliance pages. */}
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Go to a page</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {QUICK_LINKS.map((l) => {
            const Icon = l.icon;
            return (
              <Link
                key={l.href}
                href={l.href}
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
              >
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition-colors group-hover:bg-blue-100">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-800">{l.name}</span>
                  <span className="block truncate text-[11px] text-slate-400">{l.hint}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
