import type { ToastType } from './Toast';

// Arbitrary colour values on purpose: globals.css repaints `text-white`, `bg-white` and
// `text-slate-*` with !important (also outside .platform-ui), which left the title
// white on a white card. Pairs are checked for WCAG AA in toastTheme.test.ts.
export const TOAST_TEXT = {
  title: 'text-[#1f2933]',
  message: 'text-[#586472]',
  close: 'text-[#586472] hover:text-[#1f2933]',
};

// The button a toast can carry ("Retry"): dark teal words and outline on the card, filled with white words on hover. Pairs checked in toastTheme.test.ts.
export const TOAST_ACTION = 'border border-[#115e59] text-[#115e59] hover:bg-[#115e59] hover:text-[#fff]';

/** A failure interrupts a screen reader; everything else waits its turn. */
export function toastRole(type: ToastType): 'alert' | 'status' {
  return type === 'error' ? 'alert' : 'status';
}

// bg = the type colour at 10% over white (the tint the card was designed with).
export const TOAST_TONES: Record<ToastType, { bg: string; border: string; iconColor: string }> = {
  success: { bg: 'bg-[#e9f9ef]', border: 'border-success-500/30', iconColor: 'text-[#15803d]' },
  error: { bg: 'bg-[#fdecec]', border: 'border-danger-500/30', iconColor: 'text-[#b91c1c]' },
  warning: { bg: 'bg-[#fef5e7]', border: 'border-warning-500/30', iconColor: 'text-[#b45309]' },
  info: { bg: 'bg-[#e6f8fb]', border: 'border-info-500/30', iconColor: 'text-[#0e7490]' },
};
