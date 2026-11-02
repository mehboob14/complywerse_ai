'use client';

// Select: the browser's own <select> (so the list is native, accessible and works on a phone), drawn on the design-system tokens with a chevron.
// Options are children. `placeholder` adds a first, empty option with that text; it reads grey while it is the one showing. Same wiring and look
// as TextInput (see there); `className` goes on the wrapper, for layout only.
import { forwardRef, type SelectHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useFieldControl } from './FormField';
import { fieldClasses } from './fieldStyles';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** red outline and aria-invalid (a FormField with an error does this by itself) */
  invalid?: boolean;
  /** the text of an empty first option ("Select a department") */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid = false, placeholder, className, children, ...rest }, ref) {
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
      <select
        {...rest}
        ref={ref}
        {...a11y}
        className={clsx(
          fieldClasses(a11y['aria-invalid'] === true),
          'h-ds-control appearance-none truncate pl-[12px] pr-[32px] has-[option[data-placeholder]:checked]:text-ds-fg-muted [&>option]:text-ds-fg',
        )}
      >
        {placeholder !== undefined && <option value="" data-placeholder="">{placeholder}</option>}
        {children}
      </select>
      <ChevronDown aria-hidden="true" strokeWidth={1.75} className="pointer-events-none absolute right-[10px] top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-ds-fg-muted" />
    </div>
  );
});
