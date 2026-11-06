'use client';

// Ask before a destructive or far-reaching action, without a provider and without window.confirm:
//
//   const { confirm, confirmDialog } = useConfirm();
//   if (!(await confirm({ title: 'Archive 3 documents?', confirmLabel: 'Archive 3 documents', tone: 'danger' }))) return;
//   ...
//   return <>{page}{confirmDialog}</>;
//
// The promise resolves true or false exactly once (Cancel, Escape, a click outside, a newer question, the page going away: all "false"). The rules
// live in confirmState.ts; this only holds them in React.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog';
import { CONFIRM_IDLE, checkRequest, openConfirm, settleConfirm, type ConfirmState, type Transition } from './confirmState';

export type ConfirmOptions = ConfirmRequest;

export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean>; confirmDialog: ReactNode } {
  const [state, setState] = useState<ConfirmState<ConfirmRequest>>(CONFIRM_IDLE);
  const latest = useRef(state);                                      // what a click or a new question sees, even before React has re-rendered
  const waiting = useRef(new Map<number, (answer: boolean) => void>());

  const run = useCallback((t: Transition<ConfirmRequest>) => {
    latest.current = t.state;
    setState(t.state);
    for (const { id, value } of t.answers) {
      waiting.current.get(id)?.(value);
      waiting.current.delete(id);
    }
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    checkRequest(options);                                           // throws inside the promise: the caller's await fails loudly
    const t = openConfirm(latest.current, options);
    waiting.current.set(t.state.id, resolve);
    run(t);
  }), [run]);

  // the page goes away with a question open: answer it "no", so nothing waits for ever
  useEffect(() => () => {
    for (const { id, value } of settleConfirm(latest.current, latest.current.id, false).answers) waiting.current.get(id)?.(value);
  }, []);

  const confirmDialog = state.request ? (
    <ConfirmDialog
      {...state.request}
      open={state.open}
      onConfirm={() => run(settleConfirm(latest.current, state.id, true))}
      onCancel={() => run(settleConfirm(latest.current, state.id, false))}
    />
  ) : null;

  return { confirm, confirmDialog };
}
