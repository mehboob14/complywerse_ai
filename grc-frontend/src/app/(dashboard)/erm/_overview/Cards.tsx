'use client';

/**
 * The chart cards of the Risk Management Overview (Overview v2): the residual matrix (every cell opens the register at that likelihood and impact), the ten section scores as small
 * multiples (each opens its page), open risks by category (donut) and by business unit (top 5 bars), by treatment state, the five highest risks, and the risks raised by month.
 * Each card is its title, an (i) and the chart; each opens the register already filtered to what it draws (rule R6). Each rests on its own requests and says so when they fail.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import {
  AreaTiles, BarList, ChartCard, DonutChart, Heatmap, SegmentBar, STATUS, SERIES, Swatches, TrendChart, foldTail,
  type BarRow, type Slice as ChartSlice,
} from '@/components/overview/charts';
import { Button, SegmentedControl, StatusPill } from '@/components/ui/ds';
import { linkClasses } from '@/components/ui/ds/linkModel';
import { formatCount } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { riskLevel } from '@/lib/statuses/risk';
import { bandOf, levelScore, type Basis, type RiskRow } from '../risks/_register/riskModel';
import { cardStatus, type Feed } from './parts';
import {
  BAND_COLOR, BAND_WORD, MATRIX_COLS, MATRIX_ROWS, SECTION_WORDS, activeHref, byCategorySlices, byUnitSlices, cellHref, cellLevel, matrixOf, raisedByMonth, registerHref, sectionTiles,
  topRisks, treatmentParts, type Slice,
} from './overviewModel';

const REGISTER = activeHref();
const OPEN_REGISTER = 'Open the risk register';

/** The register has no risks: one line, and the Add button on the first card only (the others would repeat it). */
function AddRisk({ canCreate, button = false }: { canCreate: boolean; button?: boolean }) {
  return (
    <div className="flex flex-col items-start gap-[8px]">
      <p className="text-ds-body text-ds-fg-muted">No risks yet. They appear here once one is added.</p>
      {button && canCreate && <Button href="/erm/risks?new=1" leftIcon={<Plus aria-hidden />}>Add risk</Button>}
    </div>
  );
}

interface RegisterCardProps { feed: Feed; rows: readonly RiskRow[]; canCreate: boolean }

// ── the residual matrix ──────────────────────────────────────────────────────────────────────────────────────────────────

const LEGEND = (['critical', 'high', 'medium', 'low'] as const).map((b) => ({ key: b, label: BAND_WORD[b], color: STATUS[BAND_COLOR[b]] }));

export function MatrixCard({ feed, rows, canCreate, basis, onBasis, unscored }: RegisterCardProps & { basis: Basis; onBasis: (b: Basis) => void; unscored: number }) {
  const m = useMemo(() => matrixOf(rows, basis), [rows, basis]);
  const st = cardStatus('the risk register', [feed], false);
  return (
    <ChartCard
      id="matrix" title="Risk matrix" info="Open risks placed by likelihood (rows, 5 at the top) and impact (columns). The colour under a number is the level of that position. Press a number for its risks."
      href={REGISTER} hrefLabel={OPEN_REGISTER} loadingHeight={250} {...st}
      actions={(
        <SegmentedControl<Basis> label="Score to place risks by" name="matrix-basis" value={basis} onChange={onBasis} options={[{ value: 'residual', label: 'Residual' }, { value: 'inherent', label: 'Inherent' }]} />
      )}
    >
      {m.active === 0 ? <AddRisk canCreate={canCreate} button /> : (
        <>
          <Heatmap
            label={`${basis === 'residual' ? 'Residual' : 'Inherent'} risk matrix`} rowTitle="Likelihood" colTitle="Impact" rows={MATRIX_ROWS} cols={MATRIX_COLS} cells={m.cells} noun="risks"
            zone={(r, c) => BAND_COLOR[cellLevel(r, c)]} href={(r, c) => cellHref(r, c, basis)}
          />
          <div className="mt-[8px] flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
            <Swatches items={LEGEND} />
            <span className="mt-[8px] text-ds-label text-ds-fg-muted"><span aria-hidden>Likelihood ↑ · Impact →</span></span>
          </div>
          {unscored > 0 && (
            <Link href={registerHref({ quick: 'unscored' })} className={`mt-[4px] inline-flex w-fit items-center gap-[2px] ${linkClasses({ tone: 'text', size: 'label' })}`}>
              {`${formatCount(unscored)} not fully scored`}<ArrowRight aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} />
            </Link>
          )}
        </>
      )}
    </ChartCard>
  );
}

// ── the ten sections ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function SectionsCard({ overview, sections, onOpenHealth }: { overview: Feed; sections: Record<string, { label: string; score: number | null } | undefined> | undefined; onOpenHealth: () => void }) {
  const tiles = sectionTiles(sections);
  const st = cardStatus('the section scores', [overview], tiles.length === 0);
  return (
    <ChartCard
      id="sections" title="Scores by section" info="The ten parts of the programme that make up the posture score, each scored 0 to 100 by the server. Press a tile to open that part." emptyText="No section scores yet."
      loadingHeight={230} {...st} actions={<Button size="sm" onClick={onOpenHealth}>How is it scored?</Button>}
    >
      <AreaTiles label="Score by section" items={tiles} words={SECTION_WORDS} max={12} />
    </ChartCard>
  );
}

// ── by category, by business unit, by treatment ──────────────────────────────────────────────────────────────────────────

const DONUT_MAX = 5;

/** The categories as donut slices: the five biggest, the rest as ONE "Other" that opens all of them. */
function donutSlices(cats: readonly Slice[]): ChartSlice[] {
  const ranked = cats.slice().sort((a, b) => b.total - a.total);
  const tail = ranked.length <= DONUT_MAX + 1 ? [] : ranked.slice(DONUT_MAX);
  return foldTail(cats.map((c) => ({ key: c.key, label: c.label, value: c.total, href: c.href })), DONUT_MAX).map((s) => (s.key === '__other' ? { ...s, href: activeHref({ cat: tail.map((t) => t.key).join(',') }) } : s));
}

export function CategoryCard({ feed, rows, canCreate }: RegisterCardProps) {
  const cats = useMemo(() => byCategorySlices(rows), [rows]);
  const total = cats.reduce((n, c) => n + c.total, 0);
  const st = cardStatus('the risk register', [feed], false);
  return (
    <ChartCard id="by-category" title="By category" info="Open risks by the category each stores. Press a category for its risks." href={REGISTER} hrefLabel={OPEN_REGISTER} loadingHeight={160} {...st}>
      {total === 0 ? <AddRisk canCreate={canCreate} /> : <DonutChart label="Open risks by category" slices={donutSlices(cats)} centre={{ value: formatCount(total), caption: 'risks' }} noun="risks" size={132} />}
    </ChartCard>
  );
}

const UNITS_SHOWN = 5;

export function UnitCard({ feed, rows, canCreate }: RegisterCardProps) {
  const units = useMemo(() => byUnitSlices(rows), [rows]);
  const bars: BarRow[] = units.slice(0, UNITS_SHOWN).map((u) => ({ key: u.key, label: u.label, value: u.total, href: u.href }));
  const st = cardStatus('the risk register', [feed], false);
  return (
    <ChartCard id="by-unit" title="By business unit" info="Open risks by the business unit they are assigned to: the five with the most." href={REGISTER} hrefLabel={OPEN_REGISTER} loadingHeight={160} {...st}>
      {units.length === 0 ? <AddRisk canCreate={canCreate} /> : (
        <>
          <BarList label="Open risks by business unit" rows={bars} nameWidth={180} color={SERIES[0]} />
          {units.length > UNITS_SHOWN && (
            <Link href={REGISTER} aria-label={`See all ${units.length} business units in the risk register`} className={`mt-[12px] inline-flex w-fit items-center gap-[2px] ${linkClasses({ tone: 'text', size: 'label' })}`}>
              {`See all ${units.length}`}<ArrowRight aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} />
            </Link>
          )}
        </>
      )}
    </ChartCard>
  );
}

const TREATMENT_COLOR = { not_started: STATUS.warn, in_progress: STATUS.progress, completed: STATUS.good } as const;

export function TreatmentCard({ feed, rows, canCreate }: RegisterCardProps) {
  const parts = useMemo(() => treatmentParts(rows), [rows]);
  const total = parts.reduce((n, p) => n + p.value, 0);
  const st = cardStatus('the risk register', [feed], false);
  return (
    <ChartCard id="treatment" title="Treatment" info="Open risks by where their treatment stands: no plan yet, a plan under way, or mitigated with a plan. Press a part for its risks." href={REGISTER} hrefLabel={OPEN_REGISTER} loadingHeight={96} {...st}>
      {total === 0 ? <AddRisk canCreate={canCreate} /> : (
        <SegmentBar label="Open risks by treatment" noun="risks" height={20} parts={parts.map((p) => ({ key: p.key, label: p.label, value: p.value, color: TREATMENT_COLOR[p.key], href: p.href }))} />
      )}
    </ChartCard>
  );
}

// ── the highest risks ────────────────────────────────────────────────────────────────────────────────────────────────────

const TOP = 5;

export function HighestCard({ feed, rows, canCreate }: RegisterCardProps) {
  const top = useMemo(() => topRisks(rows, TOP), [rows]);
  const scored = useMemo(() => rows.filter((r) => (r.status || 'open') !== 'closed' && levelScore(r) > 0).length, [rows]);
  const st = cardStatus('the risk register', [feed], false);
  return (
    <ChartCard id="top-risks" title="Highest risks" info="The five open risks with the highest residual score (inherent when there is no residual)." href={activeHref({ level: 'critical,high' })} hrefLabel="Open the high and critical risks" loadingHeight={200} {...st}>
      {top.length === 0 ? (rows.length === 0 ? <AddRisk canCreate={canCreate} /> : <p className="text-ds-body text-ds-fg-muted">No scored risks yet. Score a risk and it appears here.</p>) : (
        <>
          <ol className="m-0 list-none p-0">
            {top.map((r) => {
              const sp = statusPill(riskLevel, bandOf(levelScore(r)));
              return (
                <li key={r.id} className="flex min-h-[40px] items-center gap-[8px] border-t border-ds-border first:border-t-0">
                  <Link href={`/erm/risks/${r.id}`} title={r.title} className={`min-w-0 flex-1 truncate ${linkClasses({ tone: 'title', size: 'body' })}`}>{r.title}</Link>
                  <StatusPill size="sm" tone={sp.tone} label={`${sp.label} ${Math.round(levelScore(r))}`} className="shrink-0" />
                </li>
              );
            })}
          </ol>
          {scored > TOP && (
            <Link href={REGISTER} aria-label={`See all ${scored} scored open risks in the risk register`} className={`mt-[8px] inline-flex w-fit items-center gap-[2px] ${linkClasses({ tone: 'text', size: 'label' })}`}>
              {`See all ${formatCount(scored)}`}<ArrowRight aria-hidden className="h-[14px] w-[14px]" strokeWidth={2} />
            </Link>
          )}
        </>
      )}
    </ChartCard>
  );
}

// ── risks raised by month ────────────────────────────────────────────────────────────────────────────────────────────────

export function RaisedCard({ feed, rows, now }: { feed: Feed; rows: readonly RiskRow[]; now: Date }) {
  const months = useMemo(() => raisedByMonth(rows, now), [rows, now]);
  const empty = months === null || months.every((m) => m.value === 0);
  const st = cardStatus('the risk register', [feed], empty);
  return (
    <ChartCard
      id="raised" title="Risks raised" meta="12 months" info="Risks added to the register in each month, by the date each was created. It has as many months as the register has had." href={registerHref({ sort: 'created:desc' })} hrefLabel="Open the register, newest first"
      emptyText="None raised in the last 12 months." loadingHeight={190} {...st}
    >
      {months && (
        <TrendChart label="Risks raised by month" firstColumn="Month" variant="bars" height={190} rows={months.map((m) => ({ label: m.label, raised: m.value }))} series={[{ key: 'raised', label: 'Risks raised', color: SERIES[0] }]} />
      )}
    </ChartCard>
  );
}
