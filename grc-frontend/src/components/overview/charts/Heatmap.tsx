'use client';

// Heatmap: a grid of counts, darker is more (one hue: RAMP). It is a real <table>: row and column headers, and the number printed in every cell, so the colour is
// never the only signal and a screen reader reads it as a table. A cell with something in it is a link when `href` returns one (the records behind that cell). For
// a risk matrix, a control-by-state grid, an owner-by-severity grid. `zone` adds a coloured edge to a cell for the meaning of the position itself (a risk matrix's
// "high" corner); the count still sets the fill.
//
//   <Heatmap label="Risks by likelihood and impact" rowTitle="Likelihood" colTitle="Impact" rows={['5', '4', …]} cols={['1', '2', …]} cells={[[0, 1, …], …]} href={(r, c) => `/erm/risks?l=${5 - r}&i=${c + 1}`} />
import Link from 'next/link';
import { formatCount } from '../../../lib/format';
import { heatStep } from './chartModel';
import { RAMP, STATUS, type StatusColor } from './palette';

export interface HeatmapProps {
  label: string;
  /** what the rows are ("Likelihood") and what the columns are ("Impact") */
  rowTitle: string;
  colTitle: string;
  rows: readonly string[];
  cols: readonly string[];
  /** cells[row][col]; null is "not applicable" (a dash), 0 is an empty cell */
  cells: ReadonlyArray<ReadonlyArray<number | null>>;
  /** where a cell with something in it opens its records */
  href?: (row: number, col: number) => string | undefined;
  /** the meaning of a position, as the colour of a 3px edge under the cell */
  zone?: (row: number, col: number) => StatusColor | undefined;
  /** the largest value of the scale (default: the largest cell) */
  max?: number;
  /** what a cell counts, for its name: "risks" */
  noun?: string;
}

const DARK_FROM = 3;       // RAMP steps 3 and 4 are dark enough for white text

export function Heatmap({ label, rowTitle, colTitle, rows, cols, cells, href, zone, max, noun = 'items' }: HeatmapProps) {
  const top = max ?? Math.max(0, ...cells.flat().map((v) => (typeof v === 'number' ? v : 0)));
  return (
    <div className="max-w-full overflow-x-auto">
      <table aria-label={label} className="w-full min-w-[260px] !border-separate !border-spacing-[3px] text-ds-label">
        <caption className="sr-only">{`${label}: ${rowTitle} by ${colTitle}`}</caption>
        <thead>
          <tr className="!bg-transparent">
            <th scope="col" className="!bg-transparent !p-0 text-left text-ds-label font-normal text-ds-fg-muted"><span className="sr-only">{`${rowTitle} by ${colTitle}`}</span></th>
            {cols.map((c) => <th key={c} scope="col" className="!bg-transparent !p-[2px] text-center text-ds-label font-normal text-ds-fg-muted">{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={r} className="!bg-transparent">
              <th scope="row" className="!bg-transparent !p-[2px] pr-[6px] text-right !text-ds-label font-normal text-ds-fg-muted">{r}</th>
              {cols.map((c, ci) => {
                const v = cells[ri]?.[ci] ?? null;
                const step = heatStep(v, top, RAMP.length);
                const z = zone?.(ri, ci);
                const link = v !== null && v > 0 ? href?.(ri, ci) : undefined;
                const name = `${rowTitle} ${r}, ${colTitle} ${c}: ${v === null ? 'not applicable' : `${formatCount(v)} ${noun}`}`;
                const body = v === null ? '—' : formatCount(v);
                const style = { backgroundColor: RAMP[step], color: step >= DARK_FROM ? '#ffffff' : '#1f2933', boxShadow: z ? `inset 0 -3px 0 ${STATUS[z]}` : undefined };
                return (
                  <td key={c} className="!h-[36px] !min-w-[36px] !rounded-ds-control !p-0 text-center text-ds-label tabular-nums" style={style}>
                    {link ? (
                      <Link href={link} aria-label={`Open ${name}`} className="flex h-[36px] min-w-[36px] items-center justify-center rounded-ds-control font-[600] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring" style={{ color: 'inherit' }}>{body}</Link>
                    ) : (
                      <span aria-label={name} className="flex h-[36px] min-w-[36px] items-center justify-center">{body}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
