// The class strings the record's panels put on their own <button> and <Link> elements, drawn by the kit's button recipe (components/ui/ds/buttonStyles.ts): the kit's colours, focus ring
// and control height (44px on a phone or a coarse pointer). They stand where the module's older BTN constants stood, so a panel moves to the kit by changing one import.
import { buttonClasses, iconButtonClasses } from '@/components/ui/ds/buttonStyles';

export const BTN = buttonClasses();
export const BTN_PRIMARY = buttonClasses({ variant: 'primary' });
/** The destructive action: a red outline (the confirming step is the sheet's own button). */
export const BTN_DANGER = buttonClasses({ variant: 'dangerOutline' });
/** Smaller, for the inside of a card or a row. */
export const BTN_SM = buttonClasses({ size: 'sm' });
export const BTN_ICON = iconButtonClasses();
export const BTN_TEXT = buttonClasses({ variant: 'link' });
export const DANGER_FILL = buttonClasses({ variant: 'danger' });
