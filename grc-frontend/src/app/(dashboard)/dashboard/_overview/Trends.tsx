'use client';

// The two histories this page can draw from the requests it already makes (no request is added for a chart): the Governance score by month (`performance.health_trend` of the
// Governance scorecard, the points that visits to this page and to Governance kept: it starts from the first one and fabricates nothing) and the tasks created and completed by month
// (`trend_data` of the tasks summary, counted from the tasks' own dates, so it has twelve months from day one). A card is drawn only for an area the person can open. Each says why
// it is empty in a plain line; a failed or refused request is its own state, never an empty chart. Each card's title opens the module the history is of (Governance, Task Management).
// The cards are cells of the page's own ChartGrid (PerfOverview). Rules: perfCharts.ts (tested).
import { Cell, ChartCard, TrendChart, type ChartState } from '@/components/overview/charts';
import { SERIES } from '@/components/overview/charts/palette';
import { governanceTrend, tasksTrend } from './perfCharts';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { retryable, type AreaRow } from './perfModel';

const stateOf = (row: AreaRow): ChartState => (row.state === 'ready' ? 'ready' : row.state === 'denied' ? 'denied' : row.state === 'error' ? 'error' : 'loading');

export function Trends({ rows, payloads, onRetry }: { rows: readonly AreaRow[]; payloads: { governance?: unknown; tasks?: unknown }; onRetry: (areaKey: string) => void }) {
  const gov = rows.find((r) => r.area.key === 'governance');
  const tasks = rows.find((r) => r.area.key === 'tasks');
  const cards = [gov, tasks].filter((r): r is AreaRow => !!r);
  if (cards.length === 0) return null;
  const span = cards.length === 1 ? 12 : 6;

  const points = gov?.state === 'ready' ? governanceTrend(payloads.governance) : [];
  const govState: ChartState = !gov ? 'empty' : gov.state !== 'ready' ? stateOf(gov) : points.length < 2 ? 'empty' : 'ready';
  const target = gov?.read?.target ?? null;

  const months = tasks?.state === 'ready' ? tasksTrend(payloads.tasks) : null;
  const taskState: ChartState = !tasks ? 'empty' : tasks.state !== 'ready' ? stateOf(tasks) : !months || !months.busy ? 'empty' : 'ready';

  return (
    <>
      {gov && (
        <Cell span={span}>
          <ChartCard
            id="governance-trend"
            title="Governance score by month"
            meta="Last 12 months"
            href="/governance"
            hrefLabel="Open Governance"
            info="The Governance score at the end of each month, from the points kept each time this page or Governance is opened. The dashed line is the target the area is scored against. The line starts at the first point kept."
            state={govState}
            loadingHeight={220}
            error={{ title: "Couldn't load the Governance score", message: errorMessage(gov.error), onRetry: retryable(gov) ? () => onRetry('governance') : undefined }}
            deniedText="Your role cannot read the Governance score."
            emptyText="No history yet. A point is kept for each month this page or Governance is opened; the line builds up from the first one."
          >
            <TrendChart
              label="Governance score by month"
              firstColumn="Month"
              rows={points.map((p) => ({ label: p.label, score: p.value }))}
              series={[{ key: 'score', label: 'Governance score', color: SERIES[0] }]}
              yMax={100}
              target={target !== null ? { value: target, label: `Target ${Math.round(target)}` } : null}
            />
          </ChartCard>
        </Cell>
      )}
      {tasks && (
        <Cell span={span}>
          <ChartCard
            id="tasks-trend"
            title="Tasks created and completed"
            meta="Last 12 months"
            href="/tasks"
            hrefLabel="Open Task Management"
            info={`Tasks created and tasks completed in each calendar month, counted from the tasks' own dates. ${months?.scope === 'mine' ? 'Only the tasks you may see are counted.' : 'It counts every task you may see.'}`}
            state={taskState}
            loadingHeight={220}
            error={{ title: "Couldn't load the tasks", message: errorMessage(tasks.error), onRetry: retryable(tasks) ? () => onRetry('tasks') : undefined }}
            deniedText="Your role cannot read the tasks."
            emptyText="No tasks were created or completed in the last 12 months."
          >
            <TrendChart
              label="Tasks created and completed by month"
              firstColumn="Month"
              variant="bars"
              rows={(months?.rows ?? []).map((m) => ({ label: m.label, created: m.created, completed: m.completed }))}
              series={[{ key: 'created', label: 'Created', color: SERIES[0] }, { key: 'completed', label: 'Completed', color: SERIES[2] }]}
            />
          </ChartCard>
        </Cell>
      )}
    </>
  );
}
