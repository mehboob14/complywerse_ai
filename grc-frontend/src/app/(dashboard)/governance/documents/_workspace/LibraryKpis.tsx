'use client';

/**
 * The summary strip of the documents library: five status tiles and the review-health tile, on the kit's tile pattern (the Overview's: a 12px label, a 24px figure, a
 * bordered card on the surface token). Every tile is a button that sets a filter (a second click takes it off), so the numbers are also the quickest way to narrow the list.
 * The numbers are the loaded library's, not affected by the other filters (libraryModel.kpis); when the list is cut a line under the strip says they cover the loaded
 * documents only, and each tile's accessible name says "loaded". The donut's arithmetic is in libraryKpisLogic.ts, this file only draws. A tile says a word and a number: what
 * the word means is in its tooltip, not printed under it. Only --ds tokens and arbitrary values.
 */
import { Skeleton } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { formatCount } from '@/lib/format';
import { KPI_STATUSES, REVIEW_BUCKET_LABEL, sameSet, type Kpis, type ReviewBucket } from './libraryModel';
import { HEALTH_COLOUR, HEALTH_ORDER, donutArcs, healthCount, percent } from './libraryKpisLogic';

export interface LibraryKpisProps {
  /** libraryModel.kpis(): the loaded library's numbers, not affected by the other filters */
  kpis: Kpis;
  /** Filters.statuses now applied */
  statuses: string[];
  /** Filters.review now applied */
  review: ReviewBucket[];
  onStatuses: (next: string[]) => void;
  onReview: (next: ReviewBucket[]) => void;
  loading?: boolean;
  /** what the tiles count in a tile's accessible name: "documents" (default) or "loaded documents" when the list is cut */
  noun?: string;
  /** one line under the strip, when the list is cut: what the figures cover */
  note?: string | null;
}

type CardKey = 'all' | 'draft' | 'inReview' | 'approved' | 'published';

const CARDS: { key: CardKey; label: string; tip: string }[] = [
  { key: 'all', label: 'All', tip: 'Every document (archived ones are not counted)' },
  { key: 'draft', label: 'Draft', tip: 'Not yet sent for review' },
  { key: 'inReview', label: 'In review', tip: 'Waiting for a review or an approval' },
  { key: 'approved', label: 'Approved', tip: 'Approved, waiting to be published' },
  { key: 'published', label: 'Published', tip: 'In force' },
];

/** What a bucket's chip says: a word or two (the full wording is its tooltip and the filter list's). */
const CHIP_WORD: Record<ReviewBucket, string> = { ok: 'current', due_soon: 'due', overdue: 'overdue', unscheduled: 'no date' };

// six tiles: 3 across on a phone and a tablet (2 rows of tiles: "Published" widens to fill the second, the health tile spans a third), one row on a laptop
// with the health tile widest (never narrower than the ring and its four counts need)
const GRID = 'grid grid-cols-3 gap-[12px] xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(320px,2.2fr)]';
// a minimum, not a fixed height: if the counts of the health tile ever have to wrap, the whole row grows instead of clipping them
const TILE_BASE = 'flex min-h-[72px] min-w-0 rounded-ds-card border bg-ds-surface px-[12px] py-[10px]';
const TILE = `${TILE_BASE} flex-col justify-between`;
const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const NUMBER = 'text-[24px] leading-[32px] font-[600] tabular-nums';

const fmt = formatCount;
const documents = (n: number, noun: string) => `${fmt(n)} ${n === 1 ? noun.replace(/documents$/, 'document') : noun}`;

// ─── Status tiles ────────────────────────────────────────────────────────────────────────────────────────────────────────

function StatusTile({ card, count, delta, active, wide, noun, onClick }: {
  card: (typeof CARDS)[number];
  count: number;
  /** documents added in the last 30 days (the "All" tile only) */
  delta?: number;
  active: boolean;
  /** the odd tile of the two- and three-column grids fills its row (the health tile has the next row to itself) */
  wide: boolean;
  noun: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${card.label}, ${documents(count, noun)}. ${card.key === 'all' ? 'Show all.' : 'Show only these.'}`}
      title={`${card.tip}${active ? ' — click to show all' : ''}`}
      onClick={onClick}
      className={`${TILE} text-left transition-colors ${wide ? 'col-span-2 xl:col-span-1' : ''} ${FOCUS} ${
        active ? 'border-ds-primary bg-ds-primary-soft shadow-[0_0_0_1px_var(--ds-primary)]' : 'border-ds-border hover:bg-ds-surface-hover'
      }`}
    >
      <span className="block truncate text-ds-label text-ds-fg-muted">{card.label}</span>
      <span className="flex min-w-0 items-baseline gap-[8px]">
        <span className={`${NUMBER} ${count === 0 ? 'text-ds-fg-muted' : 'text-ds-fg'}`}>{fmt(count)}</span>
        {delta ? (
          <span className="rounded-full bg-ds-primary-soft px-[6px] text-ds-label text-ds-primary-text" title="Added in the last 30 days">+{fmt(delta)}</span>
        ) : null}
      </span>
    </button>
  );
}

// ─── Review health ───────────────────────────────────────────────────────────────────────────────────────────────────────

// a thin ring: the percentage inside it (13px, about 31px wide) has ~7px of air on each side, the arcs read as a gauge, not a block
const SIZE = 56;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;

function HealthTile({ health, review, noun, onReview }: { health: Kpis['health']; review: ReviewBucket[]; noun: string; onReview: (next: ReviewBucket[]) => void }) {
  const { reviewable } = health;
  const arcs = donutArcs(health, { radius: RADIUS, gapDegrees: 2 });
  const rows = HEALTH_ORDER.filter((bucket) => bucket !== 'unscheduled' || health.unscheduled > 0);
  return (
    <div
      role="group"
      aria-label="Review health"
      className={`${TILE_BASE} col-span-3 flex-row items-center gap-[14px] overflow-hidden border-ds-border py-[6px] xl:col-span-1`}
    >
      <div className="relative h-[56px] w-[56px] shrink-0" title={reviewable > 0 ? `${percent(health.upToDate, reviewable)}% of the ${documents(reviewable, noun)} in force are up to date` : undefined}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
          {/* the track: the whole ring in a pale grey, the arcs are drawn over it (it shows only in the gaps between arcs, or alone when nothing is in force) */}
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#e8edf1" strokeWidth={STROKE} />
          {arcs.map((arc) => (
            <circle
              key={arc.bucket}
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke={arc.colour}
              strokeWidth={STROKE}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={arc.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className={`text-ds-body font-[600] tabular-nums ${reviewable > 0 ? 'text-ds-fg' : 'text-ds-fg-muted'}`} aria-hidden>
            {reviewable > 0 ? `${percent(health.upToDate, reviewable)}%` : '—'}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-[2px] text-ds-label text-ds-fg-muted">
          Review health
          <InfoTip
            label="About review health"
            align="end"
            text={reviewable > 0
              ? `Of the ${documents(reviewable, noun)} in force: a review is owed on published and approved documents. Click a number to list them.`
              : 'A review is owed on published and approved documents. None is in force yet.'}
          />
        </div>
        {reviewable > 0 ? (
          <div className="flex flex-wrap gap-x-[6px]">
            {rows.map((bucket) => {
              const count = healthCount(health, bucket);
              const share = percent(count, reviewable);
              const active = review.length === 1 && review[0] === bucket;
              return (
                <button
                  key={bucket}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${REVIEW_BUCKET_LABEL[bucket]}, ${documents(count, noun)}, ${share}%. Show only these.`}
                  title={`${REVIEW_BUCKET_LABEL[bucket]}: ${fmt(count)} of ${fmt(reviewable)} (${share}%)`}
                  onClick={() => onReview(active ? [] : [bucket])}
                  className={`flex flex-col items-start rounded-ds-control border px-[4px] text-left transition-colors ${FOCUS} ${
                    active ? 'border-ds-primary bg-ds-primary-soft' : 'border-transparent hover:bg-ds-surface-hover'
                  }`}
                >
                  {/* the count on top with its colour, the word under it: four of them take about 200px, one line, whatever the data */}
                  <span className="flex items-center gap-[6px]">
                    <span className="h-[8px] w-[8px] shrink-0 rounded-full" style={{ backgroundColor: HEALTH_COLOUR[bucket] }} aria-hidden />
                    <span className={`text-[16px] leading-[20px] font-[600] tabular-nums ${count === 0 ? 'text-ds-fg-muted' : 'text-ds-fg'}`}>{fmt(count)}</span>
                  </span>
                  <span className={`text-ds-label ${active ? 'text-ds-primary-text' : 'text-ds-fg-muted'}`}>{CHIP_WORD[bucket]}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="mt-1 text-ds-label text-ds-fg-muted">None in force yet</div>
        )}
      </div>
    </div>
  );
}

// ─── The strip ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function LibraryKpis({ kpis, statuses, review, onStatuses, onReview, loading, noun = 'documents', note }: LibraryKpisProps) {
  if (loading) {
    return (
      <div className={GRID} role="status" aria-busy="true">
        <span className="sr-only">Loading the summary…</span>
        {[...CARDS, null].map((card, i) => (
          <Skeleton key={card?.key ?? 'health'} className={`min-h-[72px] rounded-ds-card ${i === CARDS.length ? 'col-span-3 xl:col-span-1' : ''}`} />
        ))}
      </div>
    );
  }
  return (
    <div>
      <div role="group" aria-label="Library summary" className={GRID}>
        {CARDS.map((card) => {
          const active = sameSet(statuses, KPI_STATUSES[card.key]);
          return (
            <StatusTile
              key={card.key}
              card={card}
              count={kpis[card.key]}
              delta={card.key === 'all' ? kpis.addedLast30 : undefined}
              active={active}
              wide={card.key === 'published'}
              noun={noun}
              onClick={() => onStatuses(active ? [] : [...KPI_STATUSES[card.key]])}
            />
          );
        })}
        <HealthTile health={kpis.health} review={review} noun={noun} onReview={onReview} />
      </div>
      {note && <p className="mt-[8px] text-ds-label text-ds-fg-muted">{note}</p>}
    </div>
  );
}

export default LibraryKpis;
