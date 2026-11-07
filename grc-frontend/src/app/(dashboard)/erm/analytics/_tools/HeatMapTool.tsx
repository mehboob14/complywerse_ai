'use client';

// The heat map tool: the open risks on the 5 x 5 likelihood-and-impact grid. One band system (lib/erm/band.ts) colours the cells and counts the tiles, so a tile and the cells
// it adds up never disagree; "not scored" is its own number (the old "Total risks" counted risks that were nowhere on the grid). A cell is a button named in words (likelihood, impact,
// score, band, how many), the grid has a list view with the same numbers, and a cell's risks open in a side panel with a link to each risk. The filters are in the address.
import { Fragment, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { oneOf, text } from '@/lib/addressState';
import { Button, EmptyState, ErrorState, PersonChip, RegisterTable, SegmentedControl, Select, SidePanel, StatTile, StatusPill, useAddressState, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { BANDS, BAND_LABEL, BAND_RANGE } from '@/lib/erm/band';
import { categoryLabel, categoryOptions } from '@/lib/erm/categories';
import { cellBand, cellWords, heatTiles, occupied, type HeatCell, type HeatResponse } from '@/lib/erm/heat';
import { statusPill } from '@/lib/status';
import { severity } from '@/lib/statuses/monitoring';
import { bandColors } from '../../_monitoring/bandStyle';

const SCHEMA = { score: oneOf(['residual', 'inherent'] as const, 'residual'), category: text(), view: oneOf(['grid', 'list'] as const, 'grid'), cell: text() };
const SCORES = [{ value: 'residual', label: 'Residual' }, { value: 'inherent', label: 'Inherent' }];
const VIEWS = [{ value: 'grid', label: 'Grid' }, { value: 'list', label: 'List' }];
const cellKey = (c: Pick<HeatCell, 'likelihood' | 'impact'>) => `${c.likelihood}-${c.impact}`;

export function HeatMapTool() {
  const [a, set] = useAddressState(SCHEMA);
  const q = useQuery({
    queryKey: ['erm-interactive-heatmap', a.score, a.category],
    queryFn: async () => (await ermApi.analytics.getInteractiveHeatmap({ score_type: a.score, ...(a.category ? { category: a.category } : {}) })).data as HeatResponse,
    retry: 1,
  });
  const data = q.data;
  const tiles = useMemo(() => heatTiles(data), [data]);
  const byKey = useMemo(() => new Map((data?.cells ?? []).map((c) => [cellKey(c), c])), [data]);
  const open = a.cell ? byKey.get(a.cell) ?? null : null;
  const listed = useMemo(() => occupied(data?.cells ?? []), [data]);
  const lLabels = data?.likelihood_labels ?? [];
  const iLabels = data?.impact_labels ?? [];
  const failed = q.isError && !data ? { title: 'Not available', message: errorMessage(q.error), onRetry: () => { void q.refetch(); } } : null;

  const filters = (
    <div className="flex flex-wrap items-end gap-[12px]">
      <SegmentedControl label="Score" name="heat-score" options={SCORES} value={a.score} onChange={(v) => set({ score: v as 'residual' | 'inherent', cell: '' })} />
      <Select aria-label="Category" value={a.category} onChange={(e) => set({ category: e.target.value, cell: '' })} placeholder="All categories" className="w-[200px]">
        {categoryOptions().map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </Select>
      <SegmentedControl label="View" name="heat-view" options={VIEWS} value={a.view} onChange={(v) => set({ view: v as 'grid' | 'list' })} />
    </div>
  );

  const listColumns: RegisterColumn<HeatCell>[] = [
    { key: 'band', header: 'Level', width: 'w-[120px]', isRowHeader: true, cell: (c) => <StatusPill size="sm" {...statusPill(severity, cellBand(c))} /> },
    { key: 'score', header: 'Score', width: 'w-[80px]', align: 'right', card: 'meta', cell: (c) => <span className="tabular-nums text-ds-body text-ds-fg">{c.score}</span> },
    { key: 'likelihood', header: 'Likelihood', card: 'meta', cell: (c) => <span className="text-ds-body text-ds-fg-body">{`${c.likelihood} ${lLabels[c.likelihood - 1] ?? ''}`.trim()}</span> },
    { key: 'impact', header: 'Impact', card: 'meta', cell: (c) => <span className="text-ds-body text-ds-fg-body">{`${c.impact} ${iLabels[c.impact - 1] ?? ''}`.trim()}</span> },
    { key: 'count', header: 'Risks', width: 'w-[160px]', align: 'right', card: 'meta', cell: (c) => <Button size="sm" onClick={() => set({ cell: cellKey(c) })}>{`${formatCount(c.count)} ${c.count === 1 ? 'risk' : 'risks'}`}</Button> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {filters}
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-5">
        {BANDS.map((b) => (
          <StatTile key={b} label={BAND_LABEL[b]} unit={`score ${BAND_RANGE[b]}`} value={data ? formatCount(tiles.bands[b]) : null} loading={q.isLoading} error={failed} tone={b === 'critical' && tiles.bands[b] ? 'danger' : b === 'high' && tiles.bands[b] ? 'warning' : undefined} />
        ))}
        <StatTile label="Not scored" unit="no likelihood or impact" value={data ? formatCount(tiles.unscored) : null} loading={q.isLoading} error={failed} info={`Open risks the server counted that have no ${a.score} likelihood and impact, so they are not on the grid. ${data ? `${formatCount(tiles.total)} open risks in all.` : ''}`} />
      </div>

      {q.isError && !data && <ErrorState title="Couldn't load the heat map" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />}
      {q.isLoading && <div role="status" aria-busy="true" className="h-[320px] rounded-ds-card border border-ds-border bg-ds-surface-subtle" ><span className="sr-only">Loading the heat map</span></div>}
      {data && tiles.scored === 0 && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState bare kind="noMatches" title="No scored risks to place" description={a.category ? 'No open risk in this category has a likelihood and impact. Try another category.' : 'No open risk has a likelihood and impact yet.'} onClearFilters={a.category ? () => set({ category: '' }) : undefined} /></div>
      )}

      {data && tiles.scored > 0 && a.view === 'grid' && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
          <div role="group" aria-label={`Risks by likelihood and impact, ${a.score} score`} className="grid grid-cols-[28px_repeat(5,minmax(0,1fr))] gap-[4px] sm:grid-cols-[96px_repeat(5,minmax(0,1fr))]">
            {[5, 4, 3, 2, 1].map((l) => (
              <Fragment key={`row${l}`}>
                <div className="flex items-center justify-end pr-[4px] text-right text-ds-label text-ds-fg-muted"><span className="sm:hidden">{l}</span><span className="hidden sm:inline">{`${l} ${lLabels[l - 1] ?? ''}`.trim()}</span></div>
                {[1, 2, 3, 4, 5].map((i) => {
                  const c = byKey.get(`${l}-${i}`) ?? { likelihood: l, impact: i, score: l * i, count: 0, risks: [] };
                  const colors = bandColors(cellBand(c));
                  const on = open != null && cellKey(open) === cellKey(c);
                  return (
                    <button
                      key={`${l}-${i}`}
                      type="button"
                      disabled={c.count === 0}
                      aria-label={cellWords(c, lLabels, iLabels)}
                      aria-pressed={on}
                      onClick={() => set({ cell: cellKey(c) })}
                      className="relative flex min-h-[56px] flex-col items-center justify-center rounded-ds-control border px-[2px] py-[4px] focus-visible:outline-none focus-visible:shadow-ds-ring enabled:hover:brightness-95 disabled:cursor-default"
                      style={{ background: colors.tint, borderColor: on ? colors.text : colors.border, color: colors.text, opacity: c.count === 0 ? 0.55 : 1 }}
                    >
                      <span aria-hidden className="absolute left-[4px] top-[2px] text-ds-label tabular-nums">{c.score}</span>
                      <span aria-hidden className="text-[18px] font-[600] leading-[24px] tabular-nums">{c.count || ''}</span>
                    </button>
                  );
                })}
              </Fragment>
            ))}
            <div />
            {[1, 2, 3, 4, 5].map((i) => <div key={`i${i}`} className="px-[2px] pt-[2px] text-center text-ds-label text-ds-fg-muted"><span className="sm:hidden">{i}</span><span className="hidden break-words sm:inline">{`${i} ${iLabels[i - 1] ?? ''}`.trim()}</span></div>)}
          </div>
          <p className="mt-[8px] text-ds-label text-ds-fg-muted">Likelihood runs up the side, impact along the bottom. The small number in a cell is its score; the large one is how many risks sit there.</p>
          <ul aria-label="Levels" className="m-0 mt-[8px] flex list-none flex-wrap gap-x-[16px] gap-y-[4px] p-0">
            {BANDS.map((b) => <li key={b} className="flex items-center gap-[6px] text-ds-label text-ds-fg-body"><span aria-hidden className="h-[10px] w-[10px] rounded-[3px] border" style={{ background: bandColors(b).tint, borderColor: bandColors(b).dot }} />{`${BAND_LABEL[b]} ${BAND_RANGE[b]}`}</li>)}
          </ul>
        </div>
      )}

      {data && tiles.scored > 0 && a.view === 'list' && (
        <RegisterTable caption="Cells that hold risks, highest score first" columns={listColumns} rows={listed} getRowId={cellKey} cardTitle={(c) => <span className="font-[600] text-ds-fg">{`${BAND_LABEL[cellBand(c)]}, score ${c.score}`}</span>} />
      )}

      <SidePanel
        open={!!open}
        onClose={() => set({ cell: '' })}
        dockFrom={Infinity}
        width="md"
        title={open ? `${BAND_LABEL[cellBand(open)]}: score ${open.score}` : ''}
        subtitle={open ? `Likelihood ${open.likelihood} ${lLabels[open.likelihood - 1] ?? ''}, impact ${open.impact} ${iLabels[open.impact - 1] ?? ''}`.trim() : undefined}
      >
        {open && (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0" aria-label={`${open.count} risks`}>
            {open.risks.map((r) => (
              <li key={r.id} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px]">
                <Link href={`/erm/risks/${r.id}`} className="inline-flex max-w-full items-center gap-[4px] text-ds-body font-[600] text-ds-fg underline-offset-2 hover:text-ds-primary-text hover:underline"><span className="break-words">{r.title}</span><ArrowUpRight aria-hidden size={14} className="shrink-0" /></Link>
                <p className="mt-[2px] text-ds-label text-ds-fg-muted">{[categoryLabel(r.category), r.business_unit].filter(Boolean).join(' · ')}</p>
                <div className="mt-[4px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px]"><PersonChip name={r.owner} size={20} /><span className="text-ds-label tabular-nums text-ds-fg-body">{`Inherent ${r.inherent_score ?? '—'} · Residual ${r.residual_score ?? '—'}`}</span></div>
              </li>
            ))}
          </ul>
        )}
      </SidePanel>
    </div>
  );
}

