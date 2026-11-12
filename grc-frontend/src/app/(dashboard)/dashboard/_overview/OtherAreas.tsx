'use client';

// Other areas: the areas of the platform that have no score of their own (a headline and a few counts, or only a page), as small multiples: one tile each, a bar of its status colour, the
// area's name and one line in that colour with its words ("99 overdue tasks", "All clear", "12 active vendors", "Open"). The line is the area's most serious count and the tile opens the
// records it counts (the area itself when nothing is lit), so a tile is both the status and the way in. It stands in for the 17-row table: the scored areas are the bars of "Score against
// target". The kit's AreaTiles draws a ring for a 0 to 100 score; these areas have counts, not scores, so the tile is this page's own (it uses the same tile frame). Each tile waits, fails
// (with its own Retry, never as a 0), is refused or has nothing on its own. Rules: perfCharts.ts otherTiles (tested).
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ChartCard } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { Button, Skeleton } from '@/components/ui/ds';
import { otherTiles, type OtherTile } from './perfCharts';
import { COUNT_TEXT } from './ScoreBars';
import type { AreaRow } from './perfModel';

const TILE = 'flex h-full min-w-0 items-stretch gap-[10px] rounded-ds-control border border-ds-border bg-ds-surface px-[10px] py-[8px]';
const TILE_LINK = 'hover:border-ds-border-strong hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

function Body({ t, retry }: { t: OtherTile; retry?: ReactNode }) {
  return (
    <>
      <span aria-hidden className="block min-h-[32px] w-[4px] shrink-0 rounded-full" style={{ backgroundColor: STATUS[t.status] }} />
      <span className="min-w-0 flex-1">
        <span className="block line-clamp-2 break-words text-ds-body font-[500] text-ds-fg">{t.label}</span>
        <span className={clsx('block line-clamp-2 break-words text-ds-label', COUNT_TEXT[t.status])}>{t.line}</span>
        {retry}
      </span>
    </>
  );
}

export function OtherAreas({ rows, onRetry }: { rows: readonly AreaRow[]; onRetry: (areaKey: string) => void }) {
  const tiles = otherTiles(rows);
  return (
    <ChartCard
      id="areas"
      title="Other areas"
      info="The areas that are not scored: one tile each, in the colour of its most serious count and with that count's words (red: overdue, lapsed or breached; amber: to watch; green: all clear). A tile opens the records it counts, or the area when nothing is counted. The areas that are scored are in Score against target."
      state={tiles.length === 0 ? 'empty' : 'ready'}
      emptyText="None of the other areas are open to your account."
    >
      <ul aria-label="Other areas" className="m-0 grid list-none grid-cols-2 gap-[8px] p-0 min-[480px]:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
        {tiles.map((t) => (
          <li key={t.key} className="min-w-0">
            {t.state === 'loading' ? (
              <div role="status" aria-busy="true"><span className="sr-only">{t.name}</span><Skeleton className="h-[50px] w-full" /></div>
            ) : t.href ? (
              <Link href={t.href} title={t.name} aria-label={t.name} className={clsx(TILE, TILE_LINK)}><Body t={t} /></Link>
            ) : (
              <div title={t.name} className={TILE}>
                <Body t={t} retry={t.retry ? <Button variant="link" size="sm" onClick={() => onRetry(t.key)} aria-label={`Retry ${t.label}`}>Retry</Button> : undefined} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
