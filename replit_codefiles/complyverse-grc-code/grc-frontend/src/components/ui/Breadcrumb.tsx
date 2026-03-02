'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ChevronRight, type LucideIcon } from 'lucide-react';
import { clsx } from 'clsx';

const pathLabels: Record<string, string> = {
  dashboard: 'Dashboard',
  frameworks: 'Frameworks',
  'framework-upload': 'Framework Upload',
  controls: 'Controls',
  'control-library': 'Control Library',
  evidence: 'Evidence',
  erm: 'Risk Management',
  risks: 'Risk Register',
  'mitigation-actions': 'Mitigation Actions',
  appetite: 'Risk Appetite',
  kris: 'Key Risk Indicators',
  incidents: 'Incidents',
  'internal-controls': 'Internal Controls',
  governance: 'Governance',
  documents: 'Documents',
  workflows: 'Workflows',
  reviews: 'Reviews',
  assets: 'Assets',
  settings: 'Settings',
  users: 'Users',
  vulnerabilities: 'Vulnerabilities',
  sla: 'SLA Configuration',
  reports: 'Reports',
  alignment: 'Control Alignment',
  assessment: 'Assessment',
  compare: 'Compare',
  coverage: 'Coverage',
  gaps: 'Gap Analysis',
  'audit-packages': 'Audit Packages',
  dependencies: 'Dependencies',
};

export interface BreadcrumbItem {
  label: string;
  href: string;
  icon?: LucideIcon;
}

export interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  showHome?: boolean;
  className?: string;
}

export function Breadcrumb({ items, showHome = true, className }: BreadcrumbProps) {
  const pathname = usePathname();
  
  const breadcrumbItems = items || generateBreadcrumbs(pathname);

  if (breadcrumbItems.length === 0) return null;

  return (
    <nav 
      className={clsx('flex items-center gap-1.5 text-sm', className)}
      aria-label="Breadcrumb"
    >
      {showHome && (
        <>
          <Link 
            href="/dashboard" 
            className="flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-150"
            aria-label="Home"
          >
            <Home size={15} />
          </Link>
          {breadcrumbItems.length > 0 && (
            <ChevronRight size={14} className="text-slate-600 flex-shrink-0" />
          )}
        </>
      )}
      {breadcrumbItems.map((item, index) => {
        const isLast = index === breadcrumbItems.length - 1;
        return (
          <div key={item.href} className="flex items-center gap-1.5">
            {index > 0 && (
              <ChevronRight size={14} className="text-slate-600 flex-shrink-0" />
            )}
            {isLast ? (
              <span className="flex items-center gap-1.5 px-2 py-1 text-white font-medium">
                {item.icon && <item.icon size={14} />}
                <span className="truncate max-w-[200px]">{item.label}</span>
              </span>
            ) : (
              <Link
                href={item.href}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800/50 transition-all duration-150"
              >
                {item.icon && <item.icon size={14} />}
                <span className="truncate max-w-[150px]">{item.label}</span>
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}

function generateBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const segments = pathname.split('/').filter(Boolean);
  
  if (segments.length === 0) return [];

  return segments.map((segment, index) => {
    const path = '/' + segments.slice(0, index + 1).join('/');
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
    const isNumericId = /^\d+$/.test(segment);
    
    let label: string;
    if (isUuid || isNumericId) {
      label = 'Details';
    } else {
      label = pathLabels[segment] || 
        segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
    }

    return { label, href: path };
  });
}

export default Breadcrumb;
