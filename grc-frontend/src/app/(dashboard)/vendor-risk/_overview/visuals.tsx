'use client';

/**
 * The graphical part of the Third-Party Vendor Risk Overview, on the Overview chart kit (components/overview/charts): the hero row of six figures with their history, and the grid of chart cards:
 * the 12-month risk trend against the appetite, vendors by tier, tier by residual band, inherent against residual, the highest residual scores, when reviews fall due, where reviews stand, what vendors
 * wait on, findings by severity (status or age) and by domain, the contract timeline, concentration, monitoring signals by month and the latest ones, vendors by status.
 * Every card loads, fails, is refused and has nothing on its own (a failed or refused request is never drawn as a chart of zeros); what a chart draws is arranged by chartsModel.ts, from the
 * requests that already served the module's pages and from GET tpra/overview-charts. Each part that opens records is a link in a list or a table.
 */
import { useState, type ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button, ErrorState, SegmentedControl } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import {
  BarList, Cell, ChartCard, ChartGrid, DonutChart, Heatmap, KpiRow, KpiTile, Picture, SegmentBar, StackedBars, Swatches, TrendChart, SERIES,
} from '@/components/overview/charts';
import { AXIS, GRID, HOVER, TIP } from '@/components/overview/charts/palette';
import { formatCount } from '@/lib/format';
import type { Dashboard, Scope } from '../_lib/overviewModel';
import type { Bands } from '../_lib/vendorRules';
import {
  AGE_SERIES, STATUS_SERIES, SEVERITY_SERIES, TIER_SERIES, contractCategories, domainBars, findingCategories, findingFacts, gapRows, heatData, heatHref, heroTiles, nextStepBars,
  platformBars, reviewCategories, signalCategories, stackTotal, stageBars, statusParts, tierDonut, topResidualBars, trendCard,
  type ContractsAnswer, type GapRow, type OverviewCharts, type PlatformLike, type TrendAnswer,
} from './chartsModel';
import { cardOutcome, type CardFeed } from './cardState';
import { SignalList } from './parts';

const cardOf = cardOutcome;

// ── the hero row ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const TILE_LABELS = ['Vendors in use', 'Residual risk', 'Risk removed by controls', 'Open findings', 'Critical vendors assessed', 'Reviews in window'];
const TILE_INFO: Record<string, string> = {
  vendors: 'Vendors in use: not archived, not retired and not a request still waiting for a decision.',
  residual: "The portfolio's average residual score after controls (0 to 100, lower is better), against the appetite your organisation set. The line is the whole portfolio's score as last recorded in each month.",
  removed: 'Inherent score less residual score: the points of risk the controls take away. The line is the whole portfolio as last recorded in each month.',
  findings: 'Findings that are open or being fixed; those of archived vendors are not counted. The line is the whole portfolio as last recorded in each month.',
  assessed: 'Critical vendors that have a residual score, out of all critical vendors.',
  window: 'Critical and high vendors that are inside their reassessment window.',
};

export function HeroRow({ dash, trend, scope }: { dash: UseQueryResult<Dashboard>; trend: UseQueryResult<TrendAnswer>; scope: Scope }) {
  const d = dash.data;
  if (dash.isError && !d) {
    return (
      <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
        <ErrorState compact title="Couldn't load the headline figures" message={errorMessage(dash.error)} onRetry={canRetry(dash.error) ? () => { void dash.refetch(); } : undefined} />
      </div>
    );
  }
  if (!d || dash.isPlaceholderData) return <KpiRow>{TILE_LABELS.map((label) => <KpiTile key={label} label={label} value="0" loading />)}</KpiRow>;
  return (
    <KpiRow>
      {heroTiles(d, trend.data, scope, new Date(), trend.isPending).map((t) => (
        <KpiTile key={t.key} label={t.label} value={t.value} unit={t.unit} note={t.note} info={TILE_INFO[t.key]} href={t.href} linkLabel={t.linkLabel} tone={t.tone} delta={t.delta} spark={t.spark} progress={t.progress} />
      ))}
    </KpiRow>
  );
}

// ── cards that are not in the kit ────────────────────────────────────────────────────────────────────────────────────────

/** Inherent against residual, two columns per tier on one 0 to 100 axis (the same two colours as the trend). A recharts chart in a Picture: its numbers are a table for a screen reader. */
function GapChart({ rows }: { rows: GapRow[] }) {
  const data = rows.map((r) => ({ name: r.label, inherent: r.inherent, residual: r.residual }));
  return (
    <div>
      <Picture label="Inherent and residual score by tier" height={220} data={{ columns: ['Tier', 'Inherent', 'Residual', 'Vendors scored'], rows: rows.map((r) => [r.label, r.inherent, r.residual, r.vendors]) }}>
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 12, left: -10, bottom: 0 }} barCategoryGap="28%" {...focusOff}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 2" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={AXIS} axisLine={false} tickLine={false} domain={[0, 100]} allowDecimals={false} width={40} />
              <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} />
              <Bar dataKey="inherent" name="Inherent" fill={SERIES[1]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="residual" name="Residual" fill={SERIES[0]} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Picture>
      <Swatches items={[{ key: 'residual', label: 'Residual', color: SERIES[0] }, { key: 'inherent', label: 'Inherent', color: SERIES[1] }]} />
    </div>
  );
}

const PIVOT = [{ value: 'status', label: 'By status' }, { value: 'age', label: 'By age' }] as const;

function FindingsCard({ charts }: { charts: UseQueryResult<OverviewCharts> }) {
  const [view, setView] = useState<'status' | 'age'>('status');
  const f = charts.data?.findings;
  const categories = findingCategories(f, view);
  const facts = findingFacts(f);
  const nothing = stackTotal(findingCategories(f, 'status')) === 0;
  const meta = facts.open > 0 ? `${formatCount(facts.open)} open${facts.late > 0 ? `, ${formatCount(facts.late)} with a fix past its date` : ''}` : undefined;
  return (
    <ChartCard
      id="ov-findings" title="Findings by severity" meta={meta}
      info="Every finding of vendors that are not archived, by severity, split by status; By age counts only the open ones (open or being fixed) by how long ago they were raised. Each severity opens the findings of that severity."
      actions={<SegmentedControl label="Split findings" name="ov-findings-view" options={PIVOT} value={view} onChange={setView} />}
      {...cardOf([charts], nothing || (view === 'age' && stackTotal(categories) === 0), 'findings')}
      emptyText={nothing ? 'No findings yet.' : 'No findings are open.'}
    >
      <StackedBars label={view === 'status' ? 'Findings by severity and status' : 'Open findings by severity and age'} firstColumn="Severity" categories={categories} series={view === 'status' ? STATUS_SERIES : AGE_SERIES} nameWidth={72} height={190} />
    </ChartCard>
  );
}

// ── the grid ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VisualGridProps {
  scope: Scope;
  narrow: boolean;
  bands: Bands;
  dash: UseQueryResult<Dashboard>;
  trend: UseQueryResult<TrendAnswer>;
  charts: UseQueryResult<OverviewCharts>;
  contracts: UseQueryResult<ContractsAnswer>;
  concentration: UseQueryResult<PlatformLike[]>;
  me: UseQueryResult<number | null>;
}

const link = (href: string, label: string): ReactNode => <Button variant="link" size="sm" href={href}>{label}</Button>;

export function VisualGrid({ scope, narrow, bands, dash, trend, charts, contracts, concentration, me }: VisualGridProps) {
  const d = dash.data;
  const c = charts.data;
  const tcard = trendCard(trend.data);
  const tiers = tierDonut(d?.tier_counts, scope);
  const tierTotal = tiers.reduce((n, s) => n + s.value, 0);
  const heat = heatData(c?.risk_matrix);
  const gap = gapRows(d?.inherent_vs_residual, c?.risk_matrix);
  const top = topResidualBars(d?.top_residual_vendors, bands);
  const calendar = reviewCategories(c?.reviews, scope);
  const stages = stageBars(c?.stages);
  const steps = nextStepBars(d?.attention_counts, scope);
  const domains = domainBars(d?.findings_by_domain);
  const t = c?.thresholds;
  const contract = contractCategories(contracts.data?.items, scope, me.data ?? null);
  const platforms = platformBars(concentration.data);
  const signals = signalCategories(c?.signals);
  const waiting = Object.values(c?.signals.waiting ?? {}).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0);
  const status = statusParts(d?.by_status);
  const contractFeeds: CardFeed[] = scope === 'mine' ? [contracts, me] : [contracts];

  return (
    <ChartGrid>
      <Cell span={8}>
        <ChartCard
          id="ov-trend" title="Risk trend" meta="12 months, whole portfolio" loadingHeight={240}
          info="The portfolio's residual and inherent score as last recorded in each month, against the appetite your organisation set (the dashed line). A month with no record is a gap, not a zero."
          {...cardOf([trend], tcard.recorded === 0, 'the risk trend')} emptyText="No history yet. It builds up as assessments are scored."
        >
          <TrendChart
            label="Portfolio risk by month" firstColumn="Month" variant="line" height={240}
            rows={tcard.rows} series={[{ key: 'residual', label: 'Residual', color: SERIES[0] }, { key: 'inherent', label: 'Inherent', color: SERIES[1] }]}
            target={trend.data?.appetite != null ? { value: trend.data.appetite, label: `Appetite ${trend.data.appetite}` } : null}
          />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-tiers" title="Vendors by tier" loadingHeight={160}
          info="Vendors in use by their tier; vendors not yet tiered are apart. Each tier opens the register on those vendors."
          {...cardOf([dash], tierTotal === 0, 'vendors')} emptyText="No vendors yet."
        >
          <DonutChart label="Vendors by tier" slices={tiers} centre={{ value: formatCount(tierTotal), caption: 'vendors' }} noun="vendors" />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="ov-grid" title="Tier by residual risk" loadingHeight={200}
          info={`Vendors by their tier and the band of their residual score on your organisation's bands${t ? ` (critical from ${t.critical}, high from ${t.high}, medium from ${t.medium})` : ''}. A cell opens the register on its tier. Vendors without a score are in the last column.`}
          {...cardOf([charts], heat.total === 0, 'vendors')} emptyText="No vendors yet."
        >
          <Heatmap label="Vendors by tier and residual band" rowTitle="Tier" colTitle="Residual band" rows={heat.rows} cols={heat.cols} cells={heat.cells} noun="vendors" href={(r) => heatHref(heat.rowKeys[r], scope)} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-gap" title="Inherent against residual" loadingHeight={220}
          info="The average inherent and residual score of the scored vendors in each tier. The gap between the two is the risk the controls remove."
          {...cardOf([dash, charts], gap.length === 0, 'the scores')} emptyText="No scored assessments yet."
        >
          <GapChart rows={gap} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-top" title="Highest residual risk" meta="Top 8" loadingHeight={220}
          info="The vendors with the highest residual score, in the colour of their band on your organisation's bands. Each opens the vendor."
          {...cardOf([dash], top.length === 0, 'the highest risks')} emptyText="No scored assessments yet."
        >
          <BarList label="Highest residual risk by vendor" rows={top} max={100} nameWidth={150} />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="ov-calendar" title="Reviews due" loadingHeight={220}
          info="When each vendor's next reassessment falls (the earlier of its own date and its open engagements'), by tier: in 30 days, 31 to 60, 61 to 90, later. Overdue is the Reassessment overdue count. Suspended and offboarding vendors are not in it."
          {...cardOf([charts], stackTotal(calendar) === 0, 'the reviews')} emptyText="No vendor in use yet."
        >
          <StackedBars label="Vendors by next review and tier" firstColumn="Next review" layout="columns" categories={calendar} series={TIER_SERIES} height={220} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-stages" title="Where reviews stand" loadingHeight={220}
          info="The stage of each vendor's current review, in the order of the life cycle. Vendors with no review started are the last bar."
          {...cardOf([charts], stages.every((s) => s.value === 0), 'the reviews')} emptyText="No vendor in use yet."
        >
          <BarList label="Vendors by review stage" rows={stages} nameWidth={110} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-steps" title="Vendors by next step" loadingHeight={220}
          info="The one thing each vendor is waiting on, the first that holds. Each opens the register on those vendors. The Work queue counts items, so its number is higher."
          {...cardOf([dash], false, 'the next steps')}
        >
          {steps.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">{d?.kpis.active_vendors ? 'Every vendor is where it should be.' : 'No vendors yet.'}</p> : <BarList label="Vendors by next step" rows={steps} nameWidth={165} />}
        </ChartCard>
      </Cell>

      <Cell span={8}>
        <FindingsCard charts={charts} />
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-domains" title="Where open findings gather" loadingHeight={190}
          info="Findings that are open or being fixed, by the risk domain they gather in. Each opens the findings of that domain."
          {...cardOf([dash], domains.length === 0, 'the findings')} emptyText="No findings are open."
        >
          <BarList label="Open findings by domain" rows={domains} nameWidth={185} />
        </ChartCard>
      </Cell>

      <Cell span={8}>
        <ChartCard
          id="ov-contracts" title="Contract timeline"
          meta={[contract.facts.lapsed > 0 ? `${formatCount(contract.facts.lapsed)} lapsed` : '', contract.facts.decide > 0 ? `${formatCount(contract.facts.decide)} need a decision` : ''].filter(Boolean).join(' · ') || undefined}
          actions={link('/vendor-risk/contracts', 'Contracts')} loadingHeight={220}
          info={`Active contracts by the month they end or renew (the earlier of the two dates), split by the vendor's tier; contracts already past their end are in the first column.${scope === 'mine' ? ' Only your vendors.' : ''}`}
          {...cardOf(contractFeeds, contract.facts.total === 0, 'contracts')} emptyText={scope === 'mine' ? 'No active contract of your vendors ends in the next 12 months.' : 'No active contract has an end date in the next 12 months.'}
        >
          <StackedBars label="Active contracts by end month and tier" firstColumn="Ends" layout={narrow ? 'bars' : 'columns'} categories={contract.categories} series={TIER_SERIES} height={narrow ? undefined : 220} nameWidth={64} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-concentration" title="Concentration" meta="Whole portfolio" actions={link('/vendor-risk/concentration', 'All platforms')} loadingHeight={190}
          info="Platforms that two or more vendors rely on, most shared first. One failure there is several failures for us."
          {...cardOf([concentration], platforms.length === 0, 'concentration')} emptyText="No platform is shared by two vendors yet."
        >
          <BarList label="Vendors on each shared platform" rows={platforms} nameWidth={120} />
        </ChartCard>
      </Cell>

      <Cell span={5}>
        <ChartCard
          id="ov-signals" title="Monitoring signals" meta={waiting > 0 ? `${formatCount(waiting)} waiting for review` : undefined} actions={link('/vendor-risk/monitoring', 'Monitoring')} loadingHeight={200}
          info="Verified monitoring signals by the month they happened and their severity, for the last six months. Waiting counts the signals no one has reviewed yet."
          {...cardOf([charts], stackTotal(signals) === 0, 'signals')} emptyText="No signals in the last six months."
        >
          <StackedBars label="Monitoring signals by month and severity" firstColumn="Month" layout="columns" categories={signals} series={SEVERITY_SERIES} height={200} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard id="ov-latest" title="Latest signals" loadingHeight={200} info="The latest signals from outside-in monitoring." {...cardOf([dash], false, 'signals')}>
          {d && <SignalList d={d} />}
        </ChartCard>
      </Cell>
      <Cell span={3}>
        <ChartCard
          id="ov-status" title="Vendors by status" loadingHeight={80}
          info="Vendors by where they are in their life cycle."
          {...cardOf([dash], status.length === 0, 'vendors')} emptyText="No vendors yet."
        >
          <SegmentBar label="Vendors by status" parts={status} noun="vendors" />
        </ChartCard>
      </Cell>
    </ChartGrid>
  );
}
