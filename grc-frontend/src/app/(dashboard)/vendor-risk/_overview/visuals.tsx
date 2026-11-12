'use client';

/**
 * The graphical part of the Third-Party Vendor Risk Overview (Overview v2), on the chart kit (components/overview/charts): the hero row of six figures (the last, Needs attention, is one number and
 * a thin bar of how urgent) and the grid of chart cards: the 12-month risk trend against the appetite, vendors by tier, tier by residual band, the highest residual scores, findings by severity,
 * when reviews fall due, where reviews stand, what vendors wait on, the contract timeline, monitoring signals and shared platforms. Posture first, and nothing here is a list longer than five rows:
 * the rest is "See all". Every part opens the vendor register, the findings, the contracts or the module's page, filtered where that page can filter (chartsModel.ts holds every address).
 * Every card loads, fails, is refused and has nothing on its own (a failed or refused request is never drawn as a chart of zeros).
 * (i) notes carry the explanations; a card is its title, the chart and, for a list, "See all".
 */
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import type { UseQueryResult } from '@tanstack/react-query';
import { ErrorState, SegmentedControl } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { linkClasses } from '@/components/ui/ds/linkModel';
import {
  BarList, Cell, ChartCard, ChartGrid, DonutChart, Heatmap, KpiRow, KpiTile, SegmentBar, StackedBars, TrendChart, SERIES,
} from '@/components/overview/charts';
import { formatCount } from '@/lib/format';
import type { Dashboard, Scope } from '../_lib/overviewModel';
import type { Bands } from '../_lib/vendorRules';
import {
  AGE_SERIES, CONTRACTS, DEPENDENCIES, MONITORING, STATUS_SERIES, SEVERITY_SERIES, TIER_SERIES, contractCategories, findingCategories, heatData, heatHref, heroTiles, nextStepBars,
  platformBars, reviewCategories, signalCategories, stackTotal, stageBars, tierDonut, topResidualBars, trendCard,
  type ContractsAnswer, type OverviewCharts, type PlatformLike, type TrendAnswer,
} from './chartsModel';
import { cardOutcome, type CardFeed } from './cardState';

const cardOf = cardOutcome;

// ── the hero row ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const TILE_LABELS = ['Vendors in use', 'Residual risk', 'Open findings', 'Critical vendors assessed', 'Reviews in window', 'Needs attention'];
const TILE_INFO: Record<string, string> = {
  vendors: 'Vendors in use: not archived, not retired and not a request still waiting for a decision.',
  residual: "The portfolio's average residual score after controls (0 to 100, lower is better), against the appetite your organisation set. The line is the whole portfolio's score as last recorded in each month.",
  findings: 'Findings that are open or being fixed; those of archived vendors are not counted. The line is the whole portfolio as last recorded in each month.',
  assessed: 'Critical vendors that have a residual score, out of all critical vendors.',
  window: 'Critical and high vendors that are inside their reassessment window.',
  attention: 'Vendors that wait on a next step (the register shows the one thing each waits on). The bar splits them: urgent (late, suspended, documents expired), to fix (something is missing) and in hand (someone is on it). It opens the Work queue.',
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
        <KpiTile key={t.key} label={t.label} value={t.value} unit={t.unit} note={t.note} info={TILE_INFO[t.key]} href={t.href} linkLabel={t.linkLabel} tone={t.tone} delta={t.delta} spark={t.spark} progress={t.progress}>
          {t.bar && <SegmentBar label="Vendors by urgency" parts={t.bar} height={6} legend={false} noun="vendors" />}
        </KpiTile>
      ))}
    </KpiRow>
  );
}

// ── a list's "See all" ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The end of a list of five: "See all 12", named for where it goes. Only when there is more than the list shows. */
function SeeAll({ shown, total, href, name }: { shown: number; total: number; href: string; name: string }) {
  if (total <= shown) return null;
  return (
    <div className="mt-[8px] text-right">
      <Link href={href} aria-label={`See all ${formatCount(total)}: ${name}`} className={clsx('inline-flex', linkClasses({ tone: 'text', size: 'label' }))}>{`See all ${formatCount(total)}`}</Link>
    </div>
  );
}

const PIVOT = [{ value: 'status', label: 'Status' }, { value: 'age', label: 'Age' }] as const;
export type FindingsView = (typeof PIVOT)[number]['value'];

// ── the grid ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface VisualGridProps {
  scope: Scope;
  narrow: boolean;
  bands: Bands;
  /** the findings card's split (the address keeps it) */
  findings: FindingsView;
  onFindings: (view: FindingsView) => void;
  dash: UseQueryResult<Dashboard>;
  trend: UseQueryResult<TrendAnswer>;
  charts: UseQueryResult<OverviewCharts>;
  contracts: UseQueryResult<ContractsAnswer>;
  concentration: UseQueryResult<PlatformLike[]>;
  me: UseQueryResult<number | null>;
  /** the last cell of the grid: the person's own work, slim */
  work: ReactNode;
}

const REGISTER_BY_RISK = '/vendor-risk/vendors?sort=risk:asc';

export function VisualGrid({ scope, narrow, bands, findings, onFindings, dash, trend, charts, contracts, concentration, me, work }: VisualGridProps) {
  const d = dash.data;
  const c = charts.data;
  const tcard = trendCard(trend.data);
  const tiers = tierDonut(d?.tier_counts, scope);
  const tierTotal = tiers.reduce((n, s) => n + s.value, 0);
  const heat = heatData(c?.risk_matrix);
  const top = topResidualBars(d?.top_residual_vendors, bands);
  const calendar = reviewCategories(c?.reviews, scope);
  const stages = stageBars(c?.stages, scope);
  const steps = nextStepBars(d?.attention_counts, scope);
  const t = c?.thresholds;
  const contract = contractCategories(contracts.data?.items, scope, me.data ?? null);
  const platforms = platformBars(concentration.data);
  const signals = signalCategories(c?.signals);
  const kinds = findingCategories(c?.findings, 'status');
  const nothingFound = stackTotal(kinds) === 0;
  const contractFeeds: CardFeed[] = scope === 'mine' ? [contracts, me] : [contracts];

  return (
    <ChartGrid>
      <Cell span={8}>
        <ChartCard
          id="ov-trend" title="Risk trend" meta={scope === 'mine' ? 'Whole portfolio' : undefined} href={REGISTER_BY_RISK} hrefLabel="the vendor register, highest risk first" loadingHeight={240}
          info="The portfolio's residual and inherent score for the last 12 months (whole portfolio), against the appetite your organisation set (the dashed line). A month with no record is a gap, not a zero."
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
          id="ov-tiers" title="Vendors by tier" href="/vendor-risk/vendors" hrefLabel="the vendor register" loadingHeight={160}
          info="Vendors in use by their tier; vendors not yet tiered are apart. Each tier opens the register on those vendors."
          {...cardOf([dash], tierTotal === 0, 'vendors')} emptyText="No vendors yet."
        >
          <DonutChart label="Vendors by tier" slices={tiers} centre={{ value: formatCount(tierTotal), caption: 'vendors' }} noun="vendors" />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="ov-grid" title="Tier by residual risk" href="/vendor-risk/vendors" hrefLabel="the vendor register" loadingHeight={200}
          info={`Vendors by their tier and the band of their residual score on your organisation's bands${t ? ` (critical from ${t.critical}, high from ${t.high}, medium from ${t.medium})` : ''}. A cell opens the register on its tier. Vendors without a score are in the last column.`}
          {...cardOf([charts], heat.total === 0, 'vendors')} emptyText="No vendors yet."
        >
          <Heatmap label="Vendors by tier and residual band" rowTitle="Tier" colTitle="Residual band" rows={heat.rows} cols={heat.cols} cells={heat.cells} noun="vendors" href={(r) => heatHref(heat.rowKeys[r], scope)} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-top" title="Highest residual risk" href={REGISTER_BY_RISK} hrefLabel="the vendor register, highest risk first" loadingHeight={190}
          info="The five vendors with the highest residual score, in the colour of their band on your organisation's bands (the band is named beside the score). Each opens the vendor."
          {...cardOf([dash], top.length === 0, 'the highest risks')} emptyText="No scored assessments yet."
        >
          <BarList label="Highest residual risk by vendor" rows={top} max={100} nameWidth={128} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-findings" title="Findings" href="/vendor-risk/findings?scope=all" hrefLabel="the findings register" loadingHeight={190}
          info="Findings by severity: every finding of vendors that are not archived, split by status; Age counts only the open ones (open or being fixed) by how long ago they were raised. Each severity opens the findings of that severity."
          actions={<SegmentedControl label="Split findings" name="ov-findings-view" options={PIVOT} value={findings} onChange={onFindings} />}
          {...cardOf([charts], nothingFound || (findings === 'age' && stackTotal(findingCategories(c?.findings, 'age')) === 0), 'findings')}
          emptyText={nothingFound ? 'No findings yet.' : 'No findings are open.'}
        >
          <StackedBars
            label={findings === 'status' ? 'Findings by severity and status' : 'Open findings by severity and age'} firstColumn="Severity"
            categories={findings === 'status' ? kinds : findingCategories(c?.findings, 'age')} series={findings === 'status' ? STATUS_SERIES : AGE_SERIES} nameWidth={64} height={170}
          />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="ov-calendar" title="Reviews due" href="/vendor-risk/vendors?sort=next_reassessment:asc" hrefLabel="the vendor register, next review first" loadingHeight={200}
          info="When each vendor's next reassessment falls (the earlier of its own date and its open engagements'), by tier: in 30 days, 31 to 60, 61 to 90, later. Overdue opens the vendors whose reassessment is overdue. Suspended and offboarding vendors are not in it."
          {...cardOf([charts], stackTotal(calendar) === 0, 'the reviews')} emptyText="No vendor in use yet."
        >
          <StackedBars label="Vendors by next review and tier" firstColumn="Next review" layout="columns" categories={calendar} series={TIER_SERIES} height={200} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-stages" title="Where reviews stand" href="/vendor-risk/vendors?view=board&quick=lifecycle" hrefLabel="the vendor board by review stage" loadingHeight={190}
          info="The stage of each vendor's current review: the five stages with most vendors. Vendors with no review started are the grey bar. Each opens the register on that stage; the board shows every stage."
          {...cardOf([charts], stages.rows.length === 0, 'the reviews')} emptyText="No vendor in use yet."
        >
          <BarList label="Vendors by review stage" rows={stages.rows} nameWidth={110} noun="vendors" />
          <SeeAll shown={stages.rows.length} total={stages.total} href="/vendor-risk/vendors?view=board&quick=lifecycle" name="review stages on the vendor board" />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-steps" title="Vendors by next step" href="/vendor-risk/attention" hrefLabel="the Work queue" loadingHeight={190}
          info="The one thing each vendor is waiting on, the first that holds: the five most common. Red is late, amber is something missing, blue is someone on it. Each opens the register on those vendors. The Work queue counts items, so its number is higher."
          {...cardOf([dash], false, 'the next steps')}
        >
          {steps.rows.length === 0
            ? <p className="m-0 text-ds-body text-ds-fg-muted">{d?.kpis.active_vendors ? 'Every vendor is where it should be.' : 'No vendors yet.'}</p>
            : <BarList label="Vendors by next step" rows={steps.rows} nameWidth={140} noun="vendors" />}
          <SeeAll shown={steps.rows.length} total={steps.total} href="/vendor-risk/attention" name="next steps in the Work queue" />
        </ChartCard>
      </Cell>

      <Cell span={8}>
        <ChartCard
          id="ov-contracts" title="Contract timeline" href={CONTRACTS} hrefLabel="the contracts" loadingHeight={200}
          info={`Active contracts by the month they end or renew (the earlier of the two dates), split by the vendor's tier; contracts already past their end are in the first column. The Contracts page lists the ones that need a decision.${scope === 'mine' ? ' Only your vendors.' : ''}`}
          {...cardOf(contractFeeds, contract.facts.total === 0, 'contracts')} emptyText={scope === 'mine' ? 'No active contract of your vendors ends in the next 12 months.' : 'No active contract has an end date in the next 12 months.'}
        >
          <StackedBars label="Active contracts by end month and tier" firstColumn="Ends" layout={narrow ? 'bars' : 'columns'} categories={contract.categories} series={TIER_SERIES} height={narrow ? undefined : 200} nameWidth={64} />
        </ChartCard>
      </Cell>
      <Cell span={4}>
        <ChartCard
          id="ov-signals" title="Monitoring signals" href={MONITORING} hrefLabel="the monitoring alerts" loadingHeight={180}
          info="Verified monitoring signals by the month they happened and their severity, for the last six months."
          {...cardOf([charts], stackTotal(signals) === 0, 'signals')} emptyText="No signals in the last six months."
        >
          <StackedBars label="Monitoring signals by month and severity" firstColumn="Month" layout="columns" categories={signals} series={SEVERITY_SERIES} height={180} />
        </ChartCard>
      </Cell>

      <Cell span={4}>
        <ChartCard
          id="ov-concentration" title="Shared platforms" meta={scope === 'mine' ? 'Whole portfolio' : undefined} href={`${DEPENDENCIES}?view=platforms`} hrefLabel="the shared platforms" loadingHeight={160}
          info="Platforms that two or more vendors rely on, most shared first (whole portfolio). One failure there is several failures for us. Each opens what suppliers run on it."
          {...cardOf([concentration], platforms.rows.length === 0, 'concentration')} emptyText="No platform is shared by two vendors yet."
        >
          <BarList label="Vendors on each shared platform" rows={platforms.rows} nameWidth={100} noun="vendors" />
          <SeeAll shown={platforms.rows.length} total={platforms.total} href={`${DEPENDENCIES}?view=platforms`} name="shared platforms" />
        </ChartCard>
      </Cell>
      <Cell span={8}>{work}</Cell>
    </ChartGrid>
  );
}
