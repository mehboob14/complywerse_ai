// When the question of useConfirm is asked and when it is answered, apart from React so `node --test` can pin it (confirmState.test.ts):
// one question on screen at a time, and every question answered exactly once (yes, no, or no because it was replaced or its page went away).

export interface ConfirmState<R> {
  /** the dialog is showing */
  open: boolean;
  /** which question this is: a click that carries an older id (a dialog that has since been replaced or answered) is ignored */
  id: number;
  /** the question; kept after the dialog closes, because the dialog fades out and must still show its words while it does */
  request: R | null;
}

export interface Transition<R> {
  state: ConfirmState<R>;
  /** the questions to answer now; the caller resolves the matching promises */
  answers: Array<{ id: number; value: boolean }>;
}

export const CONFIRM_IDLE: ConfirmState<never> = { open: false, id: 0, request: null };

/** A new question. One already showing is answered "no": nothing was confirmed, and a double click on the trigger must not run its action twice. */
export function openConfirm<R>(state: ConfirmState<R>, request: R): Transition<R> {
  return {
    state: { open: true, id: state.id + 1, request },
    answers: state.open ? [{ id: state.id, value: false }] : [],
  };
}

/** The answer to question `id`. Ignored when that question is not the one showing: already answered (a double click), or replaced by a newer one. */
export function settleConfirm<R>(state: ConfirmState<R>, id: number, value: boolean): Transition<R> {
  if (!state.open || state.id !== id) return { state, answers: [] };
  return { state: { ...state, open: false }, answers: [{ id, value }] };
}

/** The words every question needs. `confirmLabel` has no default on purpose: "OK" says nothing, "Archive 3 documents" says what will happen. */
export function checkRequest(request: { title?: string; confirmLabel?: string }): void {
  if (!request.title?.trim()) throw new Error('confirm() needs a title');
  if (!request.confirmLabel?.trim()) throw new Error('confirm() needs a confirmLabel: a verb phrase such as "Archive 3 documents", not "OK"');
}
