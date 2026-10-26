'use client';

/**
 * The summary strip of the documents library: five status cards and the "Document health" card. Every card is a button that sets a
 * filter (a second click takes it off), so the numbers are also the quickest way to narrow the list. The numbers are the whole
 * library's, not affected by the other filters (libraryModel.kpis); the donut's arithmetic is in libraryKpisLogic.ts, this file
 * only draws. Colours are explicit hex classes on purpose: the platform's CSS repaints slate/white inside the dashboard and a bare
 * <p> gets its own size and colour (PITFALLS: grc-frontend UI), so every piece of text here carries its own.
 */
import { BadgeCheck, CheckCircle2, Clock, FileText, Pencil, type LucideIcon } from 'lucide-react';
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

const CARDS: { key: CardKey; label: string; sub: string; Icon: LucideIcon; tile: string }[] = [
  { key: 'all', label: 'All documents', sub: '', Icon: FileText, tile: 'bg-[#eef1f4] text-[#586472]' },
  { key: 'draft', label: 'Draft', sub: 'not yet sent for review', Icon: Pencil, tile: 'bg-[#eef1f4] text-[#586472]' },
  { key: 'inReview', label: 'In review', sub: 'pending review or approval', Icon: Clock, tile: 'bg-[#fef3c7] text-[#b45309]' },
  { key: 'approved', label: 'Approved', sub: 'awaiting publication', Icon: CheckCircle2, tile: 'bg-[#dbeafe] text-[#1d4ed8]' },
  { key: 'published', label: 'Published', sub: 'in force', Icon: BadgeCheck, tile: 'bg-[#d1fae5] text-[#047857]' },
];

const GRID = 'grid grid-cols-2 gap-3 lg:grid-cols-5 xl:grid-cols-[repeat(5,minmax(0,1fr))_minmax(0,2.5fr)]';
const HEALTH_SPAN = 'col-span-2 lg:col-span-5 xl:col-span-1';
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
// NOTE: the platform's CSS forces `.bg-white` with !important, which would beat a hover tint on the same element: a card whose
// background changes is spelled bg-[#fff], not bg-white.
/** A zero is quieter than a count, but still readable (3.7:1 on white; large text needs 3:1). */
const ZERO = 'text-[#7b8794]';

const fmt = (n: number) => n.toLocaleString('en-US');
const documents = (n: number) => `${fmt(n)} ${n === 1 ? 'document' : 'documents'}`;

// ─── Status cards ────────────────────────────────────────────────────────────────────────────────────────────────────────

function StatusCard({ card, count, sub, active, wide, onClick }: {
  card: (typeof CARDS)[number];
  count: number;
  sub: string;
  active: boolean;
  /** the odd card of a two-column phone grid fills its row */
  wide: boolean;
  onClick: () => void;
}) {
  const { Icon } = card;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={`${card.label}, ${documents(count)}. ${card.key === 'all' ? 'Show all.' : 'Show only these.'}`}
      onClick={onClick}
      className={`flex min-h-[104px] min-w-0 flex-col justify-between gap-2 rounded-xl border p-3.5 text-left transition-colors ${wide ? 'col-span-2 lg:col-span-1' : ''} ${FOCUS} focus-visible:ring-offset-1 ${
        active ? 'border-[#0f766e] bg-[#f0fdfa] ring-1 ring-[#0f766e]' : 'border-[#d5dbe1] bg-[#fff] hover:border-[#99d5cf] hover:bg-[#f0fdfa]'
      }`}
    >
      <span className="block min-w-0 text-[12px] font-medium leading-4 text-[#586472]">{card.label}</span>
      <span className="block">
        <span className="flex items-center justify-between gap-2">
          <span className={`block text-[26px] font-semibold leading-8 tabular-nums ${count === 0 ? ZERO : 'text-[#1f2933]'}`}>{fmt(count)}</span>
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${card.tile}`} aria-hidden>
            <Icon className="h-4 w-4" strokeWidth={1.75} />
          </span>
        </span>
        <span className="mt-0.5 block text-[11.5px] leading-4 text-[#586472]">{sub}</span>
      </span>
    </button>
  );
}

// ─── Document health ─────────────────────────────────────────────────────────────────────────────────────────────────────

const SIZE = 88;
const STROKE = 10;
const RADIUS = (SIZE - STROKE) / 2;

function HealthCard({ health, review, onReview }: { health: Kpis['health']; review: ReviewBucket[]; onReview: (next: ReviewBucket[]) => void }) {
  const { reviewable } = health;
  const arcs = donutArcs(health, { radius: RADIUS, gapDegrees: 2 });
  const rows = HEALTH_ORDER.filter((bucket) => bucket !== 'unscheduled' || health.unscheduled > 0);
  return (
    <div
      role="group"
      aria-label="Document health"
      title="A review is owed on documents that are published or approved."
      className={`${HEALTH_SPAN} flex min-w-0 flex-col gap-2.5 rounded-xl border border-[#d5dbe1] bg-white p-3.5`}
    >
      <div>
        <p className="text-[12px] font-medium leading-4 text-[#586472]">Document health</p>
        {reviewable > 0 && <p className="text-[11.5px] leading-4 text-[#586472]">Of the {documents(reviewable)} in force</p>}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative h-[88px] w-[88px] shrink-0">
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
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {reviewable > 0 ? (
              <>
                <span className="text-[18px] font-semibold leading-5 tabular-nums text-[#1f2933]">{percent(health.upToDate, reviewable)}%</span>
                <span className="text-[10.5px] leading-3 text-[#586472]">up to date</span>
              </>
            ) : (
              <span className="text-[18px] font-semibold leading-5 text-[#586472]" aria-hidden>—</span>
            )}
          </div>
        </div>
        {reviewable === 0 ? (
          <p className="min-w-0 text-[12px] leading-4 text-[#586472]">No document is in force yet.</p>
        ) : (
          <ul className="min-w-[10rem] max-w-[24rem] flex-1">
            {rows.map((bucket) => {
              const count = healthCount(health, bucket);
              const share = percent(count, reviewable);
              const active = review.length === 1 && review[0] === bucket;
              return (
                <li key={bucket}>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={`${REVIEW_BUCKET_LABEL[bucket]}, ${documents(count)}, ${share}%. Show only these.`}
                    title={`${REVIEW_BUCKET_LABEL[bucket]}: ${fmt(count)} of ${fmt(reviewable)}`}
                    onClick={() => onReview(active ? [] : [bucket])}
                    className={`flex h-[22px] w-full items-center gap-1.5 rounded-md px-1.5 text-left text-[12px] transition-colors ${FOCUS} focus-visible:ring-inset ${
                      active ? 'bg-[#f0fdfa] ring-1 ring-inset ring-[#99d5cf]' : 'hover:bg-[#f3f6f8]'
                    }`}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: HEALTH_COLOUR[bucket] }} aria-hidden />
                    <span className={`min-w-0 flex-1 truncate ${active ? 'font-medium text-[#115e59]' : 'text-[#26323d]'}`}>{REVIEW_BUCKET_LABEL[bucket]}</span>
                    <span className="font-semibold tabular-nums text-[#1f2933]">{fmt(count)}</span>
                    <span className="w-8 text-right tabular-nums text-[#586472]">{share}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
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
        {CARDS.map((card) => (
          <div key={card.key} aria-hidden className="min-h-[104px] animate-pulse rounded-xl border border-[#e1e6eb] bg-[#f3f6f8]" />
        ))}
        <div aria-hidden className={`${HEALTH_SPAN} min-h-[160px] animate-pulse rounded-xl border border-[#e1e6eb] bg-[#f3f6f8]`} />
      </div>
    );
  }
  return (
    <div role="group" aria-label="Library summary" className={GRID}>
      {CARDS.map((card) => {
        const active = sameSet(statuses, KPI_STATUSES[card.key]);
        const sub = card.key === 'all'
          ? (kpis.addedLast30 > 0 ? `+${fmt(kpis.addedLast30)} in the last 30 days` : 'No new documents in 30 days')
          : card.sub;
        return (
          <StatusCard
            key={card.key}
            card={card}
            count={kpis[card.key]}
            sub={sub}
            active={active}
            wide={card.key === 'published'}
            onClick={() => onStatuses(active ? [] : [...KPI_STATUSES[card.key]])}
          />
        );
      })}
      <HealthCard health={kpis.health} review={review} onReview={onReview} />
    </div>
  );
}
