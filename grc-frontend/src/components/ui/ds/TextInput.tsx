'use client';

// TextInput: a single-line field on the design-system tokens. Inside a FormField it takes its id and ARIA wiring from there; on its own it takes
// the same props (id, aria-describedby, invalid, required) and the caller names it (aria-label). `className` goes on the wrapper, for width and
// margin only. Adornments sit inside the box: the left one is decoration (it does not take clicks), the right one may hold a button.
import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useFieldControl } from './FormField';
import { READ_ONLY, fieldClasses } from './fieldStyles';

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** red outline and aria-invalid (a FormField with an error does this by itself) */
  invalid?: boolean;
  leftAdornment?: ReactNode;
  rightAdornment?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ invalid = false, leftAdornment, rightAdornment, className, ...rest }, ref) {
  const a11y = useFieldControl({
    id: rest.id,
    invalid,
    required: rest.required,
    'aria-describedby': rest['aria-describedby'],
    'aria-invalid': rest['aria-invalid'],
    'aria-required': rest['aria-required'],
  });
  return (
    <div className={clsx('relative', className)}>
      {leftAdornment && (
        <span className="pointer-events-none absolute inset-y-0 left-[10px] flex items-center text-ds-fg-muted [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:[stroke-width:1.75]">{leftAdornment}</span>
      )}
      <input
        {...rest}
        ref={ref}
        {...a11y}
        className={clsx(fieldClasses(a11y['aria-invalid'] === true), READ_ONLY, 'h-ds-control', leftAdornment ? 'pl-[32px]' : 'pl-[12px]', rightAdornment ? 'pr-[32px]' : 'pr-[12px]')}
      />
      {rightAdornment && (
        <span className="absolute inset-y-0 right-[8px] flex items-center text-ds-fg-muted [&_svg]:h-[16px] [&_svg]:w-[16px] [&_svg]:[stroke-width:1.75]">{rightAdornment}</span>
      )}
    </div>
  );
});
