'use client';

// The Overview, the module's one overview page: Verity's four tiles and cards (each a way into the list it counts; what needs attention and
// what is planned are cards here, their full lists one click away), then Compliverse's own posture charts below.
// Live from /vendor-risk/tpra/dashboard and /risk-trend; Portfolio, or My queue (the vendors the caller owns). The title and the
// two ways to bring a vendor in are the module header's (layout).

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN_PRIMARY, EmptyState, ErrorState, SegmentedControl, Skeleton } from './_ui';
import AddVendorDialog from './_lib/AddVendorDialog';
import { errText } from './_lib/intake/types';
import type { Dashboard, Scope } from './_lib/overviewModel';
import { TPRM_QUERY_OPTS } from './_lib/tprmQuery';
import { AttentionCard, CoverageCard, IntakeCard, OpenFindingsCard, PlannedCard, ResidualCard, StatusCard, Tiles, TierCard } from './_overview/Cards';
import Posture, { type Trend } from './_overview/Posture';

export default function VendorRiskOverviewPage() {
  const { hasPermission } = usePermissions();
  const canAdd = hasPermission('vendor_risk:vendors:create') || hasPermission('erm:risks:edit');
  const [scope, setScope] = useState<Scope>('portfolio');
  const [adding, setAdding] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tprm-dashboard', scope],
    queryFn: async () => (await tpraApi.dashboard(scope)).data as Dashboard,
    ...TPRM_QUERY_OPTS,
  });
  const { data: trend } = useQuery({
    queryKey: ['tprm-trend'],
    queryFn: async () => (await tpraApi.riskTrend({ scope: 'portfolio', months: 12 })).data as Trend,
    ...TPRM_QUERY_OPTS,
  });

  const switcher = (
    <div className="flex justify-end">
      <SegmentedControl ariaLabel="Overview scope" value={scope} onChange={setScope}
        options={[{ value: 'portfolio', label: 'Portfolio' }, { value: 'mine', label: 'My queue' }]} />
    </div>
  );

  if (isLoading && !data) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading the overview">
        {switcher}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[82px] rounded-xl" />)}</div>
        <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-64 rounded-xl" />)}</div>
      </div>
    );
  }
  if (error || !data) {
    return <ErrorState title="Couldn't load the overview" message={errText(error, 'Try again in a moment.')} onRetry={() => refetch()} />;
  }

  if (data.kpis.active_vendors === 0) {
    return (
      <div className="space-y-4">
        {switcher}
        {scope === 'mine' ? (
          <EmptyState icon={Building2} title="No vendors in your queue" hint="Vendors you own show here." />
        ) : (
          <EmptyState icon={Building2} title="No vendors yet" hint="Add the third parties you share data or systems with."
            action={canAdd ? <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>Add vendor</button> : undefined} />
        )}
        <AddVendorDialog open={adding} onClose={() => setAdding(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {switcher}
      <Tiles d={data} scope={scope} />
      <div className="grid gap-4 lg:grid-cols-3">
        <AttentionCard d={data} scope={scope} />
        <TierCard d={data} scope={scope} />
        <CoverageCard d={data} scope={scope} />
        <OpenFindingsCard d={data} />
        <StatusCard d={data} />
        <IntakeCard d={data} />
        <ResidualCard d={data} />
        <PlannedCard scope={scope} />
      </div>
      <Posture d={data} trend={trend} />
    </div>
  );
}
