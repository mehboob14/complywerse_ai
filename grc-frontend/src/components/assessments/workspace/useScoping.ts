'use client';

/**
 * The scoping of a scoped assessment (Cyber Security and NIST: one per application, function or system), held for the whole workspace because its heading offers Start and
 * Discard: the edits the person makes in Scope, People and Plan are saved as they go (700 ms after the last key), the server's answer replaces the scope, what was typed while a
 * save ran is saved next, and what is left when the person leaves the page is sent as it goes. A refused save names its fields and offers Try again; Start sends what is pending first.
 * (The same behaviour as components/compliance/scoping/AssessmentWorkspace.tsx, which this page replaces for the screen.)
 */
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useNotify } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import type { StageProps } from '@/components/compliance/scoping/ScopeForms';
import { fieldErrors } from '@/components/compliance/scoping/scopingModel';
import { scopingApi, type Scope, type ScopePatch, type ScopeView } from '@/components/compliance/scoping/scopingApi';
import { KEYS, refreshWorkspaceCaches } from './workspaceApi';
import { BACK } from './workspaceModel';

export interface Scoping {
  /** the props of the three stage forms; null when the assessment is not scoped */
  props: StageProps | null;
  /** something typed is not saved yet */
  pending: boolean;
  saving: boolean;
  /** the words of the last refused save, null when the last save went through */
  saveError: string | null;
  startError: string | null;
  retry: () => void;
  start: () => void;
  starting: boolean;
  discard: () => void;
  discarding: boolean;
}

export function useScoping(id: number, view: ScopeView | undefined, { onStarted }: { onStarted: () => void }): Scoping {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const scoped = !!view?.scope_model;
  const [edits, setEdits] = useState<ScopePatch>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const sent = useRef('');
  const failed = useRef('');                                                    // the edits the server refused: not sent again until they change (or the person says so)

  const save = useMutation({
    mutationFn: (patch: ScopePatch) => { sent.current = JSON.stringify(patch); return scopingApi.save(id, patch); },
    onSuccess: (next) => {
      qc.setQueryData(KEYS.scope(id), next);
      setErrors({}); setSaveError(null);
      setEdits((cur) => (JSON.stringify(cur) === sent.current ? {} : cur));       // what was typed while it saved stays, and is saved next
      refreshWorkspaceCaches(qc, id);
    },
    onError: (e) => { failed.current = sent.current; setErrors(fieldErrors(e)); setSaveError(errorMessage(e)); },
  });
  const pending = Object.keys(edits).length > 0;
  useEffect(() => {
    if (!scoped || !pending || save.isPending || JSON.stringify(edits) === failed.current) return undefined;
    const t = setTimeout(() => save.mutate(edits), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, save.isPending, scoped]);
  // leaving the page with something typed in the last moment: it is sent as the page goes
  const leaving = useRef({ id, edits });
  leaving.current = { id, edits };
  useEffect(() => () => {
    const { id: at, edits: left } = leaving.current;
    if (Object.keys(left).length > 0) scopingApi.save(at, left).then(() => refreshWorkspaceCaches(qc, at)).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useMutation({
    mutationFn: async () => { if (pending) await scopingApi.save(id, edits); return scopingApi.start(id); },
    onSuccess: (next) => {
      qc.setQueryData(KEYS.scope(id), next);
      setEdits({}); setStartError(null);
      refreshWorkspaceCaches(qc, id);
      notify.success(`${next.total_items} questions are open`, { title: 'Assessment started' });
      onStarted();
    },
    onError: (e) => { setErrors(fieldErrors(e)); setStartError(errorMessage(e)); void qc.invalidateQueries({ queryKey: KEYS.scope(id) }); },
  });
  const discard = useMutation({
    mutationFn: () => scopingApi.remove(id),
    onSuccess: () => { refreshWorkspaceCaches(qc, id); router.push(BACK.href); },
    onError: (e) => notify.error(e, { title: 'Could not discard the draft' }),
  });

  const scope: Scope = { ...(view?.scope ?? {}), ...(edits.scope ?? {}) };
  const props: StageProps | null = view && scoped ? {
    view, scope, errors,
    ownerId: edits.owner_id ?? view.owner?.id ?? null,
    dueDate: 'due_date' in edits ? edits.due_date ?? null : view.due_date,
    onScope: (patch) => setEdits((e) => ({ ...e, scope: { ...(e.scope ?? {}), ...patch } })),
    onOwner: (owner) => setEdits((e) => ({ ...e, owner_id: owner })),
    onDue: (day) => setEdits((e) => ({ ...e, due_date: day })),
  } : null;

  return {
    props, pending, saving: save.isPending, saveError, startError,
    retry: () => { failed.current = ''; save.mutate(edits); },
    start: () => start.mutate(), starting: start.isPending,
    discard: () => discard.mutate(), discarding: discard.isPending,
  };
}
