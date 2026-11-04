'use client';

// The cards of the overview, each a SectionCard on the kit: By type, By status (the approval flow, what has lapsed, the stages documents in review are at),
// Waiting on people, Reviews and Issues. What each number means and where it opens is _model.ts; every number is a Figure (a link to the library, or text).
// Colours are the kit's tokens; a bar is only a picture, the numbers beside it are what is read. While the answer is on its way each card is a skeleton.
import Link from 'next/link';
import { clsx } from 'clsx';
import { RegisterTable, SectionCard, SkeletonLines, type RegisterColumn } from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { EMPTY, formatDate } from '@/lib/format';
import { Figure } from './_Figure';
import {
  flow, issueRows, lapsed, lateBy, namesText, openHref, requestRows, reviewRows, reviewShares, stages, typeBars,
  type Overview, type RequestRow, type Reviews, type WaitingRow,
} from './_model';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const DOC_LINK = `rounded-ds-control font-medium text-ds-fg hover:underline ${FOCUS}`;
const QUIET = 'text-ds-body text-ds-fg-muted';

/** The grid the cards sit in: two columns from 1024px, one below. */
export const CARDS = 'grid gap-[16px] lg:grid-cols-2';

// ── skeleton ─────────────────────────────────────────────────────────────────
export function CardsSkeleton() {
  return (
    <div className={CARDS}>
      {[['types', 'By type'], ['status', 'By status'], ['waiting', 'Waiting on people'], ['reviews', 'Reviews'], ['issues', 'Issues']].map(([id, title]) => (
        <div key={id} className={id === 'waiting' ? 'lg:col-span-2' : undefined}>
          <SectionCard id={`${id}-loading`} title={title}>
            <SkeletonLines lines={id === 'waiting' ? 5 : 4} label={`Loading ${title.toLowerCase()}`} />
          </SectionCard>
        </div>
      ))}
    </div>
  );
}

// ── By type ──────────────────────────────────────────────────────────────────
function ByType({ data }: { data: Overview }) {
  const bars = typeBars(data);
  return (
    <SectionCard id="types" title="By type" info="Documents that are not archived, by what they are. Each bar is as long as its count against the biggest type; the second number is how many of them are in force.">
      {bars.length === 0 ? (
        <p className={QUIET}>No documents</p>
      ) : (
        <ul className="flex flex-col gap-[4px]">
          {bars.map((b) => (
            <li key={b.key} className="grid min-h-[36px] grid-cols-[minmax(0,6.5rem)_minmax(0,1fr)_auto] items-center gap-x-[12px]">
              <span className="truncate text-ds-body text-ds-fg-body" title={b.label}>{b.label}</span>
              <span aria-hidden className="block h-[8px] overflow-hidden rounded-full bg-ds-surface-hover">
                <span className="block h-full rounded-full bg-ds-primary" style={{ width: `${b.percent}%` }} />
              </span>
              <span className="flex items-baseline justify-end gap-[8px]">
                <Figure value={b.count} href={b.href} noun={`${b.label.toLowerCase()} documents`} />
                <span className="whitespace-nowrap text-ds-label text-ds-fg-muted">
                  <Figure value={b.inForce} href={b.inForceHref} noun={`${b.label.toLowerCase()} documents in force`} className="!text-ds-label" /> in force
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

// ── By status and stage ──────────────────────────────────────────────────────
function ByStatus({ data }: { data: Overview }) {
  const lapse = lapsed(data);
  const at = stages(data);
  return (
    <SectionCard id="status" title="By status" info="Documents that are not archived, at each step of the approval flow, and the ones that fell out of it. Below, the stage each document in review or approval is at; opening a stage shows every document at that status.">
      <ol aria-label="Approval flow" className="grid grid-cols-2 gap-[8px] sm:grid-cols-5">
        {flow(data).map((step) => (
          <li key={step.key} className="min-w-0 rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
            <p className="truncate text-ds-label text-ds-fg-muted">{step.label}</p>
            <Figure value={step.count} href={step.href} noun={step.noun} big />
          </li>
        ))}
      </ol>
      <ul className="mt-[12px] flex flex-wrap gap-x-[16px] gap-y-[4px]">
        {lapse.map((step) => (
          <li key={step.key} className="flex items-baseline gap-[6px] text-ds-body text-ds-fg-body">
            <span>{step.label}</span>
            <Figure value={step.count} href={step.href} noun={step.noun} tone={step.status === 'expired' && step.count ? 'danger' : 'default'} />
          </li>
        ))}
      </ul>
      {at.length > 0 && (
        <div className="mt-[16px] border-t border-ds-border pt-[12px]">
          <h3 className="!text-ds-label !text-ds-fg-muted">At a stage</h3>
          <ul className="mt-[4px] flex flex-col">
            {at.map((stage) => (
              <li key={stage.key} className="flex min-h-[36px] items-center justify-between gap-[12px]">
                <span className="min-w-0 truncate text-ds-body text-ds-fg-body" title={stage.name}>{stage.name}</span>
                <Figure value={stage.count} href={stage.href} noun={stage.noun} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

// ── Waiting on people ────────────────────────────────────────────────────────
function RequestBlock({ row }: { row: RequestRow }) {
  const noun = row.label.toLowerCase();
  return (
    <div className="min-w-0 rounded-ds-control border border-ds-border p-[12px]">
      <h3 className="!text-ds-label !text-ds-fg-muted">{row.label}</h3>
      <dl className="mt-[8px] grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-[12px] gap-y-[4px]">
        <dt className="text-ds-body text-ds-fg-body">Pending</dt>
        <dd className="text-right"><Figure value={row.pending} href={row.pendingHref} noun={`${noun} requests pending`} /></dd>
        <dt className="text-ds-body text-ds-fg-body">Overdue</dt>
        <dd className="text-right"><Figure value={row.overdue} href={row.overdueHref} noun={`${noun} requests overdue`} tone="danger" /></dd>
        <dt className="text-ds-body text-ds-fg-body">Due in 7 days</dt>
        <dd className="text-right"><Figure value={row.dueSoon} href={null} noun={`${noun} requests due in 7 days`} tone="warning" /></dd>
        <dt className="text-ds-body text-ds-fg-body">Oldest late</dt>
        <dd className="text-right text-ds-body font-medium tabular-nums text-ds-fg" title={row.oldestLong ?? undefined}>{row.oldest ?? EMPTY}</dd>
      </dl>
    </div>
  );
}

const waitingColumns: RegisterColumn<WaitingRow>[] = [
  {
    key: 'document', header: 'Document', isRowHeader: true, width: 'w-[34%]',
    cell: (r) => <Link href={openHref(r.document_id)} className={clsx('line-clamp-2 break-words', DOC_LINK)}>{r.title}</Link>,
  },
  { key: 'step', header: 'Step', card: 'meta', cell: (r) => <span className="line-clamp-2 break-words" title={r.stage}>{r.stage}</span> },
  { key: 'who', header: 'Waiting for', card: 'meta', cell: (r) => <span className="line-clamp-2 break-words" title={r.waiting_for.join(', ')}>{namesText(r)}</span> },
  {
    key: 'late', header: 'Late by', align: 'right', card: 'meta', width: 'w-[96px]',
    cell: (r) => <span className="whitespace-nowrap tabular-nums text-ds-danger" title={`${lateBy(r.days_late).long}, due ${formatDate(r.due_date)}`}>{lateBy(r.days_late).short}</span>,
  },
];

function Waiting({ data }: { data: Overview }) {
  const rows = requestRows(data);
  return (
    <SectionCard
      id="waiting"
      title="Waiting on people"
      info="Reviews, approvals and acknowledgements asked of people and not answered yet: one for each person asked, so a number can be larger than the documents it opens. Overdue is past the due date; due soon is within 7 days. The list is the steps that have waited longest."
    >
      <div className="grid gap-[12px] md:grid-cols-3">
        {rows.map((row) => <RequestBlock key={row.kind} row={row} />)}
      </div>
      <div className="mt-[16px]">
        <RegisterTable<WaitingRow>
          caption="Steps waiting longest"
          columns={waitingColumns}
          rows={data.waiting}
          getRowId={(r) => `${r.document_id}:${r.kind}:${r.stage}`}
          cardTitle={(r) => <Link href={openHref(r.document_id)} className={clsx('break-words', DOC_LINK)}>{r.title}</Link>}
          empty={<div className="px-[16px] py-[24px] text-center text-ds-body text-ds-fg-muted">Nothing is late</div>}
        />
      </div>
    </SectionCard>
  );
}

// ── Reviews ──────────────────────────────────────────────────────────────────
const FILL: Record<keyof Reviews, string> = { overdue: 'bg-ds-danger', due_soon: 'bg-ds-warning', unscheduled: 'bg-ds-border-strong', up_to_date: 'bg-ds-success' };

function ReviewsCard({ data }: { data: Overview }) {
  const rows = reviewRows(data);
  const shares = reviewShares(data.reviews);
  return (
    <SectionCard id="reviews" title="Reviews" info="Documents in force or approved, by where their next review date stands. A draft, an expired or an archived document owes no review.">
      {shares.length > 0 && (
        <div aria-hidden className="mb-[12px] flex h-[8px] overflow-hidden rounded-full bg-ds-surface-hover">
          {shares.map((s) => <span key={s.key} className={clsx('h-full', FILL[s.key])} style={{ width: `${s.percent}%` }} />)}
        </div>
      )}
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="flex min-h-[40px] items-center justify-between gap-[12px] border-b border-ds-border last:border-b-0">
            <span className="flex min-w-0 items-center gap-[8px] text-ds-body text-ds-fg-body">
              <span aria-hidden className={clsx('h-[8px] w-[8px] shrink-0 rounded-full', FILL[r.key])} />
              <span className="truncate">{r.label}</span>
            </span>
            <Figure value={r.count} href={r.href} noun={r.noun} tone={r.tone} />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ── Issues ───────────────────────────────────────────────────────────────────
function IssuesCard({ data }: { data: Overview }) {
  const rows = issueRows(data);
  return (
    <SectionCard
      id="issues"
      title="Issues"
      meta={`${data.issues.documents} ${data.issues.documents === 1 ? 'document' : 'documents'}`}
      info="Documents that need attention. One document can be in several of these, so the rows add up to more than the documents named above."
    >
      <ul className="flex flex-col">
        {rows.map((r) => (
          <li key={r.key} className="flex min-h-[40px] items-center justify-between gap-[12px] border-b border-ds-border last:border-b-0">
            <span className="flex min-w-0 items-center gap-[4px] text-ds-body text-ds-fg-body">
              <span className="truncate">{r.label}</span>
              <InfoTip text={r.info} label={`About ${r.label.toLowerCase()}`} />
            </span>
            <Figure value={r.count} href={r.href} noun={r.noun} tone={r.tone} />
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

// ── all of them ──────────────────────────────────────────────────────────────
export function Cards({ data }: { data: Overview }) {
  return (
    <div className={CARDS}>
      <ByType data={data} />
      <ByStatus data={data} />
      <div className="lg:col-span-2"><Waiting data={data} /></div>
      <ReviewsCard data={data} />
      <IssuesCard data={data} />
    </div>
  );
}
