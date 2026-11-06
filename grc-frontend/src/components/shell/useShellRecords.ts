'use client';

// The data the shell reads from the browser, all through endpoints the app already has (nothing new is asked of the server):
//  - the crumbs of a committee page and a meeting page: the page's OWN queries (same key, same raw answer: records.test.ts holds both), so nothing extra is requested;
//  - the committees and a committee's meetings, for the crumb switchers and the palette;
//  - the palette's record search: documents (the server's own search and visibility filter, brief rows), committees and meetings (filtered here).
// Each source stands alone: a refused list is one line in the palette ("Documents could not be searched", Retry) and the pages and actions go on working.
import { useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, committeeApi } from '@/lib/api';
import type { CrumbRecords } from './crumbsModel';
import type { RecordSource, RecordSourceName } from './paletteModel';
import { committeeHits, committeesOf, documentHits, listOf, meetingHits, recordIdsIn, type CommitteeRow } from './records';

const FIVE_MINUTES = 5 * 60_000;
export const DOCUMENT_HITS = 8;
export const MEETING_COMMITTEES = 10;
export const MIN_QUERY = 2;

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** The committee and the meeting the page is about, from the page's own cache entries. */
export function useCrumbRecords(pathname: string): CrumbRecords {
  const ids = recordIdsIn(pathname);
  const meetingQ = useQuery({
    queryKey: ['meeting', ids.meetingId],
    queryFn: async () => (await committeeApi.getMeeting(ids.meetingId as number)).data as Record<string, unknown>,
    enabled: ids.meetingId != null,
    staleTime: 60_000,
  });
  const committeeId = ids.committeeId;
  const committeeQ = useQuery({
    queryKey: ['committee', committeeId],
    queryFn: async () => (await committeeApi.getCommittee(committeeId as number)).data as Record<string, unknown>,
    enabled: committeeId != null,
    staleTime: 60_000,
  });
  const meeting = meetingQ.data;
  const committee = committeeQ.data;
  return useMemo<CrumbRecords>(() => {
    if (ids.meetingId != null) {
      const owner = num(meeting?.committee_id);
      return {
        meeting: { id: ids.meetingId, number: str(meeting?.meeting_number), committeeId: owner },
        committee: owner != null ? { id: owner, name: str(meeting?.committee_name) } : undefined,
      };
    }
    if (committeeId != null) return { committee: { id: committeeId, name: str(committee?.name) } };
    return {};
  }, [ids.meetingId, committeeId, meeting, committee]);
}

export interface Fetched<T> { status: 'idle' | 'loading' | 'ready' | 'failed'; data: T; retry: () => void }

/** The active committees: for the committee switcher and the palette. */
export function useCommittees(enabled: boolean): Fetched<CommitteeRow[]> {
  const q = useQuery({
    queryKey: ['shell', 'committees'],
    queryFn: async () => committeesOf(listOf((await committeeApi.getCommittees()).data).items),
    enabled,
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  return { status: statusOf(q), data: q.data ?? [], retry: () => { void q.refetch(); } };
}

/** The meetings of one committee (the server sends the newest 50). */
export function useCommitteeMeetings(committeeId: number | null, enabled: boolean): Fetched<Array<Record<string, unknown>>> {
  const q = useQuery({
    queryKey: ['shell', 'meetings', committeeId],
    queryFn: async () => listOf((await committeeApi.getMeetings(committeeId as number)).data).items,
    enabled: enabled && committeeId != null,
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
  return { status: statusOf(q), data: q.data ?? [], retry: () => { void q.refetch(); } };
}

function statusOf(q: { isPending: boolean; isError: boolean; isSuccess: boolean; fetchStatus: string }): Fetched<unknown>['status'] {
  if (q.isError) return 'failed';
  if (q.isSuccess) return 'ready';
  return q.isPending && q.fetchStatus === 'fetching' ? 'loading' : 'idle';
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}

export interface RecordSearch {
  sources: Record<RecordSourceName, RecordSource>;
  retry: (name: RecordSourceName) => void;
}

/** The palette's record search. `open`: the palette is showing (nothing is asked while it is shut); `may`: which sources this person may read at all. A query of fewer than two
 *  characters asks nothing; the document search waits 250 ms after the last key. */
export function useRecordSearch(query: string, open: boolean, may: { documents: boolean; committees: boolean }): RecordSearch {
  const client = useQueryClient();
  const typed = query.replace(/\s+/g, ' ').trim();
  const term = useDebounced(typed, 250);
  const active = open && typed.length >= MIN_QUERY && term.length >= MIN_QUERY;

  const docsQ = useQuery({
    queryKey: ['shell', 'search', 'documents', term],
    queryFn: async () => listOf((await apiClient.get('/governance/documents', { params: { brief: 1, search: term, limit: DOCUMENT_HITS } })).data),
    enabled: active && may.documents,
    staleTime: 60_000,
    retry: false,
  });
  const committees = useCommittees(open && active && may.committees);
  const shown = committees.data.slice(0, MEETING_COMMITTEES);
  const meetingQs = useQueries({
    queries: shown.map((c) => ({
      queryKey: ['shell', 'meetings', c.id],
      queryFn: async () => listOf((await committeeApi.getMeetings(c.id)).data).items,
      enabled: active && may.committees,
      staleTime: FIVE_MINUTES,
      retry: 1,
    })),
  });

  const sources = useMemo<Record<RecordSourceName, RecordSource>>(() => {
    const documents: RecordSource = !active || !may.documents ? { status: 'idle', hits: [] }
      : docsQ.isError ? { status: 'failed', hits: [] }
      : docsQ.isSuccess && term === typed ? { status: 'ready', hits: documentHits(docsQ.data.items), total: docsQ.data.total }
      : { status: 'loading', hits: [] };
    const committeeSource: RecordSource = !active || !may.committees ? { status: 'idle', hits: [] }
      : committees.status === 'failed' ? { status: 'failed', hits: [] }
      : committees.status === 'ready' ? { status: 'ready', hits: committeeHits(committees.data, typed) }
      : { status: 'loading', hits: [] };
    let meetings: RecordSource = { status: 'idle', hits: [] };
    if (active && may.committees) {
      if (committees.status === 'failed') meetings = { status: 'failed', hits: [] };
      else if (committees.status !== 'ready' || meetingQs.some((m) => m.isPending && m.fetchStatus === 'fetching')) meetings = { status: 'loading', hits: [] };
      else if (shown.length > 0 && meetingQs.every((m) => m.isError)) meetings = { status: 'failed', hits: [] };
      else meetings = { status: 'ready', hits: meetingHits(shown.map((committee, i) => ({ committee, rows: meetingQs[i]?.data ?? [] })), typed) };
    }
    return { documents, committees: committeeSource, meetings };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the query results change identity every render; their status and data are what the rows are made of
  }, [active, may.documents, may.committees, term, typed, docsQ.status, docsQ.data, committees.status, committees.data, meetingQs.map((m) => `${m.status}:${m.dataUpdatedAt}`).join('|')]);

  const retry = (name: RecordSourceName) => {
    if (name === 'documents') void client.invalidateQueries({ queryKey: ['shell', 'search', 'documents'] });
    else { void client.invalidateQueries({ queryKey: ['shell', 'committees'] }); void client.invalidateQueries({ queryKey: ['shell', 'meetings'] }); }
  };
  return { sources, retry };
}

