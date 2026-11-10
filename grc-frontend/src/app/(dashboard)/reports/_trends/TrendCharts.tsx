'use client';

// The two charts of a figure's Sheet. Each is a ChartFrame: a named figure, the chart hidden from assistive technology (it is a picture), and the same numbers as a table for a screen reader; a visible table sits beside
// each too (TrendSheet), so nobody has to read a picture. Ticks and labels are 12px and wear the ink tokens (hex: an SVG attribute cannot read a class). The target and the warning level are drawn as dashed lines AND
// named in words on the chart. The breakdown's colours follow the slice (its place in the alphabetical list), never its rank, in the validated order of vizPalette; past eight slices the chart says it left some out.
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from '@/components/ui/ds';
import { SERIES } from '../_reports/vizPalette';
import {
  INK, axisDate, chartSlices, formatDay, formatValue, sliceLabel, sliceRows, valueRows, yDomain, type BreakdownResp, type TrendCard, type Unit,
} from './trendsModel';

const TICK = { fontSize: 12, fill: INK.muted };

interface TipPayload { dataKey?: string | number; name?: string; value?: number | null; color?: string; payload?: { date?: string } }
/** The hover card: the full day ("12 Nov 2026", from the row the point belongs to) over one line per series. */
function Tip({ active, payload, unit }: { active?: boolean; payload?: TipPayload[]; unit: Unit }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-ds-control border border-ds-border bg-ds-surface px-[8px] py-[6px] text-ds-label text-ds-fg shadow-ds-pop">
      <div className="mb-[2px] text-ds-fg-muted">{formatDay(payload[0]?.payload?.date)}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-[6px] tabular-nums">
          <span aria-hidden className="inline-block h-[8px] w-[8px] rounded-[2px]" style={{ background: p.color }} />
          {p.name}: <b className="font-[600]">{formatValue(p.value ?? null, unit)}</b>
        </div>
      ))}
    </div>
  );
}

/** The figure over time: one line, with the target and the warning level as dashed lines named on the chart. A day with no value is a gap, not a 0. */
export function TrendChart({ card, rangeLabel }: { card: TrendCard; rangeLabel: string }) {
  const data = card.points.map((p) => ({ date: p.date.slice(0, 10), label: axisDate(p.date), value: p.value }));
  const vals = card.points.filter((p) => p.value != null).map((p) => p.value as number);
  const dom = yDomain(vals, card.unit, [card.target, card.warn]);
  const rows = valueRows(card.points, card.unit).map((r) => [r.day, r.value]);
  const note = [card.target != null ? `Dashed: target ${formatValue(card.target, card.unit)}` : '', card.warn != null ? `warning level ${formatValue(card.warn, card.unit)}` : ''].filter(Boolean).join(', ');
  return (
    <ChartFrame title={`${card.label}, last ${rangeLabel}`} note={note || undefined} height={230} data={{ columns: ['Day', card.label], rows }}>
      {(focusOff) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} {...focusOff}>
            <CartesianGrid stroke={INK.grid} vertical={false} />
            <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: INK.grid }} minTickGap={32} />
            <YAxis domain={dom} tick={TICK} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={(p) => <Tip active={p.active} payload={p.payload as unknown as TipPayload[]} unit={card.unit} />} />
            {card.warn != null && (
              <ReferenceLine y={card.warn} stroke={INK.warn} strokeDasharray="2 3" strokeWidth={1.5}
                label={{ value: `Warn at ${formatValue(card.warn, card.unit)}`, position: 'insideBottomRight', fontSize: 12, fill: INK.muted }} />
            )}
            {card.target != null && (
              <ReferenceLine y={card.target} stroke={INK.muted} strokeDasharray="5 4" strokeWidth={1.5}
                label={{ value: `Target ${formatValue(card.target, card.unit)}`, position: 'insideTopRight', fontSize: 12, fill: INK.muted }} />
            )}
            <Line type="monotone" dataKey="value" name={card.label} stroke={INK.primary} strokeWidth={2} dot={data.length <= 40 ? { r: 3, fill: INK.primary, stroke: '#ffffff', strokeWidth: 1 } : false} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}

/** A figure split by its dimension (open vulnerabilities by severity): stacked areas for counts, lines for anything else, at most eight slices, a legend, and a note when slices were left out of the picture (the table lists them all). */
export function BreakdownChart({ data, unit, title, rangeLabel }: { data: BreakdownResp; unit: Unit; title: string; rangeLabel: string }) {
  const table = sliceRows(data.series);
  const { keys: largest, hidden } = chartSlices(table);
  const keys = largest.slice().sort((a, b) => a.localeCompare(b));
  const byDate = new Map<string, Record<string, number | string>>();
  for (const s of data.series) {
    if (!keys.includes(s.key)) continue;
    for (const p of s.points) {
      if (p.value == null) continue;
      const d = p.date.slice(0, 10);
      const row = byDate.get(d) ?? { date: d, label: axisDate(d) };
      row[s.key] = p.value;
      byDate.set(d, row);
    }
  }
  const rows = Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!rows.length) return <p className="m-0 py-[24px] text-center text-ds-body text-ds-fg-muted">No breakdown history yet.</p>;
  const stack = unit === 'count';
  const Chart = stack ? AreaChart : LineChart;
  const colour = (k: string) => SERIES[keys.indexOf(k) % SERIES.length];
  const sr = rows.slice().reverse().map((r) => [formatDay(String(r.date)), ...keys.map((k) => (typeof r[k] === 'number' ? (r[k] as number) : null))]);
  return (
    <div>
      <ChartFrame title={`${title}, last ${rangeLabel}`} height={220} data={{ columns: ['Day', ...keys.map(sliceLabel)], rows: sr }}>
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%">
            <Chart data={rows} margin={{ top: 12, right: 16, bottom: 4, left: 0 }} {...focusOff}>
              <CartesianGrid stroke={INK.grid} vertical={false} />
              <XAxis dataKey="label" tick={TICK} tickLine={false} axisLine={{ stroke: INK.grid }} minTickGap={32} />
              <YAxis tick={TICK} tickLine={false} axisLine={false} width={44} />
              <Tooltip content={(p) => <Tip active={p.active} payload={p.payload as unknown as TipPayload[]} unit={unit} />} />
              {keys.map((k) => (stack
                ? <Area key={k} type="monotone" dataKey={k} name={sliceLabel(k)} stackId="1" stroke={colour(k)} fill={colour(k)} fillOpacity={0.22} strokeWidth={2} isAnimationActive={false} />
                : <Line key={k} type="monotone" dataKey={k} name={sliceLabel(k)} stroke={colour(k)} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />))}
            </Chart>
          </ResponsiveContainer>
        )}
      </ChartFrame>
      <ul className="m-0 mt-[6px] flex list-none flex-wrap gap-x-[12px] gap-y-[4px] p-0">
        {keys.map((k) => (
          <li key={k} className="inline-flex items-center gap-[6px] text-ds-label text-ds-fg-body">
            <span aria-hidden className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: colour(k) }} />
            {sliceLabel(k)}
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="m-0 mt-[4px] text-ds-label text-ds-fg-muted">{`The chart draws the ${keys.length} largest of ${table.length}. The table below lists every one.`}</p>}
    </div>
  );
}
