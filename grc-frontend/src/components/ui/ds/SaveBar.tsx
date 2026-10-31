'use client';

// SaveBar: the strip a form that saves as a whole keeps at the bottom of the page (it sticks there while the page scrolls under it).
//
//   <SaveBar label="Save the settings" canEdit={canEdit} dirty={dirty} invalid={invalid} saving={save.isPending}
//            justSaved={savedAt !== null} error={serverError} onSave={() => save.mutate()} onDiscard={reset} />
//
// It says one thing at a time ("Unsaved changes", "Fix the fields in red to save", what the server refused with, "Saved") and offers Discard and Save
// only while there is something to save. A person who cannot change the form (canEdit false) never sees it. The rules are in saveBarModel.ts; the
// words of the buttons are the platform's (`saveLabel` and `discardLabel` change them). The line is a polite live region and the bar a named region.
// When Save goes through, the buttons leave and focus would fall to the page: it is moved to the line ("Saved") instead, so a keyboard or screen-reader
// user is not sent back to the top.
import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { Button } from './Button';
import { saveBarState, type SaveBarInput, type SaveBarTone } from './saveBarModel';

export interface SaveBarProps extends SaveBarInput {
  onSave: () => void;
  onDiscard: () => void;
  /** names the bar's region for a screen reader ("Save the settings") */
  label: string;
  /** default "Save" */
  saveLabel?: string;
  /** default "Discard" */
  discardLabel?: string;
}

const TEXT: Record<SaveBarTone, string> = {
  neutral: 'text-ds-fg-body',
  danger: 'text-ds-danger',
  success: 'text-ds-success',
};

export function SaveBar({ onSave, onDiscard, label, saveLabel = 'Save', discardLabel = 'Discard', ...input }: SaveBarProps) {
  const state = saveBarState(input);
  const line = useRef<HTMLParagraphElement>(null);
  const hadButtons = useRef(state.actions);

  useEffect(() => {
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (hadButtons.current && !state.actions && (!active || active === document.body)) line.current?.focus({ preventScroll: true });
    hadButtons.current = state.actions;
  }, [state.actions]);

  if (!state.show) return null;
  return (
    <div className="sticky bottom-[12px] z-10">
      <div
        role="region"
        aria-label={label}
        className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border-strong bg-ds-surface px-[16px] py-[10px] shadow-ds-pop sm:flex-row sm:items-center sm:justify-between"
      >
        <p ref={line} tabIndex={-1} aria-live="polite" className={clsx('min-w-0 break-words text-ds-body focus-visible:outline-none', TEXT[state.tone])}>
          {state.tone === 'success' && <Check aria-hidden strokeWidth={1.75} className="mr-[6px] inline h-[16px] w-[16px] align-[-3px]" />}
          {state.text}
        </p>
        {state.actions && (
          <div className="flex shrink-0 gap-[8px]">
            <Button onClick={onDiscard} disabled={state.discardDisabled}>{discardLabel}</Button>
            <Button variant="primary" onClick={onSave} loading={state.saveBusy} disabled={state.saveDisabled} leftIcon={<Check aria-hidden />}>{saveLabel}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
