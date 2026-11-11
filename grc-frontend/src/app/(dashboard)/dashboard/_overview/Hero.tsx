'use client';

// The figures the page leads with: four tiles, each a count the page can say exactly. How many scored areas reach their target, how many areas have something that needs attention
// (areas, not items: the items are in different units and the same one can be counted by two modules, so they are never added), the Governance score with where it went since last month
// (the only score that keeps a history), and how many live Cyber Security KPIs are on target (read from the strip's own request, so nothing is asked twice). Every tile has its own states:
// loading, failed with Retry, "No access", and "Not recorded" where nothing is recorded (never a 0 that stands for "no answer"). Rules and words: perfCharts.ts and perfModel.ts (tested).
import { KpiRow, KpiTile, type KpiTileProps } from '@/components/overview/charts';
import { buildKpis, type LiveMetric } from '@/components/dashboard/kpiShared';
import { errorMessage, canRetry } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { gradeStatus } from '@/lib/statuses/dashboard';
import { useKpiLive } from './CyberKpis';
import { gapText, attentionView, governanceDelta, governanceTrend, kpiFigure, nameList, shareOf } from './perfCharts';
import { kpiCounts, panelState, type KpiData } from './kpiModel';
import { loadOf } from './overviewModel';
import { retryable, type AreaRow, type Overall } from './perfModel';

const gradeTone = (grade: string | null): KpiTileProps['tone'] => (grade === 'excellent' || grade === 'good' ? 'success' : grade === 'fair' ? 'warning' : grade === 'poor' ? 'danger' : 'default');

export function Hero({ rows, overall, governance, onRetry, onRetryAll }: { rows: readonly AreaRow[]; overall: Overall; governance: unknown; onRetry: (areaKey: string) => void; onRetryAll: () => void }) {
  // 1. scored areas at their target
  const scored = overall.members.length;
  const failedScored = rows.filter((r) => r.area.kind === 'score' && r.state === 'error');
  const nothingScored = overall.state === 'none' && failedScored.length > 0;
  const atTarget: KpiTileProps = {
    label: 'Areas at target',
    info: 'How many of the scored areas you can open have a score at or above the target they are scored against. Areas with no score yet, or that did not answer, are not counted.',
    value: overall.state === 'ready' ? formatCount(overall.atTarget) : null,
    unit: scored > 0 ? `of ${formatCount(scored)} scored` : undefined,
    progress: overall.state === 'ready' ? shareOf(overall.atTarget, scored) : null,
    loading: overall.state === 'loading',
    error: nothingScored ? { title: "Couldn't load the scored areas", message: errorMessage(failedScored[0].error), onRetry: failedScored.some(retryable) ? onRetryAll : undefined } : null,
    note: overall.state === 'ready' && overall.leftOut.length > 0 ? `${nameList(overall.leftOut)} did not answer` : undefined,
  };

  // 2. areas with something that needs attention
  const view = attentionView(rows);
  const firstFailed = view.failed[0];
  const attention: KpiTileProps = {
    label: 'Areas needing attention',
    info: 'How many areas have at least one count of overdue, lapsed, breached or critical items above 0. It counts areas, not items: the counts are in different units and the same item can be counted by two modules.',
    value: view.state === 'ready' ? formatCount(view.withItems) : null,
    unit: view.state === 'ready' ? `of ${formatCount(view.reporting)} ${view.reporting === 1 ? 'area' : 'areas'}` : undefined,
    tone: view.state === 'ready' ? (view.withItems > 0 ? 'danger' : 'success') : 'default',
    href: view.state === 'ready' ? '#attention' : undefined,
    linkLabel: `${view.withItems} of ${view.reporting} areas need attention. Go to the counts`,
    loading: view.state === 'loading',
    error: view.state === 'error' ? { title: "Couldn't load what needs attention", message: errorMessage(firstFailed?.error), onRetry: view.failed.some(retryable) ? onRetryAll : undefined } : null,
    note: view.state === 'ready'
      ? (view.waiting > 0 ? `${view.waiting} still loading` : view.failed.length > 0 ? `${nameList(view.failed.map((r) => r.area.label))} could not be read` : view.withItems === 0 ? 'Nothing is overdue, lapsed or breached' : undefined)
      : undefined,
  };

  // 3. the Governance score and its history
  const gov = rows.find((r) => r.area.key === 'governance');
  const points = gov?.state === 'ready' ? governanceTrend(governance) : [];
  const history = governanceDelta(points);
  const govRead = gov?.read ?? null;
  const governanceTile: KpiTileProps | null = gov ? {
    label: 'Governance score',
    info: 'The Governance scorecard\'s score. Its history is the point kept at the end of each month this page or Governance is opened; the arrow says what changed since the month before.',
    value: gov.state === 'ready' && govRead && govRead.score !== null ? formatCount(Math.round(govRead.score)) : null,
    unit: '/ 100',
    tone: gradeTone(govRead?.grade ?? null),
    href: '/governance',
    linkLabel: `Governance score ${govRead?.score !== null && govRead ? Math.round(govRead.score) : ''}. Open Governance`,
    delta: points.length >= 2 && history.delta ? { ...history.delta, since: 'since last month' } : null,
    spark: points.length >= 2 ? { values: history.values, label: 'Governance score by month', summary: history.summary, floor: 0 } : null,
    loading: gov.state === 'loading',
    denied: gov.state === 'denied',
    error: gov.state === 'error' ? { title: "Couldn't load Governance", message: errorMessage(gov.error), onRetry: retryable(gov) ? () => onRetry('governance') : undefined } : null,
    note: gov.state === 'ready' && govRead && govRead.score !== null
      ? [govRead.grade ? gradeStatus.label(govRead.grade) : '', gapText(govRead.score, govRead.target)].filter(Boolean).join(' · ') + (points.length < 2 ? ' · No history yet' : '')
      : undefined,
  } : null;

  // 4. live Cyber Security KPIs on target, from the strip's own request
  const query = useKpiLive();
  const panel = panelState(loadOf(query), query.data);
  const data = query.data as KpiData | undefined;
  const counts = panel.state === 'ready' && !panel.liveFailed && data ? kpiCounts(buildKpis(data.items as never[], data.metrics as Record<string, LiveMetric>).filter((k) => k.live)) : null;
  const figure = kpiFigure(panel, counts);
  const kpis: KpiTileProps = {
    label: 'Cyber KPIs on target',
    info: figure.failedLive
      ? 'The KPI report is there, but the platform could not load the live values, so nothing can be measured yet.'
      : 'How many of the live Cyber Security KPIs are at or above their target. A live KPI is one the platform measures from its own modules; the rest are in the KPI report.',
    value: figure.state === 'value' ? formatCount(figure.on ?? 0) : null,
    unit: figure.state === 'value' ? `of ${formatCount(figure.live ?? 0)} live` : undefined,
    progress: figure.state === 'value' ? shareOf(figure.on ?? 0, figure.live ?? 0) : null,
    href: figure.state === 'value' ? '#cyber-kpis' : undefined,
    linkLabel: `${figure.on ?? 0} of ${figure.live ?? 0} live Cyber Security KPIs are on target. Go to the KPIs`,
    loading: figure.state === 'loading',
    error: figure.state === 'error' ? { title: "Couldn't load the Cyber Security KPIs", message: errorMessage(query.error), onRetry: canRetry(query.error) ? () => { void query.refetch(); } : undefined } : null,
  };

  const tiles = [atTarget, attention, governanceTile, kpis].filter((t): t is KpiTileProps => t !== null);
  return (
    <KpiRow>
      {tiles.map((t) => <KpiTile key={t.label} {...t} />)}
    </KpiRow>
  );
}
