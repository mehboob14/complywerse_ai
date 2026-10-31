'use client';

// FormField: the label, the required or optional mark, the hint and the error of ONE control, wired together. The control inside it (TextInput,
// Textarea, Select, Checkbox, or your own through useFieldControl) takes its id, aria-describedby, aria-invalid and aria-required from here, so
// nothing is wired by hand:
//
//   <FormField label="Title" required hint="Shown in the library" error={errors.title}>
//     <TextInput value={title} onChange={(e) => setTitle(e.target.value)} />
//   </FormField>
//
// The words are the page's: this only displays `hint` and `error`. The error is a role="alert" paragraph, so it is read out when it appears.
// The field owns the control's id (the label points at it); pass `id` to FormField, not to the control, when the page needs a fixed one.
import { createContext, useContext, useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { InfoTip } from '../InfoTip';
import { controlA11y, describedBy, fieldIds, type ControlA11y, type ControlOwn, type FieldState } from './fieldA11y';

const FieldContext = createContext<FieldState | null>(null);

/** For a control of your own: the id and ARIA attributes the enclosing FormField gives it (the field's, merged with `own`). Works without a FormField. */
export function useFieldControl(own: ControlOwn = {}): ControlA11y {
  return controlA11y(useContext(FieldContext), own);
}

export interface FormFieldProps {
  label: ReactNode;
  /** adds the red * (read out as "required") */
  required?: boolean;
  /** adds "(optional)" after the label; ignored when `required` */
  optional?: boolean;
  /** an explanation that helps the person who wonders, as the (i) beside the label (InfoTip); text that prevents a mistake is a `hint` */
  info?: string;
  hint?: ReactNode;
  /** shown in red under the control; the control is then marked invalid */
  error?: ReactNode;
  /** the id of the control, when the page needs a fixed one (default: generated) */
  id?: string;
  /** layout only (width, margin) */
  className?: string;
  children: ReactNode;
}

export function FormField({ label, required = false, optional = false, info, hint, error, id: chosenId, className, children }: FormFieldProps) {
  const generated = useId();
  const { id, hintId, errorId } = fieldIds(chosenId ?? generated);
  const hasHint = Boolean(hint);
  const hasError = Boolean(error);
  const state: FieldState = { id, describedBy: describedBy(hasHint && hintId, hasError && errorId), invalid: hasError, required };

  const labelEl = (
    <label htmlFor={id} className="relative break-words text-ds-label text-ds-fg">
      {label}
      {required ? (
        <>
          <span aria-hidden="true" className="ml-[2px] text-ds-danger">*</span>
          <span className="sr-only"> (required)</span>
        </>
      ) : optional ? (
        <span className="ml-[4px] font-normal text-ds-fg-muted">(optional)</span>
      ) : null}
    </label>
  );

  return (
    <FieldContext.Provider value={state}>
      <div className={clsx('flex min-w-0 flex-col gap-[4px]', className)}>
        {/* the (i) sits beside the label, not inside it: a press on it must not move focus into the control */}
        {info ? <div className="flex min-w-0 items-center gap-[4px]">{labelEl}<InfoTip text={info} /></div> : labelEl}
        {children}
        {hasHint && <p id={hintId} className="break-words text-ds-label font-normal text-ds-fg-muted">{hint}</p>}
        {hasError && <p id={errorId} role="alert" className="break-words text-ds-label font-normal text-ds-danger">{error}</p>}
      </div>
    </FieldContext.Provider>
  );
}
