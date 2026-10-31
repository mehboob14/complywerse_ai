'use client';

// ChartFrame: the wrapper every recharts chart needs so it is neither a keyboard trap nor a picture a screen reader cannot read. A visible title (and an
// optional line under it), the chart in a box of a set height that is hidden from assistive technology (it is a picture), and the same numbers as a
// table that only a screen reader sees: the chart's text alternative, named by the title. recharts 3 makes every chart a tab stop announced as an
// unnamed "application"; the frame hands the chart the props that turn that off (chartFocusOff), so nothing inside it takes focus.
//
//   <ChartFrame title="Documents created and published each month" height={280} data={{ columns: ['Month', 'Created', 'Published'], rows: [['Jun', 3, 2], ['Jul', 5, 4]] }}>
//     {(focusOff) => (
//       <ResponsiveContainer width="100%" height="100%">
//         <AreaChart data={months} {...focusOff}>…</AreaChart>
//       </ResponsiveContainer>
//     )}
//   </ChartFrame>
//
// A chart with a <Pie> puts the same props on the Pie too. The frame does not import recharts (it would join every page that imports the kit); the
// page draws the chart, so the page also owns the colours (an SVG attribute cannot read a class: write the hex of the --ds token) and says what is
// loading, empty or failed before it draws a frame. Tokens and arbitrary values only (kit rules).
import { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { RowHeaderCell, Table, TBody, Td, Th, THead, Tr } from './Table';
import { chartFocusOff, chartTable, type ChartData } from './chartText';

export type { ChartData };

export interface ChartFrameProps {
  /** what the chart shows, drawn above it: "Documents created and published each month". It also names the figure and the table of numbers */
  title: string;
  /** a line under the title, drawn: the unit, or what to read from the chart */
  note?: string;
  /** the numbers the chart draws, as a table: the chart's text alternative, read out by a screen reader and never drawn */
  data: ChartData;
  /** how tall the chart is, in px (it fills the box: `<ResponsiveContainer width="100%" height="100%">`) */
  height?: number;
  /** the chart; a function receives the props that turn off recharts' keyboard layer (spread them on the chart, and on a Pie) */
  children: ReactNode | ((focusOff: ReturnType<typeof chartFocusOff>) => ReactNode);
  /** layout only (margin, width) */
  className?: string;
}

export function ChartFrame({ title, note, data, height = 240, children, className }: ChartFrameProps) {
  const id = useId();
  const table = chartTable(data);
  return (
    <figure aria-labelledby={`${id}-title`} className={clsx('min-w-0', className)}>
      <figcaption>
        <p id={`${id}-title`} className="text-ds-body font-[600] text-ds-fg">{title}</p>
        {note && <p className="text-ds-label font-normal text-ds-fg-muted">{note}</p>}
      </figcaption>
      {/* a picture: hidden from assistive technology, which has the table below instead */}
      <div aria-hidden="true" className="mt-[8px] w-full min-w-0" style={{ height }}>
        {typeof children === 'function' ? children(chartFocusOff()) : children}
      </div>
      <div className="sr-only">
        <Table caption={title}>
          <THead>
            <Tr>{table.columns.map((name, i) => <Th key={i}>{name}</Th>)}</Tr>
          </THead>
          <TBody>
            {table.rows.map((row, r) => (
              <Tr key={r}>{row.map((cell, i) => (i === 0 ? <RowHeaderCell key={i}>{cell}</RowHeaderCell> : <Td key={i}>{cell}</Td>))}</Tr>
            ))}
            {table.more > 0 && <Tr><Td colSpan={Math.max(1, table.columns.length)}>{`and ${table.more} more ${table.more === 1 ? 'row' : 'rows'}`}</Td></Tr>}
          </TBody>
        </Table>
      </div>
    </figure>
  );
}
