'use client';

/**
 * The summary strip of the documents library: five status tiles and the review-health tile. Every tile is a button that sets a
 * filter (a second click takes it off), so the numbers are also the quickest way to narrow the list. The numbers are the whole
 * library's, not affected by the other filters (libraryModel.kpis); the donut's arithmetic is in libraryKpisLogic.ts, this file
 * only draws. A tile says a word and a number: what the word means is in its tooltip, not printed under it. Colours are explicit
 * hex classes on purpose: the platform's CSS repaints slate/white inside the dashboard and a bare <p> gets its own size and colour
 * (PITFALLS 100), so every piece of text here carries its own.
 */
import { BadgeCheck, CheckCircle2, Clock, FileText, Pencil, type LucideIcon } from 'lucide-react';
import { InfoTip } from '@/components/ui/InfoTip';
import { KPI_STATUSES, REVIEW_BUCKET_LABEL, sameSet, type Kpis, type ReviewBucket } from './libraryModel';
import { HEALTH_COLOUR, HEALTH_ORDER, donutArcs, healthCount, percent } from './libraryKpisLogic';

export interface LibraryKpisProps {
  /** libraryModel.kpis(): the whole library's numbers, not affected by the other filters */
  kpis: Kpis;
  /** Filters.statuses now applied */
  statuses: string[];
  /** Filters.review now applied */
  review: ReviewBucket[];
  onStatuses: (next: string[]) => void;
  onReview: (next: ReviewBucket[]) => void;
  loading?: boolean;
}

type CardKey = 'all' | 'draft' | 'inReview' | 'approved' | 'published';

const CARDS: { key: CardKey; label: string; tip: string; Icon: LucideIcon; tile: string }[] = [
  { key: 'all', label: 'All', tip: 'Every document (archived ones are not counted)', Icon: FileText, tile: 'bg-[#eef1f4] text-[#586472]' },
  { key: 'draft', label: 'Draft', tip: 'Not yet sent for review', Icon: Pencil, tile: 'bg-[#eef1f4] text-[#586472]' },
  { key: 'inReview', label: 'In review', tip: 'Waiting for a review or an approval', Icon: Clock, tile: 'bg-[#fef3c7] text-[#b45309]' },
  { key: 'approved', label: 'Approved', tip: 'Approved, waiting to be published', Icon: CheckCircle2, tile: 'bg-[#dbeafe] text-[#1d4ed8]' },
  { key: 'published', label: 'Published', tip: 'In force', Icon: BadgeCheck, tile: 'bg-[#d1fae5] text-[#047857]' },
];

/** What a bucket's chip says: a word or two (the full wording is its tooltip and the filter list's). */
const CHIP_WORD: Record<ReviewBucket, string> = { ok: 'current', due_soon: 'due', overdue: 'overdue', unscheduled: 'no date' };

// six tiles: 2 across on a phone (3 rows), 3 across from tablets (2 rows), one row on a laptop with the health tile widest
const GRID = 'grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,2.6fr)]';
const TILE = 'h-[72px]';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
// NOTE: the platform's CSS forces `.bg-white` with !important, which would beat a hover tint on the same element: a tile whose
// background changes is spelled bg-[#fff], not bg-white.
/** A zero is quieter than a count, but still readable (3.7:1 on white; large text needs 3:1). */
const ZERO = 'text-[#7b8794]';

const fmt = (n: number) => n.toLocaleString('en-US');
const documents = (n: number) => `${fmt(n)} ${n === 1 ? 'document' : 'documents'}`;

// ─── Status tiles ────────────────────────────────────────────────────────────────────────────────────────────────────────

function StatusTile({ card, count, delta, active, wide, onClick }: {
  card: (typeof CARDS)[number];
  count: number;
  /** documents added in the last 30 days (the "All" tile only) */
  delta?: number;
  active: boolean;
  /** the odd tile of the two-column phone grid fills its row */
  wide: boolean;
  onClick: () => void;
}) {
  const { Icon } = card;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${card.label}, ${documents(count)}. ${card.key === 'all' ? 'Show all.' : 'Show only these.'}`}
      title={`${card.tip}${active ? ' — click to show all' : ''}`}
      onClick={onClick}
      className={`${TILE} flex min-w-0 flex-col justify-between rounded-xl border px-3.5 py-2.5 text-left transition-colors ${wide ? 'col-span-2 md:col-span-1' : ''} ${FOCUS} focus-visible:ring-offset-1 ${
        active ? 'border-[#0f766e] bg-[#f0fdfa] ring-1 ring-[#0f766e]' : 'border-[#d5dbe1] bg-[#fff] hover:border-[#99d5cf] hover:bg-[#f0fdfa]'
      }`}
    >
      <span className="block truncate text-[12px] font-medium leading-4 text-[#586472]">{card.label}</span>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={`text-[24px] font-semibold leading-7 tabular-nums ${count === 0 ? ZERO : 'text-[#1f2933]'}`}>{fmt(count)}</span>
          {delta ? (
            <span className="rounded-full bg-[#ccfbf1] px-1.5 text-[11px] font-medium leading-4 text-[#115e59]" title="Added in the last 30 days">+{fmt(delta)}</span>
          ) : null}
        </span>
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${card.tile}`} aria-hidden>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
      </span>
    </button>
  );
}

// ─── Review health ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SIZE = 52;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;

function HealthTile({ health, review, onReview }: { health: Kpis['health']; review: ReviewBucket[]; onReview: (next: ReviewBucket[]) => void }) {
  const { reviewable } = health;
  const arcs = donutArcs(health, { radius: RADIUS, gapDegrees: 2 });
  const rows = HEALTH_ORDER.filter((bucket) => bucket !== 'unscheduled' || health.unscheduled > 0);
  return (
    <div
      role="group"
      aria-label="Review health"
      className={`${TILE} col-span-2 flex min-w-0 items-center gap-3 overflow-hidden rounded-xl border border-[#d5dbe1] bg-white px-3.5 md:col-span-1`}
    >
      <div className="relative h-[52px] w-[52px] shrink-0" title={reviewable > 0 ? `${percent(health.upToDate, reviewable)}% of the ${documents(reviewable)} in force are up to date` : undefined}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="-rotate-90" aria-hidden>
          {arcs.length === 0 && <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="#e1e6eb" strokeWidth={STROKE} />}
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
          <span className={`text-[13px] font-semibold tabular-nums ${reviewable > 0 ? 'text-[#1f2933]' : 'text-[#586472]'}`} aria-hidden>
            {reviewable > 0 ? `${percent(health.upToDate, reviewable)}%` : '—'}
          </span>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-0.5 text-[12px] font-medium leading-4 text-[#586472]">
          Review health
          <InfoTip
            label="About review health"
            align="end"
            text={reviewable > 0
              ? `Of the ${documents(reviewable)} in force: a review is owed on published and approved documents. Click a number to list them.`
              : 'A review is owed on published and approved documents. None is in force yet.'}
          />
        </div>
        {reviewable > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-1">
            {rows.map((bucket) => {
              const count = healthCount(health, bucket);
              const share = percent(count, reviewable);
              const active = review.length === 1 && review[0] === bucket;
              return (
                <button
                  key={bucket}
                  type="button"
                  aria-pressed={active}
                  aria-label={`${REVIEW_BUCKET_LABEL[bucket]}, ${documents(count)}, ${share}%. Show only these.`}
                  title={`${REVIEW_BUCKET_LABEL[bucket]}: ${fmt(count)} of ${fmt(reviewable)} (${share}%)`}
                  onClick={() => onReview(active ? [] : [bucket])}
                  className={`inline-flex h-5 items-center gap-1 rounded-full border px-1.5 text-[12px] leading-4 transition-colors ${FOCUS} ${
                    active ? 'border-[#99d5cf] bg-[#f0fdfa] text-[#115e59]' : 'border-transparent text-[#26323d] hover:bg-[#f3f6f8]'
                  }`}
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: HEALTH_COLOUR[bucket] }} aria-hidden />
                  <span className="font-semibold tabular-nums text-[#1f2933]">{fmt(count)}</span>
                  <span>{CHIP_WORD[bucket]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── The strip ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export function LibraryKpis({ kpis, statuses, review, onStatuses, onReview, loading }: LibraryKpisProps) {
  if (loading) {
    return (
      <div className={`relative ${GRID}`} role="status" aria-busy="true">
        <span className="sr-only">Loading the summary…</span>
        {[...CARDS, null].map((card, i) => (
          <div key={card?.key ?? 'health'} aria-hidden className={`${TILE} animate-pulse rounded-xl border border-[#e1e6eb] bg-[#f3f6f8]`} data-i={i} />
        ))}
      </div>
    );
  }
  return (
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
            onClick={() => onStatuses(active ? [] : [...KPI_STATUSES[card.key]])}
          />
        );
      })}
      <HealthTile health={kpis.health} review={review} onReview={onReview} />
    </div>
  );
}

export default LibraryKpis;
