'use client';

// The aggregation tool: the register added up. The numbers are the server's (lib/erm/aggregation.ts reproduces its totals, averages, reduction and group order from the whole
// register, read in one request), the Critical / High / Medium / Low counts use the one band system, and a risk with no residual score is "not scored", not Low. The chart is a
// picture with the same numbers as a table behind it (ChartFrame), and every group has its table with the words in full - no single letters, no colour-only bars.
import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { oneOf } from '@/lib/addressState';
import { ChartFrame, EmptyState, ErrorState, RegisterTable, StatTile, Tabs, useAddressState, type RegisterColumn } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { aggregate, type AggGroup } from '@/lib/erm/aggregation';
import { BANDS, BAND_LABEL } from '@/lib/erm/band';
import { categoryLabel } from '@/lib/erm/categories';
import { formatCount } from '@/lib/format';
import { statusLabel } from '@/lib/format';
import { bandColors, GRID, HOVER, INK, TIP } from '../../_monitoring/bandStyle';
import { useLeanRisks } from '../../_monitoring/lookups';

const SCHEMA = { by: oneOf(['category', 'unit', 'status'] as const, 'category') };
const TABS = [{ key: 'category', label: 'By category' }, { key: 'unit', label: 'By business unit' }, { key: 'status', label: 'By status' }];
const num = 'tabular-nums text-ds-body text-ds-fg-body';

const groupColumns = (first: string, name: (g: AggGroup) => string): RegisterColumn<AggGroup>[] => [
  { key: 'name', header: first, isRowHeader: true, cell: (g) => <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{name(g)}</span> },
  { key: 'count', header: 'Risks', align: 'right', width: 'w-[72px]', card: 'meta', cell: (g) => <span className={num}>{formatCount(g.count)}</span> },
  { key: 'avgI', header: 'Avg inherent', align: 'right', width: 'w-[110px]', priority: 2, card: 'meta', cell: (g) => <span className={num}>{g.avgInherent}</span> },
  { key: 'avgR', header: 'Avg residual', align: 'right', width: 'w-[110px]', card: 'meta', cell: (g) => <span className={num}>{g.avgResidual}</span> },
  { key: 'red', header: 'Reduction', align: 'right', width: 'w-[96px]', priority: 2, card: 'meta', cell: (g) => <span className={num}>{`${g.reductionPct}%`}</span> },
  ...BANDS.map((b): RegisterColumn<AggGroup> => ({ key: b, header: BAND_LABEL[b], align: 'right', width: 'w-[80px]', priority: 3, card: 'meta', cell: (g) => <span className={`${num} ${g[b] ? '' : 'text-ds-fg-muted'}`}>{g[b] || '—'}</span> })),
  { key: 'unscored', header: 'Not scored', align: 'right', width: 'w-[96px]', priority: 3, card: 'meta', cell: (g) => <span className={`${num} ${g.unscored ? '' : 'text-ds-fg-muted'}`}>{g.unscored || '—'}</span> },
];

export function AggregationTool() {
  const [a, set] = useAddressState(SCHEMA);
  const q = useLeanRisks();
  const agg = useMemo(() => (q.data ? aggregate(q.data.items) : null), [q.data]);
  const failed = q.isError && !q.data ? { title: 'Not available', message: errorMessage(q.error), onRetry: () => { void q.refetch(); } } : null;

  if (q.isError && !q.data) return <ErrorState title="Couldn't load the register" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />;
  const s = agg?.summary;
  const chartRows = (agg?.byCategory ?? []).map((g) => ({ name: categoryLabel(g.label), ...Object.fromEntries(BANDS.map((b) => [b, g[b]])), unscored: g.unscored }));
  const rows: AggGroup[] = a.by === 'category' ? agg?.byCategory ?? [] : a.by === 'unit' ? agg?.byBusinessUnit ?? [] : [];
  const statusRows = (agg?.byStatus ?? []).map((st) => ({ key: st.status, label: statusLabel(st.status), count: st.count, avgScore: st.avgScore }));

  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Open risks" value={s ? formatCount(s.totalRisks) : null} loading={q.isLoading} error={failed} info="Risks that are not closed or being closed." />
        <StatTile label="Risk reduction" value={s ? `${s.reductionPct}%` : null} loading={q.isLoading} error={failed} progress={s ? Math.min(100, Math.max(0, s.reductionPct)) : null} info="How much lower the residual scores are than the inherent ones, added up." />
        <StatTile label="Avg inherent" value={s ? String(s.avgInherent) : null} loading={q.isLoading} error={failed} unit="of 25" />
        <StatTile label="Avg residual" value={s ? String(s.avgResidual) : null} loading={q.isLoading} error={failed} unit="of 25" />
        <StatTile label="Critical or high" value={s ? formatCount(s.critical + s.high) : null} loading={q.isLoading} error={failed} tone={s && s.critical + s.high > 0 ? 'danger' : undefined} note={s ? `${formatCount(s.critical)} critical, ${formatCount(s.high)} high` : undefined} />
        <StatTile label="Not scored" value={s ? formatCount(s.unscored) : null} loading={q.isLoading} error={failed} info="Open risks with no residual score." />
      </div>

      {agg && agg.summary.totalRisks === 0 && <div className="rounded-ds-card border border-ds-border bg-ds-surface"><EmptyState bare kind="firstUse" title="No open risks yet" description="Add risks to the register and they are added up here." /></div>}

      {agg && chartRows.length > 0 && (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
          <ChartFrame
            title="Residual level of the open risks in each category"
            note="Each bar is a category; its colours are the levels. The same numbers are in the tables below."
            height={Math.max(180, chartRows.length * 40 + 60)}
            data={{ columns: ['Category', ...BANDS.map((b) => BAND_LABEL[b]), 'Not scored'], rows: chartRows.map((r) => [r.name, ...BANDS.map((b) => (r as unknown as Record<string, number>)[b]), r.unscored]) }}
          >
            {(focusOff) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartRows} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap="24%" {...focusOff}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={112} interval={0} tick={{ fontSize: 12, fill: INK }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} />
                  <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
                  {BANDS.map((b) => <Bar key={b} dataKey={b} name={BAND_LABEL[b]} stackId="s" fill={bandColors(b).dot} isAnimationActive={false} />)}
                  <Bar dataKey="unscored" name="Not scored" stackId="s" fill="#cbd2da" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
        </div>
      )}

      <Tabs tabs={TABS} value={a.by} onChange={(k) => set({ by: k as 'category' | 'unit' | 'status' })} ariaLabel="Group the register by">
        <div className="mt-[12px]">
          {a.by === 'status' ? (
            <RegisterTable
              caption="Open risks by status"
              columns={[
                { key: 'name', header: 'Status', isRowHeader: true, cell: (r) => <span className="font-[600] text-ds-fg">{r.label}</span> },
                { key: 'count', header: 'Risks', align: 'right', card: 'meta', cell: (r) => <span className={num}>{formatCount(r.count)}</span> },
                { key: 'avg', header: 'Avg residual', align: 'right', card: 'meta', cell: (r) => <span className={num}>{r.avgScore}</span> },
              ] as RegisterColumn<(typeof statusRows)[number]>[]}
              rows={statusRows}
              getRowId={(r) => r.key}
              loading={q.isLoading}
              empty={<EmptyState bare kind="firstUse" title="No open risks" />}
              cardTitle={(r) => <span className="font-[600] text-ds-fg">{r.label}</span>}
            />
          ) : (
            <RegisterTable
              caption={a.by === 'category' ? 'Open risks by category' : 'Open risks by business unit'}
              columns={groupColumns(a.by === 'category' ? 'Category' : 'Business unit', (g) => (a.by === 'category' ? categoryLabel(g.label) : g.label))}
              rows={rows}
              getRowId={(g) => g.key}
              loading={q.isLoading}
              empty={<EmptyState bare kind="firstUse" title="No open risks" />}
              cardTitle={(g) => <span className="font-[600] text-ds-fg">{a.by === 'category' ? categoryLabel(g.label) : g.label}</span>}
            />
          )}
        </div>
      </Tabs>
    </div>
  );
}
