'use client';

// AreaTiles: small multiples. One compact tile per area (a department, a framework, a module): a small ring filled to its score, the figure beside it and the
// name under the figure, the ring in the area's STATUS colour. It replaces a table of many rows (Overview rule R4): twelve areas are twelve tiles that fit in
// a screen, each one a link to that area's records. A status colour never stands alone: the tooltip and the accessible name carry its word, and a legend under
// the grid names the colours that are drawn. An area with no score (value null) is a grey ring, "—" and "Not scored", never a 0. A phone has two columns; a
// grid with more than `max` tiles ends in "See all N" (`moreHref`). The rules are areaModel.ts.
//
//   <AreaTiles label="Score by area" items={[{ key: 'gov', label: 'Governance', value: 72, tone: 'warn', href: '/governance', note: '3 overdue' }, …]} max={12} moreHref="/reports" />
import Link from 'next/link';
import { clsx } from 'clsx';
import { ringDash } from './chartModel';
import { legendOf, moreText, tilesOf, type AreaTileItem, type AreaTone, type Tile } from './areaModel';
import { STATUS, TRACK } from './palette';
import { linkClasses } from '../../ui/ds/linkModel';

export interface AreaTilesProps {
  /** names the grid for a screen reader: "Score by area" */
  label: string;
  items: readonly AreaTileItem[];
  /** how many tiles before "See all" (default 12) */
  max?: number;
  /** where "See all N" goes */
  moreHref?: string;
  /** replaces "See all N" */
  moreLabel?: string;
  /** the words of the status colours when the measure has better ones than On track / Watch / Off track / Not scored */
  words?: Partial<Record<AreaTone, string>>;
  /** the legend of the colours drawn (default true) */
  legend?: boolean;
}

const SIZE = 36;
const STROKE = 5;
const R = (SIZE - STROKE) / 2;

function MiniRing({ fill, tone, scored }: { fill: number; tone: AreaTone; scored: boolean }) {
  const { circumference, dash } = ringDash(fill, R);
  const c = SIZE / 2;
  return (
    <svg aria-hidden width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="block shrink-0">
      <circle cx={c} cy={c} r={R} fill="none" stroke={TRACK} strokeWidth={STROKE} />
      {(dash > 0 || scored) && <circle cx={c} cy={c} r={R} fill="none" stroke={STATUS[tone]} strokeWidth={STROKE} strokeLinecap="round" strokeDasharray={`${Math.max(dash, 0.01)} ${circumference}`} transform={`rotate(-90 ${c} ${c})`} />}
    </svg>
  );
}

const TILE = 'flex min-w-0 items-center gap-[10px] rounded-ds-control border border-ds-border bg-ds-surface p-[8px]';
const TILE_LINK = 'hover:border-ds-border-strong hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring';

function Body({ t }: { t: Tile }) {
  return (
    <>
      <MiniRing fill={t.fill} tone={t.tone} scored={t.scored} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[18px] font-[600] leading-[22px] tabular-nums text-ds-fg">{t.figure}</span>
        <span className="block truncate text-ds-label text-ds-fg-muted">{t.label}</span>
      </span>
      {!t.href && <span className="sr-only">{`, ${t.word}`}</span>}
    </>
  );
}

export function AreaTiles({ label, items, max, moreHref, moreLabel, words, legend = true }: AreaTilesProps) {
  const { shown, total, hidden } = tilesOf(items, max, words);
  const key = legend ? legendOf(shown) : [];
  const more = moreText(total, hidden, moreLabel);
  return (
    <div>
      <ul aria-label={label} className="m-0 grid list-none grid-cols-2 gap-[8px] p-0 min-[480px]:grid-cols-[repeat(auto-fill,minmax(148px,1fr))]">
        {shown.map((t) => (
          <li key={t.key} className="min-w-0">
            {t.href ? (
              <Link href={t.href} title={t.title} aria-label={t.linkName} className={clsx(TILE, TILE_LINK)}><Body t={t} /></Link>
            ) : (
              <div title={t.title} className={TILE}><Body t={t} /></div>
            )}
          </li>
        ))}
      </ul>
      {(key.length > 0 || more) && (
        <div className="mt-[12px] flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px]">
          <ul aria-hidden className="m-0 flex list-none flex-wrap gap-x-[12px] gap-y-[4px] p-0">
            {key.map((k) => (
              <li key={k.tone} className="flex items-center gap-[6px] text-ds-label text-ds-fg-muted">
                <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: STATUS[k.tone] }} />
                {k.word}
              </li>
            ))}
          </ul>
          {more && (moreHref
            ? <Link href={moreHref} className={clsx('ml-auto', linkClasses({ tone: 'text', size: 'label' }))}>{more}</Link>
            : <span className="ml-auto text-ds-label text-ds-fg-muted">{`${shown.length} of ${total}`}</span>)}
        </div>
      )}
    </div>
  );
}
