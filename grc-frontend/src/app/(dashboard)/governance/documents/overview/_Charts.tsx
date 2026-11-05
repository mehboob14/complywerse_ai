'use client';

// The graphs of At a glance: documents by department stacked by status or by type, requests waiting on people by department, the steps of the approval flow and
// the kinds of document as a donut. Each is a ChartFrame (a picture for the eye, the same numbers as a table for a screen reader); the rows, series and colours
// are _chart.ts (tested) and the numbers are the table's. A bar opens that department's own view and a slice or a step opens the library on it, with the mouse: the
// keyboard has the same links in the table and in the list beside the donut. A chart is never drawn from nothing: a card with no row says so.
import { useRouter } from 'next/navigation';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from '@/components/ui/ds';
import { Figure } from './_Figure';
import { GRID, HOVER, INK, TIP, sliceTable, stackTable, statusBars, typeSlices, type Series, type Stack } from './_chart';
import { typeLines, type Overview } from './_model';

const CARD = 'h-full min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
const AXIS = { fontSize: 12, fill: INK };
const ROW = 34;

const clip = (name: string): string => (name.length > 20 ? `${name.slice(0, 19)}…` : name);
/** What a clicked bar, slice or step carries: the page's own address, or the library's. */
const payloadOf = (entry: unknown): { value?: string | null; href?: string | null } => (entry as { payload?: { value?: string | null; href?: string | null } } | null)?.payload ?? {};

/** The colours of a chart's series, drawn once under it (the chart itself is a picture; the table has the names). */
function Swatches({ series }: { series: readonly Series[] }) {
  return (
    <ul aria-hidden className="mt-[8px] flex flex-wrap gap-x-[12px] gap-y-[4px]">
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
          <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Departments as horizontal stacked bars (one level of the tree, so no document is drawn twice). */
export function StackChart({ title, note, stack, open }: { title: string; note: string; stack: Stack; open: (dept: string) => string }) {
  const router = useRouter();
  const rows = stack.rows.map((r) => ({ name: r.name, value: r.value, ...r.cells }));
  const go = (entry: unknown) => { const value = payloadOf(entry).value; if (value) router.push(open(value)); };
  return (
    <div className={CARD}>
      {rows.length === 0 ? (
        <>
          <p className="text-ds-body font-[600] text-ds-fg">{title}</p>
          <p className="mt-[8px] text-ds-body text-ds-fg-muted">No departments</p>
        </>
      ) : (
        <>
          <ChartFrame title={title} note={note} height={Math.max(120, rows.length * ROW + 40)} data={stackTable(stack)}>
            {(focusOff) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap="24%" {...focusOff}>
                  <CartesianGrid stroke={GRID} strokeDasharray="2 2" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={132} interval={0} tick={AXIS} tickFormatter={clip} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} />
                  {stack.series.map((s) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} stackId="stack" fill={s.color} isAnimationActive={false} cursor="pointer" onClick={go} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
          <Swatches series={stack.series} />
          {stack.more > 0 && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{`${stack.more} smaller ${stack.more === 1 ? 'department is' : 'departments are'} in the table`}</p>}
        </>
      )}
    </div>
  );
}

/** The steps of the approval flow (and any other status that is there) as columns; a column opens the library on that status. */
export function StatusChart({ data }: { data: Overview }) {
  const router = useRouter();
  const bars = statusBars(data);
  const go = (entry: unknown) => { const href = payloadOf(entry).href; if (href) router.push(href); };
  return (
    <div className={CARD}>
      <ChartFrame title="Documents by status" note="Each step of the approval flow" height={220} data={sliceTable(bars, 'Status')}>
        {(focusOff) => (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} {...focusOff}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 2" vertical={false} />
              <XAxis dataKey="label" interval={0} tick={AXIS} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={AXIS} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: HOVER }} contentStyle={TIP} />
              <Bar dataKey="value" name="Documents" radius={[4, 4, 0, 0]} isAnimationActive={false} cursor="pointer" onClick={go}>
                {bars.map((b) => <Cell key={b.key} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartFrame>
    </div>
  );
}

/** The kinds of document as a donut, with beside it the list the keyboard uses: each kind, how many, and how many of them are in force. */
export function TypeChart({ data }: { data: Overview }) {
  const router = useRouter();
  const slices = typeSlices(data);
  const color = new Map(slices.map((s) => [s.key, s.color]));
  const go = (entry: unknown) => { const href = payloadOf(entry).href; if (href) router.push(href); };
  return (
    <div className={CARD}>
      {slices.length === 0 ? (
        <>
          <p className="text-ds-body font-[600] text-ds-fg">Documents by type</p>
          <p className="mt-[8px] text-ds-body text-ds-fg-muted">No documents</p>
        </>
      ) : (
        <>
          <ChartFrame title="Documents by type" note="What the documents are" height={168} data={sliceTable(slices, 'Type')}>
            {(focusOff) => (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart {...focusOff}>
                  <Pie data={slices} dataKey="value" nameKey="label" innerRadius="56%" outerRadius="92%" paddingAngle={slices.length > 1 ? 2 : 0} isAnimationActive={false} cursor="pointer" onClick={go} {...focusOff}>
                    {slices.map((s) => <Cell key={s.key} fill={s.color} stroke="none" />)}
                  </Pie>
                  <Tooltip contentStyle={TIP} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartFrame>
          <ul className="mt-[8px] flex flex-col">
            {typeLines(data).filter((b) => b.count > 0).map((b) => (
              <li key={b.key} className="flex min-h-[32px] items-center justify-between gap-[12px]">
                <span className="flex min-w-0 items-center gap-[8px] text-ds-body text-ds-fg-body">
                  <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: color.get(b.key) }} />
                  <span className="truncate" title={b.label}>{b.label}</span>
                </span>
                <span className="flex items-baseline gap-[8px]">
                  <Figure value={b.count} href={b.href} noun={`${b.label.toLowerCase()} documents`} />
                  <span className="whitespace-nowrap text-ds-label text-ds-fg-muted">
                    <Figure value={b.inForce} href={b.inForceHref} noun={`published ${b.label.toLowerCase()} documents`} className="!text-ds-label" /> published
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
