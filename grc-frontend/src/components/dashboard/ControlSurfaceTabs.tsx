'use client';

/**
 * Top-of-page toggle between the two control surfaces — the working Catalog and
 * the normalization Library. Renders on both /controls and /control-library so
 * they read as one page with two tabs (switch in place, no "jump to other page"
 * buttons).
 */
import Link from 'next/link';
import { Boxes, GitMerge, ShieldCheck } from 'lucide-react';

export default function ControlSurfaceTabs({ active }: { active: 'catalog' | 'library' | 'assurance' }) {
  const tabs = [
    { k: 'catalog', label: 'Control Catalog', href: '/controls', icon: Boxes, hint: 'Work your controls — assign, test, evidence & certify' },
    { k: 'library', label: 'Normalized Controls', href: '/control-library', icon: GitMerge, hint: 'Normalize frameworks & explore the unified library' },
    { k: 'assurance', label: 'Assurance', href: '/control-library/assurance', icon: ShieldCheck, hint: 'Control testing & assurance posture — tested, effective, on time' },
  ] as const;
  return (
    <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
      {tabs.map((t) => {
        const on = active === t.k;
        const Icon = t.icon;
        return (
          <Link
            key={t.k}
            href={t.href}
            title={t.hint}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors ${on ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Icon className="h-4 w-4" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
