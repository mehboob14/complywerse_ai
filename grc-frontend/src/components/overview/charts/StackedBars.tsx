'use client';

// StackedBars: a count per category split into series (open / closed, by severity, by state): horizontal bars by default (long names read left to right, and the
// chart is as tall as its rows need), or columns. The bars stack on one axis, the parts are separated by 2px of the surface, a click on a bar opens that
// category's records when it has a `href` (the keyboard has the same links wherever the page lists the categories; the numbers are in the table for a screen reader).
// Colour follows the SERIES entry, never the rank. More than six series is a table, not a chart.
//
//   <StackedBars label="Vendors by tier and risk" firstColumn="Tier" categories={[{ key: 't1', label: 'Tier 1', cells: { high: 3, medium: 5, low: 4 } }]} series={[{ key: 'high', label: 'High', color: STATUS.bad }, …]} />
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCount } from '../../../lib/format';
import { Picture, Swatches } from './Picture';
import { AXIS, GRID, HOVER, SERIES, SURFACE, TIP } from './palette';

export interface StackSeries { key: string; label: string; color?: string }
export interface StackCategory { key: string; label: string; cells: Record<string, number | null | undefined>; href?: string }

export interface StackedBarsProps {
  label: string;
  /** the first column of the table: what a category is ("Tier") */
  firstColumn: string;
  categories: readonly StackCategory[];
  series: readonly StackSeries[];
  layout?: 'bars' | 'columns';
  /** the height of a `columns` chart, or the row height of a `bars` chart (default 220 / 32px a row) */
  height?: number;
  /** the width of the category names on a `bars` chart, in px (default 120) */
  nameWidth?: number;
}

const colorOf = (s: StackSeries, i: number): string => s.color ?? SERIES[i] ?? SERIES[0];
const clip = (n: number) => (name: string): string => (name.length > n ? `${name.slice(0, n - 1)}…` : name);
const ROW = 32;

export function StackedBars({ label, firstColumn, categories, series, layout = 'bars', height, nameWidth = 120 }: StackedBarsProps) {
  const router = useRouter();
  const data = categories.map((c) => ({ name: c.label, key: c.key, href: c.href, ...Object.fromEntries(series.map((s) => [s.key, c.cells[s.key] ?? 0])) }));
  const horizontal = layout === 'bars';
  const h = height ?? (horizontal ? Math.max(120, categories.length * ROW + 32) : 220);
  const go = (entry: unknown) => { const href = (entry as { payload?: { href?: string } } | null)?.payload?.href; if (href) router.push(href); };
  return (
    <div>
      <Picture label={label} height={h} data={{ columns: [firstColumn, ...series.map((s) => s.label)], rows: categories.map((c) => [c.label, ...series.map((s) => c.cells[s.key] ?? 0)]) }}>
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 12, left: horizontal ? 0 : -10, bottom: 0 }} barCategoryGap="26%" {...focusOff}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 2" horizontal={!horizontal} vertical={horizontal} />
              {horizontal ? (
                <>
                  <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={nameWidth} interval={0} tick={AXIS} tickFormatter={clip(Math.max(8, Math.floor(nameWidth / 6.5)))} axisLine={false} tickLine={false} />
                </>
              ) : (
                <>
                  <XAxis type="category" dataKey="name" interval={0} tick={AXIS} tickFormatter={clip(12)} axisLine={false} tickLine={false} />
                  <YAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} width={40} />
                </>
              )}
              <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} formatter={(v: unknown) => (typeof v === 'number' ? formatCount(v) : String(v))} />
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} stackId="stack" fill={colorOf(s, i)} stroke={SURFACE} strokeWidth={1} isAnimationActive={false} cursor="pointer" onClick={go} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </Picture>
      <Swatches items={series.map((s, i) => ({ key: s.key, label: s.label, color: colorOf(s, i) }))} />
    </div>
  );
}
