// Where keyboard focus goes in a dialog or a drawer, as pure decisions: `node --test src/components/ui/dialogFocus.test.ts` runs them;
// useDialogFocus.ts applies them to the page for AnimatedModal and RightSlidePanel (the vendor Dialog sits on top of AnimatedModal).

/** What a Tab press can land on. `:disabled` (not `[disabled]`) also covers a button inside a disabled <fieldset>. */
export const TABBABLE = 'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [contenteditable=""], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Somewhere to type: where a dialog's focus goes when its caller names nothing. */
export const FIELD = 'input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [contenteditable=""], [contenteditable="true"]';

/** A caller marks the one element that takes focus when its dialog opens. */
export const AUTOFOCUS = '[data-autofocus]:not(:disabled)';

/** The items that take part in the layout: display:none (and everything inside it) has no client rects, so a hidden step of a form is no tab stop. */
export function visibleOnly<T extends { getClientRects(): ArrayLike<unknown> }>(items: Iterable<T>): T[] {
  return Array.from(items).filter((el) => el.getClientRects().length > 0);
}

/** Where a Tab (or Shift+Tab, `shift`) press must send focus in a dialog with `count` tabbable items while focus is on item `activeIndex`
 *  (-1: on none of them, e.g. the dialog itself). Only the ends wrap; anywhere else it returns null and the browser's own move stays
 *  inside (it also knows that a radio group is one stop). Needs `count` >= 1. */
export function nextFocusIndex(count: number, activeIndex: number, shift: boolean): number | null {
  if (activeIndex < 0) return shift ? count - 1 : 0;
  if (shift) return activeIndex === 0 ? count - 1 : null;
  return activeIndex === count - 1 ? 0 : null;
}

/** True when focus sits in something drawn over the dialog (a menu, a dialog opened from it): that element handles Tab and Escape
 *  itself. Focus on <body> is not "elsewhere": nothing holds it, so the dialog may. */
export function focusIsElsewhere(dialog: { contains(node: unknown): boolean }, active: unknown, body: unknown): boolean {
  return active != null && active !== body && !dialog.contains(active);
}

/** Whether an overlay (a dialog or a drawer) takes this Escape press. It must be Escape; nothing may have handled it already (a list, a menu or a
 *  stacked overlay that took it first: `defaultPrevented`); and focus must not be in a layer drawn over this overlay (`focusElsewhere`: a menu, a
 *  preview or a drawer opened from it). That layer is the top one and the press is its: one Escape closes one layer, whether the overlay holds
 *  typed input or not. */
export function overlayTakesEscape({ key, defaultPrevented, focusElsewhere }: { key: string; defaultPrevented: boolean; focusElsewhere: boolean }): boolean {
  return key === 'Escape' && !defaultPrevented && !focusElsewhere;
}

/** What takes focus when a dialog opens: the element a caller marked, else the first field, else the first button, else the dialog.
 *  On a touch screen (`touch`) only a marked element or the dialog itself: focusing a text field there raises the on-screen keyboard over the
 *  dialog the moment it opens, which these dialogs never did before they took focus. */
export function initialFocusTarget<T>(found: { autofocus: readonly T[]; fields: readonly T[]; buttons: readonly T[] }, dialog: T, touch = false): T {
  if (touch) return found.autofocus[0] ?? dialog;
  return found.autofocus[0] ?? found.fields[0] ?? found.buttons[0] ?? dialog;
}

// ---- closing a dialog that may hold typed input ----

export type CloseSource = 'escape' | 'close-button' | 'backdrop';
/** close: onClose now. ask: show "Discard changes?". keep: hide that bar, back to editing. ignore: nothing. */
export type CloseAction = 'close' | 'ask' | 'keep' | 'ignore';

/** What Escape, the X button or a click on the backdrop does. Without `dirty` it is what these dialogs always did (the backdrop closes
 *  unless `closeOnBackdrop` is false). With `dirty` nothing closes by itself: the bar asks first, and Escape on the bar means keep editing. */
export function closeAction(
  state: { dirty: boolean; asking: boolean; closeOnBackdrop: boolean },
  source: CloseSource,
): CloseAction {
  if (source === 'backdrop' && !state.closeOnBackdrop) return 'ignore';
  if (!state.dirty) return 'close';
  if (state.asking && source === 'escape') return 'keep';
  return 'ask';
}
