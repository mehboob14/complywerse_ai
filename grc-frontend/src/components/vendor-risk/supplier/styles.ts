// Class strings the supplier's pages share. Written out in full so Tailwind sees them. The portal sits outside the
// dashboard shell, so plain Tailwind colours apply; the buttons are the kit's (deep teal, white words; 44px on a phone) and the teal
// of links and focus is the same dark one (#0f766e) so they read on white. A supplier opens the link on a phone: every field and
// target is at least 44px high there, and a field's text is 16px so the browser does not zoom the page when it is tapped.
import { buttonClasses } from '@/components/ui/ds/buttonStyles';

export const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-1';

export const FIELD = 'w-full min-h-[44px] rounded-lg border border-ds-border-control bg-ds-surface px-3 py-2 text-[16px] text-ds-fg outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#0f766e]/25 disabled:bg-ds-surface-subtle disabled:text-ds-fg-body sm:text-[14px]';

/** A quiet button. */
export const BTN = buttonClasses({ variant: 'secondary' });

/** The main button. */
export const BTN_MAIN = buttonClasses({ variant: 'primary' });

/** A word that does something. */
export const LINK = `inline-flex min-h-[44px] items-center rounded text-sm font-medium text-[#0f766e] underline-offset-2 hover:underline sm:min-h-[32px] ${FOCUS}`;
