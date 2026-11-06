// The buttons of the Documents area, spelled once. Explicit hex values on purpose: the platform CSS forces `bg-white` and repaints
// slate/blue/green utilities, and gives every <button> 12px text (named sizes like text-sm still win) — see PITFALLS 100.
const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

/** A page action: Templates, Export … (36px high). */
export const BTN = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** The one main action of a page: New document, New attestation … */
export const BTN_PRIMARY = `inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 text-sm font-medium text-[#fff] hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** An icon-only button (give it an aria-label and a title). */
export const BTN_ICON = `inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#c3ccd5] bg-[#fff] text-[#586472] hover:bg-[#f3f6f8] hover:text-[#26323d] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** A quiet text button inside a table row or a card ("Details", "Close"). */
export const BTN_TEXT = `rounded-md px-1.5 py-1 text-sm font-medium text-[#0f766e] hover:bg-[#f0fdfa] ${FOCUS}`;
