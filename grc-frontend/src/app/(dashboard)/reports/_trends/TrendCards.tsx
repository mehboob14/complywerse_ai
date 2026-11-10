'use client';

// The two ways the board shows a figure: a card (the board) and a row (the table). A card or a row opens the figure's Sheet. The status is a pill that says its words, the movement says "better" or "worse" as
// well as showing a colour, and the sparkline is a picture: what it shows is said in words beside it (the figure, the change, the day, the target).
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { RegisterTable, StatusPill, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { trendStatus } from '@/lib/statuses/trends';
import { INK, deltaView, formatDay, formatValue, sparkPath, type TrendCard } from './trendsModel';

const SPARK_W = 120;
const SPARK_H = 36;

/** A line of the last values, scaled to its box. Under two points it says there is not enough history (in words, never an empty box). */
export function Spark({ card, className = '' }: { card: Pick<TrendCard, 'points' | 'target'>; className?: string }) {
  const s = sparkPath(card.points, card.target, SPARK_W, SPARK_H);
  if (!s) return <span className={`flex h-[36px] items-center text-ds-label text-ds-fg-muted ${className}`}>Not enough history yet</span>;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" className={`block h-[36px] w-full ${className}`}>
      <path d={s.area} fill={INK.primary} fillOpacity={0.08} />
      {s.targetY != null && <line x1={0} x2={SPARK_W} y1={s.targetY} y2={s.targetY} stroke={INK.border} strokeWidth={1} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />}
      <path d={s.line} fill="none" stroke={INK.primary} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** The movement from the earlier value: arrow, signed amount and, when the figure has a direction, "better" or "worse". */
export function Delta({ card }: { card: Pick<TrendCard, 'delta_abs' | 'previous' | 'direction' | 'unit'> }) {
  const d = deltaView(card);
  const Icon = d.arrow === 'up' ? TrendingUp : d.arrow === 'down' ? TrendingDown : Minus;
  const tone = d.good == null ? 'text-ds-fg-muted' : d.good ? 'text-ds-success' : 'text-ds-danger';
  return (
    <span className={`inline-flex items-center gap-[4px] text-ds-label font-[600] tabular-nums ${tone}`}>
      <Icon aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />
      {d.text}
      {d.verdict && <span className="font-normal">, {d.verdict}</span>}
    </span>
  );
}

export function TrendCardTile({ card, showModule, onOpen }: { card: TrendCard; showModule: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-haspopup="dialog"
      className="flex min-w-0 flex-col gap-[6px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px] text-left hover:border-ds-border-strong hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"
    >
      <span className="flex items-start justify-between gap-[8px]">
        <span className="min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{card.label}</span>
        <StatusPill size="sm" {...statusPill(trendStatus, card.status)} />
      </span>
      {showModule && <span className="text-ds-label text-ds-fg-muted">{card.module_label}</span>}
      <span className="flex flex-wrap items-baseline gap-x-[8px]">
        <span className="text-[24px] font-[600] leading-[32px] tabular-nums text-ds-fg">{formatValue(card.current, card.unit)}</span>
        <Delta card={card} />
      </span>
      <Spark card={card} />
      <span className="flex flex-wrap justify-between gap-x-[8px] text-ds-label text-ds-fg-muted">
        <span>{card.as_of ? `As of ${formatDay(card.as_of)}` : 'No values yet'}</span>
        {card.target != null && <span>Target {formatValue(card.target, card.unit)}</span>}
      </span>
    </button>
  );
}

/** The table's rows are sorted by the page (sortCards); this draws them. A row opens the Sheet; on a phone each row is a card. */
export function TrendTable({
  cards, sort, onSortChange, onOpen, selectedKey,
}: { cards: TrendCard[]; sort: SortState; onSortChange: (next: SortState) => void; onOpen: (card: TrendCard) => void; selectedKey: string | null }) {
  const columns: RegisterColumn<TrendCard>[] = [
    { key: 'figure', header: 'Figure', sortable: true, isRowHeader: true, cell: (c) => <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.label}</span>, card: 'hide' },
    { key: 'module', header: 'Module', priority: 2, sortable: true, cell: (c) => <span className="text-ds-fg-body">{c.module_label}</span>, card: 'meta' },
    { key: 'now', header: 'Now', align: 'right', sortable: true, firstDir: 'desc', cell: (c) => <span className="tabular-nums text-ds-fg">{formatValue(c.current, c.unit)}</span>, card: 'meta' },
    { key: 'change', header: 'Change', priority: 2, sortable: true, firstDir: 'desc', cell: (c) => <Delta card={c} />, card: 'meta' },
    { key: 'target', header: 'Target', priority: 2, align: 'right', cell: (c) => <span className="tabular-nums text-ds-fg-body">{c.target != null ? formatValue(c.target, c.unit) : 'Not set'}</span>, card: 'meta' },
    { key: 'status', header: 'Status', sortable: true, cell: (c) => <StatusPill size="sm" {...statusPill(trendStatus, c.status)} />, card: 'meta' },
    { key: 'trend', header: 'Trend', priority: 3, width: 'w-[140px]', cell: (c) => <Spark card={c} />, card: 'hide' },
  ];
  return (
    <RegisterTable
      caption="Trends: every figure with its value now, its change, its target and its status"
      columns={columns}
      rows={cards}
      getRowId={(c) => c.key}
      sort={sort}
      onSortChange={onSortChange}
      onRowActivate={onOpen}
      selectedId={selectedKey}
      cardTitle={(c) => <span className="font-[600] text-ds-fg [overflow-wrap:anywhere]">{c.label}</span>}
    />
  );
}
