'use client';

// Picture: the box a recharts chart is drawn in on an Overview, and its text alternative. The chart is a picture (hidden from assistive technology, no tab stop:
// recharts 3 makes every chart a keyboard trap announced as an unnamed "application", `chartFocusOff()` turns that off) and the same numbers are a table that only
// a screen reader sees, named by `label`. The visible title is the card's, so unlike the kit's ChartFrame this one draws none: a card never says its title twice.
//
//   <Picture label="Open issues by month" height={220} data={{ columns: ['Month', 'Open'], rows: [['Jun', 3], ['Jul', 5]] }}>
//     {(focusOff) => <ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} {...focusOff}>…</AreaChart></ResponsiveContainer>}
//   </Picture>
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { RowHeaderCell, Table, TBody, Td, Th, THead, Tr } from '../../ui/ds/Table';
import { chartFocusOff, chartTable, type ChartData } from '../../ui/ds/chartText';

export interface PictureProps {
  /** what the picture shows, read out with its table: "Open issues by month" */
  label: string;
  /** the numbers the chart draws, as a table: the chart's text alternative */
  data: ChartData;
  /** how tall the picture is, in px (it fills the box: `<ResponsiveContainer width="100%" height="100%">`) */
  height: number;
  children: ReactNode | ((focusOff: ReturnType<typeof chartFocusOff>) => ReactNode);
  className?: string;
}

export function Picture({ label, data, height, children, className }: PictureProps) {
  const table = chartTable(data);
  return (
    <figure aria-label={label} className={clsx('m-0 min-w-0', className)}>
      <div aria-hidden="true" className="w-full min-w-0" style={{ height }}>
        {typeof children === 'function' ? children(chartFocusOff()) : children}
      </div>
      <div className="sr-only">
        <Table caption={label}>
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

/** What a chart's legend is: swatch and name per series, drawn once under the chart (the picture is hidden from assistive technology and its table has the names). */
export function Swatches({ items }: { items: ReadonlyArray<{ key: string; label: string; color: string }> }) {
  return (
    <ul aria-hidden className="m-0 mt-[8px] flex list-none flex-wrap gap-x-[12px] gap-y-[4px] p-0">
      {items.map((s) => (
        <li key={s.key} className="flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
          <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
