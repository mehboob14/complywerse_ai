'use client';

// Risk Management > Overview (Overview v2): the page says how the risk programme STANDS, in graphics, and what the person has to do is small and last. Six tiles lead (the posture
// score, open risks, high and critical, above appetite, treatment on track, KRIs on target), then the residual matrix and the ten section scores as small multiples, risks by category,
// business unit and treatment, the five highest risks, the risks raised by month, three signals from other modules, and "My work" in three lines. There is no counters band and no
// attention list: attention is the status colour of what is drawn. Every graphic opens the register (or the module page) already filtered to what it shows.
// What changes what the page shows is in its address (?basis= the matrix's score, ?sheet= the open sheet: how the score is made, the full work list), and useReturnToPlace puts the
// person back at the same scroll position when they come back from a module (Back, or a link to this address).
// Every request loads, fails and has nothing on its own, and a failed one is said where its figures would be, never read as 0. The module score and the section counts are the
// server's (GET /erm/dashboard/sections-overview: query key and payload unchanged, the main Dashboard reads the same key); the risks are the complete lean load, so the matrix, the
// categories and the five highest are of every risk.
import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, IconButton, useAddressState } from '@/components/ui/ds';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { Cell, ChartGrid } from '@/components/overview/charts';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import { usePermissions } from '@/hooks/usePermissions';
import apiClient, { ermApi } from '@/lib/api';
import { oneOf } from '@/lib/addressState';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { CategoryCard, HighestCard, MatrixCard, RaisedCard, SectionsCard, TreatmentCard, UnitCard } from './_overview/Cards';
import { MyWorkCard, MyWorkSheet } from './_overview/MyWork';
import { ModuleHealth } from './_overview/parts';
import { RiskTiles, SignalTiles } from './_overview/Tiles';
import { SECTION_ORDER, buildWork, postureOf, riskFigures } from './_overview/overviewModel';
import { useAppetite, useMeId, usePendingReviews, useRiskRows } from './risks/_register/riskData';
import type { Basis } from './risks/_register/riskModel';
import type { KriLike } from '@/lib/erm/kri';

interface SectionsPayload {
  sections?: Record<string, OverviewSection & { counts?: Record<string, unknown> }>;
  attention_queue?: Record<string, number>;
  performance?: { score: number | null; grade: string | null };
}

/** The page's state, in its address: the matrix's score and the open sheet. Defined once, outside the component. */
const SCHEMA = { basis: oneOf(['residual', 'inherent'] as const, 'residual'), sheet: oneOf(['none', 'health', 'work'] as const, 'none') };

const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export default function ERMOverviewPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:risks:create');
  const me = useMeId();
  const [address, setAddress] = useAddressState(SCHEMA);

  // the server's scorecard: the module score, the sections and the counts (the key is shared with the main Dashboard)
  const overview = useQuery({ queryKey: [...SCORECARD_QUERY_KEYS.erm], queryFn: async () => (await ermApi.dashboard.getSectionsOverview()).data as SectionsPayload, retry });
  const target = useQuery({ queryKey: ['erm-scorecard-config'], queryFn: async () => ((await apiClient.get('/erm/dashboard/scorecard-config')).data as { target?: number | null }), retry: false });
  const risks = useRiskRows();
  const reviews = usePendingReviews();
  const appetite = useAppetite();
  const actions = useQuery({ queryKey: ['erm-actions-overdue'], queryFn: async () => (await ermApi.mitigationActions.getOverdue()).data as unknown as Array<{ id: number; risk_id: number; title: string; owner_id?: number | null; due_date?: string | null }>, retry });
  const kris = useQuery({ queryKey: ['erm-kri-my-updates'], queryFn: async () => (await ermApi.kris.myUpdates()).data.items, retry });
  const krisReport = useQuery({ queryKey: ['metric-report', 'kri'], queryFn: async () => (await ermApi.kris.report(90, 'kri')).data as { kris: Array<KriLike & { is_active?: boolean | null }> }, retry });
  const incidents = useQuery({ queryKey: ['erm-incidents-all'], queryFn: async () => (await ermApi.incidents.getAll()).data as unknown as Array<{ id: number; title: string; severity?: string | null; status?: string | null; assigned_to?: number | null }>, retry });

  const now = useMemo(() => new Date(), []);
  const ctx = useMemo(() => ({ me, now, limits: appetite.limits, reviews: reviews.index }), [me, now, appetite.limits, reviews.index]);
  const work = useMemo(() => buildWork({
    me, now, rows: risks.rows, ctx, reviews: reviews.data ?? [], overdueActions: actions.data ?? [], kriUpdates: kris.data ?? [], incidents: incidents.data ?? [],
  }), [me, now, risks.rows, ctx, reviews.data, actions.data, kris.data, incidents.data]);
  const workFeeds = [
    { label: 'Your risks', feed: risks }, { label: 'Reviews', feed: reviews }, { label: 'Mitigation actions', feed: actions }, { label: 'Indicators to report', feed: kris }, { label: 'Incidents', feed: incidents },
  ];

  const payload = overview.data;
  const posture = postureOf(payload?.performance);
  const unscored = useMemo(() => riskFigures(risks.rows, appetite.limits, now).unscored, [risks.rows, appetite.limits, now]);
  const sectionList: OverviewSection[] = useMemo(
    () => SECTION_ORDER.map((k) => payload?.sections?.[k]).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ ...s, counts: s.counts ?? {} } as OverviewSection)),
    [payload],
  );
  const mitigation = payload?.sections?.mitigation?.counts as { open?: number; overdue?: number } | undefined;

  // the page is drawn once every request has answered: that is when a returning person is put back where they were
  const ready = ![overview, risks, reviews, appetite, actions, kris, krisReport, incidents].some((q) => q.isPending);
  useReturnToPlace(ready);

  const updated = overview.dataUpdatedAt > 0 ? `Updated ${clockOf(overview.dataUpdatedAt)}` : undefined;
  const refreshAll = () => { [overview, risks, reviews, appetite, actions, kris, krisReport, incidents].forEach((q) => { void q.refetch(); }); };
  const closeSheet = () => setAddress({ sheet: 'none' });

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={titleFor('/erm') ?? 'Risk Management Overview'}
        info="How the risk programme stands. Every figure and chart opens the records behind it."
        meta={<span className="inline-flex items-center gap-[2px]">{updated}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>}
        actions={(
          <>
            <Button href="/erm/risks">Risk Register</Button>
            {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => router.push('/erm/risks?new=1')}>Add risk</Button>}
          </>
        )}
      />

      <RiskTiles
        overview={overview} score={posture.score} grade={posture.grade} target={target.data?.target ?? null} mitigation={mitigation}
        risks={risks} rows={risks.rows} appetite={appetite} limits={appetite.limits} kris={krisReport} krisRows={krisReport.data?.kris ?? []} now={now}
      />

      <ChartGrid>
        <Cell span={6}>
          <MatrixCard feed={risks} rows={risks.rows} canCreate={canCreate} basis={address.basis as Basis} onBasis={(basis) => setAddress({ basis })} unscored={unscored} />
        </Cell>
        <Cell span={6}>
          <SectionsCard overview={overview} sections={payload?.sections} onOpenHealth={() => setAddress({ sheet: 'health' }, { push: true })} />
        </Cell>
        <Cell span={6}><CategoryCard feed={risks} rows={risks.rows} canCreate={canCreate} /></Cell>
        <Cell span={6}><UnitCard feed={risks} rows={risks.rows} canCreate={canCreate} /></Cell>
        <Cell span={6}><TreatmentCard feed={risks} rows={risks.rows} canCreate={canCreate} /></Cell>
        <Cell span={6}><SignalTiles overview={overview} queue={payload?.attention_queue} /></Cell>
        <Cell span={6}><HighestCard feed={risks} rows={risks.rows} canCreate={canCreate} /></Cell>
        <Cell span={6}><RaisedCard feed={risks} rows={risks.rows} now={now} /></Cell>
        <Cell span={12}><MyWorkCard items={work} now={now} sources={workFeeds} /></Cell>
      </ChartGrid>

      <ModuleHealth open={address.sheet === 'health'} onClose={closeSheet} sections={sectionList} score={posture.score} grade={posture.grade} />
      <MyWorkSheet open={address.sheet === 'work'} onClose={closeSheet} items={work} now={now} />
    </div>
  );
}
