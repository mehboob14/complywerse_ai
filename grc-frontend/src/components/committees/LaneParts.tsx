'use client';

// The pieces of the three lanes of the Committees home (Needs action, Meetings, Decisions): the lane's frame, a group's heading, "Show more", and the three kinds of
// row. A row is two lines (what it is, then who / where / when) so a lane shows many of them: the kit's WorkRow stacks to three lines at a lane's width and carries
// a kind pill and a button a lane does not have (kit gap: a dense two-line row). An action row has a tick ("done"); a meeting row and a decision row are ONE link to
// the meeting (one tab stop each). Nothing is revealed by hover; every status is a word.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { AlertTriangle } from 'lucide-react';
import { Button, Checkbox, PersonChip, StatusPill } from '@/components/ui/ds';
import { dueBadge } from '@/components/ui/ds/workModel';
import { chipName, dateBox, decisionDay, meetingClock, readiness, type DecisionRow, type MeetingRow } from '@/lib/committeeHome';
import { meetingQuorum, notClosed } from '@/lib/meetingRun';
import { formatCount, formatDate } from '@/lib/format';
import { meetingStatus, statusPill } from '@/lib/status';
import { decisionOutcome } from '@/lib/statuses/committees';
import { SlaTag } from './ui';

/** One lane: a card with a heading, a count (the true total) and the lane's own controls. */
export function Lane({ id, title, count, controls, hiddenOnPhone, className, children }: {
  id: string;
  title: string;
  /** the true total, drawn beside the title; undefined while it loads */
  count?: ReactNode;
  controls?: ReactNode;
  /** under 640px one lane shows at a time (the switch above the lanes picks it) */
  hiddenOnPhone?: boolean;
  /** layout only (which grid columns it spans) */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-h`} className={clsx('min-w-0 overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface', hiddenOnPhone && 'hidden sm:block', className)}>
      <div className="flex min-h-[44px] flex-wrap items-center justify-between gap-x-[8px] gap-y-[4px] border-b border-ds-border bg-ds-surface-subtle px-[12px] py-[4px]">
        <h2 id={`${id}-h`} className="min-w-0 break-words !text-ds-section !text-ds-fg">
          {title}
          {count !== undefined && <span className="ml-[6px] text-ds-label font-normal text-ds-fg-muted">{count}</span>}
        </h2>
        {controls && <div className="flex flex-wrap items-center gap-[6px]">{controls}</div>}
      </div>
      {children}
    </section>
  );
}

/** "Overdue (3)": the heading of a group of rows. */
export function GroupHead({ label, count, tone }: { label: string; count: number | null; tone?: 'danger' }) {
  return (
    <h3 className={clsx('px-[12px] pb-[2px] pt-[8px] !text-ds-label !font-[600]', tone === 'danger' ? '!text-ds-danger' : '!text-ds-fg-muted')}>
      {label}{count !== null && ` (${formatCount(count)})`}
    </h3>
  );
}

/** "Show 7 more" / "Show fewer", or the way to the whole list when what is here is a part of a longer one. */
export function MoreRow({ children }: { children: ReactNode }) {
  return <div className="border-t border-ds-border px-[8px] py-[2px]">{children}</div>;
}

export function MoreButton({ open, more, onToggle, noun }: { open: boolean; more: number; onToggle: () => void; noun: string }) {
  return (
    <Button variant="link" size="sm" aria-expanded={open} onClick={onToggle}>
      {open ? 'Show fewer' : `Show ${formatCount(more)} more ${noun}`}
    </Button>
  );
}

const ROW = 'grid min-w-0 items-start gap-x-[10px] gap-y-[2px] border-t border-ds-border px-[12px] py-[8px] first:border-t-0';
const TITLE = 'min-w-0 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]';
const META = 'flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label font-normal text-ds-fg-muted';

// ── an action ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface LaneAction {
  id: number;
  title: string;
  status: string;
  is_overdue?: boolean;
  due_date: string | null;
  committee_name?: string | null;
  assigned_to_name?: string | null;
  assignee_name?: string | null;
  sla?: Parameters<typeof SlaTag>[0]['sla'];
}

const DUE_TONE = { danger: 'font-[600] text-ds-danger', warning: 'font-[500] text-ds-warning', neutral: 'text-ds-fg-muted' } as const;

/** An open action: a tick that marks it done (only for someone who may change it), its title, its SLA, and who / which committee / when. */
export function ActionRow({ a, showCommittee, canTick, ticking, onTick }: {
  a: LaneAction;
  showCommittee: boolean;
  canTick: boolean;
  /** the request that marks THIS one done is running */
  ticking: boolean;
  onTick: (a: LaneAction) => void;
}) {
  const badge = dueBadge({ due: a.due_date, calendar: true, overdue: a.is_overdue });
  const who = a.assigned_to_name || a.assignee_name || '';
  const committee = a.committee_name ?? '';
  return (
    <li className={clsx(ROW, canTick ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]')}>
      {canTick && (
        <label className="relative -my-[6px] -ml-[8px] inline-grid h-ds-control w-[var(--ds-control-h)] shrink-0 cursor-pointer place-items-center row-span-2">
          <Checkbox checked={ticking} disabled={ticking} aria-label={`Mark completed: ${a.title}`} onChange={() => onTick(a)} />
        </label>
      )}
      <span title={a.title} className={clsx(TITLE, 'line-clamp-2')}>{a.title}</span>
      <span className="justify-self-end"><SlaTag size="sm" sla={a.sla} /></span>
      <span className={clsx(META, 'col-span-2', canTick && 'col-start-2')}>
        {showCommittee && committee && <><span className="max-w-[160px] truncate" title={committee}>{chipName(committee)}</span><span aria-hidden>·</span></>}
        <PersonChip name={who} size={20} className="text-ds-label" />
        <span aria-hidden>·</span>
        <span className={clsx('inline-flex items-center gap-[4px] whitespace-nowrap', DUE_TONE[badge.tone])}>
          {badge.overdue && <AlertTriangle aria-hidden className="h-[14px] w-[14px] shrink-0" strokeWidth={2} />}
          {a.due_date ? <>{badge.overdue ? 'Due ' : ''}{formatDate(a.due_date, { calendar: true })}</> : 'No due date'}
        </span>
      </span>
    </li>
  );
}

// ── a meeting ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function DateBox({ value }: { value: string | null }) {
  const box = dateBox(value);
  return (
    <span aria-hidden className="row-span-2 inline-flex w-[40px] flex-col items-center rounded-ds-control border border-ds-border bg-ds-surface py-[2px] text-center">
      <span className="text-ds-section tabular-nums text-ds-fg">{box?.day ?? '—'}</span>
      <span className="text-ds-label font-normal uppercase text-ds-fg-muted">{box?.month ?? ''}</span>
    </span>
  );
}

const ROW_LINK = 'hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]';

/** A meeting: its day, its title, its status and how ready it is (an agenda, papers) or, while it runs, who is here. The whole row is the link. */
export function MeetingRowItem({ m, showCommittee, pinned }: { m: MeetingRow; showCommittee: boolean; pinned?: boolean }) {
  const upcoming = m.status === 'scheduled' && !notClosed(m);
  const quorum = meetingQuorum(m);
  const present = m.quorum_present;
  return (
    <li className="border-t border-ds-border first:border-t-0">
      <Link
        href={`/governance/committees/meetings/${m.id}`}
        className={clsx(ROW, '!border-t-0 grid-cols-[40px_minmax(0,1fr)_auto]', ROW_LINK, pinned && 'border-l-[3px] border-l-ds-info bg-ds-info-soft pl-[9px]')}
      >
        <DateBox value={m.scheduled_date} />
        <span title={m.title} className={clsx(TITLE, 'line-clamp-2')}>{m.title}</span>
        {/* "Scheduled" is what the Upcoming group already says; a past meeting nobody closed says so instead */}
        <span className="flex flex-col items-end gap-[2px]">
          {notClosed(m)
            ? <StatusPill size="sm" tone="warning" label="Not closed" />
            : m.status !== 'scheduled' && <StatusPill size="sm" {...statusPill(meetingStatus, m.status)} />}
        </span>
        <span className={clsx(META, 'col-span-2 col-start-2')}>
          <span>{showCommittee && m.committee_name ? `${chipName(m.committee_name)} · ` : ''}{meetingClock(m.scheduled_date)}</span>
          {upcoming && readiness(m).map((r) => <StatusPill key={r.label} size="sm" tone={r.tone} label={r.label} />)}
          {m.status === 'in_progress' && (present == null
            ? <span>No roll yet</span>
            : <span>{`${formatCount(present)}${m.quorum_required ? ` of ${formatCount(m.quorum_required)}` : ''} present${quorum.label === 'Quorum met' ? ', quorum met' : quorum.label === 'Quorum not met' ? ', quorum not met' : ''}`}</span>)}
        </span>
      </Link>
    </li>
  );
}

// ── a decision ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** A decision: the outcome as a word, the item, what was decided (two lines; the whole of it is in the meeting) and where and when. One link to the meeting. */
export function DecisionRowItem({ d, showCommittee }: { d: DecisionRow; showCommittee: boolean }) {
  return (
    <li className="border-t border-ds-border first:border-t-0">
      <Link href={`/governance/committees/meetings/${d.meeting_id}`} className={clsx(ROW, '!border-t-0 grid-cols-[84px_minmax(0,1fr)]', ROW_LINK)}>
        <span className="pt-[1px]">
          {d.outcome ? <StatusPill size="sm" {...statusPill(decisionOutcome, d.outcome)} /> : <StatusPill size="sm" tone="neutral" label="Recorded" />}
        </span>
        <span className="min-w-0">
          <span title={d.title} className={clsx(TITLE, 'line-clamp-2 block')}>{d.title}</span>
          {d.decision_made && <span className="mt-[2px] line-clamp-2 block break-words text-ds-label font-normal text-ds-fg-body [overflow-wrap:anywhere]">{d.decision_made}</span>}
          <span className="mt-[2px] block truncate text-ds-label font-normal text-ds-fg-muted">
            {showCommittee ? `${chipName(d.committee_name)} · ` : ''}{decisionDay(d)}{d.committee_is_active ? '' : ' · inactive committee'}
          </span>
        </span>
      </Link>
    </li>
  );
}

