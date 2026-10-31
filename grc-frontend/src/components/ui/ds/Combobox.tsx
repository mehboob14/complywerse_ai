'use client';

// Combobox: choose one value from a list that may be long. A button that says what is chosen and opens a popover of options with a search box (from
// more than 8 options, or when `searchable`). Choosing an option closes the list and gives focus back to the button. Same popover, keys and rules as
// MultiSelect (see SelectPopover.tsx and listboxModel.ts); the kit's version of the single-choice legacy MultiSelectDropdown (an owner or a sponsor picker).
//
//   <FormField label="Owner" required><Combobox label="Owner" options={PEOPLE} value={owner} onChange={setOwner} placeholder="Choose an owner" /></FormField>
import { SelectEngine, type SelectBaseProps } from './SelectPopover';

export interface ComboboxProps extends SelectBaseProps {
  /** the value chosen, or null for none; a value with no option (the options have not loaded) is shown as it is */
  value: string | null;
  /** the value chosen, or null when it was cleared */
  onChange: (value: string | null) => void;
  /** choosing the chosen option again clears it: for a field that may stay empty */
  clearable?: boolean;
}

export function Combobox({ value, onChange, clearable, ...rest }: ComboboxProps) {
  return <SelectEngine {...rest} multiple={false} selected={value === null ? [] : [value]} onChoose={(next) => onChange(next[0] ?? null)} clearable={clearable} />;
}
