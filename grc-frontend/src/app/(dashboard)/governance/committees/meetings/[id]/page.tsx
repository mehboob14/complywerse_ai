'use client';

// Governance > Committees > a meeting: ONE scrollable workspace. A sticky bar says what state the meeting is in (while it runs: who is here against the quorum, and End meeting;
// when its day has come: Start meeting), a sticky outline lists the sections in the order of the work (before the meeting: the agenda and papers; while it runs: who is here,
// then the agenda; once it is over: what was decided, the minutes, the actions) and follows the reading. A meeting can be started and ended, its roll taken (Present, Late,
// Absent: the first mark records everyone else absent; quorum is the server's count) and an outcome and decision recorded on each agenda item: the screen only calls the server's
// own start, end, attendance and outcome calls and never writes a status by hand; a refusal (409, 400, 403) is said in the server's words. Cancelling or rescheduling a meeting is
// not here (it was not approved: the API has it, no screen calls it).
// The data flow is the old page's (the same requests, query keys and invalidations; one votes request per agenda item, now made when the item is opened). On the design-system kit:
// PageHeader variant="page", AccordionRow, ChipList, ClampedText, StatusPill, every write a useReportedMutation, every question a useConfirm, drawers that ask "Discard changes?".
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Calendar, Link as LinkIcon, MapPin, Play, Users } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Skeleton, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { useConfirm } from '@/components/ui/ds/useConfirm';
import { formatCount, statusLabel, truncate } from '@/lib/format';
import { isActiveCommittee, meetingWhen } from '@/lib/committees';
import { committeeHomeAddress } from '@/lib/committeeHome';
import { barKind, meetingQuorum, notClosed, outlineOrder, rollCount, rollQuorum, type OutlineKey, type Roll } from '@/lib/meetingRun';
import { meetingStatus, statusPill } from '@/lib/status';
import { AgendaSection } from '@/components/committees/AgendaSection';
import { ActionsSection, MinutesSection, PapersSection } from '@/components/committees/MeetingExtras';
import { Outline, Section, useSectionSpy } from '@/components/committees/MeetingSection';
import type { AgendaItem, Meeting } from '@/components/committees/meetingTypes';
import { RollCall } from '@/components/committees/RollCall';
import { LiveBar, useRunMeeting } from '@/components/committees/RunMeeting';

export default function MeetingPage() {
  const params = useParams();
  const meetingId = parseInt(params.id as string, 10);
  const meetingQ = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: async () => (await committeeApi.getMeeting(meetingId)).data as Meeting,
  });
  const meeting = meetingQ.data;

  if (meetingQ.isLoading) {
    return (
      <div className="space-y-[16px]" aria-busy="true">
        <PageHeader variant="page" title="Meeting" />
        <Skeleton className="h-[16px] w-[420px] max-w-full" />
        <div className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]"><SkeletonLines lines={5} label="Loading the meeting" /></div>
      </div>
    );
  }
  if (meetingQ.isError || !meeting) {
    const notFound = statusOf(meetingQ.error) === 404;
    return (
      <div className="space-y-[16px]">
        <PageHeader variant="page" title="Meeting" back={{ href: '/governance/committees', label: 'Back to committees' }} />
        <ErrorState
          title={notFound ? 'Meeting not found' : "Couldn't load this meeting"}
          message={notFound ? "It doesn't exist or you don't have access to it." : errorMessage(meetingQ.error)}
          onRetry={notFound ? undefined : () => { void meetingQ.refetch(); }}
        />
      </div>
    );
  }
  return <Workspace meeting={meeting} />;
}

function Workspace({ meeting }: { meeting: Meeting }) {
  const meetingId = meeting.id;
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:committees:create');
  const canRun = canCreate;                                         // the server asks for a sign-in only; the screen offers these to whoever may create committee records
  const { confirm, confirmDialog } = useConfirm();

  // the committee, to know whether it still takes new actions (a deactivated one refuses them with a 400): the committee's own query key. While it loads, or if it
  // failed, the control is offered and the server decides.
  const committeeQ = useQuery({
    queryKey: ['committee', meeting.committee_id],
    queryFn: async () => (await committeeApi.getCommittee(meeting.committee_id)).data as { is_active?: boolean | null },
  });
  const takesActions = isActiveCommittee(committeeQ.data ?? {});

  // the roll and the agenda: the page needs them for the bar and for the question before the meeting ends; the sections read the same cache entries
  const rollQ = useQuery({ queryKey: ['meeting-roll', meetingId], queryFn: async () => (await committeeApi.getAttendance(meetingId)).data as Roll });
  const agendaQ = useQuery<AgendaItem[]>({
    queryKey: ['meeting-agenda', meetingId],
    queryFn: async () => { const res = await committeeApi.getAgenda(meetingId); return Array.isArray(res.data) ? res.data : []; },
  });
  const run = useRunMeeting({ meeting, roll: rollQ.data, agenda: agendaQ.data ?? [], confirm });

  const order = useMemo(() => outlineOrder(meeting.status), [meeting.status]);
  const [current, jump] = useSectionSpy(order);
  const bar = barKind(meeting, canRun);

  const roll = rollQ.data;
  const count = roll ? rollCount(roll.members) : null;
  const here = count ? count.present + count.late : null;
  const reading = roll ? rollQuorum(roll) : meetingQuorum(meeting);
  const hasMinutes = Boolean(meeting.has_minutes || meeting.minutes);
  const counts: Partial<Record<OutlineKey, React.ReactNode>> = {
    attendance: meeting.status === 'scheduled' ? (meeting.invitees_count ? formatCount(meeting.invitees_count) : undefined) : (here !== null && roll ? `${formatCount(here)}/${formatCount(roll.members.length)}` : undefined),
    agenda: formatCount(meeting.agenda_item_count ?? agendaQ.data?.length ?? 0),
    minutes: hasMinutes ? <span><span aria-hidden>✓</span><span className="sr-only">drafted</span></span> : undefined,
    actions: formatCount(meeting.action_count ?? 0),
    papers: formatCount(meeting.papers_count ?? 0),
  };

  const sections: Record<OutlineKey, React.ReactNode> = {
    attendance: (
      <Section
        key="attendance"
        id="attendance"
        title={meeting.status === 'scheduled' ? 'Invitees' : 'Attendance'}
        count={meeting.status === 'scheduled' ? (meeting.invitees_count ? formatCount(meeting.invitees_count) : undefined) : (here !== null && roll ? `${formatCount(here)} of ${formatCount(roll.members.length)} here` : undefined)}
      >
        <RollCall meetingId={meetingId} meetingStatus={meeting.status} canRun={canRun} committeeActive={takesActions} />
      </Section>
    ),
    agenda: <AgendaSection key="agenda" meeting={meeting} canCreate={canCreate} canRun={canRun} />,
    minutes: <MinutesSection key="minutes" meeting={meeting} canCreate={canCreate} />,
    actions: <ActionsSection key="actions" meeting={meeting} canCreate={canCreate} takesActions={takesActions} />,
    papers: <PapersSection key="papers" meeting={meeting} canCreate={canCreate} />,
  };

  return (
    <div className="space-y-[12px]">
      <div>
        <PageHeader
          variant="page"
          title={meeting.title}
          back={{ href: committeeHomeAddress(meeting.committee_id), label: `Back to ${truncate(meeting.committee_name || 'the committee', 60).text}` }}
          chips={(
            <>
              <StatusPill tone="neutral" label={statusLabel(meeting.meeting_type)} />
              <StatusPill {...statusPill(meetingStatus, meeting.status)} />
              {notClosed(meeting) && <StatusPill tone="warning" label="Not closed" />}
            </>
          )}
          actions={canRun && meeting.status === 'scheduled' && bar !== 'due'
            ? <Button variant="primary" leftIcon={<Play aria-hidden />} loading={run.starting} onClick={() => { void run.askStart(); }}>Start meeting</Button>
            : undefined}
        />
        <dl className="mt-[12px] flex flex-wrap items-center gap-x-[20px] gap-y-[8px] text-ds-body text-ds-fg-body">
          <div className="flex items-center gap-[6px]"><dt className="sr-only">When</dt><dd className="inline-flex items-center gap-[6px]"><Calendar aria-hidden className="h-[16px] w-[16px] text-ds-fg-muted" />{meetingWhen(meeting.scheduled_date)}</dd></div>
          {meeting.location && (
            <div className="flex items-center gap-[6px]"><dt className="sr-only">Location</dt><dd className="inline-flex items-center gap-[6px] break-words"><MapPin aria-hidden className="h-[16px] w-[16px] shrink-0 text-ds-fg-muted" />{meeting.location}</dd></div>
          )}
          <div className="flex items-center gap-[6px]">
            <dt className="inline-flex items-center gap-[6px] text-ds-fg-muted"><Users aria-hidden className="h-[16px] w-[16px]" />Quorum</dt>
            <dd className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
              {meeting.quorum_required ? `${formatCount(meeting.quorum_required)} required` : 'Not set'}
              {meeting.status !== 'scheduled' && <><span className="text-ds-fg-muted">·</span><span>{reading.label === 'Not recorded' ? 'no roll recorded' : reading.text}</span><StatusPill size="sm" tone={reading.tone} label={reading.label} /></>}
            </dd>
          </div>
          {meeting.virtual_link && (
            <div className="flex items-center gap-[6px]">
              <dt className="sr-only">Virtual link</dt>
              <dd><a href={meeting.virtual_link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-ds-control-sm items-center gap-[6px] rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring"><LinkIcon aria-hidden className="h-[16px] w-[16px]" />Virtual link</a></dd>
            </div>
          )}
        </dl>
      </div>

      {/* the bars that stay in view: what state the meeting is in, and (under 1024px) the outline as a row of pills */}
      <div className="sticky top-0 z-[20] -mx-[4px] space-y-[6px] bg-[var(--color-subtle)] px-[4px] pb-[4px] pt-[2px]">
        {bar && <LiveBar meeting={meeting} roll={roll} canRun={canRun} run={run} />}
        <Outline layout="pills" order={order} status={meeting.status} counts={counts} current={current} onJump={jump} />
      </div>

      <div className="lg:grid lg:grid-cols-[190px_minmax(0,1fr)] lg:items-start lg:gap-[16px]">
        <div className={`sticky hidden lg:block ${bar ? 'top-[72px]' : 'top-[8px]'}`}>
          <Outline layout="column" order={order} status={meeting.status} counts={counts} current={current} onJump={jump} />
        </div>
        <div className="min-w-0 space-y-[16px]">{order.map((key) => sections[key])}</div>
      </div>
      {confirmDialog}
    </div>
  );
}
