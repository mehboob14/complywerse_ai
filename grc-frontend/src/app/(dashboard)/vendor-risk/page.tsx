'use client';

// Third-Party Vendor Risk > Overview, a graphical dashboard of the programme on the cockpit frame (components/overview): the six figures it leads with (with their 12-month history), the counters of what needs
// attention, the grid of chart cards (risk trend against the appetite, vendors by tier and by residual band, inherent against residual, reviews due and where they stand, findings, contracts, concentration,
// signals: _overview/visuals.tsx), then the person's own work beside one posture card. The two scopes (Portfolio, My vendors) are in the address (?scope=mine); they decide whose vendors the counters, the
// figures and the charts count. "My work" is always the person's own.
// Every request loads, fails and has nothing on its own (overviewData.ts): a failed one is said where its numbers would be and never reads as zero. The numbers are the server's: the program dashboard
// (GET tpra/dashboard, the same key as before: the Performance Overview reads it too), the 12-month trend, GET tpra/overview-charts, the contracts register, the concentration read, the Work queue and the planned actions.
import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { EmptyState, SegmentedControl, useAddressState } from '@/components/ui/ds';
import { oneOf } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { formatCount } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import VendorActions from './_lib/VendorActions';
import { usePortfolioCounts } from './_lib/portfolioApi';
import { headerStats } from './_lib/portfolioModel';
import { counters, type Kpis, type Scope } from './_lib/overviewModel';
import { useBands, useCharts, useConcentration, useContracts, useDashboard, useMe, useMyActions, useMyQueue, useTrend } from './_overview/overviewData';
import { PostureCard, WorkCard } from './_overview/parts';
import { HeroRow, VisualGrid } from './_overview/visuals';
import { buildWork } from './_overview/workModel';

const SCOPES = ['portfolio', 'mine'] as const;
const SCHEMA = { scope: oneOf(SCOPES, 'portfolio') };
const OPTIONS = [{ value: 'portfolio', label: 'Portfolio' }, { value: 'mine', label: 'My vendors' }] as const;

export default function VendorRiskOverviewPage() {
  const narrow = useNarrow();
  const [{ scope }, setAddress] = useAddressState(SCHEMA);
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
  const mode = layoutOf({ refused: false, workCount: loadingWork ? null : work.length });
  const limit = workRowLimit(mode, narrow);

  const names = counters({ kpis: {} as Kpis }, scope);        // the labels and addresses, for the band while the numbers are on their way
  const failed = dash.isError && !d;
  const bandCounters: BandCounter[] = names.map((c) => {
    const real = d && !stale ? counters(d, scope).find((x) => x.key === c.key) : undefined;
    const label = real?.caption ? `${c.label} (${real.caption})` : c.label;
    return {
      key: c.key, label, href: c.href, tone: c.tone,
      state: failed ? 'error' : real ? 'ready' : 'loading',
      value: real?.value,
      onRetry: failed && canRetry(dash.error) ? () => { void dash.refetch(); } : undefined,
    };
  });

  const firstUse = !!d && !stale && d.kpis.active_vendors === 0 && (d.intake_pending?.total ?? 0) === 0 && !loadingWork && work.length === 0;

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/vendor-risk') ?? 'Third-Party Vendor Risk Overview'}
        info="How the vendor programme is doing, and what needs you."
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
        <Cockpit
          mode={mode}
          narrow={narrow}
          hero={<HeroRow dash={dash} trend={trend} scope={scope} />}
          band={(
            <CounterBand
              id="attention"
              title="Needs attention"
              info="Each count opens the vendors, findings or requests it counts."
              total={d && !stale ? `${formatCount(d.kpis.active_vendors)} in use` : undefined}
              counters={bandCounters}
              narrow={narrow}
              failure={failed ? { title: "Couldn't load the counters", message: errorMessage(dash.error), onRetry: canRetry(dash.error) ? () => { void dash.refetch(); } : undefined } : undefined}
            />
          )}
          visuals={<VisualGrid scope={scope} narrow={narrow} bands={bands} dash={dash} trend={trend} charts={charts} contracts={contracts} concentration={concentration} me={me} />}
          work={<WorkCard id="work" items={work} sources={sources} limit={limit} />}
          posture={<PostureCard id="posture" dash={dash} trend={trend} bands={bands} scope={scope} />}
          breakdowns={[]}
        />
      )}
    </div>
  );
}
