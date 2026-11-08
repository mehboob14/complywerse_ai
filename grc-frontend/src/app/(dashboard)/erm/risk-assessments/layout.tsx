'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

// The two places of the Risk Assessments area: the assessments (manual and framework, with their Insights) and the register of the organisation's own AI systems' risks. The strip is shown on
// those two pages only; an assessment's workspace has its own head and a link back. It looks like the kit's Tabs (same classes) but each tab is a page with its own address.
const HOME = '/erm/risk-assessments';
const AI_HREF = '/erm/risk-assessments/ai-risk-assessment';
const TABS = [
  { name: 'Assessments', href: HOME },
  { name: 'AI System Risks', href: AI_HREF },
] as const;

const STRIP = 'mb-[16px] flex overflow-x-auto shadow-[inset_0_-1px_0_var(--ds-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const TAB = 'inline-flex h-ds-control shrink-0 items-center whitespace-nowrap border-b-2 px-[12px] text-ds-body font-medium focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

export default function RiskAssessmentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const onAi = pathname.startsWith(AI_HREF);
  const showStrip = pathname === HOME || pathname === `${HOME}/` || onAi;
  return (
    <div>
      {showStrip && (
        <nav aria-label="Risk Assessments">
          <div className={STRIP}>
            {TABS.map((tab) => {
              const active = tab.href === AI_HREF ? onAi : !onAi;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(TAB, active ? 'border-ds-primary text-ds-primary-text' : 'border-transparent text-ds-fg-muted hover:border-ds-border-strong hover:text-ds-fg')}
                >
                  {tab.name}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
      {children}
    </div>
  );
}
