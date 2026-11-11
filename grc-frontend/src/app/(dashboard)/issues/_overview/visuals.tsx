'use client';

/**
 * The graphical part of the Issue & Incident Overview, drawn on the chart kit (components/overview/charts): the figures it leads with (a row of KpiTiles with the shape of each over twelve
 * months) and the cards under the counters (raised and closed, open by severity, by state, by age, by impact and urgency, the open backlog, who holds the issues, where they came from, how
 * well they close, the corrective actions, the incidents). Every number is worked out in chartModel.ts from the three lists the page already holds, so a figure here is the figure the
 * register shows after the click; every card loads, fails (with Retry), has nothing, or is a chart, on its own: a failed list is never an empty chart or a 0.
 */
import { useMemo, type ReactNode } from 'react';
import Link from 'next/link';
import { ProgressBar } from '@/components/ui/ds';
import {
  BarList, Cell, ChartCard, ChartGrid, DonutChart, Heatmap, KpiRow, KpiTile, SegmentBar, Swatches, TrendChart,
  OTHER, SERIES, STATUS, changeOf, deltaOf, trendText, type BarRow, type StatusColor,
} from '@/components/overview/charts';
import { SURFACE, TRACK } from '@/components/overview/charts/palette';
import { formatCount } from '@/lib/format';
import { issueSeverity } from '@/lib/statuses/issues';
import { openOf } from '@/lib/issues/issueDef';
import {
  ACTION_HUE, OWNER_SERIES, actionProgress, ageHeat, cardState, closedOnTime, flowOf, hueOfSeverity, incidentHistory, incidentSeverityParts, issueHistory, matrixHeat, oldSerious, openAt,
  ownerLoad, seriousSplit, severityParts, sourceRank, stageParts, wholeParts, AGE_COLS, type Hue, type MatrixCellLike, type OwnerRow, type Part,
} from './chartModel';
import {
  actionSlices, ageMatrix, closingRows, reopenLine, type Aggregate, type Counter, type FeedKey, type Feeds,
} from './overviewModel';

/** How to say a failure and how to ask again, per list. */
export interface ErrorInfo { message?: string; onRetry?: () => void }
export type Errors = Partial<Record<FeedKey, ErrorInfo>>;

const hueColor = (h: Hue): string => (h === 'other' ? OTHER : STATUS[h]);
const zoneOf = (severity: string | null): StatusColor | undefined => { if (!severity) return undefined; const h = hueOfSeverity(severity); return h === 'other' ? 'neutral' : h; };
const asSlices = (parts: readonly Part[]) => parts.map((p) => ({ key: p.key, label: p.label, value: p.value, color: hueColor(p.hue), href: p.href }));
const DAYS = 'vs 30 days ago';
const BEFORE = 'vs the 30 days before';
const failure = (what: string, e?: ErrorInfo) => ({ title: `Couldn't load ${what}`, message: e?.message, onRetry: e?.onRetry });
const pointsOf = (labels: readonly string[], values: readonly number[]) => labels.map((label, i) => ({ label, value: values[i] as number | null }));
const hasAny = (values: readonly number[]): boolean => values.some((v) => v > 0);
/** How a figure moved, in words with an arrow and a tone: `goodWhen` says which way is good for it (none: neutral). */
const move = (before: number, now: number, goodWhen: 'up' | 'down' | undefined, since: string) => { const d = deltaOf(changeOf([before, now]), goodWhen); return d ? { ...d, since } : null; };

// ── the figures it leads with ────────────────────────────────────────────────────────────────────────────────────────────

export interface HeroProps { now: Date; feeds: Feeds; errors: Errors; counters: readonly Counter[] }

export function IssueHero({ now, feeds, errors, counters }: HeroProps) {
  const rows = feeds.issues.rows;
  const ready = feeds.issues.state === 'ready';
  const history = useMemo(() => issueHistory(rows, now), [rows, now]);
  const flows = useMemo(() => flowOf(rows, now), [rows, now]);
  const onTime = useMemo(() => closedOnTime(rows), [rows]);
  const split = useMemo(() => seriousSplit(rows), [rows]);
  const before = useMemo(() => openAt(rows, now.getTime() - 30 * 86_400_000), [rows, now]);
  const labels = history.slots.map((s) => s.label);
  const counter = (key: string) => counters.find((c) => c.key === key);
  const fed = (key: string) => { const c = counter(key); return { value: c?.state === 'ready' && c.value !== undefined ? c.value : null, loading: c?.state === 'loading', error: c?.state === 'error' ? failure(c.label.toLowerCase(), errors.issues) : null, href: c?.href }; };
  const open = fed('open');
  const late = fed('late');
  const serious = fed('serious');
  const awaiting = fed('closing');
  const own = { loading: feeds.issues.state === 'loading', error: feeds.issues.state === 'error' ? failure('the issues', errors.issues) : null };
  const spark = (name: string, values: readonly number[]) => (ready && hasAny(values) ? { values, label: `${name}, last 12 months`, summary: trendText(name, pointsOf(labels, values)), floor: 0 } : null);
  const lateShare = open.value && late.value !== null ? Math.round((late.value / open.value) * 100) : null;
  return (
    <KpiRow>
      <KpiTile
        label="Open issues" value={open.value === null ? null : formatCount(open.value)} loading={open.loading} error={open.error} href={open.href} linkLabel={open.value === null ? undefined : `${open.value} open issues. Open the register`}
        delta={ready && open.value !== null ? move(before, open.value, 'down', DAYS) : null}
        spark={spark('Open issues at the end of each month', history.open)} note={awaiting.value ? `${formatCount(awaiting.value)} awaiting closure` : undefined}
        info="New, triage, in progress, resolution or closure review: the issues the register's Open chip keeps. The line is the issues open at the end of each month; the change is against 30 days ago."
      />
      <KpiTile
        label="Late issues" value={late.value === null ? null : formatCount(late.value)} loading={late.loading} error={late.error} href={late.href} linkLabel={late.value === null ? undefined : `${late.value} late issues. Open the register`}
        tone={late.value ? 'danger' : 'success'} progress={lateShare} note={lateShare === null ? undefined : `${lateShare}% of open issues`}
        info="Open issues whose target date has passed: the issues the register's Late chip keeps."
      />
      <KpiTile
        label="Critical or high" value={serious.value === null ? null : formatCount(serious.value)} loading={serious.loading} error={serious.error} href={serious.href} linkLabel={serious.value === null ? undefined : `${serious.value} critical or high issues. Open the register`}
        tone={serious.value ? 'danger' : 'success'} note={ready && serious.value ? `${formatCount(split.critical)} critical, ${formatCount(split.high)} high` : undefined}
        info="Open issues of critical or high severity: the issues the register's Critical or high chip keeps."
      />
      <KpiTile
        label="Raised in 30 days" value={ready ? formatCount(flows.raised.last) : null} {...own}
        delta={ready ? move(flows.raised.before, flows.raised.last, undefined, BEFORE) : null}
        spark={spark('Issues raised each month', history.raised)}
        info="Issues raised in the last 30 days (by their raised date), against the 30 days before. The line is the issues raised in each month."
      />
      <KpiTile
        label="Closed in 30 days" value={ready ? formatCount(flows.closed.last) : null} {...own}
        delta={ready ? move(flows.closed.before, flows.closed.last, 'up', BEFORE) : null}
        spark={spark('Issues closed each month', history.closed)}
        info="Issues closed in the last 30 days (by their closing date), against the 30 days before. The line is the issues closed in each month."
      />
      <KpiTile
        label="Closed on time" value={ready && onTime.of > 0 ? `${Math.round((onTime.onTime / onTime.of) * 100)}%` : null} {...own}
        progress={ready && onTime.of > 0 ? Math.round((onTime.onTime / onTime.of) * 100) : null} note={ready && onTime.of > 0 ? `${formatCount(onTime.onTime)} of ${formatCount(onTime.of)} closed issues` : undefined}
        info="Closed issues that had a target date and were closed on or before it, over all closed issues that had one: the Closed on time measure of the score. No closed issue has both dates yet."
      />
    </KpiRow>
  );
}

// ── the cards ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VisualsProps {
  now: Date;
  feeds: Feeds;
  errors: Errors;
  /** the tenant's severity matrix: its cells give the zones; without it the card still draws its counts */
  matrix: readonly MatrixCellLike[] | undefined;
  closing: { state: 'loading' | 'error' | 'ready'; data?: Aggregate; error?: ErrorInfo };
}

/** One line of facts under a chart. */
function Note({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 mt-[8px] text-ds-label text-ds-fg-muted ${className}`}>{children}</p>;
}
const SEV_NAME: Record<string, string> = { none: 'No severity' };
const sevName = (k: string): string => SEV_NAME[k] ?? issueSeverity.label(k);

export function IssueVisuals({ now, feeds, errors, matrix, closing }: VisualsProps) {
  const rows = feeds.issues.rows;
  const history = useMemo(() => issueHistory(rows, now), [rows, now]);
  const severity = useMemo(() => severityParts(rows), [rows]);
  const whole = useMemo(() => wholeParts(rows), [rows]);
  const stages = useMemo(() => stageParts(rows), [rows]);
  const age = useMemo(() => ageHeat(ageMatrix(rows, now)), [rows, now]);
  const heat = useMemo(() => matrixHeat(rows, matrix), [rows, matrix]);
  const owners = useMemo(() => ownerLoad(rows), [rows]);
  const sources = useMemo(() => sourceRank(rows), [rows]);
  const openCount = rows.filter(openOf).length;
  const issues = feeds.issues;
  const issuesState = (has: boolean) => cardState(issues, has);
  const labels = history.slots.map((s) => s.label);

  const actionRows = feeds.actions.rows;
  const progress = useMemo(() => actionProgress(actionRows, now), [actionRows, now]);
  const byStatus = useMemo(() => actionSlices(actionRows), [actionRows]);

  const incidents = feeds.incidents;
  const incidentRows = incidents?.rows ?? [];
  const incidentLine = useMemo(() => incidentHistory(incidentRows, now), [incidentRows, now]);
  const incidentSeverity = useMemo(() => incidentSeverityParts(incidentRows), [incidentRows]);

  const closingRowsList = closingRows(closing.data);
  const reopen = reopenLine(closing.data?.reopen_stats);
  const heatSeverities = heat.severity.flat().filter((s): s is string => !!s);
  const zoneKeys = Array.from(new Set(heatSeverities.map((s) => (hueOfSeverity(s) === 'other' ? 'neutral' : hueOfSeverity(s))))) as StatusColor[];
  const ownerSeries = OWNER_SERIES.filter((k) => owners.some((o) => (o.cells[k] ?? 0) > 0)).map((k) => ({ key: k, label: sevName(k), color: hueColor(hueOfSeverity(k)) }));

  return (
    <ChartGrid>
      <Cell span={8}>
        <ChartCard
          id="flow" title="Raised and closed" meta="Last 12 months" state={issuesState(rows.length > 0)} error={failure('the issues', errors.issues)} emptyText="No issues yet. They appear here once one is raised." loadingHeight={240}
          info="Issues raised in each month (by their raised date) and issues closed in it (by their closing date). The last month is the month so far. An issue closed without a closing date, and a cancelled one, is in no month's closed."
        >
          <TrendChart
            label="Issues raised and closed by month" firstColumn="Month" variant="bars" height={240}
            rows={history.slots.map((s, i) => ({ label: s.label, raised: history.raised[i], closed: history.closed[i] }))}
            series={[{ key: 'raised', label: 'Raised', color: SERIES[0] }, { key: 'closed', label: 'Closed', color: SERIES[2] }]}
          />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="severity" title="Open by severity" state={issuesState(openCount > 0)} error={failure('the issues', errors.issues)} emptyText="No open issues." loadingHeight={148}
          info="Open issues by severity, worst first. Each severity opens those issues in the register."
        >
          <DonutChart label="Open issues by severity" slices={asSlices(severity)} centre={{ value: formatCount(openCount), caption: openCount === 1 ? 'open issue' : 'open issues' }} noun="issues" />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="states" title="Issues by state" state={issuesState(rows.length > 0)} error={failure('the issues', errors.issues)} emptyText="No issues yet." loadingHeight={200}
          info="Every issue as open, closed or cancelled, and the open ones by stage of their life cycle (closure review is waiting for an approval). Each name opens those issues in the register."
        >
          <SegmentBar label="Issues by state" parts={asSlices(whole)} />
          <p className="m-0 mb-[8px] mt-[16px] text-ds-label font-[600] text-ds-fg-muted">Open, by stage</p>
          <BarList label="Open issues by stage" nameWidth={120} rows={stages.map((p): BarRow => ({ key: p.key, label: p.label, value: p.value, color: hueColor(p.hue), href: p.href }))} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="age" title="Open by severity and age" state={issuesState(age.total > 0)} error={failure('the issues', errors.issues)} emptyText="No open issues." loadingHeight={200}
          info="Open issues by severity (rows) and how long ago they were raised (columns). The red edge marks critical and high issues open for more than 30 days. An issue with no raised date is in no column."
        >
          <Heatmap
            label="Open issues by severity and age" rowTitle="Severity" colTitle="Age" noun="open issues" rows={age.rows} cols={[...AGE_COLS]} cells={age.cells}
            zone={(r, c) => (oldSerious(age.severities[r], c) ? 'bad' : undefined)}
          />
          <Note className="flex items-center gap-[6px]"><span aria-hidden className="inline-block h-[3px] w-[16px]" style={{ backgroundColor: STATUS.bad }} />Critical or high for over 30 days</Note>
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="matrix" title="Open by impact and urgency" state={issuesState(heat.placed + heat.unrated > 0)} error={failure('the issues', errors.issues)} emptyText="No open issues." loadingHeight={200}
          info="Open issues by the impact and urgency they were raised with. The coloured edge of a cell is the severity your severity matrix gives it (change the matrix in the issue settings)."
        >
          <Heatmap
            label="Open issues by impact and urgency" rowTitle="Impact" colTitle="Urgency" noun="open issues" rows={heat.rows} cols={heat.cols} cells={heat.cells}
            zone={(r, c) => zoneOf(heat.severity[r][c])}
          />
          <Note>Urgency across, high to low.{heat.unrated > 0 ? ` ${formatCount(heat.unrated)} open ${heat.unrated === 1 ? 'issue has' : 'issues have'} no impact or urgency.` : ''}</Note>
          {zoneKeys.length > 0 && <Swatches items={zoneKeys.map((z) => ({ key: z, label: z === 'bad' ? 'Critical' : z === 'warn' ? 'High' : z === 'progress' ? 'Medium' : 'Low', color: STATUS[z] }))} />}
        </ChartCard>
      </Cell>

      <Cell span={6}>
        <ChartCard
          id="backlog" title="Open backlog" meta="Last 12 months" state={issuesState(hasAny(history.open))} error={failure('the issues', errors.issues)} emptyText="No history yet. It builds up as issues are raised and closed." loadingHeight={220}
          info="The issues open at the end of each month: raised by then and not yet closed. The last point is now. Worked out from the raised and closing dates, so an issue that was cancelled, or closed with no closing date, cannot be placed and is left out."
        >
          <TrendChart
            label="Open issues at the end of each month" firstColumn="Month" variant="area" height={220}
            rows={history.slots.map((s, i) => ({ label: s.label, open: history.open[i] }))} series={[{ key: 'open', label: 'Open', color: SERIES[0] }]}
          />
          {history.unplaced > 0 && <Note>{`${formatCount(history.unplaced)} ${history.unplaced === 1 ? 'issue has' : 'issues have'} no dates to place ${history.unplaced === 1 ? 'it' : 'them'} and ${history.unplaced === 1 ? 'is' : 'are'} left out.`}</Note>}
        </ChartCard>
      </Cell>
      <Cell span={6}>
        <ChartCard
          id="owners" title="Who holds them" state={issuesState(owners.length > 0)} error={failure('the issues', errors.issues)} emptyText="No open issues." loadingHeight={220}
          info="Open issues by the person they are assigned to, the most loaded first, split by severity. Each name opens that person's open issues. Unassigned issues are their own row."
        >
          <OwnerBars rows={owners} series={ownerSeries} />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="sources" title="Raised from" state={issuesState(sources.length > 0)} error={failure('the issues', errors.issues)} emptyText="No open issues." loadingHeight={200}
          info="Open issues by the place they were raised from. Each row opens the open issues from that place."
        >
          <BarList label="Open issues by the place they were raised from" nameWidth={130} rows={sources.map((r): BarRow => ({ key: r.key, label: r.label, value: r.value, note: r.note, href: r.href }))} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="closing" title="How well issues close" state={closing.state === 'ready' ? (closingRowsList.length > 0 ? 'ready' : 'empty') : closing.state} error={failure('how issues close', closing.error)}
          emptyText="No issue has been closed yet." loadingHeight={200}
          info="Average days from raised to closed for issues closed in the last 90 days, with how many closed and the share closed by their target date (every closed issue that had one). Only issues closed with a closing date are counted."
        >
          <BarList
            label="Average days to close, by severity" nameWidth={100}
            rows={closingRowsList.map((r): BarRow => ({
              key: r.severity, label: r.label, value: r.meanDays ?? 0, valueText: r.meanDays === null ? '—' : `${r.meanDays} days`, color: hueColor(hueOfSeverity(r.severity)),
              note: `${formatCount(r.closed)} closed in 90 days${r.onTimePct === null ? '' : ` · ${r.onTimePct}% of ${formatCount(r.onTimeOf)} closed on time`}`,
            }))}
          />
          {reopen && <Note>{`${reopen}.`}</Note>}
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="actions" title="Corrective actions" meta={feeds.actions.state === 'ready' ? `${formatCount(actionRows.length)} in total` : undefined} state={cardState(feeds.actions, actionRows.length > 0)}
          error={failure('the corrective actions', errors.actions)} emptyText="No corrective actions yet." loadingHeight={200}
          info="Every corrective action by status. The share completed is the score's Actions completed measure: completed or verified actions over all actions but the cancelled ones. Each status opens those actions."
        >
          <div className="flex flex-wrap items-baseline gap-x-[8px]">
            <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{progress.pct === null ? '—' : `${progress.pct}%`}</span>
            <span className="text-ds-body text-ds-fg-muted">{`completed · ${formatCount(progress.done)} of ${formatCount(progress.live)}`}</span>
          </div>
          <ProgressBar className="mb-[12px] mt-[4px]" value={progress.pct} label="Corrective actions completed" showValue={false} tone="success" />
          <BarList label="Corrective actions by status" nameWidth={110} rows={byStatus.map((s): BarRow => ({ key: s.key, label: s.label, value: s.total, color: hueColor(ACTION_HUE[s.key] ?? 'other'), href: s.href }))} />
          {progress.late > 0 && <Note><Link href="/issues/actions?quick=late" className="rounded-ds-control font-[600] text-ds-danger hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{`${formatCount(progress.late)} late`}</Link>{' '}(open and past their due date)</Note>}
        </ChartCard>
      </Cell>

      {incidents && (
        <>
          <Cell span={8}>
            <ChartCard
              id="incident-flow" title="Incidents" meta="Last 12 months" state={cardState(incidents, incidentRows.length > 0)} error={failure('the incidents', errors.incidents)}
              emptyText="No incidents yet. They appear here once one is reported." loadingHeight={220}
              info="Incidents reported in each month (by the incident date) and resolved in it (by the resolution date). The last month is the month so far."
            >
              <TrendChart
                label="Incidents reported and resolved by month" firstColumn="Month" variant="bars" height={220}
                rows={incidentLine.slots.map((s, i) => ({ label: s.label, reported: incidentLine.reported[i], resolved: incidentLine.resolved[i] }))}
                series={[{ key: 'reported', label: 'Reported', color: SERIES[1] }, { key: 'resolved', label: 'Resolved', color: SERIES[2] }]}
              />
            </ChartCard>
          </Cell>
          <Cell span={4}>
            <ChartCard
              id="incident-severity" title="Open incidents by severity" state={cardState(incidents, incidentSeverity.length > 0)} error={failure('the incidents', errors.incidents)} emptyText="No open incidents." loadingHeight={148}
              info="Incidents not yet resolved or closed, by severity. Each severity opens those incidents."
            >
              <DonutChart label="Open incidents by severity" slices={asSlices(incidentSeverity)} centre={{ value: formatCount(incidentSeverity.reduce((a, p) => a + p.value, 0)), caption: 'open' }} noun="incidents" />
            </ChartCard>
          </Cell>
        </>
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
            <li key={r.key} className="grid items-center gap-x-[12px] gap-y-[4px] [grid-template-columns:minmax(0,1fr)_auto] min-[420px]:[grid-template-columns:150px_minmax(0,1fr)_auto]">
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
