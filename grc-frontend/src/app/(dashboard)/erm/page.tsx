'use client';

// Risk Management > Overview, a worklist-first cockpit (option A of the Overview design lab, the same frame as the Governance Overview: components/overview): what needs attention across
// the module as a band of counters, the person's own prioritised work beside one compact posture card, and the breakdowns of the whole register below (by category, by business unit,
// the highest risks). The ten section cards, the waterfall and dot-matrix variants, the "Arriving" tiles and the two tool cards of the old page are gone: the sections are one sheet behind
// "How is it scored?", and Bow-Tie and Scenario Analysis are in the menu.
// Every request loads, fails and has nothing on its own. The module score and the 14 counters are the server's (GET /erm/dashboard/sections-overview, query key and payload unchanged: the
// main Dashboard reads the same key); a failure of that request is said where the numbers would be, and never reads as a score of 0. The risks are the complete lean load (the old page
// read the newest 100), so the matrix and the top ten are of every risk.
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, IconButton } from '@/components/ui/ds';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { Cockpit, SkipToWork, type Breakdown } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import { usePermissions } from '@/hooks/usePermissions';
import apiClient, { ermApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { ModuleHealth, PostureCard, SliceList, TopRisksList, WorkCard } from './_overview/parts';
import {
  ATTENTION, attentionTotal, buildWork, byCategorySlices, byUnitSlices, counterFrom, postureOf, topRisks, weakest, type SectionRow,
} from './_overview/overviewModel';
import { useAppetite, useMeId, usePendingReviews, useRiskRows } from './risks/_register/riskData';
import { isMine } from './risks/_register/riskModel';

interface SectionsPayload {
  sections?: Record<string, OverviewSection & { counts?: Record<string, unknown> }>;
  attention_queue?: Record<string, number>;
  performance?: { score: number | null; grade: string | null };
}

const SECTION_ORDER = ['register', 'assessments', 'rcsa', 'controls', 'vendor_risk', 'kris', 'appetite', 'mitigation', 'reviews', 'incidents'];
const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export default function ERMOverviewPage() {
  const router = useRouter();
  const narrow = useNarrow();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:risks:create');
  const me = useMeId();
  const [healthOpen, setHealthOpen] = useState(false);

  // the server's scorecard: the module score, the sections and the 14 counters (the key is shared with the main Dashboard)
  const overview = useQuery({ queryKey: [...SCORECARD_QUERY_KEYS.erm], queryFn: async () => (await ermApi.dashboard.getSectionsOverview()).data as SectionsPayload, retry });
  const target = useQuery({ queryKey: ['erm-scorecard-config'], queryFn: async () => ((await apiClient.get('/erm/dashboard/scorecard-config')).data as { target?: number | null }), retry: false });
  const risks = useRiskRows();
  const reviews = usePendingReviews();
  const appetite = useAppetite();
  const actions = useQuery({ queryKey: ['erm-actions-overdue'], queryFn: async () => (await ermApi.mitigationActions.getOverdue()).data as unknown as Array<{ id: number; risk_id: number; title: string; owner_id?: number | null; due_date?: string | null }>, retry });
  const kris = useQuery({ queryKey: ['erm-kri-my-updates'], queryFn: async () => (await ermApi.kris.myUpdates()).data.items, retry });
  const incidents = useQuery({ queryKey: ['erm-incidents-all'], queryFn: async () => (await ermApi.incidents.getAll()).data as unknown as Array<{ id: number; title: string; severity?: string | null; status?: string | null; assigned_to?: number | null }>, retry });

  const now = useMemo(() => new Date(), []);
  const ctx = useMemo(() => ({ me, now, limits: appetite.limits, reviews: reviews.index }), [me, now, appetite.limits, reviews.index]);
  const work = useMemo(() => buildWork({
    me, now, rows: risks.rows, ctx, reviews: reviews.data ?? [], overdueActions: actions.data ?? [], kriUpdates: kris.data ?? [], incidents: incidents.data ?? [],
  }), [me, now, risks.rows, ctx, reviews.data, actions.data, kris.data, incidents.data]);
  const feeds = [
    { label: 'Your risks', feed: risks }, { label: 'Reviews', feed: reviews }, { label: 'Mitigation actions', feed: actions }, { label: 'Indicators to report', feed: kris }, { label: 'Incidents', feed: incidents },
  ];

  const payload = overview.data;
  const posture = postureOf(payload?.performance);
  const sections: OverviewSection[] = useMemo(() => SECTION_ORDER.map((k) => payload?.sections?.[k]).filter((s): s is NonNullable<typeof s> => !!s).map((s) => ({ ...s, counts: s.counts ?? {} } as OverviewSection)), [payload]);
  const sectionRows: SectionRow[] = sections.map((s) => ({ key: s.key, label: s.label, weight: s.weight, score: s.score }));

  const queue = payload?.attention_queue;
  const counters: BandCounter[] = ATTENTION.map((def) => {
    const c = counterFrom(def.key, queue, overview.isPending, overview.isError && !payload);
    return { key: def.key, label: def.label, href: def.href, tone: def.tone, state: c.state, value: c.value, onRetry: c.state === 'error' && canRetry(overview.error) ? () => { void overview.refetch(); } : undefined };
  });
  const mineCount = risks.isPending ? null : risks.rows.filter((r) => isMine(r, me)).length;
  const myRisks: BandCounter = {
    key: 'my_risks', label: 'My risks', href: '/erm/risks?quick=mine', tone: 'neutral',
    state: risks.isError && !risks.data ? 'error' : risks.isPending ? 'loading' : me == null ? 'none' : 'ready', value: mineCount ?? undefined, onRetry: risks.isError ? () => { void risks.refetch(); } : undefined,
  };
  const total = attentionTotal(queue);

  const mode = layoutOf({ refused: false, workCount: feeds.some((f) => f.feed.isPending) ? null : work.length });
  const limit = workRowLimit(mode, narrow);
  const cats = byCategorySlices(risks.rows);
  const units = byUnitSlices(risks.rows);
  const breakdowns: Breakdown[] = [
    { id: 'by-category', title: 'By category', info: 'Active risks by the category each stores, the ones with the most critical and high risks first.', meta: risks.isPending ? undefined : `${formatCount(cats.length)} categories`, children: <SliceList slices={cats} empty="No active risks yet." /> },
    { id: 'by-unit', title: 'By business unit', info: 'Active risks by the business unit they are assigned to.', meta: risks.isPending ? undefined : `${formatCount(units.length)} units`, children: <SliceList slices={units} empty="No active risks yet." /> },
    { id: 'top-risks', title: 'Highest risks', info: 'The ten risks with the highest residual score (inherent when there is no residual), from the whole register.', children: <TopRisksList risks={topRisks(risks.rows)} /> },
  ];
  const updated = overview.dataUpdatedAt > 0 ? `Updated ${clockOf(overview.dataUpdatedAt)}` : undefined;
  const refreshAll = () => { [overview, risks, reviews, actions, kris, incidents].forEach((q) => { void q.refetch(); }); };

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/erm') ?? 'Risk Management Overview'}
        info="How the risk programme is doing, and what needs you."
        meta={<span className="inline-flex items-center gap-[2px]">{updated}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>}
        actions={(
          <>
            <Button href="/erm/risks">Risk Register</Button>
            {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => router.push('/erm/risks?new=1')}>Add risk</Button>}
          </>
        )}
      />
      <Cockpit
        mode={mode}
        narrow={narrow}
        band={(
          <CounterBand
            id="attention"
            title="Needs attention"
            info="Each count opens the records it counts, or the page that lists them. My risks are the ones you own or are the business owner of."
            total={total != null ? `${formatCount(total)} in total` : undefined}
            counters={[myRisks, ...counters]}
            narrow={narrow}
          />
        )}
        work={<WorkCard id="work" items={work} now={now} sources={feeds} limit={limit} />}
        posture={(
          <PostureCard
            id="posture" sections={overview} score={posture.score} grade={posture.grade} target={target.data?.target ?? null}
            rows={risks.rows} rowsFeed={risks} weak={weakest(sectionRows)} onOpenSections={() => setHealthOpen(true)}
          />
        )}
        breakdowns={breakdowns}
      />
      <ModuleHealth open={healthOpen} onClose={() => setHealthOpen(false)} sections={sections} score={posture.score} grade={posture.grade} />
    </div>
  );
}
