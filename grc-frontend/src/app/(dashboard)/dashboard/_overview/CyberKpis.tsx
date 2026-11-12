'use client';

// The Cyber Security KPI card of the Performance Overview: the live KPIs as one segment bar (on target, below target, not measured; each part opens the KPI report) and the three KPIs
// furthest from their target (a row each: the KPI, its readings so far, where it stands against the target; each opens the module that owns the number). The card's title opens the
// KPI report this card reads. It used to be three tiles and a card for every live KPI with a dialog behind each (the KPI report draws every KPI and its history). The request, its key and
// its stale time are what they were (kpiShared.buildKpis, shared with the KPI Report page, still turns the rows and the live values into KPIs). A tenant with no KPI report, or a report
// with no KPIs, is said in a line; a failed request is said, with Retry; a failed live feed is said as that and never drawn as zeros; and after a read that got the live values the card
// asks the server to keep today's value (POST /kpi-live/snapshot): the GET no longer writes, so without this the KPI history would stop growing. What decides each state, and when the
// snapshot is asked for, is kpiModel.ts (tested).
import { useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { Button } from '@/components/ui/ds';
import { ChartCard, SegmentBar, Sparkline, type ChartState } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { KPI_FORMAT, buildKpis, type LiveMetric } from '@/components/dashboard/kpiShared';
import { loadOf, retryDashboard } from './overviewModel';
import { statusOfTone } from './perfCharts';
import {
  SNAPSHOT_PATH, UPLOAD_HREF, countChips, furthestFromTarget, gapWords, historyWords, kpiCounts, newestNote, panelState, reportHref, rowFacts, shouldKeepSnapshot, snapshotKeeper, stripBody,
  type Furthest, type KpiData,
} from './kpiModel';

const HEAD_INFO = 'The KPI list comes from the uploaded KPI report. Each value is computed live from the platform\'s own modules. The full list and each KPI\'s history are in the KPI report.';

// One keeper for the page: a visit that finds the same cached read (inside the 60 s stale time) asks for nothing; a new read asks once.
const keepSnapshot = snapshotKeeper(() => apiClient.post(SNAPSHOT_PATH));

const ROW = 'flex min-h-ds-control w-full min-w-0 items-center gap-x-[12px] rounded-ds-control px-[8px] py-[6px] text-left';
const ROW_LINK = 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

/** One of the KPIs furthest from its target: what it measures, its readings so far, where it stands against the target, and a link to the module that owns the number (named with how far it is). */
function FurthestRow({ f }: { f: Furthest }) {
  const facts = rowFacts(f);
  const body = (
    <>
      <span className="min-w-0 flex-1 break-words text-ds-body font-[500] text-ds-fg">{f.topic}</span>
      <span className="ml-auto flex shrink-0 items-center gap-[12px]">
        <Sparkline values={f.history} label={`${f.topic}, readings kept so far`} summary={historyWords(f)} color={STATUS.bad} floor={0} />
        <span className="text-right">
          <span className="block text-ds-body font-[600] tabular-nums text-ds-danger"><span className="sr-only">Actual </span>{facts.value}</span>
          <span className="block text-ds-label font-normal tabular-nums text-ds-fg-muted">{facts.target}</span>
        </span>
        {f.href && <ChevronRight aria-hidden className="h-[14px] w-[14px] shrink-0 text-ds-fg-muted" strokeWidth={1.75} />}
      </span>
    </>
  );
  const name = `Open ${f.topic}: ${facts.value} against a target of ${Math.round(f.target)}%, ${gapWords(f).toLowerCase()}`;
  return (
    <li className="min-w-0 border-b border-ds-border last:border-b-0" title={`${f.domain}: ${gapWords(f)}`}>
      {f.href ? <Link href={f.href} aria-label={name} className={`${ROW} ${ROW_LINK}`}>{body}</Link> : <div className={ROW}>{body}</div>}
    </li>
  );
}

/** The strip's one query, under the key the page has always used: the figures at the top of the page (Hero) read the same answer from the cache, so nothing is asked twice. */
export function useKpiLive() {
  return useQuery({
    queryKey: ['main-kpi-live'],
    queryFn: async (): Promise<KpiData> => {
      const list = (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data;
      const arr = list?.assessments || list || [];
      // no KPI report is an ANSWER (a stored null would be read as a failed request)
      if (!Array.isArray(arr) || !arr.length) return { items: [], metrics: {}, liveFailed: false, workbook: null };
      // the live values are asked for beside the rows: when only they fail the rows still count (as KPIs not measured yet) and the card says why
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
}

export function CyberKpis() {
  const query = useKpiLive();
  const panel = panelState(loadOf(query), query.data);
  const retry = () => { void query.refetch(); };

  // The GET above writes nothing: once per successful read, keep today's value of every live KPI. Silent, and no read follows it, so it cannot chain into a loop.
  const keepable = shouldKeepSnapshot(query.data);
  useEffect(() => {
    keepSnapshot({ ok: keepable, at: query.dataUpdatedAt });
  }, [keepable, query.dataUpdatedAt]);

  const common = { id: 'cyber-kpis', title: 'Cyber Security KPIs', info: HEAD_INFO } as const;
  if (panel.state === 'loading') return <ChartCard {...common} state="loading" loadingHeight={200} />;
  if (panel.state === 'error') return <ChartCard {...common} state="error" error={{ title: "Couldn't load the Cyber Security KPIs", message: errorMessage(query.error), onRetry: canRetry(query.error) ? retry : undefined }} />;
  if (panel.state === 'absent') {
    return <ChartCard {...common} state="empty" emptyText="No Cyber Security KPI report has been uploaded yet." actions={<Button size="sm" href={UPLOAD_HREF}>Upload a KPI report</Button>} />;
  }
  const href = reportHref(panel.workbook);
  const open = { href, hrefLabel: 'Open the KPI report' } as const;
  if (panel.state === 'empty') return <ChartCard {...common} {...open} state="empty" emptyText="The KPI report has no KPIs yet." />;
  if (panel.liveFailed) {
    return <ChartCard {...common} {...open} state="error" error={{ title: 'The live values could not be loaded', message: 'The KPIs in your report cannot be measured until they load.', onRetry: retry }} />;
  }

  const data = query.data as KpiData;
  const live = buildKpis(data.items as never[], data.metrics as Record<string, LiveMetric>).filter((k) => k.live);
  const counts = kpiCounts(live);
  const rows = furthestFromTarget(live);
  const body = stripBody(counts, rows);
  const state: ChartState = body === 'no_live_feed' ? 'empty' : 'ready';
  const newest = newestNote(panel.workbook);
  return (
    <ChartCard
      {...common}
      {...open}
      info={`${HEAD_INFO}${newest ? ` ${newest}.` : ''}`}
      meta={`${counts.live} live`}
      state={state}
      emptyText="No KPI in this report is measured by the platform yet."
      loadingHeight={200}
    >
      <SegmentBar
        label="Live KPIs by standing"
        noun="KPIs"
        height={16}
        parts={countChips(counts).filter((c) => c.key !== 'live').map((c) => ({ key: c.key, label: c.label, value: c.count, color: STATUS[statusOfTone(c.tone)], href }))}
      />
      {body === 'rows' && (
        <>
          <p id="cyber-kpis-furthest" className="mb-[4px] mt-[12px] text-ds-label font-[600] text-ds-fg-muted">Furthest from target</p>
          <ul aria-labelledby="cyber-kpis-furthest" className="m-0 list-none p-0">{rows.map((f) => <FurthestRow key={f.key} f={f} />)}</ul>
        </>
      )}
      {body === 'all_on_target' && <p className="mt-[12px] text-ds-body text-ds-fg-muted">Every live KPI is on target.</p>}
    </ChartCard>
  );
}
