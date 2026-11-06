'use client';

// The Meetings lane of the Committees home: the meetings in time order across the committees in scope, with the one in progress pinned on top, the ones to come with
// how ready each is (an agenda, papers) and the earlier ones (a past meeting nobody closed says "Not closed"). There is no cross-committee meetings list on the server,
// so the lane reads each committee's own (GET /{id}/meetings, newest first) for the committees in scope, at most twenty; a committee that cannot be read is said, not
// left out silently. The search finds a meeting by its title or its committee (agenda text is not searched here).
import { useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { CalendarPlus } from 'lucide-react';
import { committeeApi } from '@/lib/api';
import { Button, EmptyState, ErrorState, Notice, Skeleton } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';
import { listOf } from '@/lib/committees';
import { groupMeetings, type MeetingRow } from '@/lib/committeeHome';
import { GroupHead, Lane, MeetingRowItem, MoreButton, MoreRow } from './LaneParts';

/** Meetings read for each committee (the API sends newest first): enough to hold every meeting still to come and the recent ones. */
const PER_COMMITTEE = 30;
const UPCOMING_SHOWN = 5;
const EARLIER_SHOWN = 4;

export function MeetingsLane({ ids, cut, committeeId, search, canSchedule, onSchedule, hiddenOnPhone, ready }: {
  /** the committees to read */
  ids: number[];
  /** how many more there are than the twenty read */
  cut: number;
  committeeId: number | null;
  search: string;
  canSchedule: boolean;
  onSchedule: () => void;
  hiddenOnPhone: boolean;
  /** the committee list is known (the ids are final) */
  ready: boolean;
}) {
  const [open, setOpen] = useState({ upcoming: false, earlier: false });
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['committee-meetings', id],
      queryFn: async () => listOf<MeetingRow>((await committeeApi.getMeetings(id, { limit: PER_COMMITTEE })).data),
    })),
  });

  const loading = !ready || results.some((r) => r.isLoading);
  const failed = results.filter((r) => r.isError && !r.data);
  const rows = results.flatMap((r) => r.data?.items ?? []);
  const total = results.reduce((n, r) => n + (r.data?.total ?? 0), 0);
  const trimmed = results.some((r) => r.data && r.data.total > r.data.items.length);
  const q = search.trim().toLowerCase();
  const matched = q ? rows.filter((m) => m.title.toLowerCase().includes(q) || (m.committee_name ?? '').toLowerCase().includes(q)) : rows;
  const { live, upcoming, earlier } = groupMeetings(matched);
  const showCommittee = !committeeId;
  const nothing = !loading && failed.length < results.length && matched.length === 0;
  const retry = () => { failed.forEach((r) => { void r.refetch(); }); };

  return (
    <Lane
      id="lane-meetings"
      title="Meetings"
      count={loading || failed.length > 0 ? undefined : formatCount(q ? matched.length : total)}     // a failed list is not "0": no number until every committee has answered
      hiddenOnPhone={hiddenOnPhone}
      controls={canSchedule ? <Button size="sm" leftIcon={<CalendarPlus aria-hidden />} onClick={onSchedule}>Schedule</Button> : undefined}
    >
      {loading ? (
        <div className="space-y-[10px] p-[12px]" aria-busy="true"><Skeleton className="h-[48px]" /><Skeleton className="h-[48px]" /><Skeleton className="h-[48px]" /></div>
      ) : failed.length > 0 && failed.length === results.length ? (
        <ErrorState compact title="Couldn't load the meetings" message={errorMessage(failed[0].error)} onRetry={retry} />
      ) : (
        <div>
          {failed.length > 0 && (
            <Notice tone="warning" className="m-[8px]" action={<Button size="sm" onClick={retry}>Retry</Button>}>
              {`The meetings of ${formatCount(failed.length)} ${failed.length === 1 ? 'committee' : 'committees'} could not be loaded.`}
            </Notice>
          )}
          {nothing ? (
            <EmptyState
              kind={q ? 'noMatches' : 'firstUse'}
              bare
              icon={CalendarPlus}
              title={q ? 'No meeting matches' : 'No meetings'}
              description={q ? undefined : committeeId ? 'This committee has no meeting yet.' : 'Schedule a meeting to plan its agenda and track its decisions.'}
              action={!q && canSchedule ? <Button variant="primary" onClick={onSchedule}>Schedule meeting</Button> : undefined}
            />
          ) : (
            <>
              {live.length > 0 && (
                <div>
                  <GroupHead label="In progress" count={live.length} />
                  <ul>{live.map((m) => <MeetingRowItem key={m.id} m={m} showCommittee={showCommittee} pinned />)}</ul>
                </div>
              )}
              {upcoming.length > 0 && (
                <div>
                  <GroupHead label="Upcoming" count={upcoming.length} />
                  <ul>{(open.upcoming ? upcoming : upcoming.slice(0, UPCOMING_SHOWN)).map((m) => <MeetingRowItem key={m.id} m={m} showCommittee={showCommittee} />)}</ul>
                  {upcoming.length > UPCOMING_SHOWN && (
                    <MoreRow><MoreButton open={open.upcoming} more={upcoming.length - UPCOMING_SHOWN} noun="meetings" onToggle={() => setOpen((o) => ({ ...o, upcoming: !o.upcoming }))} /></MoreRow>
                  )}
                </div>
              )}
              {earlier.length > 0 && (
                <div>
                  <GroupHead label="Earlier" count={earlier.length} />
                  <ul>{(open.earlier ? earlier : earlier.slice(0, EARLIER_SHOWN)).map((m) => <MeetingRowItem key={m.id} m={m} showCommittee={showCommittee} />)}</ul>
                  {earlier.length > EARLIER_SHOWN && (
                    <MoreRow><MoreButton open={open.earlier} more={earlier.length - EARLIER_SHOWN} noun="meetings" onToggle={() => setOpen((o) => ({ ...o, earlier: !o.earlier }))} /></MoreRow>
                  )}
                </div>
              )}
              {(trimmed || cut > 0) && (
                <p className="border-t border-ds-border px-[12px] py-[8px] text-ds-label font-normal text-ds-fg-muted">
                  {cut > 0 ? `The meetings of ${formatCount(ids.length)} of ${formatCount(ids.length + cut)} committees are listed: choose a committee to see the others. ` : ''}
                  {trimmed ? `Each committee lists its ${PER_COMMITTEE} latest meetings.` : ''}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Lane>
  );
}
