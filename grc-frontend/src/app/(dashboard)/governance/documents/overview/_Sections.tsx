'use client';

// The cards of the overview that are lists and figures: By status (the approval flow, what has lapsed, the stages documents in review are at) and Waiting on people,
// each a SectionCard on the kit, and Reviews (a donut of the four states of a review date) and Issues (ranked bars) as the chart kit's cards
// (components/overview/charts: a picture whose list is its text, every name a link to the library). (The department table is _DepartmentTable.tsx, the graphs
// _Charts.tsx, the board _BoardPanel.tsx.) What each number means and where it opens is _model.ts; every number is a Figure (a link to the library, or text) or a
// row of the kit's lists. Colours are the kit's tokens and palette; a bar is only a picture, the numbers beside it are what is read. While the answer is on its way
// each card is a skeleton.
import Link from 'next/link';
import { clsx } from 'clsx';
import { BarList, ChartCard, DonutChart, SegmentBar } from '@/components/overview/charts';
import { STATUS } from '@/components/overview/charts/palette';
import { RegisterTable, SectionCard, SkeletonLines, type RegisterColumn } from '@/components/ui/ds';
import { EMPTY, formatCount, formatDate } from '@/lib/format';
import { Figure } from './_Figure';
import {
  flow, issueRows, lapsed, lateBy, namesText, openHref, requestRows, reviewRows, stages,
  type IssueRow, type Overview, type RequestRow, type ReviewRow, type Tone, type WaitingRow,
} from './_model';

const FOCUS = 'focus-visible:outline-none focus-visible:shadow-ds-ring';
const DOC_LINK = `rounded-ds-control font-medium text-ds-fg hover:underline ${FOCUS}`;

/** The grid two cards sit side by side in: two columns from 1024px, one below. */
export const CARDS = 'grid gap-[16px] lg:grid-cols-2';

// ── skeleton ─────────────────────────────────────────────────────────────────
export function CardsSkeleton() {
  return (
    <>
      {[['departments', 'By department', 5], ['status', 'By status', 4], ['waiting', 'Waiting on people', 5]].map(([id, title, lines]) => (
        <SectionCard key={id} id={`${id}-loading`} title={String(title)}>
          <SkeletonLines lines={Number(lines)} label={`Loading ${String(title).toLowerCase()}`} />
        </SectionCard>
      ))}
    </>
  );
}

// ── By status and stage ──────────────────────────────────────────────────────
export function ByStatus({ data }: { data: Overview }) {
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
      {row.pending > 0 && (
        <div className="mt-[8px]">
          <SegmentBar
            label={`${row.label} requests pending`}
            height={8}
            legend={false}
            parts={[
              { key: 'overdue', label: 'Overdue', value: row.overdue, color: STATUS.bad },
              { key: 'soon', label: 'Due in 7 days', value: row.dueSoon, color: STATUS.warn },
              { key: 'later', label: 'Later', value: Math.max(0, row.pending - row.overdue - row.dueSoon), color: STATUS.pending },
            ]}
          />
        </div>
      )}
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

export function Waiting({ data }: { data: Overview }) {
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
// the states of a review date are states: their colours are the status colours, and the words beside them say which
const REVIEW_COLOR: Record<ReviewRow['key'], string> = { overdue: STATUS.bad, due_soon: STATUS.warn, unscheduled: STATUS.neutral, up_to_date: STATUS.good };

export function ReviewsCard({ data }: { data: Overview }) {
  const rows = reviewRows(data);
  const total = rows.reduce((n, r) => n + r.count, 0);
  return (
    <ChartCard
      id="reviews"
      title="Reviews"
      info="Published or approved documents, by where their next review date stands. A draft, an expired or an archived document owes no review. A state nobody is in is left out. Each name opens the library on it."
      state={total === 0 ? 'empty' : 'ready'}
      emptyText="No review is owed yet. Published and approved documents appear here once they have a review date."
      loadingHeight={160}
    >
      <DonutChart
        label="Documents by review state"
        slices={rows.map((r) => ({ key: r.key, label: r.label, value: r.count, color: REVIEW_COLOR[r.key], href: r.href ?? undefined }))}
        centre={{ value: formatCount(total), caption: total === 1 ? 'document' : 'documents' }}
        noun="documents"
      />
    </ChartCard>
  );
}

// ── Issues ───────────────────────────────────────────────────────────────────
const ISSUE_COLOR: Record<Tone, string> = { danger: STATUS.bad, warning: STATUS.warn, success: STATUS.good, default: STATUS.neutral };

export function IssuesCard({ data }: { data: Overview }) {
  const rows: IssueRow[] = issueRows(data);
  return (
    <ChartCard
      id="issues"
      title="Issues"
      meta={`${data.issues.documents} ${data.issues.documents === 1 ? 'document' : 'documents'}`}
      info={`Documents that need attention. One document can be in several of these, so the bars can add up to more than the number of documents. ${rows.map((r) => `${r.label}: ${r.info}`).join(' ')}`}
      state={data.issues.documents === 0 ? 'empty' : 'ready'}
      emptyText="No document has an issue."
      loadingHeight={200}
    >
      <BarList
        label="Documents with issues, by kind"
        rows={rows.map((r) => ({ key: r.key, label: r.label, value: r.count, color: ISSUE_COLOR[r.tone], href: r.href ?? undefined }))}
        nameWidth={180}
      />
    </ChartCard>
  );
}
