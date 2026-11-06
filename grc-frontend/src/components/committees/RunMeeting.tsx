'use client';

// Running a meeting: the live bar (sticky, always in view) and the two questions that change its state. Start: "scheduled" becomes "in progress". End: "in progress"
// becomes "completed" (a past meeting nobody started can be ended too); the question says what is complete and what is not before it is too late to say it, including
// "No roll was recorded" (that leaves attendance and quorum empty and counts against the Governance quorum measure until the roll is taken). Both are reported mutations:
// the confirmation comes after the server answered, a refusal (409) is said in the server's own words, and the answer (the meeting) replaces what the page holds.
// The server asks only for a sign-in; the screen offers them to whoever may create committee records.
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Info, Play, Square, TriangleAlert } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { Button, StatusPill } from '@/components/ui/ds';
import type { ConfirmOptions } from '@/components/ui/ds/useConfirm';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { truncate } from '@/lib/format';
import { dueToStart, endPlan, meetingQuorum, notClosed, rollQuorum, startPlan, undecidedItems, type Roll, type RunPlan } from '@/lib/meetingRun';
import type { AgendaItem, Meeting } from './meetingTypes';

const LINE_ICON = { ok: CheckCircle2, warn: TriangleAlert, muted: Info } as const;
const LINE_TONE = { ok: 'text-ds-success', warn: 'text-ds-warning', muted: 'text-ds-fg-muted' } as const;

/** The lines of a question under its title: a tick for what is complete, a triangle for what is not, an (i) for what is only worth knowing. */
export function PlanLines({ lines }: { lines: RunPlan['lines'] }) {
  return (
    <ul className="mt-[8px] space-y-[6px] text-left">
      {lines.map((line, i) => {
        const Icon = LINE_ICON[line.tone];
        return (
          <li key={i} className="flex items-start gap-[8px] text-ds-body text-ds-fg-body">
            <Icon aria-hidden className={`mt-[2px] h-[16px] w-[16px] shrink-0 ${LINE_TONE[line.tone]}`} strokeWidth={1.75} />
            <span className="min-w-0 break-words">{line.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function useRunMeeting({ meeting, roll, agenda, confirm }: {
  meeting: Meeting;
  roll: Roll | null | undefined;
  agenda: readonly AgendaItem[];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const refresh = [['meeting-roll', meeting.id], ['meeting-agenda', meeting.id], ['committee-meetings'], ['committee-overview'], ['committee', meeting.committee_id]];
  const replace = (res: { data: unknown }) => { queryClient.setQueryData(['meeting', meeting.id], res.data); };
  const start = useReportedMutation({
    mutationFn: () => committeeApi.startMeeting(meeting.id),
    success: () => ({ title: 'Meeting started', message: truncate(meeting.title, 80).text }),
    failure: "Couldn't start the meeting",
    invalidate: refresh,
    onSuccess: replace,
  });
  const end = useReportedMutation({
    mutationFn: () => committeeApi.endMeeting(meeting.id),
    success: () => ({ title: 'Meeting ended', message: meeting.has_minutes || meeting.minutes ? 'Attendance and quorum are kept as recorded.' : 'You can draft the minutes next.' }),
    failure: "Couldn't end the meeting",
    invalidate: refresh,
    onSuccess: replace,
  });
  const ask = async (plan: RunPlan): Promise<boolean> => confirm({ title: plan.title, message: <PlanLines lines={plan.lines} />, confirmLabel: plan.confirmLabel, tone: plan.tone });
  return {
    askStart: async () => { if (await ask(startPlan(meeting))) start.mutate(); },
    askEnd: async () => {
      const plan = endPlan({ meeting, roll: roll ?? null, openItems: undecidedItems(agenda), hasMinutes: Boolean(meeting.has_minutes || meeting.minutes?.content) });
      if (await ask(plan)) end.mutate();
    },
    starting: start.isPending,
    ending: end.isPending,
    busy: start.isPending || end.isPending,
  };
}

export type RunControls = ReturnType<typeof useRunMeeting>;

/** The bar under the page head: while the meeting runs, how many are here against the quorum and the End button; before it, that it is due to start. */
export function LiveBar({ meeting, roll, canRun, run }: { meeting: Meeting; roll: Roll | null | undefined; canRun: boolean; run: RunControls }): ReactNode {
  const reading = roll ? rollQuorum(roll) : meetingQuorum(meeting);
  if (meeting.status === 'in_progress') {
    return (
      <div role="region" aria-label="Meeting in progress" className="flex flex-wrap items-center gap-x-[10px] gap-y-[6px] rounded-ds-card border border-ds-info bg-ds-info-soft px-[12px] py-[8px]">
        <span aria-hidden className="h-[8px] w-[8px] shrink-0 rounded-full bg-ds-info motion-safe:animate-pulse" />
        <span className="text-ds-body font-[600] text-ds-fg">In progress</span>
        <span className="text-ds-body text-ds-fg-body">{reading.text}</span>
        <StatusPill size="sm" tone={reading.tone} label={reading.label} />
        {reading.fraction !== null && (
          <span aria-hidden className="hidden h-[8px] w-[140px] overflow-hidden rounded-full bg-ds-border sm:block">
            <span className={`block h-full rounded-full ${reading.tone === 'success' ? 'bg-ds-success' : 'bg-ds-warning'}`} style={{ width: `${Math.round(reading.fraction * 100)}%` }} />
          </span>
        )}
        {canRun && <Button variant="primary" leftIcon={<Square aria-hidden />} loading={run.ending} className="ml-auto" onClick={() => { void run.askEnd(); }}>End meeting</Button>}
      </div>
    );
  }
  if (meeting.status === 'scheduled' && canRun && dueToStart(meeting)) {
    const late = notClosed(meeting);
    return (
      <div role="region" aria-label="Meeting due to start" className="flex flex-wrap items-center gap-x-[10px] gap-y-[6px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[8px]">
        <Play aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />
        <span className="text-ds-body font-[600] text-ds-fg">{late ? 'The time of this meeting has passed.' : 'This meeting is due to start.'}</span>
        <span className="ml-auto flex flex-wrap items-center gap-[8px]">
          {late && <Button loading={run.ending} onClick={() => { void run.askEnd(); }}>End meeting</Button>}
          <Button variant="primary" leftIcon={<Play aria-hidden />} loading={run.starting} onClick={() => { void run.askStart(); }}>Start meeting</Button>
        </span>
      </div>
    );
  }
  return null;
}
