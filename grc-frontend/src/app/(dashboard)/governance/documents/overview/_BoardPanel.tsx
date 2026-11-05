'use client';

// The board of At a glance, a Kanban of the documents of the view: a column for each status, type or department, the most urgent documents first (stuck, late,
// on hold, without an owner). It is read-only: a card opens the document in the library, a column title opens the library on the column, and "Show all" on the rest.
// The server counts every column truly and lists a few cards in each (GET /governance/document-overview/board, documents_overview.py `board`); what a card says,
// and where each link goes, is _board.ts (tested). While the answer is on its way the columns are skeletons; a failure is "Board unavailable" with Retry.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { ErrorState, Skeleton, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { BOARD_ENDPOINT, boardParams, cardHref, cardMeta, columnHref, columnNote, columnTitle, flagWords, showAllHref, type BoardAnswer, type BoardCard, type BoardColumn } from './_board';
import { retryOverview, type Tone } from './_model';
import type { GroupId } from './_views';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const LINK = `rounded-ds-control hover:underline ${FOCUS}`;
const PILL: Record<Tone, 'neutral' | 'success' | 'warning' | 'danger'> = { default: 'neutral', success: 'success', warning: 'warning', danger: 'danger' };
const COLUMN = 'flex min-w-[220px] flex-1 flex-col rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]';

function Card({ card, group, compact }: { card: BoardCard; group: GroupId; compact: boolean }) {
  const meta = cardMeta(card, group);
  const flags = flagWords(card);
  return (
    <li className="min-w-0 rounded-ds-control border border-ds-border bg-ds-surface p-[10px]">
      <Link href={cardHref(card)} title={card.title} className={`line-clamp-2 break-words text-ds-body font-medium text-ds-fg ${LINK}`}>{card.title}</Link>
      {meta && <p className="mt-[2px] truncate text-ds-label text-ds-fg-muted" title={meta}>{meta}</p>}
      {flags.length > 0 && (
        <div className="mt-[6px] flex flex-wrap gap-[4px]">
          {flags.map((f) => <StatusPill key={f.key} size="sm" tone={PILL[f.tone]} label={f.label} />)}
        </div>
      )}
      {!compact && card.owner && <p className="mt-[6px] truncate text-ds-label text-ds-fg-muted" title={card.owner}>{card.owner}</p>}
    </li>
  );
}

function Column({ answer, col, compact }: { answer: BoardAnswer; col: BoardColumn; compact: boolean }) {
  const title = columnTitle(col, answer.group);
  const href = columnHref(answer, col);
  const all = showAllHref(answer, col);
  return (
    <li className={COLUMN}>
      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="min-w-0 truncate font-[600] !text-ds-body !text-ds-fg" title={title}>
          {href ? <Link href={href} className={LINK}>{title}</Link> : title}
        </h3>
        <span className="shrink-0 rounded-full bg-ds-surface px-[8px] text-ds-label tabular-nums text-ds-fg-muted">{formatCount(col.count)}</span>
      </div>
      {col.cards.length === 0 ? (
        <p className="mt-[8px] text-ds-body text-ds-fg-muted">No documents</p>
      ) : (
        <ul aria-label={`${title}: ${columnNote(col)}`} className="mt-[8px] flex flex-col gap-[8px]">
          {col.cards.map((card) => <Card key={card.id} card={card} group={answer.group} compact={compact} />)}
        </ul>
      )}
      {col.more > 0 && all && <Link href={all} className={`mt-[8px] text-ds-label font-medium text-ds-primary-text ${LINK}`}>{`Show all ${formatCount(col.count)}`}</Link>}
    </li>
  );
}

function BoardSkeleton() {
  return (
    <div role="status" className="flex gap-[12px] overflow-hidden">
      <span className="sr-only">Loading the board</span>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} aria-hidden className={COLUMN}>
          <Skeleton className="h-[12px] w-[50%]" />
          <Skeleton className="mt-[12px] h-[56px] w-full" />
          <Skeleton className="mt-[8px] h-[56px] w-full" />
        </div>
      ))}
    </div>
  );
}

/** The board of a scope ("" asks for the server's own default), grouped by status, type or department; `per` cards a column lists, `compact` for the strip on the summary. */
export function BoardPanel({ dept, group, per, compact = false }: { dept: string; group: GroupId; per: number; compact?: boolean }) {
  const query = useQuery<BoardAnswer>({
    queryKey: ['gov-doc-overview-board', dept, group, per],
    queryFn: async () => (await apiClient.get(BOARD_ENDPOINT, { params: boardParams(dept, group, per) })).data as BoardAnswer,
    retry: retryOverview,
  });
  const answer = query.data;
  if (query.isPending) return <BoardSkeleton />;
  if (!answer) return <ErrorState compact title="Board unavailable" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  return (
    <>
      {query.isError && <ErrorState compact title="Unavailable" message="What is shown may be out of date." onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} className="mb-[12px] rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
      {answer.columns.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">No documents</p>
      ) : (
        <ol aria-label="Board columns" className="flex gap-[12px] overflow-x-auto pb-[8px]">
          {answer.columns.map((col) => <Column key={col.key} answer={answer} col={col} compact={compact} />)}
        </ol>
      )}
    </>
  );
}
