'use client';

// /is-projects/dashboard: the portfolio Overview on its own (the Projects page shows the same thing as its Overview tab). The pieces are in ../_PortfolioOverview.tsx.
import { PageHeader } from '@/components/ui';
import { titleFor } from '@/lib/navRegistry';
import { PortfolioOverview } from '../_PortfolioOverview';

export default function PortfolioDashboardPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={titleFor('/is-projects/dashboard') ?? 'Projects overview'} info="Executive overview of all information security projects" />
      <PortfolioOverview />
    </div>
  );
}
