// The look of a field in the vendor record's dialogs, spelled once. Explicit hex on purpose: the platform CSS repaints slate and
// white utilities and sizes bare inputs (PITFALLS 100). The same classes as the Request vendor dialog, so the two forms match.

export const FIELD = 'block h-10 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm text-[#1f2933] placeholder:text-[#64707e] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30 disabled:bg-[#f3f6f8] disabled:text-[#586472]';
/** A text area: the same field, as tall as its rows. */
export const AREA = `${FIELD} h-auto py-2 leading-5`;
export const LABEL = 'mb-1 block text-[13px] font-medium leading-5 text-[#26323d]';
/** "(optional)" and other small grey words beside a label. */
export const HINT = 'text-[12px] font-normal text-[#64707e]';
/** A small caps heading over a group of fields ("Data", "Ownership"). */
export const GROUP = 'mb-2 text-[11px] font-semibold uppercase leading-4 tracking-wide text-[#64707e]';
