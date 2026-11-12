'use client';

/**
 * The graphic cards of the Issue & Incident Overview (Overview v2, rules R1 to R6), on the chart kit: three rows. How things stand now (the module score with its three sections, open issues by
 * severity, open issues by stage), how it moves and how old (raised and closed or the open backlog over twelve months, open issues by severity and age), and who holds it and how the work is going
 * (who holds the open issues: the four busiest and Unassigned, corrective actions by status, open incidents by severity). A card is its title, an (i) and the chart; the card's title carries an "Open"
 * link to the register it pictures and every bar, slice, legend row and heat cell opens that register already filtered (the registers read ?quick=, ?state=, ?severity=, ?assignee=, ?status=, ?sort=:
 * v2Model.ts). The register has no age filter, so a cell of the heat grid opens that severity's open issues, oldest first. Every card loads, fails (with Retry), has nothing or is a chart on its own:
 * a failed list is never an empty chart or a 0. Every number is worked out in chartModel.ts / overviewModel.ts from the three lists the page already holds.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { SegmentedControl } from '@/components/ui/ds';
import {
  BarList, Cell, ChartCard, ChartGrid, DonutChart, Heatmap, Swatches, TrendChart,
  OTHER, SERIES, STATUS, type BarRow,
} from '@/components/overview/charts';
import { SURFACE, TRACK } from '@/components/overview/charts/palette';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { formatCount } from '@/lib/format';
import { issueSeverity } from '@/lib/statuses/issues';
import { openOf } from '@/lib/issues/issueDef';
import {
  ACTION_HUE, OWNER_SERIES, actionProgress, ageHeat, cardState, hueOfSeverity, incidentSeverityParts, issueHistory, oldSerious, ownerLoad, ownerPeople, severityParts, stageParts, AGE_COLS,
  type Hue, type OwnerRow, type Part,
} from './chartModel';
import { actionSlices, ageMatrix, type FeedKey, type Feeds } from './overviewModel';
import { LINKS, TREND_LABEL, TRENDS, ageHref, type Trend } from './v2Model';
import { ScoreCard, type ScoreCardProps } from './score';

/** How to say a failure and how to ask again, per list. */
export interface ErrorInfo { message?: string; onRetry?: () => void }
export type Errors = Partial<Record<FeedKey, ErrorInfo>>;

const hueColor = (h: Hue): string => (h === 'other' ? OTHER : STATUS[h]);
const asSlices = (parts: readonly Part[]) => parts.map((p) => ({ key: p.key, label: p.label, value: p.value, color: hueColor(p.hue), href: p.href }));
const failure = (what: string, e?: ErrorInfo) => ({ title: `Couldn't load ${what}`, message: e?.message, onRetry: e?.onRetry });
const hasAny = (values: readonly number[]): boolean => values.some((v) => v > 0);
const SEV_NAME: Record<string, string> = { none: 'No severity' };
const sevName = (k: string): string => SEV_NAME[k] ?? issueSeverity.label(k);

export interface VisualsProps {
  now: Date;
  feeds: Feeds;
  errors: Errors;
  /** which twelve-month view the card shows (kept in the address) */
  trend: Trend;
  onTrend: (trend: Trend) => void;
  score: ScoreCardProps;
}

export function IssueVisuals({ now, feeds, errors, trend, onTrend, score }: VisualsProps) {
  const rows = feeds.issues.rows;
  const history = useMemo(() => issueHistory(rows, now), [rows, now]);
  const severity = useMemo(() => severityParts(rows), [rows]);
  const stages = useMemo(() => stageParts(rows), [rows]);
  const age = useMemo(() => ageHeat(ageMatrix(rows, now)), [rows, now]);
  const owners = useMemo(() => ownerLoad(rows), [rows]);
  const people = useMemo(() => ownerPeople(rows), [rows]);
  const openCount = rows.filter(openOf).length;
  const issuesState = (has: boolean) => cardState(feeds.issues, has);
  const issuesError = failure('the issues', errors.issues);

  const actionRows = feeds.actions.rows;
  const progress = useMemo(() => actionProgress(actionRows, now), [actionRows, now]);
  const byStatus = useMemo(() => actionSlices(actionRows), [actionRows]);

  const incidents = feeds.incidents;
  const incidentRows = incidents?.rows ?? [];
  const incidentSeverity = useMemo(() => incidentSeverityParts(incidentRows), [incidentRows]);
  const openIncidents = incidentSeverity.reduce((a, p) => a + p.value, 0);

  const ownerSeries = OWNER_SERIES.filter((k) => owners.some((o) => (o.cells[k] ?? 0) > 0)).map((k) => ({ key: k, label: sevName(k), color: hueColor(hueOfSeverity(k)) }));
  const trendOk = trend === 'flow' ? rows.length > 0 : hasAny(history.open);
  const wide = incidents ? 4 : 6;

  return (
    <ChartGrid>
      <Cell span={4}><ScoreCard {...score} /></Cell>
      <Cell span={4}>
        <ChartCard
          id="severity" title="Open by severity" href={LINKS.open} hrefLabel="Open the open issues in the register" state={issuesState(openCount > 0)} error={issuesError} emptyText="No open issues." loadingHeight={148}
          info="Open issues by severity, worst first. Each severity opens those issues in the register."
        >
          <DonutChart label="Open issues by severity" slices={asSlices(severity)} centre={{ value: formatCount(openCount), caption: openCount === 1 ? 'open issue' : 'open issues' }} noun="issues" />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="stages" title="Open by stage" href={LINKS.open} hrefLabel="Open the open issues in the register" state={issuesState(openCount > 0)} error={issuesError} emptyText="No open issues." loadingHeight={148}
          info="Open issues by stage of their life cycle, in order. Closure review (amber) is waiting for an approval. Each stage opens those issues in the register."
        >
          <BarList label="Open issues by stage" nameWidth={120} rows={stages.map((p): BarRow => ({ key: p.key, label: p.label, value: p.value, color: hueColor(p.hue), href: p.href }))} />
        </ChartCard>
      </Cell>

      <Cell span={8}>
        <ChartCard
          id="trend" title="Issues over time" meta="12 months" href={LINKS.register} hrefLabel="Open the issue register" state={issuesState(trendOk)} error={issuesError} loadingHeight={240}
          emptyText={trend === 'flow' ? 'No issues yet. They appear here once one is raised.' : 'No history yet. It builds up as issues are raised and closed.'}
          info="Raised and closed: issues raised in each month (by their raised date) and closed in it (by their closing date); the last month is the month so far. Open backlog: the issues open at the end of each month, the last point being now; an issue with no dates to place it is left out."
          actions={<SegmentedControl label="Show" name="trend" options={TRENDS.map((t) => ({ value: t, label: TREND_LABEL[t] }))} value={trend} onChange={onTrend} />}
        >
          {trend === 'flow' ? (
            <TrendChart
              label="Issues raised and closed by month" firstColumn="Month" variant="bars" height={240}
              rows={history.slots.map((s, i) => ({ label: s.label, raised: history.raised[i], closed: history.closed[i] }))}
              series={[{ key: 'raised', label: 'Raised', color: SERIES[0] }, { key: 'closed', label: 'Closed', color: SERIES[2] }]}
            />
          ) : (
            <TrendChart
              label="Open issues at the end of each month" firstColumn="Month" variant="area" height={240}
              rows={history.slots.map((s, i) => ({ label: s.label, open: history.open[i] }))} series={[{ key: 'open', label: 'Open', color: SERIES[0] }]}
            />
          )}
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="age" title="Open by severity and age" href={LINKS.open} hrefLabel="Open the open issues in the register" state={issuesState(age.total > 0)} error={issuesError} emptyText="No open issues." loadingHeight={200}
          info="Open issues by severity (rows) and how long ago they were raised (columns). A red edge marks critical and high issues open for more than 30 days. The register has no age filter: a cell opens that severity's open issues, the oldest first. An issue with no raised date is in no column."
        >
          <Heatmap
            label="Open issues by severity and age" rowTitle="Severity" colTitle="Age" noun="open issues" rows={age.rows} cols={[...AGE_COLS]} cells={age.cells}
            href={(r) => ageHref(age.severities[r])} zone={(r, c) => (oldSerious(age.severities[r], c) ? 'bad' : undefined)}
          />
        </ChartCard>
      </Cell>

      <Cell span={wide}>
        <ChartCard
          id="owners" title="Who holds them" href={LINKS.owners} hrefLabel="Open the open issues by person in the register" state={issuesState(owners.length > 0)} error={issuesError} emptyText="No open issues." loadingHeight={200}
          info="Open issues by the person they are assigned to, the four busiest, split by severity. Each name opens that person's open issues. Unassigned issues are their own row: nobody holds them."
        >
          <OwnerBars rows={owners} series={ownerSeries} />
          {people > owners.filter((o) => o.key !== 'none').length && (
            <Link href={LINKS.owners} className={clsx('mt-[8px] inline-block', linkClasses({ tone: 'text', size: 'label' }))}>{`See all ${formatCount(people)} people`}</Link>
          )}
        </ChartCard>
      </Cell>
      <Cell span={wide}>
        <ChartCard
          id="actions" title="Corrective actions" href={LINKS.actions} hrefLabel="Open the corrective actions" state={cardState(feeds.actions, actionRows.length > 0)} error={failure('the corrective actions', errors.actions)}
          emptyText="No corrective actions yet." loadingHeight={148}
          info="Every corrective action by status; the centre is the share completed (the score's Actions completed measure: completed or verified actions over all actions but the cancelled ones). Each status opens those actions."
        >
          <DonutChart
            label="Corrective actions by status" noun="actions" centre={{ value: progress.pct === null ? '—' : `${progress.pct}%`, caption: 'completed' }}
            slices={byStatus.map((s) => ({ key: s.key, label: s.label, value: s.total, color: hueColor(ACTION_HUE[s.key] ?? 'other'), href: s.href }))}
          />
        </ChartCard>
      </Cell>
      {incidents && (
        <Cell span={4}>
          <ChartCard
            id="incidents" title="Open incidents" href={LINKS.incidents} hrefLabel="Open the incidents" state={cardState(incidents, incidentSeverity.length > 0)} error={failure('the incidents', errors.incidents)}
            emptyText="No open incidents." loadingHeight={148}
            info="Incidents not yet resolved or closed, by severity. Each severity opens those incidents."
          >
            <DonutChart label="Open incidents by severity" slices={asSlices(incidentSeverity)} centre={{ value: formatCount(openIncidents), caption: 'open' }} noun="incidents" />
          </ChartCard>
        </Cell>
      )}
    </ChartGrid>
  );
}

// ── who holds them: ranked bars split by severity, as real links ────────────────────────────────────────────────────────────

/** Ranked horizontal bars (the kit's BarList, in the same markup) whose bar is cut into the severities of what the person holds. HTML throughout, so each name is a link a keyboard reaches and the
 *  words are the text alternative. Promote to the kit if another Overview needs a stacked ranking. */
function OwnerBars({ rows, series }: { rows: readonly OwnerRow[]; series: ReadonlyArray<{ key: string; label: string; color: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div>
      <ul aria-label="Open issues by person, split by severity" className="m-0 flex list-none flex-col gap-[8px] p-0">
        {rows.map((r) => {
          const say = series.filter((s) => (r.cells[s.key] ?? 0) > 0).map((s) => `${r.cells[s.key]} ${s.label.toLowerCase()}`).join(', ');
          const name = r.href ? <Link href={r.href} title={r.label} className="rounded-ds-control hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.label}</Link> : r.label;
          return (
            <li key={r.key} className="grid items-center gap-x-[12px] gap-y-[4px] [grid-template-columns:minmax(0,1fr)_auto] min-[420px]:[grid-template-columns:110px_minmax(0,1fr)_auto]">
              <span className="col-start-1 row-start-1 min-w-0 truncate text-ds-body text-ds-fg-body" title={r.label}>{name}</span>
              <span aria-hidden className="col-span-2 row-start-2 min-[420px]:col-span-1 min-[420px]:col-start-2 min-[420px]:row-start-1">
                <span className="block h-[8px] w-full overflow-hidden rounded-full" style={{ backgroundColor: TRACK }}>
                  <span className="flex h-[8px] overflow-hidden rounded-full" style={{ width: `${Math.max(2, (r.total / max) * 100)}%`, gap: 2, backgroundColor: SURFACE }}>
                    {series.filter((s) => (r.cells[s.key] ?? 0) > 0).map((s) => <span key={s.key} title={`${s.label}: ${r.cells[s.key]}`} className="block h-full min-w-[3px]" style={{ flexGrow: r.cells[s.key], flexBasis: 0, backgroundColor: s.color }} />)}
                  </span>
                </span>
              </span>
              <span className="col-start-2 row-start-1 min-w-[28px] text-right text-ds-body tabular-nums text-ds-fg min-[420px]:col-start-3">{formatCount(r.total)}</span>
              <span className="sr-only">{say}</span>
            </li>
          );
        })}
      </ul>
      <Swatches items={series} />
    </div>
  );
}
