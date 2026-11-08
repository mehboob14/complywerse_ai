'use client';

// "Created and completed": twelve calendar months of bars, the numbers in a table anyone can open. The months are insightsModel.trendOf: the year is said at the first bar and at every January (the
// old chart dropped it), and the last bar is the month so far. The bars are a picture (hidden from a screen reader); the table is the same numbers as text. On a phone a bar's label is the month's first letter (twelve names do not fit); the table has them whole.
import { formatCount } from '@/lib/format';
import { trendHeight, trendMax } from '../tasksModel';
import type { Month } from './insightsModel';

export function Trend({ months }: { months: readonly Month[] }) {
  const max = trendMax(months.slice());
  return (
    <div>
      <div aria-hidden className="flex h-[168px] items-end gap-[4px]">
        {months.map((m, i) => (
          <div key={m.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-[2px]">
            <div className="flex w-full flex-1 items-end justify-center gap-[2px]">
              <div className="w-[8px] rounded-t-[2px] bg-ds-info" style={{ height: `${trendHeight(m.created, max)}%`, minHeight: m.created > 0 ? '4px' : '0' }} />
              <div className="w-[8px] rounded-t-[2px] bg-ds-success" style={{ height: `${trendHeight(m.completed, max)}%`, minHeight: m.completed > 0 ? '4px' : '0' }} />
            </div>
            <span className="w-full whitespace-nowrap text-center text-ds-label text-ds-fg-muted"><span className="sm:hidden">{m.short.charAt(0)}</span><span className="hidden sm:inline">{m.short}</span></span>
            <span className="h-[16px] w-full truncate text-center text-ds-label text-ds-fg-muted">{i === 0 || m.short === 'Jan' ? `'${String(m.year).slice(2)}` : ''}</span>
          </div>
        ))}
      </div>
      <div className="mt-[12px] flex items-center justify-center gap-[24px] text-ds-label text-ds-fg-muted">
        <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px] bg-ds-info" /> Created</span>
        <span className="inline-flex items-center gap-[6px]"><span aria-hidden className="h-[10px] w-[10px] rounded-[2px] bg-ds-success" /> Completed</span>
      </div>
      <details className="mt-[8px]">
        <summary className="min-h-ds-control cursor-pointer rounded-ds-control py-[6px] text-ds-body font-medium text-ds-primary-text focus-visible:outline-none focus-visible:shadow-ds-ring">Show the numbers</summary>
        <div className="mt-[8px] max-w-full overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Tasks created and completed in each of the last 12 months</caption>
            <thead>
              <tr>
                <th scope="col" className="py-[4px] pr-[12px] text-ds-label font-[600] text-ds-fg-muted">Month</th>
                <th scope="col" className="px-[12px] py-[4px] text-right text-ds-label font-[600] text-ds-fg-muted">Created</th>
                <th scope="col" className="px-[12px] py-[4px] text-right text-ds-label font-[600] text-ds-fg-muted">Completed</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className="py-[4px] pr-[12px] text-ds-body font-normal text-ds-fg">{m.label}</th>
                  <td className="px-[12px] py-[4px] text-right text-ds-body tabular-nums text-ds-fg">{formatCount(m.created)}</td>
                  <td className="px-[12px] py-[4px] text-right text-ds-body tabular-nums text-ds-fg">{formatCount(m.completed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
