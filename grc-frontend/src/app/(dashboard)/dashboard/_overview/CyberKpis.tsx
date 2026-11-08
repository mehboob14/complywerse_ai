'use client';

// The Cyber Security KPI strip of the Performance Overview: one line of counts (live KPIs, on target, below target), the three KPIs furthest from their target, and
// Open KPI Report, which goes straight to the report this strip reads. It used to be three tiles and a card for every live KPI with a dialog behind each (about 750 px
// that repeated the KPI report, which draws every KPI and its history). The request, its key and its stale time are what they were (kpiShared.buildKpis, shared with the
// KPI Report page, still turns the rows and the live values into KPIs). What is new: a tenant with no KPI report, or a report with no KPIs, is said (it used to be a
// silent nothing, or "couldn't load"); a failed request is said, with Retry; a failed live feed is said as that and never drawn as zeros; and after a read that got the live
// values the strip asks the server to keep today's value (POST /kpi-live/snapshot): the GET no longer writes, so without this the KPI history would stop growing.
// What decides each state, and when the snapshot is asked for, is kpiModel.ts (tested).
import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { Button, CountRow, Notice, SectionCard, Skeleton } from '@/components/ui/ds';
import { KPI_FORMAT, buildKpis, type LiveMetric } from '@/components/dashboard/kpiShared';
import { FailedRow, Loading, useSlow } from './parts';
import { loadOf, retryDashboard } from './overviewModel';
import {
  SNAPSHOT_PATH, UPLOAD_HREF, countChips, furthestFromTarget, kpiCounts, newestNote, panelState, reportHref, rowFacts, shouldKeepSnapshot, snapshotKeeper, stripBody,
  type Furthest, type KpiData,
} from './kpiModel';

const HEAD_INFO = 'The KPI list comes from the uploaded KPI report. Each value is computed live from the platform\'s own modules. The full list and each KPI\'s history are in the KPI report.';

// One keeper for the page: a visit that finds the same cached read (inside the 60 s stale time) asks for nothing; a new read asks once.
const keepSnapshot = snapshotKeeper(() => apiClient.post(SNAPSHOT_PATH));

const ROW = 'flex min-h-ds-control w-full min-w-0 flex-wrap items-center gap-x-[12px] gap-y-[4px] rounded-ds-control px-[8px] py-[8px] text-left';
const ROW_LINK = 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

/** One of the KPIs furthest from its target: what it measures, where it stands against the target and by how much (in words), and a link to the module that owns the number. */
function FurthestRow({ f }: { f: Furthest }) {
  const facts = rowFacts(f);
  const body = (
    <>
      <span className="min-w-0 flex-1 basis-[14rem]">
        <span className="block break-words text-ds-body font-[500] text-ds-fg">{f.topic}</span>
        <span className="block break-words text-ds-label font-normal text-ds-fg-muted">{f.domain}</span>
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-[8px]">
        <span className="text-right">
          <span className="block text-ds-body font-[600] tabular-nums text-ds-danger"><span className="sr-only">Actual </span>{facts.value}</span>
          <span className="block text-ds-label font-normal tabular-nums text-ds-fg-muted">{facts.target}<span aria-hidden>{' · '}</span><span className="sr-only">, </span>{facts.gap}</span>
        </span>
        {f.href && <ChevronRight aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />}
      </span>
    </>
  );
  return (
    <li className="min-w-0 border-b border-ds-border last:border-b-0">
      {f.href ? <Link href={f.href} className={`${ROW} ${ROW_LINK}`}>{body}</Link> : <div className={ROW}>{body}</div>}
    </li>
  );
}

export function CyberKpis() {
  const query = useQuery({
    queryKey: ['main-kpi-live'],
    queryFn: async (): Promise<KpiData> => {
      const list = (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data;
      const arr = list?.assessments || list || [];
      // no KPI report is an ANSWER (a stored null would be read as a failed request)
      if (!Array.isArray(arr) || !arr.length) return { items: [], metrics: {}, liveFailed: false, workbook: null };
      // the live values are asked for beside the rows: when only they fail the rows still count (as KPIs not measured yet) and the strip says why
      let liveFailed = false;
      const [detail, live] = await Promise.all([
        apiClient.get(`/compliance/assessments/${arr[0].id}`).then((r) => r.data),
        apiClient.get('/compliance/assessments/kpi-live').then((r) => r.data).catch(() => { liveFailed = true; return { metrics: {} }; }),
      ]);
      return { items: detail?.items || [], metrics: (live?.metrics || {}) as Record<string, LiveMetric>, liveFailed, workbook: { id: Number(arr[0].id), total: typeof list?.total === 'number' ? list.total : arr.length } };
    },
    staleTime: 60_000,
    retry: retryDashboard,
  });
  const slow = useSlow(query.isPending);
  const panel = panelState(loadOf(query), query.data);
  const retry = () => { void query.refetch(); };

  // The GET above writes nothing: once per successful read, keep today's value of every live KPI. Silent, and no read follows it, so it cannot chain into a loop.
  const keepable = shouldKeepSnapshot(query.data);
  useEffect(() => {
    keepSnapshot({ ok: keepable, at: query.dataUpdatedAt });
  }, [keepable, query.dataUpdatedAt]);

  if (panel.state === 'loading') {
    return (
      <SectionCard id="cyber-kpis" title="Cyber Security KPIs" info={HEAD_INFO}>
        <Loading label="Loading the Cyber Security KPIs" slow={slow}>
          <div className="flex flex-wrap gap-[8px]">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[32px] w-[120px]" />)}</div>
          <div className="mt-[12px] flex flex-col gap-[8px]">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[52px] w-full" />)}</div>
        </Loading>
      </SectionCard>
    );
  }
  if (panel.state === 'error') {
    return (
      <SectionCard id="cyber-kpis" title="Cyber Security KPIs" info={HEAD_INFO}>
        <FailedRow title="Couldn't load the Cyber Security KPIs" error={query.error} onRetry={retry} />
      </SectionCard>
    );
  }
  if (panel.state === 'absent') {
    return (
      <SectionCard id="cyber-kpis" title="Cyber Security KPIs" info={HEAD_INFO} actions={<Button href={UPLOAD_HREF} rightIcon={<ArrowRight aria-hidden />}>Upload a KPI report</Button>}>
        <p className="text-ds-body text-ds-fg-muted">No Cyber Security KPI report has been uploaded yet.</p>
      </SectionCard>
    );
  }
  if (panel.state === 'empty') {
    return (
      <SectionCard id="cyber-kpis" title="Cyber Security KPIs" info={HEAD_INFO} meta={newestNote(panel.workbook)} actions={<Button href={reportHref(panel.workbook)} rightIcon={<ArrowRight aria-hidden />}>Open KPI Report</Button>}>
        <p className="text-ds-body text-ds-fg-muted">The KPI report has no KPIs yet.</p>
      </SectionCard>
    );
  }

  const data = query.data as KpiData;
  const live = buildKpis(data.items as never[], data.metrics as Record<string, LiveMetric>).filter((k) => k.live);
  const counts = kpiCounts(live);
  const rows = furthestFromTarget(live);
  const body = stripBody(counts, rows);
  return (
    <SectionCard
      id="cyber-kpis"
      title="Cyber Security KPIs"
      info={HEAD_INFO}
      meta={newestNote(panel.workbook)}
      actions={<Button href={reportHref(panel.workbook)} rightIcon={<ArrowRight aria-hidden />}>Open KPI Report</Button>}
    >
      {panel.liveFailed ? (
        <Notice tone="warning" title="The live values could not be loaded" action={<Button size="sm" onClick={retry}>Retry</Button>}>
          The KPIs in your report cannot be measured until they load.
        </Notice>
      ) : (
        <>
          <ul aria-label="KPIs by standing" className="flex flex-wrap gap-[8px]">
            {countChips(counts).map((c) => <CountRow key={c.key} layout="chip" label={c.label} count={c.count} tone={c.tone} />)}
          </ul>
          {body === 'rows' && (
            <div className="mt-[16px]">
              <p id="cyber-kpis-furthest" className="mb-[4px] text-ds-label font-[600] text-ds-fg-muted">Furthest from target</p>
              <ul aria-labelledby="cyber-kpis-furthest">{rows.map((f) => <FurthestRow key={f.key} f={f} />)}</ul>
            </div>
          )}
          {body === 'all_on_target' && <p className="mt-[12px] text-ds-body text-ds-fg-muted">Every live KPI is on target.</p>}
          {body === 'no_live_feed' && <p className="mt-[12px] text-ds-body text-ds-fg-muted">No KPI in this report is measured by the platform yet.</p>}
        </>
      )}
    </SectionCard>
  );
}
