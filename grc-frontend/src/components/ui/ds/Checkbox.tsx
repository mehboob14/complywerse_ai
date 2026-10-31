'use client';

// Checkbox: the browser's own checkbox (accent colour from the tokens) with its label beside it. The label is the click and touch target: its padding
// brings the row up to the control height (32px, 44px on a phone-width window or a coarse pointer) while the box stays 16px. `indeterminate` is the
// "some selected" state of a select-all box (a property, not an attribute: set here after every render, because a click clears it in the DOM).
// With no `label` it is a bare box and the caller names it (aria-label). Same wiring as TextInput; `className` goes on the label, for layout only.
import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useFieldControl } from './FormField';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  indeterminate?: boolean;
  /** aria-invalid (a FormField with an error does this by itself) */
  invalid?: boolean;
}

const BOX = 'h-[16px] w-[16px] shrink-0 cursor-pointer rounded-[4px] accent-ds-primary focus-visible:outline-none focus-visible:shadow-ds-ring disabled:cursor-not-allowed';

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, indeterminate = false, invalid = false, className, ...rest }, ref) {
  const inner = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inner.current as HTMLInputElement);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  });
  const a11y = useFieldControl({
    id: rest.id,
    invalid,
    required: rest.required,
    'aria-describedby': rest['aria-describedby'],
    'aria-invalid': rest['aria-invalid'],
    'aria-required': rest['aria-required'],
  });

  if (label == null || label === false) {
    return <input {...rest} ref={inner} {...a11y} type="checkbox" className={clsx(BOX, 'disabled:opacity-50', className)} />;
  }
  return (
    <label
      className={clsx(
        'inline-flex items-start gap-[8px] py-[calc((var(--ds-control-h)_-_var(--ds-leading-body))/2)] text-ds-body text-ds-fg-body',
        rest.disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className,
      )}
    >
      <input {...rest} ref={inner} {...a11y} type="checkbox" className={clsx(BOX, 'mt-[2px]')} />
      <span className="min-w-0">{label}</span>
    </label>
  );
});
