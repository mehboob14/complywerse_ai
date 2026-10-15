'use client';

/**
 * Follows a working turn closely: asks the server for its live view a few times a second (a few hundred bytes, not the whole
 * conversation) and writes it into the messages the page already holds. When a turn ends, the whole conversation is fetched at once.
 * Returns whether the live view is available; a server that has no such route leaves the page with its slower poll alone.
 */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { studioApi, type Message } from '@/lib/studio/api';

export function useLiveProgress(sessionId: number, messages: Message[]): boolean {
  const qc = useQueryClient();
  const working = Number.isFinite(sessionId) && messages.some((m) => m.status === 'working');
  const progress = useQuery({
    queryKey: ['studio', 'progress', sessionId],
    queryFn: () => studioApi.progress(sessionId),
    enabled: working,
    refetchInterval: (q) => (working && q.state.status !== 'error' ? 700 : false),
    retry: false,
    gcTime: 0,
  });
  const rows = progress.data?.items;
  useEffect(() => {
    if (!rows) return;
    let ended = false;
    qc.setQueryData<{ items: Message[] }>(['studio', 'messages', sessionId], (old) => {
      if (!old) return old;
      return {
        items: old.items.map((m) => {
          const row = m.status === 'working' ? rows.find((r) => r.id === m.id) : undefined;
          if (!row) return m;
          if (row.status !== 'working') { ended = true; return m; }
          if ((row.live?.seq ?? 0) < (m.live?.seq ?? 0)) return m;             // never back to an older state
          return { ...m, stage: row.stage, live: row.live };
        }),
      };
    });
    if (ended) qc.invalidateQueries({ queryKey: ['studio', 'messages', sessionId] });
  }, [rows, qc, sessionId]);
  return progress.isSuccess;
}
