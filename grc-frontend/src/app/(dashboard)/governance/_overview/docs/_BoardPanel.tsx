'use client';

// The Board of the Governance Overview, a Kanban of the documents of the scope: a column for each status, type or department, the most urgent documents first (stuck,
// late, on hold, without an owner). By status the columns are the five steps (Draft, In review, In approval, Approved, Published) and "Needs attention", the documents
// outside the flow (expired, an exception applied, a review required). Every card says where its attestation stands (no attestation, not started, how many have
// acknowledged, everyone acknowledged) beside its flags. It is read-only: a card opens the document in the library, a column title opens the library on the column, and
// "Show all" on the rest. The server counts every column truly and lists a few cards in each (GET /governance/document-overview/board, documents_overview.py `board`);
// what a card says, and where each link goes, is _board.ts (tested). While the answer is on its way the columns are skeletons; a failure is "Board unavailable" with Retry.
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { ErrorState, Skeleton, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { TONE, documentStatus } from '@/lib/status';
import { BOARD_ENDPOINT, attestationLine, boardParams, cardHref, cardMeta, columnHref, columnNote, columnTitle, flagWords, isAttention, showAllHref, type BoardAnswer, type BoardCard, type BoardColumn } from './_board';
import { retryOverview, statusOf, type Tone } from './_model';
import { Denied } from '../parts';
import type { GroupId } from './_views';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const LINK = `rounded-ds-control hover:underline ${FOCUS}`;
const PILL: Record<Tone, 'neutral' | 'success' | 'warning' | 'danger'> = { default: 'neutral', success: 'success', warning: 'warning', danger: 'danger' };
const COLUMN = 'flex min-w-[220px] flex-1 flex-col rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]';

/** Where the attestation of a card stands, as a line that wraps (a pill would cut "Attestation: 4 of 12 acknowledged"): a dot in the tone's colour and the words in its text colour. */
function AttestationLine({ card }: { card: BoardCard }) {
  const line = attestationLine(card);
  if (!line) return null;
  const c = TONE[line.tone];
  return (
    <p className="mt-[6px] flex items-start gap-[6px] text-ds-label" style={{ color: c.text }}>
      <span aria-hidden className="mt-[5px] h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: c.dot }} />
      {line.label}
    </p>
  );
}

function Card({ card, group, status, link }: { card: BoardCard; group: GroupId; /** the column holds documents of different statuses: each card says its own */ status: boolean; link: (href: string) => string }) {
  const meta = cardMeta(card, group);
  const flags = flagWords(card);
  return (
    <li className="min-w-0 rounded-ds-control border border-ds-border bg-ds-surface p-[10px]">
      <Link href={link(cardHref(card))} title={card.title} className={`line-clamp-2 break-words text-ds-body font-medium text-ds-fg ${LINK}`}>{card.title}</Link>
      {meta && <p className="mt-[2px] truncate text-ds-label text-ds-fg-muted" title={meta}>{meta}</p>}
      {(status || flags.length > 0) && (
        <div className="mt-[6px] flex flex-wrap gap-[4px]">
          {status && <StatusPill size="sm" tone={documentStatus.tone(card.status)} label={documentStatus.label(card.status)} />}
          {flags.map((f) => <StatusPill key={f.key} size="sm" tone={PILL[f.tone]} label={f.label} />)}
        </div>
      )}
      <AttestationLine card={card} />
      {card.owner && <p className="mt-[6px] truncate text-ds-label text-ds-fg-muted" title={card.owner}>{card.owner}</p>}
    </li>
  );
}

function Column({ answer, col, link }: { answer: BoardAnswer; col: BoardColumn; link: (href: string) => string }) {
  const title = columnTitle(col, answer.group);
  const href = columnHref(answer, col);
  const all = showAllHref(answer, col);
  const mixed = isAttention(col, answer.group);
  return (
    <li className={COLUMN}>
      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="min-w-0 truncate font-[600] !text-ds-body !text-ds-fg" title={title}>
          {href ? <Link href={link(href)} className={LINK}>{title}</Link> : title}
        </h3>
        <span className="shrink-0 rounded-full bg-ds-surface px-[8px] text-ds-label tabular-nums text-ds-fg-muted">{formatCount(col.count)}</span>
      </div>
      {col.cards.length === 0 ? (
        <p className="mt-[8px] text-ds-body text-ds-fg-muted">No documents</p>
      ) : (
        <ul aria-label={`${title}: ${columnNote(col)}`} className="mt-[8px] flex flex-col gap-[8px]">
          {col.cards.map((card) => <Card key={card.id} card={card} group={answer.group} status={mixed} link={link} />)}
        </ul>
      )}
      {col.more > 0 && all && <Link href={link(all)} className={`mt-[8px] text-ds-label font-medium text-ds-primary-text ${LINK}`}>{`Show all ${formatCount(col.count)}`}</Link>}
    </li>
  );
}

function BoardSkeleton() {
  return (
    <div role="status" className="flex gap-[12px] overflow-hidden">
      <span className="sr-only">Loading the board</span>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} aria-hidden className={COLUMN}>
          <Skeleton className="h-[12px] w-[50%]" />
          <Skeleton className="mt-[12px] h-[56px] w-full" />
          <Skeleton className="mt-[8px] h-[56px] w-full" />
        </div>
      ))}
    </div>
  );
}

/** The board of a scope ("" asks for the server's own default), grouped by status, type or department, `per` cards a column lists; only asked while the Board view is open. */
export function useBoard(dept: string, group: GroupId, per: number, enabled = true) {
  return useQuery<BoardAnswer>({
    queryKey: ['gov-doc-overview-board', dept, group, per],
    queryFn: async () => (await apiClient.get(BOARD_ENDPOINT, { params: boardParams(dept, group, per) })).data as BoardAnswer,
    retry: retryOverview,
    enabled,
  });
}

/** The columns of a board that is asked for (useBoard). `link` adds the place the person came from. */
export function BoardPanel({ query, link }: { query: ReturnType<typeof useBoard>; link: (href: string) => string }) {
  const answer = query.data;
  if (query.isPending) return <BoardSkeleton />;
  if (!answer && statusOf(query.error) === 403) return <Denied what="the documents of the board" />;       // a refusal is not a failure: said as "No access", never as an error with Retry
  if (!answer) return <ErrorState compact title="Board unavailable" message={errorMessage(query.error)} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
  return (
    <>
      {query.isError && <ErrorState compact title="Unavailable" message="What is shown may be out of date." onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} className="mb-[12px] rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
      {answer.columns.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">No documents</p>
      ) : (
        <ol aria-label="Board columns" className="flex gap-[12px] overflow-x-auto pb-[8px]">
          {answer.columns.map((col) => <Column key={col.key} answer={answer} col={col} link={link} />)}
        </ol>
      )}
    </>
  );
}
