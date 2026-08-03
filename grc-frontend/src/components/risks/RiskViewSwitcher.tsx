'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BarChart3, ChevronDown, ListChecks, Check } from 'lucide-react';

// Header dropdown that toggles between the two risk-register views: the
// dashboard (overview, charts, drill-downs) and the flat register list.
// Both pages render this same component with `active` set to whichever view
// the user is on, so the dropdown always shows the current page as selected
// and the other as the navigable option.
//
// Lives alongside the risks components rather than the generic UI folder
// because the two routes it links to are domain-specific — promoting it to
// a generic widget without that context would just add another indirection.
export default function RiskViewSwitcher({
  active,
}: {
  active: 'dashboard' | 'list';
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const currentLabel = active === 'dashboard' ? 'Dashboard' : 'Risk Register';
  const CurrentIcon = active === 'dashboard' ? BarChart3 : ListChecks;

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <CurrentIcon className="h-4 w-4 text-slate-500" />
        <span>{currentLabel}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
        >
          <ViewMenuItem
            href="/erm/risks/dashboard"
            icon={<BarChart3 className="h-4 w-4 text-slate-500" />}
            label="Dashboard"
            description="Overview, severity mix, drill-downs"
            isActive={active === 'dashboard'}
            onClick={() => setOpen(false)}
          />
          <ViewMenuItem
            href="/erm/risks/list"
            icon={<ListChecks className="h-4 w-4 text-slate-500" />}
            label="Risk Register"
            description="Flat list with filters, edit, upload"
            isActive={active === 'list'}
            onClick={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

function ViewMenuItem({
  href,
  icon,
  label,
  description,
  isActive,
  onClick,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      aria-current={isActive ? 'page' : undefined}
      onClick={onClick}
      className={`flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
        isActive ? 'bg-blue-50' : 'hover:bg-slate-50'
      }`}
    >
      <span className="mt-0.5 flex-shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className={`flex items-center gap-1.5 font-medium ${isActive ? 'text-blue-700' : 'text-slate-900'}`}>
          {label}
          {isActive && <Check className="h-3.5 w-3.5" />}
        </span>
        <span className="block text-xs text-slate-500">{description}</span>
      </span>
    </Link>
  );
}
