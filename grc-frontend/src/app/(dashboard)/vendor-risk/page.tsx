'use client';

// Third-Party Vendor Risk > Overview (v2): how the programme stands, in graphics. Six figures (each opens the page it counts; the last, Needs attention, is one number and a thin bar of how urgent),
// then the chart cards (the risk trend against the appetite, vendors by tier and by residual band, the highest residual scores, findings, when reviews fall due and where they stand, what vendors
// wait on, contracts, signals, shared platforms: _overview/visuals.tsx), and the person's own work, slim, last (_overview/parts.tsx: three one-line rows and "See all"). No wall of counters.
// Every graphic opens the vendor register, the findings, the contracts or the module's page, filtered where that page can filter, and Back brings the person to the same place: the view
// (Portfolio or My vendors, ?scope=mine; the findings split, ?findings=age) is in the address and useReturnToPlace puts the scroll position back once the data has drawn.
// The two scopes decide whose vendors the figures and the charts count. "My work" is always the person's own.
// Every request loads, fails and has nothing on its own (overviewData.ts): a failed one is said where its numbers would be and never reads as zero. The numbers are the server's: the program dashboard
// (GET tpra/dashboard, the same key as before: the Performance Overview reads it too), the 12-month trend, GET tpra/overview-charts, the contracts register, the concentration read, the Work queue and the planned actions.
import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { EmptyState, SegmentedControl, useAddressState } from '@/components/ui/ds';
import { oneOf } from '@/lib/addressState';
import { SkipToWork } from '@/components/overview/Cockpit';
import { useNarrow } from '@/components/overview/useNarrow';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { titleFor } from '@/lib/navRegistry';
import VendorActions from './_lib/VendorActions';
import { usePortfolioCounts } from './_lib/portfolioApi';
import { headerStats } from './_lib/portfolioModel';
import { useBands, useCharts, useConcentration, useContracts, useDashboard, useMe, useMyActions, useMyQueue, useTrend } from './_overview/overviewData';
import { WorkCard } from './_overview/parts';
import { HeroRow, VisualGrid } from './_overview/visuals';
import { buildWork } from './_overview/workModel';

const SCOPES = ['portfolio', 'mine'] as const;
const SCHEMA = { scope: oneOf(SCOPES, 'portfolio'), findings: oneOf(['status', 'age'] as const, 'status') };
const OPTIONS = [{ value: 'portfolio', label: 'Portfolio' }, { value: 'mine', label: 'My vendors' }] as const;

export default function VendorRiskOverviewPage() {
  const narrow = useNarrow();
  const [{ scope, findings }, setAddress] = useAddressState(SCHEMA);
  const counts = usePortfolioCounts();
  const dash = useDashboard(scope);
  const trend = useTrend();
  const bands = useBands();
  const queue = useMyQueue();
  const actions = useMyActions();
  const charts = useCharts(scope);
  const contracts = useContracts();
  const concentration = useConcentration();
  const me = useMe();

  const d = dash.data;
  const stale = dash.isPlaceholderData;                       // the other scope's answer, shown until this one arrives
  const work = useMemo(
    () => buildWork({ queue: queue.data?.items, requests: d?.intake_pending?.items, actions: actions.data?.items }),
    [queue.data, d?.intake_pending?.items, actions.data],
  );
  const sources = [
    { label: 'The Work queue', feed: queue },
    { label: 'Planned actions', feed: actions },
    { label: 'Requests waiting', feed: dash },
  ];
  const loadingWork = sources.some((s) => s.feed.isPending);

  const firstUse = !!d && !stale && d.kpis.active_vendors === 0 && (d.intake_pending?.total ?? 0) === 0 && !loadingWork && work.length === 0;

  // Back puts the page where it was once every card has drawn (an answer or a failure; not a request still on its way, nor the other scope's answer)
  useReturnToPlace([dash, charts, trend, contracts, concentration, queue, actions].every((q) => !q.isPending && !q.isPlaceholderData));

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/vendor-risk') ?? 'Third-Party Vendor Risk Overview'}
        info="How the vendor programme stands. Every figure and chart opens the vendors, findings or contracts behind it."
        meta={headerStats(counts)}
        actions={(
          <>
            <SegmentedControl label="Whose vendors" name="overview-scope" options={OPTIONS} value={scope} onChange={(value) => setAddress({ scope: value })} />
            <VendorActions />
          </>
        )}
      />
      {firstUse ? (
        <EmptyState
          kind="firstUse"
          icon={Building2}
          title={scope === 'mine' ? 'No vendors are yours yet' : 'No vendors yet'}
          description={scope === 'mine' ? 'Vendors you own show here.' : 'Use Add vendor to list the third parties you share data or systems with.'}
        />
      ) : (
        <>
          <HeroRow dash={dash} trend={trend} scope={scope} />
          <VisualGrid
            scope={scope} narrow={narrow} bands={bands} findings={findings} onFindings={(view) => setAddress({ findings: view })}
            dash={dash} trend={trend} charts={charts} contracts={contracts} concentration={concentration} me={me}
            work={<WorkCard id="work" items={work} sources={sources} />}
          />
        </>
      )}
    </div>
  );
}
