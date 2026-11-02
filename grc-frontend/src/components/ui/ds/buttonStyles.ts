// The classes of Button and IconButton, as plain strings so the pure part can be tested (controls.test.ts). Kit rules apply: only the --ds tokens
// and arbitrary values. Recipe: BRIEF_WP5_COMMON.md. The legacy docUi constants (BTN, BTN_PRIMARY ...) are not touched and keep their own look.
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dangerOutline' | 'link';
export type ButtonSize = 'md' | 'sm';

// Any svg inside is a 16px icon with the kit's stroke, whatever size the caller's icon asked for.
const BASE = 'relative inline-flex max-w-full shrink-0 items-center justify-center gap-[6px] whitespace-nowrap rounded-ds-control font-medium focus-visible:outline-none focus-visible:shadow-ds-ring [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:shrink-0 [&_svg]:[stroke-width:1.75]';

const SIZE: Record<ButtonSize, string> = {
  md: 'h-ds-control px-[12px] text-ds-body',
  sm: 'h-ds-control-sm px-[8px] text-ds-label',
};

export const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-ds-primary text-ds-on-primary hover:bg-ds-primary-hover active:bg-ds-primary-active',
  secondary: 'border border-ds-border-strong bg-ds-surface text-ds-fg-body hover:bg-ds-surface-hover',
  ghost: 'text-ds-fg-body hover:bg-ds-surface-hover',
  danger: 'bg-ds-danger text-ds-on-danger hover:bg-ds-danger-hover',
  dangerOutline: 'border border-ds-danger-border bg-ds-surface text-ds-danger hover:bg-ds-danger-soft',
  link: 'text-ds-primary-text hover:bg-ds-primary-soft',
};

// disabled: a real button is :disabled, a link or a loading button carries aria-disabled
const INERT = 'disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

export function buttonClasses({ variant = 'secondary', size = 'md', fullWidth = false, loading = false }: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
} = {}): string {
  // a loading button keeps its colours (the spinner says why it does nothing); it only changes the cursor
  return [BASE, SIZE[size], VARIANT[variant], loading ? 'cursor-progress' : INERT, fullWidth ? 'w-full' : ''].filter(Boolean).join(' ');
}

export type IconButtonVariant = 'ghost' | 'secondary';

/** Square: as high as a control and exactly as wide (the control height is 32px, and 44px on a phone-width window or a coarse pointer). */
export function iconButtonClasses(variant: IconButtonVariant = 'ghost'): string {
  return [BASE, 'h-ds-control w-[var(--ds-control-h)] p-0 text-ds-body', VARIANT[variant], INERT].join(' ');
}
