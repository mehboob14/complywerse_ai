'use client';

// MultiSelect: choose several values from a list. A button that says what is chosen ("3 selected", or the first two as chips and "+N") and opens a popover
// of options with checkboxes, a search box when the list is long, and "Select all" / "Clear". The popover is drawn on the window (a table, a card or a
// dialog cannot clip it) and the whole thing works from the keyboard: see SelectPopover.tsx for the keys and listboxModel.ts for the rules (tested).
// It is the kit's version of the legacy MultiSelectDropdown, which the library, projects, committees and exceptions still use.
//
//   <FormField label="Status"><MultiSelect label="Status" options={STATUSES} value={status} onChange={setStatus} placeholder="All statuses" /></FormField>
//   <MultiSelect showLabel label="Type" options={TYPES} value={types} onChange={setTypes} placeholder="Type" />       // in a filter bar: "Type: Policy"
import { SelectEngine, type SelectBaseProps } from './SelectPopover';
import type { SelectDisplay } from './listboxModel';

export interface MultiSelectProps extends SelectBaseProps {
  /** the values chosen, in the order they were chosen; a value with no option (the options have not loaded) is shown as it is */
  value: readonly string[];
  /** the whole choice after a change: a new array */
  onChange: (value: string[]) => void;
  /** how the button shows several: "3 selected" (count, the default) or the first two as chips and "+N" */
  display?: SelectDisplay;
}

export function MultiSelect({ value, onChange, display, ...rest }: MultiSelectProps) {
  return <SelectEngine {...rest} multiple selected={value} onChoose={onChange} display={display} />;
}
