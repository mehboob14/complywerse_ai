'use client';

// The roll call: who is in the room. Before the meeting it lists the invitees (every active member, observers included); once it runs, each member has three buttons,
// Present, Late and Absent, one press each and a repeat changes nothing. Present and late count toward quorum, absent does not, and an observer is on the roll and never
// counts (the row says so). The first mark on a meeting also records everyone else absent on the server, so the roll is complete from then on; "Everyone present" marks them
// all at once. A roll can be corrected after the meeting ended (a meeting ended with no roll gets its roll here later). Quorum and the counts are the server's (GET and PUT
// /committees/meetings/{id}/attendance). A failed save is a toast with Retry; nothing is shown as saved before the server answered.
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { Button, EmptyState, ErrorState, PersonChip, SkeletonLines, StatusPill, TextInput } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import { formatCount, statusLabel } from '@/lib/format';
import {
  alreadyMarked, markEveryone, markOne, rollCount, rollFilter, rollLine, rollQuorum, type Roll, type RollMember, type RollWord,
} from '@/lib/meetingRun';
import { rollStatus } from '@/lib/statuses/committees';
import { statusPill } from '@/lib/status';

const WORDS: Array<{ word: RollWord; label: string }> = [
  { word: 'present', label: 'Present' },
  { word: 'late', label: 'Late' },
  { word: 'absent', label: 'Absent' },
];
const SEARCH_FROM = 12;

const PRESSED: Record<RollWord, string> = {
  present: 'border-ds-success bg-ds-success-soft text-ds-success font-[600]',
  late: 'border-ds-warning bg-ds-warning-soft text-ds-warning font-[600]',
  absent: 'border-ds-border-strong bg-ds-surface-hover text-ds-fg font-[600]',
};

function Member({ m, editable, busy, onMark }: { m: RollMember; editable: boolean; busy: boolean; onMark: (m: RollMember, word: RollWord) => void }) {
  const observer = m.role === 'observer';
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[10px] gap-y-[2px] border-t border-ds-border px-[4px] py-[4px] first:border-t-0">
      <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[2px]">
        <PersonChip name={m.user_name} />
        {m.role !== 'member' && <StatusPill size="sm" tone={m.role === 'observer' ? 'neutral' : 'progress'} label={statusLabel(m.role)} />}
        {!m.is_active_member && <span className="text-ds-label font-normal text-ds-fg-muted">left the committee</span>}
        {observer && <span className="text-ds-label font-normal text-ds-fg-muted">does not count toward quorum</span>}
      </span>
      {editable ? (
        <span role="group" aria-label={`Attendance of ${m.user_name ?? 'this member'}`} className="inline-flex gap-[4px]">
          {WORDS.map(({ word, label }) => (
            <button
              key={word}
              type="button"
              aria-pressed={m.status === word}
              disabled={busy}
              onClick={() => onMark(m, word)}
              className={`inline-flex h-ds-control-sm min-w-[56px] items-center justify-center rounded-full border px-[10px] text-ds-label focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-wait ${m.status === word ? PRESSED[word] : 'border-ds-border-strong bg-ds-surface font-normal text-ds-fg-body hover:bg-ds-surface-hover'}`}
            >
              {label}
            </button>
          ))}
        </span>
      ) : (
        <StatusPill size="sm" {...statusPill(rollStatus, m.status ?? 'not_marked')} />
      )}
    </li>
  );
}

export function RollCall({ meetingId, meetingStatus, canRun, committeeActive }: {
  meetingId: number;
  meetingStatus: string;
  canRun: boolean;
  committeeActive: boolean;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const rollQ = useQuery({
    queryKey: ['meeting-roll', meetingId],
    queryFn: async () => (await committeeApi.getAttendance(meetingId)).data as Roll,
  });
  const roll = rollQ.data;
  const save = useReportedMutation({
    mutationFn: (members: Array<{ user_id: number; status: RollWord }>) => committeeApi.saveAttendance(meetingId, members),
    failure: "Couldn't save the roll call",
    toast: 'errors',                                           // a tap is quick and frequent: the buttons say it; only a failure speaks
    invalidate: [['meeting', meetingId], ['committee-meetings'], ['committee-overview']],
    onSuccess: (res) => { queryClient.setQueryData(['meeting-roll', meetingId], res.data); },
  });

  const live = meetingStatus === 'in_progress' || meetingStatus === 'completed';
  const editable = live && canRun;
  const members = roll?.members ?? [];
  const shown = rollFilter(members, search);
  const count = rollCount(members);
  const reading = roll ? rollQuorum(roll) : null;
  const everyone = markEveryone(members);

  if (rollQ.isLoading) return <SkeletonLines lines={4} label="Loading the roll" />;
  if (rollQ.isError || !roll) return <ErrorState compact title="Couldn't load the roll" message={errorMessage(rollQ.error)} onRetry={() => { void rollQ.refetch(); }} />;
  if (members.length === 0) {
    return <EmptyState kind="firstUse" bare icon={Users} title="No members to call" description={committeeActive ? 'Add the people who sit on this committee, then take the roll call here.' : 'This committee has no members.'} />;
  }

  return (
    <div className="space-y-[10px]">
      {meetingStatus === 'scheduled' ? (
        <p role="status" className="rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px] text-ds-body text-ds-fg-body">
          <span className="font-[600] text-ds-fg">Invitees</span> {formatCount(roll.members.length)}, every member and observer of the committee. The roll call opens when the meeting starts.
        </p>
      ) : reading && (
        <div role="status" className="flex flex-wrap items-center gap-x-[10px] gap-y-[6px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
          <span className="text-ds-body font-[600] text-ds-fg">Quorum</span>
          <span className="text-ds-body text-ds-fg-body">{reading.text}</span>
          <StatusPill size="sm" tone={reading.tone} label={reading.label} />
          {roll.recorded && <span className="text-ds-label font-normal text-ds-fg-muted">{rollLine(count)}</span>}
          {editable && everyone.length > 0 && (
            <Button size="sm" className="ml-auto" loading={save.isPending} onClick={() => save.mutate(everyone)}>Everyone present</Button>
          )}
        </div>
      )}
      {members.length >= SEARCH_FROM && (
        <TextInput type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find a member" aria-label="Find a member" leftAdornment={<Search aria-hidden />} className="w-[260px] max-w-full" />
      )}
      {shown.length === 0 ? (
        <p className="text-ds-body text-ds-fg-muted">No member matches.</p>
      ) : (
        <ul className={members.length > 10 ? 'grid grid-cols-1 gap-x-[16px] xl:grid-cols-2' : undefined}>
          {shown.map((m) => (
            <Member
              key={m.user_id}
              m={m}
              editable={editable}
              busy={save.isPending}
              onMark={(member, word) => { if (!alreadyMarked(member, word)) save.mutate(markOne(member.user_id, word)); }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
