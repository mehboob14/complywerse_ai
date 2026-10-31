'use client';

// Textarea: a multi-line field, same wiring and look as TextInput (see there). With `maxLength` it shows how much of it is used ("123 / 500"),
// controlled or not; the counter is a polite live region. The browser enforces the limit. `className` goes on the wrapper, for layout only.
import { forwardRef, useState, type ChangeEvent, type TextareaHTMLAttributes } from 'react';
import { clsx } from 'clsx';
import { useFieldControl } from './FormField';
import { READ_ONLY, fieldClasses } from './fieldStyles';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** red outline and aria-invalid (a FormField with an error does this by itself) */
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid = false, rows = 3, maxLength, className, onChange, ...rest }, ref) {
  const a11y = useFieldControl({
    id: rest.id,
    invalid,
    required: rest.required,
    'aria-describedby': rest['aria-describedby'],
    'aria-invalid': rest['aria-invalid'],
    'aria-required': rest['aria-required'],
  });
  const [typed, setTyped] = useState(() => String(rest.defaultValue ?? '').length);        // used while the page does not hold the value
  const used = rest.value !== undefined ? String(rest.value).length : typed;
  const change = (e: ChangeEvent<HTMLTextAreaElement>) => {
    setTyped(e.target.value.length);
    onChange?.(e);
  };
  return (
    <div className={className}>
      <textarea
        {...rest}
        ref={ref}
        {...a11y}
        rows={rows}
        maxLength={maxLength}
        onChange={change}
        className={clsx(fieldClasses(a11y['aria-invalid'] === true), READ_ONLY, 'min-h-ds-control resize-y px-[12px] py-[6px]')}
      />
      {maxLength !== undefined && (
        <p aria-live="polite" aria-atomic="true" className="mt-[4px] text-right text-ds-label font-normal tabular-nums text-ds-fg-muted">{used} / {maxLength}</p>
      )}
    </div>
  );
});
