'use client';

// What a person can do to observations, in one place for the register, its drawer, the bulk bar and the record page: move to another status, delete, and (in bulk) move or give to an
// owner. Each one asks first where it cannot be taken back, reports what happened in words (a failure stays on screen with Retry, a partial bulk says how many were done and how many
// were not) and refreshes every list and record that shows the observation. The server decides who may do what (every route is sign-in only today); nothing here narrows or widens that.
import { useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { statutoryAuditApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { levelPill } from '@/lib/statuses/statutory';
import { useConfirm, useNotify, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { REFRESH } from './observationData';
import type { Level, ObservationRow } from './observationModel';

const leftWords = (n: number): string => (n > 0 ? ` ${formatCount(n)} copied from the Issue Register ${n === 1 ? 'is' : 'are'} left out: the register owns ${n === 1 ? 'its' : 'their'} status and owner.` : '');
const name = (o: Pick<ObservationRow, 'code' | 'title'>): string => truncate([o.code, o.title].filter(Boolean).join(' · '), 80).text;

export function useObservationActions({ levels, onRemoved }: { levels: readonly Level[]; onRemoved?: (id: number) => void }): {
  move: (o: Pick<ObservationRow, 'id' | 'code' | 'title'>, to: string) => void;
  moving: boolean;
  remove: (o: Pick<ObservationRow, 'id' | 'code' | 'title'>) => Promise<boolean>;
  /** `left` is how many ticked observations are copies of register findings: they are not touched (the register owns their status and owner) and the question says so */
  bulkMove: (ids: number[], to: string, done: () => void, left?: number) => Promise<void>;
  bulkOwner: (ids: number[], owner: { id: number | null; name: string }, done: () => void, left?: number) => Promise<void>;
  confirmDialog: ReactNode;
} {
  const qc = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const refresh = useCallback(() => { REFRESH.forEach((key) => { void qc.invalidateQueries({ queryKey: key }); }); }, [qc]);

  const moveMutation = useReportedMutation({
    mutationFn: async (v: { id: number; code: string | null; title: string; to: string }) => (await statutoryAuditApi.transition(v.id, { status: v.to })).data,
    success: (_d, v) => `Moved to ${levelPill(levels, v.to).label}`,
    failure: "Couldn't move the observation",
    invalidate: REFRESH,
  });
  const removeMutation = useReportedMutation({
    mutationFn: async (v: { id: number }) => (await statutoryAuditApi.remove(v.id)).data,
    success: 'Observation deleted',
    failure: "Couldn't delete the observation",
    invalidate: REFRESH,
    onSuccess: (_d, v) => onRemoved?.(v.id),
  });

  const remove = useCallback(async (o: Pick<ObservationRow, 'id' | 'code' | 'title'>): Promise<boolean> => {
    const yes = await confirm({
      title: 'Delete this observation?',
      message: `“${name(o)}” and its links will be deleted. Files in the evidence library are kept. This can't be undone.`,
      confirmLabel: 'Delete observation',
      tone: 'danger',
    });
    if (yes) removeMutation.mutate({ id: o.id });
    return yes;
  }, [confirm, removeMutation]);

  // a bulk action is one request per observation (each is checked against its own rules by the server); the person is told how many went through
  const each = useCallback(async (ids: number[], run: (id: number) => Promise<unknown>): Promise<{ done: number; failed: number; why: string }> => {
    let done = 0;
    let failed = 0;
    let why = '';
    for (const id of ids) {
      try { await run(id); done += 1; } catch (error) { failed += 1; why = why || errorMessage(error); }
    }
    refresh();
    return { done, failed, why };
  }, [refresh]);

  const bulkMove = useCallback(async (ids: number[], to: string, clear: () => void, left = 0) => {
    const label = levelPill(levels, to).label;
    const yes = await confirm({ title: `Move ${formatCount(ids.length)} observations to ${label}?`, message: `Each one is checked on its own: any that cannot go straight to this status stay where they are.${leftWords(left)}`, confirmLabel: `Move to ${label}` });
    if (!yes) return;
    const r = await each(ids, (id) => statutoryAuditApi.transition(id, { status: to }));
    if (r.failed === 0) notify.success(`${formatCount(r.done)} observations moved to ${label}`);
    else notify.error(`${formatCount(r.failed)} of ${formatCount(ids.length)} could not be moved${r.done ? `; the other ${formatCount(r.done)} were` : ''}. ${r.why}`, { title: 'Some observations were not moved' });
    clear();
  }, [confirm, each, levels, notify]);

  const bulkOwner = useCallback(async (ids: number[], owner: { id: number | null; name: string }, clear: () => void, left = 0) => {
    const who = owner.id ? owner.name : 'nobody';
    const yes = await confirm({ title: owner.id ? `Give ${formatCount(ids.length)} observations to ${owner.name}?` : `Take the owner off ${formatCount(ids.length)} observations?`, message: `They can be given a different owner later.${leftWords(left)}`, confirmLabel: owner.id ? 'Assign owner' : 'Remove owner' });
    if (!yes) return;
    const r = await each(ids, (id) => statutoryAuditApi.update(id, { owner_id: owner.id }));
    if (r.failed === 0) notify.success(owner.id ? `${formatCount(r.done)} observations now belong to ${who}` : `The owner was removed from ${formatCount(r.done)} observations`);
    else notify.error(`${formatCount(r.failed)} of ${formatCount(ids.length)} could not be changed${r.done ? `; the other ${formatCount(r.done)} were` : ''}. ${r.why}`, { title: 'Some observations were not changed' });
    clear();
  }, [confirm, each, notify]);

  return {
    move: (o, to) => moveMutation.mutate({ id: o.id, code: o.code ?? null, title: o.title, to }),
    moving: moveMutation.isPending,
    remove,
    bulkMove,
    bulkOwner,
    confirmDialog,
  };
}
