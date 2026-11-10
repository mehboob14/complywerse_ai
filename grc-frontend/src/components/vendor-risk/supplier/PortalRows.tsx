'use client';

// The two kinds of row on the supplier's home: a thing to do (what it is, where it stands, when it is due, how far along, and the one button that does the next
// step) and a thing done (a line that opens it). Phone first: the card is one column, the button is the width of the card and 44px high. A row says
// nothing the supplier cannot use: no ids, no internal words.
import Link from 'next/link';
import { AlertTriangle, ChevronRight, ClipboardList, FileText, Info, MessageSquare, type LucideIcon } from 'lucide-react';
import { Button, ProgressBar, StatusPill } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { statusPill, type Statuses } from '@/lib/status';
import { portalKind, portalLateness, portalQuestionnaire, portalRequest } from '@/lib/statuses/vendorPortal';
import type { DoneRow, Row, TodoKind, TodoRow } from './portalHomeModel';
import { FOCUS } from './styles';

const ICON: Record<TodoKind, LucideIcon> = { questionnaire: ClipboardList, document: FileText, information: Info, finding: AlertTriangle };
const wordsOf = (row: Row): Statuses => (row.family === 'questionnaire' ? portalQuestionnaire : portalRequest);

function KindBadge({ kind }: { kind: TodoKind }) {
  const Icon = ICON[kind];
  return (
    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-[#e6f4f1] text-[#0f766e]">
      <Icon className="h-5 w-5" />
    </span>
  );
}

function Unread({ n, what }: { n: number; what: string }) {
  return n > 0 ? (
    <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-[#e6f4f1] px-2.5 py-1 text-xs font-medium text-[#0b4f4a]">
      <MessageSquare aria-hidden className="h-3.5 w-3.5" /> {n} new {what}{n === 1 ? '' : 's'}
    </span>
  ) : null;
}

/** One thing the supplier has to do. `base` is the supplier's link path (`/supplier/<link>`). */
export function TodoItem({ base, row }: { base: string; row: TodoRow }) {
  const pct = row.progress && row.progress.total ? Math.round((row.progress.answered / row.progress.total) * 100) : 0;
  return (
    <li className="rounded-xl border border-ds-border bg-ds-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <KindBadge kind={row.kind} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ds-fg-body">{portalKind.label(row.kind)}</p>
          <p title={row.title} className="line-clamp-3 break-words text-[15px] font-semibold leading-snug text-ds-fg">{row.title}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill {...statusPill(wordsOf(row), row.word)} />
            {row.late && <StatusPill {...statusPill(portalLateness, 'late')} />}
            {row.due && <span className="text-sm text-ds-fg-body">Due {formatDate(row.due)}</span>}
          </div>
          {row.note && <p className="mt-1.5 text-sm text-ds-fg-body">{row.note}</p>}
          {row.progress && (
            <div className="mt-3">
              <ProgressBar value={pct} label={`${row.title}: questions answered`} valueText={`${row.progress.answered} of ${row.progress.total} answered`} />
            </div>
          )}
          <Unread n={row.unread} what={row.family === 'questionnaire' ? 'comment' : 'message'} />
        </div>
      </div>
      <div className="mt-3">
        <Button variant="primary" href={`${base}/${row.path}`} fullWidth className="sm:w-auto" rightIcon={<ChevronRight />} aria-label={`${row.action}: ${row.title}`}>
          {row.action}
        </Button>
      </div>
    </li>
  );
}

/** One thing that is finished (or closed): a line that opens it to read. */
export function DoneItem({ base, row }: { base: string; row: DoneRow }) {
  return (
    <li>
      <Link href={`${base}/${row.path}`} className={`flex min-h-[56px] items-center gap-3 px-4 py-3 hover:bg-ds-surface-hover ${FOCUS}`}>
        <KindBadge kind={row.kind} />
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-medium text-ds-fg">{row.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill size="sm" {...statusPill(wordsOf(row), row.word)} />
            {row.when && <span className="text-xs text-ds-fg-body">{formatDate(row.when)}</span>}
            {row.unread > 0 && <span className="text-xs font-medium text-[#0b4f4a]">{row.unread} new</span>}
          </span>
        </span>
        <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-ds-fg-muted" />
      </Link>
    </li>
  );
}
