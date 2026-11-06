'use client';

// The Cyber Security KPIs of the Performance Overview: the KPI workbook's list (the catalog), its live values from the platform's own modules, three counts and
// one card for each live KPI; a card opens the detail of how its number is computed. The request, its key and its stale time are what they were
// (kpiShared.buildKpis, shared with the KPI Report page, still turns the rows and the live values into KPIs). What is new: a failed request is said, with Retry
// (it used to make the whole panel disappear, the same as "no workbook"); a failed live feed is said as that (it used to read "No live module feeds matched this
// catalog yet"); every number is 12px or more; the trend is drawn without stretched text and has its numbers in words; the detail is a kit dialog.
// What decides each state is kpiModel.ts (tested). The shared kpiShared.tsx (its trend, its dialog) is left to the KPI Report page.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import apiClient from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, EmptyState, Notice, ProgressBar, SectionCard, Skeleton, StatTile, StatusPill, Table, TableFrame, TBody, Td, Th, THead, Tr, RowHeaderCell } from '@/components/ui/ds';
import { formatCount, formatPercent } from '@/lib/format';
import { TONE, statusPill } from '@/lib/status';
import { kpiTarget } from '@/lib/statuses/dashboard';
import { KPI_FORMAT, buildKpis, type Kpi, type LiveMetric } from '@/components/dashboard/kpiShared';
import { FOCUS, FailedRow, Loading, useSlow } from './parts';
import { loadOf, retryDashboard } from './overviewModel';
import {
  KPI_REPORT_HREF, cardLabel, directionText, kpiCounts, lastCardSpan, ofText, panelState, readingDay, readings, recentPeriods, spark, targetRule, targetState, trendSummary,
  type KpiData,
} from './kpiModel';

// SVG attributes cannot read a class, so the two colours of the trend are written as hex: the brand (--ds-primary) and the tone table's neutral grey
const BRAND = '#0f766e';
const GREY = TONE.neutral.dot;
const SPAN = ['', '', 'lg:col-span-2', 'lg:col-span-3'];

/** The tone a KPI is drawn in: the words of its figure are the tone table's own (4.5:1 on white), never a bare hex. */
const figureColor = (k: Kpi): string => TONE[kpiTarget.tone(targetState(k))].text;

/** The trend of a KPI as a line against its dashed target line; the last reading is a dot drawn in HTML (an SVG circle in a stretched box is an ellipse). With one
 *  reading or none there is no line: the bar of the actual value stands in for it. */
function Trend({ k }: { k: Kpi }) {
  const line = spark(k.history, k.target);
  const pts = readings(k.history);
  if (!line) return <ProgressBar value={k.actual} label={`${k.topic}, actual`} showValue={false} tone={k.onTarget === false ? 'danger' : k.onTarget ? 'success' : 'primary'} className="mt-[12px]" />;
  return (
    <div className="mt-[8px]">
      <div className="relative h-[48px] w-full">
        <svg aria-hidden viewBox={`0 0 ${line.width} ${line.height}`} preserveAspectRatio="none" className="h-full w-full">
          {line.targetY != null && <line x1="4" x2={line.width - 4} y1={line.targetY} y2={line.targetY} stroke={GREY} strokeWidth="1" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
          <polyline points={line.points} fill="none" stroke={BRAND} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        <span aria-hidden className="absolute h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ds-primary" style={{ left: `${line.last.left}%`, top: `${line.last.top}%` }} />
      </div>
      <span className="mt-[4px] flex justify-between gap-[8px] text-ds-label font-normal text-ds-fg-muted">
        <span>{readingDay(pts[0].date)}</span>
        <span>{readingDay(pts[pts.length - 1].date)}</span>
      </span>
    </div>
  );
}

function KpiCard({ k, onOpen }: { k: Kpi; onOpen: () => void }) {
  const state = targetState(k);
  const pill = statusPill(kpiTarget, state);
  const of = ofText(k);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-label={cardLabel(k, pill.label)}
      className={`flex h-full w-full min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface p-[12px] text-left hover:border-ds-border-strong ${FOCUS}`}
    >
      <span className="flex items-start justify-between gap-[12px]">
        <span className="min-w-0">
          <span title={k.domain.length > 40 ? k.domain : undefined} className="line-clamp-2 break-words text-ds-label text-ds-fg-muted">{k.domain}</span>
          <span className="mt-[2px] block break-words text-ds-body font-[500] text-ds-fg">{k.topic}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[20px] font-[600] leading-[28px] tabular-nums" style={{ color: figureColor(k) }}>{formatPercent(k.actual)}</span>
          <span className="block text-ds-label font-normal text-ds-fg-muted">{k.target != null ? `Target ${formatPercent(k.target)}` : 'No target'}</span>
        </span>
      </span>
      <Trend k={k} />
      <span className="mt-[8px] flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[4px]">
        <StatusPill {...pill} size="sm" />
        {of && <span className="text-ds-label font-normal tabular-nums text-ds-fg-muted">{of}</span>}
      </span>
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-ds-label text-ds-fg-muted">{label}</dt>
      <dd className="break-words text-ds-body text-ds-fg">{children}</dd>
    </div>
  );
}

/** How a KPI's number is computed, and its latest readings: the detail the shared dialog showed, at 12px or more. */
function KpiDetail({ k }: { k: Kpi }) {
  const pill = statusPill(kpiTarget, targetState(k));
  const periods = recentPeriods(k.history, k.target);
  return (
    <div className="space-y-[20px] p-[20px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill {...pill} />
        <span className="text-ds-label font-normal text-ds-fg-muted">Computed live from the platform</span>
      </div>
      <dl className="grid gap-x-[16px] gap-y-[12px] sm:grid-cols-2">
        <Fact label="Actual"><span className="tabular-nums" style={{ color: figureColor(k) }}>{formatPercent(k.actual)}</span></Fact>
        <Fact label="Target"><span className="tabular-nums">{formatPercent(k.target)}</span></Fact>
        <Fact label="On target when">{targetRule(k)}</Fact>
        <Fact label="Direction">{directionText(k)}</Fact>
        <Fact label="Source">{k.source}</Fact>
      </dl>
      <section aria-labelledby="kpi-how">
        <h3 id="kpi-how" className="!text-ds-section !text-ds-fg">How this is computed</h3>
        <p className="mt-[4px] text-ds-body text-ds-fg-body">
          <span className="tabular-nums">{k.numerator ?? '—'}</span>{' ÷ '}<span className="tabular-nums">{k.denominator ?? '—'}</span>{' = '}<span className="tabular-nums font-[600]">{formatPercent(k.actual)}</span>
        </p>
        {k.formula && <p className="mt-[4px] text-ds-body text-ds-fg-muted">{k.formula}</p>}
        <p className="mt-[8px] text-ds-body text-ds-fg-muted">{`It recalculates as ${k.source} changes. It is not entered by hand.`}</p>
        {k.href && <div className="mt-[8px]"><Button href={k.href} variant="link" rightIcon={<ArrowRight aria-hidden />}>{`Open ${k.source.split(' - ')[0]}`}</Button></div>}
      </section>
      <section aria-labelledby="kpi-readings">
        <h3 id="kpi-readings" className="!text-ds-section !text-ds-fg">Readings</h3>
        <p className="mt-[4px] text-ds-body text-ds-fg-muted">{trendSummary(k.history, k.target)}</p>
        {periods.length > 0 && (
          <TableFrame aria-label="Latest readings" className="mt-[8px]">
            <Table caption={`Latest readings of ${k.topic}`}>
              <THead>
                <Tr>
                  <Th>Day</Th>
                  <Th align="right">Actual</Th>
                  {k.target != null && <Th align="right">Target</Th>}
                  {k.target != null && <Th align="right">Difference</Th>}
                </Tr>
              </THead>
              <TBody>
                {periods.map((p) => (
                  <Tr key={p.date}>
                    <RowHeaderCell>{p.day}</RowHeaderCell>
                    <Td align="right" className="tabular-nums">{formatPercent(p.value)}</Td>
                    {p.target != null && <Td align="right" className="tabular-nums">{formatPercent(p.target)}</Td>}
                    {p.variance != null && <Td align="right" className="tabular-nums">{`${p.variance > 0 ? '+' : ''}${p.variance} pp`}</Td>}
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableFrame>
        )}
      </section>
    </div>
  );
}

const HEAD_INFO = 'The KPI list comes from the uploaded KPI workbook. Each value is computed live from the platform\'s own modules; manage the full catalog on the KPI Report page.';

export function CyberKpis() {
  const [selected, setSelected] = useState<Kpi | null>(null);
  const query = useQuery({
    queryKey: ['main-kpi-live'],
    queryFn: async (): Promise<KpiData | null> => {
      const list = (await apiClient.get('/compliance/assessments', { params: { limit: 50, assessment_format: KPI_FORMAT } })).data;
      const arr = list?.assessments || list || [];
      if (!Array.isArray(arr) || !arr.length) return null;
      // the live values are asked for beside the rows: when only they fail the rows still show (as KPIs not measured yet) and the panel says why
      let liveFailed = false;
      const [detail, live] = await Promise.all([
        apiClient.get(`/compliance/assessments/${arr[0].id}`).then((r) => r.data),
        apiClient.get('/compliance/assessments/kpi-live').then((r) => r.data).catch(() => { liveFailed = true; return { metrics: {} }; }),
      ]);
      return { items: detail?.items || [], metrics: (live?.metrics || {}) as Record<string, LiveMetric>, liveFailed };
    },
    staleTime: 60_000,
    retry: retryDashboard,
  });
  const slow = useSlow(query.isPending);
  const panel = panelState(loadOf(query), query.data);
  const retry = () => { void query.refetch(); };

  if (panel.state === 'absent') return null;
  if (panel.state === 'loading') {
    return (
      <SectionCard id="cyber-kpis" title="Cyber Security KPIs" info={HEAD_INFO}>
        <Loading label="Loading the Cyber Security KPIs" slow={slow}>
          <div className="grid grid-cols-3 gap-[8px]">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] w-full" />)}</div>
          <div className="mt-[12px] grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[148px] w-full" />)}</div>
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

  const data = query.data as KpiData;
  const live = buildKpis(data.items as never[], data.metrics as Record<string, LiveMetric>).filter((k) => k.live);
  const counts = kpiCounts(live);
  return (
    <>
      <SectionCard
        id="cyber-kpis"
        title="Cyber Security KPIs"
        info={HEAD_INFO}
        meta={`${counts.live} live ${counts.live === 1 ? 'KPI' : 'KPIs'} across ${counts.domains} ${counts.domains === 1 ? 'domain' : 'domains'}`}
        actions={<Button href={KPI_REPORT_HREF} rightIcon={<ArrowRight aria-hidden />}>Open KPI Report</Button>}
      >
        <div className="grid grid-cols-3 gap-[8px]">
          <StatTile label="Live KPIs" value={formatCount(counts.live)} />
          <StatTile label="On target" value={formatCount(counts.onTarget)} tone={counts.onTarget > 0 ? 'success' : 'default'} />
          <StatTile label="Below target" value={formatCount(counts.below)} tone={counts.below > 0 ? 'danger' : 'success'} />
        </div>
        {panel.liveFailed && (
          <Notice tone="warning" title="The live values could not be loaded" className="mt-[12px]" action={<Button size="sm" onClick={retry}>Retry</Button>}>
            The KPIs from your workbook cannot be measured until they load.
          </Notice>
        )}
        {live.length > 0 ? (
          <ul className="mt-[12px] grid gap-[12px] sm:grid-cols-2 lg:grid-cols-3">
            {live.map((k, i) => (
              <li key={i} className={`min-w-0 ${SPAN[lastCardSpan(i, live.length)]}`}>
                <KpiCard k={k} onOpen={() => setSelected(k)} />
              </li>
            ))}
          </ul>
        ) : (
          !panel.liveFailed && (
            <EmptyState
              kind="firstUse"
              bare
              className="mt-[12px]"
              title="No live module feeds matched this catalog yet"
              description="KPI workbook rows need a cybersecurity domain that maps to platform data (vulnerabilities, incidents, assets, governance reviews). Upload or seed a KPI report to get started."
            />
          )
        )}
      </SectionCard>
      <AnimatedModal isOpen={selected != null} onClose={() => setSelected(null)} size="lg" title={selected?.topic} subtitle={selected?.domain}>
        {selected && <KpiDetail k={selected} />}
      </AnimatedModal>
    </>
  );
}
