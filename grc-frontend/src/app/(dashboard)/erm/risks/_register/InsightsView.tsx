'use client';

/**
 * The register's Insights view: the old Risk Register dashboard, folded in. It draws from the rows the person is looking at (the facets and the search narrow it, as the
 * dashboard's filters did), and every figure is one function of riskInsights.ts held to the server's dashboards by a test. Nothing is a picture of a number: the matrix cells, the
 * level and status bars, the register rows and the people are buttons, and pressing one shows the risks behind it in the list.
 * The CRQM summary card is the one the dashboard had (it draws only when loss models exist).
 */
import { useId } from 'react';
import { clsx } from 'clsx';
import { SectionCard, SegmentedControl } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import { TONE } from '@/lib/status';
import { riskLevel, riskSource, riskStatus } from '@/lib/statuses/risk';
import QuantificationCard from '../dashboard/_components/QuantificationCard';
import { cellBand, BUCKET_LABEL, STATUS_BUCKETS, type Band, type Basis, type RiskRow } from './riskModel';
import { byCategory, byRegister, bySource, matrixRows, placedCount, severityCounts, statusCounts, workload, SEVERITY_ORDER } from './riskInsights';
import { categoryLabel } from './riskModel';
import type { Filters } from './riskFacets';

export interface InsightsProps {
  rows: readonly RiskRow[];
  filters: Filters;
  /** show the risks behind a figure in the list: the filter to add */
  onDrill: (patch: Partial<Filters>) => void;
  onBasis: (basis: Basis) => void;
}

const BAND_TONE: Record<Band, 'danger' | 'warning' | 'progress' | 'success' | 'neutral'> = { critical: 'danger', high: 'warning', medium: 'progress', low: 'success', none: 'neutral' };
const dot = (b: Band): string => TONE[BAND_TONE[b]].dot;

/** A row that is a button: a label, a proportional bar, the count. */
function BarRow({ label, value, total, color, onPress, hint }: { label: string; value: number; total: number; color: string; onPress?: () => void; hint?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const body = (
    <>
      <span className="w-[120px] shrink-0 truncate text-ds-body text-ds-fg-body sm:w-[160px]" title={label}>{label}</span>
      <span aria-hidden className="relative h-[8px] min-w-0 flex-1 rounded-full bg-ds-border">
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${value > 0 ? Math.max(pct, 2) : 0}%`, background: color }} />
      </span>
      <span className="w-[72px] shrink-0 text-right text-ds-body tabular-nums text-ds-fg">{formatCount(value)}<span className="ml-[4px] text-ds-label text-ds-fg-muted">{pct}%</span></span>
    </>
  );
  const cls = 'flex min-h-ds-control w-full items-center gap-[12px] rounded-ds-control px-[4px] text-left';
  return onPress ? (
    <button type="button" onClick={onPress} title={hint} className={clsx(cls, 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring')}>{body}</button>
  ) : <div className={cls}>{body}</div>;
}

function Matrix({ rows, basis, selected, onPick, onBasis }: { rows: readonly RiskRow[]; basis: Basis; selected: Filters['cell']; onPick: (l: number, i: number) => void; onBasis: (b: Basis) => void }) {
  const uid = useId();
  const cells = matrixRows(rows, basis);
  const placed = placedCount(cells);
  return (
    <SectionCard
      id="matrix"
      title="Risk matrix"
      info="Likelihood down, impact across. A risk is placed when it has both. Press a cell to see its risks in the list."
      meta={`${formatCount(placed)} placed`}
      actions={<SegmentedControl<Basis> label="Matrix basis" name={`${uid}-basis`} options={[{ value: 'residual', label: 'Residual' }, { value: 'inherent', label: 'Inherent' }]} value={basis} onChange={onBasis} />}
    >
      <div className="flex gap-[8px]">
        <div aria-hidden className="flex w-[18px] shrink-0 items-center justify-center"><span className="-rotate-90 whitespace-nowrap text-ds-label text-ds-fg-muted">Likelihood</span></div>
        <div className="min-w-0 flex-1">
          <div role="grid" aria-label={`${basis === 'inherent' ? 'Inherent' : 'Residual'} risk matrix`} className="grid grid-cols-5 gap-[4px]">
            {cells.map((row) => row.map((c) => {
              const band = cellBand(c.l, c.i);
              const on = selected?.l === c.l && selected?.i === c.i;
              return (
                <button
                  key={`${c.l}-${c.i}`}
                  type="button"
                  role="gridcell"
                  aria-pressed={on}
                  disabled={c.count === 0}
                  aria-label={`Likelihood ${c.l}, impact ${c.i}, ${riskLevel.label(band).toLowerCase()}: ${formatCount(c.count)} ${c.count === 1 ? 'risk' : 'risks'}`}
                  onClick={() => onPick(c.l, c.i)}
                  style={{ background: c.count > 0 ? TONE[BAND_TONE[band]].tint : undefined, borderColor: on ? TONE[BAND_TONE[band]].dot : TONE[BAND_TONE[band]].border }}
                  className={clsx(
                    'flex min-h-[44px] items-center justify-center rounded-ds-control border text-ds-section tabular-nums focus-visible:outline-none focus-visible:shadow-ds-ring',
                    c.count > 0 ? 'cursor-pointer font-[600] text-ds-fg hover:brightness-95' : 'cursor-default bg-ds-surface-subtle text-ds-fg-muted',
                    on && 'border-[2px]',
                  )}
                >
                  {c.count > 0 ? formatCount(c.count) : <span aria-hidden>·</span>}
                </button>
              );
            }))}
          </div>
          <div aria-hidden className="mt-[4px] flex justify-between px-[4px] text-ds-label text-ds-fg-muted"><span>Impact 1</span><span>Impact 5</span></div>
        </div>
      </div>
      <p className="mb-0 mt-[8px] text-ds-label text-ds-fg-muted">Colour is the level of the cell: critical 20 and over, high 12, medium 6, low below. Each cell also says it in words.</p>
    </SectionCard>
  );
}

export function InsightsView({ rows, filters, onDrill, onBasis }: InsightsProps) {
  const sev = severityCounts(rows);
  const status = statusCounts(rows);
  const registers = byRegister(rows);
  const sources = bySource(rows);
  const cats = byCategory(rows);
  const people = workload(rows).slice(0, 8);
  const total = rows.length;
  const BANDS_SHOWN: Band[] = [...SEVERITY_ORDER, 'none'];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[16px] lg:grid-cols-2">
        <Matrix rows={rows} basis={filters.basis} selected={filters.cell} onBasis={onBasis} onPick={(l, i) => onDrill({ cell: { l, i } })} />

        <SectionCard id="levels" title="Level" info="By the residual score, else the inherent score. Critical 20 and over, high 12, medium 6, low below. A risk with no score is counted apart, not as low." meta={`${formatCount(total)} risks`}>
          <div className="flex flex-col">
            {BANDS_SHOWN.map((b) => (
              <BarRow key={b} label={riskLevel.label(b)} value={sev[b]} total={total} color={dot(b)} hint={`Show the ${riskLevel.label(b).toLowerCase()} risks`} onPress={sev[b] > 0 ? () => onDrill({ level: [b] }) : undefined} />
            ))}
          </div>
          <div className="mt-[12px] border-t border-ds-border pt-[12px]">
            <h3 className="!text-ds-body !font-[600] !text-ds-fg">Status</h3>
            <div className="mt-[4px] flex flex-col">
              {STATUS_BUCKETS.map((s) => (
                <BarRow key={s} label={BUCKET_LABEL[s]} value={status[s]} total={total} color={TONE[riskStatus.tone(s)].dot} hint={`Show the ${BUCKET_LABEL[s].toLowerCase()} risks`} onPress={status[s] > 0 ? () => onDrill({ status: [s] }) : undefined} />
              ))}
            </div>
          </div>
        </SectionCard>
      </div>

      <QuantificationCard />

      <div className="grid gap-[16px] lg:grid-cols-2">
        <SectionCard id="registers" title="By register" info="The register type a risk was filed in; risks with none are 'Standard'. Press one to see its risks." meta={`${registers.length} ${registers.length === 1 ? 'register' : 'registers'}`}>
          {registers.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">No risks in this view.</p> : (
            <ul className="m-0 list-none p-0">
              {registers.map((g) => (
                <li key={g.register} className="border-b border-ds-border py-[4px] last:border-b-0">
                  <button type="button" onClick={() => onDrill({ register: [g.register === 'Standard' ? 'none' : g.register] })} className="flex min-h-ds-control w-full flex-wrap items-center gap-x-[12px] gap-y-[2px] rounded-ds-control px-[4px] text-left hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring">
                    <span className="min-w-0 flex-1 truncate text-ds-body font-[600] text-ds-fg" title={g.register}>{g.register}</span>
                    <span className="text-ds-body tabular-nums text-ds-fg">{formatCount(g.total)}</span>
                    <span className="text-ds-label text-ds-fg-muted">{g.avgResidual ? `average residual ${g.avgResidual}` : 'no residual scores'} · {formatCount(g.people)} {g.people === 1 ? 'person' : 'people'}</span>
                    <span aria-hidden className="flex h-[6px] w-full overflow-hidden rounded-full bg-ds-border">
                      {STATUS_BUCKETS.map((s) => g.status[s] > 0 && <span key={s} style={{ width: `${(g.status[s] / g.total) * 100}%`, background: TONE[riskStatus.tone(s)].dot }} />)}
                    </span>
                    <span className="sr-only">{STATUS_BUCKETS.map((s) => `${BUCKET_LABEL[s]} ${g.status[s]}`).join(', ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard id="people" title="Who holds the risks" info="Risks per person: a risk counts once for its risk owner and once for its business owner." meta={`${formatCount(workload(rows).length)} people`}>
          {people.length === 0 ? <p className="m-0 text-ds-body text-ds-fg-muted">Nobody owns a risk in this view.</p> : (
            <div className="flex flex-col">
              {people.map((p) => <BarRow key={p.id} label={p.name} value={p.total} total={total} color={TONE.progress.dot} hint={`Show ${p.name}'s risks`} onPress={() => onDrill({ owner: [String(p.id)] })} />)}
            </div>
          )}
        </SectionCard>

        <SectionCard id="categories" title="Category" info="The category each risk stores. A risk with none is Uncategorised." meta={`${cats.length} ${cats.length === 1 ? 'category' : 'categories'}`}>
          <div className="flex flex-col">
            {cats.map((c) => <BarRow key={c.key} label={categoryLabel(c.key)} value={c.total} total={total} color={TONE.pending.dot} hint={`Show the ${categoryLabel(c.key).toLowerCase()} risks`} onPress={() => onDrill({ category: [c.key] })} />)}
          </div>
        </SectionCard>

        <SectionCard id="sources" title="Where the risks come from" info="How each risk entered the register." meta={`${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`}>
          <div className="flex flex-col">
            {sources.map((s) => <BarRow key={s.source} label={riskSource.label(s.source)} value={s.total} total={total} color={TONE.neutral.dot} />)}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
