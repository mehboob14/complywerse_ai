'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, Bot } from 'lucide-react';
import { clsx } from 'clsx';

// Tabs for the Risk Assessment area. "AI Risk Assessment" used to be a
// top-level sidebar entry; it now lives here as a sibling tab so the manual /
// framework assessments and the AI-driven assessment sit together.
const AI_HREF = '/erm/risk-assessments/ai-risk-assessment';
const tabs = [
  { name: 'Risk Assessments', href: '/erm/risk-assessments', icon: ClipboardList },
  { name: 'AI Risk Assessment', href: AI_HREF, icon: Bot },
];

export default function RiskAssessmentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const onAi = pathname.startsWith(AI_HREF);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-0 border-b border-gray-200">
        {tabs.map((tab) => {
          const isActive = tab.href === AI_HREF ? onAi : !onAi;
          return (
            <Link
              key={tab.name}
              href={tab.href}
              className={clsx(
                'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
