// What the save bar of a form says and which buttons it offers, as decisions apart from React so `node --test` can pin them (saveBarModel.test.ts).
// SaveBar.tsx only draws them. The words are the platform's for any form that saves as a whole ("Unsaved changes", "Fix the fields in red to save",
// "Saved"); a page that needs other words passes its own `error` text, nothing else is the page's.

export interface SaveBarInput {
  /** the person may change the form at all: false (view-only) and the bar is never shown */
  canEdit: boolean;
  /** the form differs from what is saved */
  dirty: boolean;
  /** a field is wrong: Save is not offered until it is fixed */
  invalid: boolean;
  /** the request is on its way */
  saving: boolean;
  /** the last save went through a moment ago (the page clears it again after a few seconds) */
  justSaved: boolean;
  /** what the server said when the last save was refused; blank or missing: nothing */
  error?: string | null;
}

export type SaveBarTone = 'neutral' | 'danger' | 'success';

export interface SaveBarState {
  /** the bar is on screen at all */
  show: boolean;
  tone: SaveBarTone;
  /** the one line it says */
  text: string;
  /** Discard and Save are offered (there is something to save) */
  actions: boolean;
  /** Discard cannot be pressed (a save is on its way) */
  discardDisabled: boolean;
  /** Save cannot be pressed (a field is wrong); while saving it is busy instead, so focus stays on it */
  saveDisabled: boolean;
  /** Save shows its spinner and ignores presses */
  saveBusy: boolean;
}

export const SAVE_BAR_WORDS = {
  unsaved: 'Unsaved changes',
  invalid: 'Fix the fields in red to save',
  saved: 'Saved',
} as const;

const HIDDEN: SaveBarState = { show: false, tone: 'neutral', text: '', actions: false, discardDisabled: false, saveDisabled: false, saveBusy: false };

/**
 * The bar shows while there is something to say: unsaved changes, a refused save, or the confirmation of a save. A refusal outranks everything
 * else (it is what the person must act on), then "fix the fields", then "unsaved". The confirmation shows only when nothing is left unsaved.
 * The buttons are there only while there are changes.
 */
export function saveBarState({ canEdit, dirty, invalid, saving, justSaved, error }: SaveBarInput): SaveBarState {
  const refusal = typeof error === 'string' ? error.trim() : '';
  if (!canEdit || !(dirty || justSaved || refusal)) return HIDDEN;
  const base = { show: true, actions: dirty, discardDisabled: saving, saveDisabled: invalid, saveBusy: saving };
  if (refusal) return { ...base, tone: 'danger', text: refusal };
  if (dirty) return invalid ? { ...base, tone: 'danger', text: SAVE_BAR_WORDS.invalid } : { ...base, tone: 'neutral', text: SAVE_BAR_WORDS.unsaved };
  return { ...base, tone: 'success', text: SAVE_BAR_WORDS.saved };
}
