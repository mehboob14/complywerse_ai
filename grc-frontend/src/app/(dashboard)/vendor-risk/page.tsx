'use client';

// Third-Party Vendor Risk > Overview, a worklist-first cockpit (components/overview, the frame of the Governance and Risk Overviews): what needs attention across the module as a band of
// counters, the person's own work beside one compact posture card, and the breakdowns of the whole portfolio below. The two scopes (Portfolio, My vendors) are in the address (?scope=mine);
// they decide whose vendors the counters, the posture and the breakdowns count. "My work" is always the person's own.
// Every request loads, fails and has nothing on its own (overviewData.ts): a failed one is said where its numbers would be and never reads as zero. The numbers are the server's: the
// program dashboard (GET tpra/dashboard, the same key as before: the Performance Overview reads it too), the 12-month trend, the Work queue and the planned actions.
import { useMemo } from 'react';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { EmptyState, SegmentedControl, useAddressState } from '@/components/ui/ds';
import { oneOf } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { formatCount } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import VendorActions from './_lib/VendorActions';
import { usePortfolioCounts } from './_lib/portfolioApi';
import { headerStats } from './_lib/portfolioModel';
import { counters, type Kpis, type Scope } from './_lib/overviewModel';
import { useBands, useDashboard, useMyActions, useMyQueue, useTrend } from './_overview/overviewData';
import {
  FindingsList, Loaded, NextStepList, PostureCard, ResidualList, SignalList, StatusList, TierGapList, TierList, TrendCard, WorkCard,
} from './_overview/parts';
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

  const breakdowns: Breakdown[] = [
    { id: 'next-step', title: 'Vendors by next step', info: 'The one thing each vendor is waiting on, the first that holds. Each count opens the register on those vendors. The Work queue counts items, so its number is higher.', children: <Loaded q={dash} label="the next steps">{(x) => <NextStepList d={x} scope={scope} />}</Loaded> },
    { id: 'by-tier', title: 'By tier', info: 'Vendors in use by their tier; vendors not yet tiered are apart.', children: <Loaded q={dash} label="the tiers">{(x) => <TierList d={x} scope={scope} />}</Loaded> },
    { id: 'by-status', title: 'By status', info: 'Vendors by where they are in their life cycle.', children: <Loaded q={dash} label="the statuses">{(x) => <StatusList d={x} />}</Loaded> },
    { id: 'findings', title: 'Open findings', info: 'Findings that are open or being fixed, by severity and by the risk domain they gather in. Findings of archived vendors are not counted.', children: <Loaded q={dash} label="the findings">{(x) => <FindingsList d={x} />}</Loaded> },
    { id: 'residual', title: 'Highest residual risk', info: 'The five vendors with the highest residual score, on your organisation\'s bands.', children: <Loaded q={dash} label="the highest risks">{(x) => <ResidualList d={x} bands={bands} />}</Loaded> },
    { id: 'gap', title: 'Inherent against residual', info: 'The gap between the two is the risk the controls remove, by tier.', children: <Loaded q={dash} label="the tiers' scores">{(x) => <TierGapList d={x} />}</Loaded> },
    { id: 'signals', title: 'Monitoring signals', info: 'The latest signals from outside-in monitoring.', children: <Loaded q={dash} label="the signals">{(x) => <SignalList d={x} />}</Loaded> },
    { id: 'trend', title: 'Risk trend', info: 'The portfolio\'s residual and inherent score month by month, against your appetite.', size: 'wide', children: <TrendCard trend={trend} /> },
  ];

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
          work={<WorkCard id="work" items={work} sources={sources} limit={limit} />}
          posture={<PostureCard id="posture" dash={dash} trend={trend} bands={bands} scope={scope} />}
          breakdowns={breakdowns}
        />
      )}
    </div>
  );
}
