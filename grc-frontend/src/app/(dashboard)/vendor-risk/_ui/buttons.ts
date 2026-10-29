// The kit's buttons are the Documents area's (one look for the whole platform), plus the red one these pages need ("Decline", "Start
// offboarding"). Explicit hex on purpose: the platform CSS repaints slate/blue/green utilities and sizes bare buttons (PITFALLS 100).
// Not in the original contract: an addition so the actions passed to ModuleHeader / Panel / Dialog / EmptyState look alike on every page.
export { BTN, BTN_PRIMARY, BTN_ICON, BTN_TEXT } from '@/components/governance/docUi';

/** The destructive action: a red outline, not a red fill (the confirming step is the dialog's own primary button). */
export const BTN_DANGER =
  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[#e4a8a1] bg-[#fff] px-3 text-sm font-medium text-[#b42318] hover:bg-[#fef3f2] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
