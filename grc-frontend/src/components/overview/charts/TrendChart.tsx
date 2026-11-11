'use client';

// TrendChart: change over time for one to three series: an area (one series, or two that are parts of one story), lines (series that cross) or columns (a
// count per period). One y axis, never two. A target is a dashed reference line with its words ("Target 80"). The legend of two or more series is drawn under
// the chart and every chart has the same numbers as a table for a screen reader (Picture). A missing period is a gap, never a 0 (`null` in a row). Colours:
// SERIES in order; a series that is a state (overdue) passes its STATUS colour.
//
//   <TrendChart label="Open issues by month" firstColumn="Month" rows={[{ label: 'Jun', open: 12, closed: 4 }, …]} series={[{ key: 'open', label: 'Open', color: SERIES[0] }, { key: 'closed', label: 'Closed', color: SERIES[2] }]} />
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount } from '../../../lib/format';
import { Picture, Swatches } from './Picture';
import { AXIS, GRID, HOVER, INK, SERIES, TIP } from './palette';

export interface TrendSeries { key: string; label: string; color?: string }
export type TrendRow = { label: string } & Record<string, string | number | null | undefined>;

export interface TrendChartProps {
  /** names the chart for a screen reader: "Open issues by month" */
  label: string;
  /** the first column of the table: what a row is ("Month") */
  firstColumn: string;
  rows: readonly TrendRow[];
  series: readonly TrendSeries[];
  variant?: 'area' | 'line' | 'bars';
  /** a dashed line at this value, with its words */
  target?: { value: number; label: string } | null;
  /** the y axis range: 'share' = 0 to 100; default starts at 0 */
  yMax?: number | 'auto';
  /** appended to the figures in the tooltip and the table ("%") */
  unit?: string;
  height?: number;
}

const colorOf = (s: TrendSeries, i: number): string => s.color ?? SERIES[i] ?? SERIES[0];

export function TrendChart({ label, firstColumn, rows, series, variant = 'area', target, yMax = 'auto', unit = '', height = 220 }: TrendChartProps) {
  const data = rows.map((r) => ({ ...r }));
  const margin = { top: 8, right: 12, left: -10, bottom: 0 };
  const axes = (
    <>
      <CartesianGrid stroke={GRID} strokeDasharray="2 2" vertical={false} />
      <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
      <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, yMax === 'auto' ? 'auto' : yMax]} width={40} />
      <Tooltip cursor={variant === 'bars' ? { fill: HOVER } : { stroke: GRID }} contentStyle={TIP} formatter={(v: unknown) => (typeof v === 'number' ? `${formatCount(v)}${unit}` : String(v))} />
      {target && <ReferenceLine y={target.value} stroke={INK} strokeDasharray="4 4" label={{ value: target.label, position: 'insideTopRight', fontSize: 12, fill: INK }} />}
    </>
  );
  return (
    <div>
      <Picture label={label} height={height} data={{ columns: [firstColumn, ...series.map((s) => s.label)], rows: rows.map((r) => [r.label, ...series.map((s) => (typeof r[s.key] === 'number' ? (r[s.key] as number) : null))]) }}>
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%">
            {variant === 'bars' ? (
              <BarChart data={data} margin={margin} barCategoryGap="28%" {...focusOff}>
                {axes}
                {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorOf(s, i)} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
              </BarChart>
            ) : variant === 'line' ? (
              <LineChart data={data} margin={margin} {...focusOff}>
                {axes}
                {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s, i)} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }} connectNulls={false} isAnimationActive={false} />)}
              </LineChart>
            ) : (
              <AreaChart data={data} margin={margin} {...focusOff}>
                {axes}
                {series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={colorOf(s, i)} fill={colorOf(s, i)} fillOpacity={series.length > 1 ? 0.1 : 0.16} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, fill: '#ffffff' }} connectNulls={false} isAnimationActive={false} />)}
              </AreaChart>
            )}
          </ResponsiveContainer>
        )}
      </Picture>
      {series.length > 1 && <Swatches items={series.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(s, i) }))} />}
    </div>
  );
}
