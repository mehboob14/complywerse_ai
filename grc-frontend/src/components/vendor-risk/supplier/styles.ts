// Class strings the supplier's pages share. Written out in full so Tailwind sees them. The portal sits outside the
// dashboard shell, so plain Tailwind colours apply; the teal is a dark one (#0f766e) so focus and links read on white.

export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-1';

export const FIELD = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/25 disabled:bg-gray-100 disabled:text-gray-600';

/** A quiet button. */
export const BTN = `inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;

/** The main button (the platform's own, dark text on teal). */
export const BTN_MAIN = `cw-btn-primary inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

/** A word that does something. */
export const LINK = `rounded text-sm font-medium text-[#0f766e] underline-offset-2 hover:underline ${FOCUS}`;
