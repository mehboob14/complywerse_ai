'use client';

/** A vendor of the organisation, chosen from the third-party register (vendor_ref). The value is the vendor's id; the name shows from the list, else from `refs.vendors`. */
import { useMemo } from 'react';
import { Combobox, type ListOption } from '@/components/ui/ds';
import type { FieldInputProps } from '@/lib/frameworkOnboarding';
import { useVendorOptions } from './lookups';

export default function VendorInput({ id, label, value, onChange, refs, onRefs, readOnly = false, invalid = false }: Pick<FieldInputProps, 'value' | 'onChange' | 'refs' | 'onRefs' | 'readOnly'> & { id: string; label: string; invalid?: boolean }) {
  const { vendors, options } = useVendorOptions();
  const chosen = value === null || value === undefined || value === '' ? null : String(value);
  const choices = useMemo<ListOption[]>(
    () => (chosen && !options.some((o) => o.value === chosen) ? [...options, { value: chosen, label: refs.vendors?.[chosen] ?? 'Removed vendor' }] : options),
    [options, chosen, refs.vendors],
  );
  return (
    <>
      <Combobox
        id={id} label={label} options={choices} value={chosen} clearable invalid={invalid} disabled={readOnly}
        placeholder={vendors.isLoading ? 'Loading…' : 'Choose a vendor'} searchPlaceholder="Search vendors" emptyText="No vendor matches"
        onChange={(v) => {
          onChange(v ? Number(v) : null);
          const name = choices.find((o) => o.value === v)?.label;
          if (v && name) onRefs?.({ vendors: { [v]: name } });
        }}
      />
      {vendors.isError && <span className="block text-ds-label text-ds-danger">Couldn&apos;t load the vendors. Reload the page to try again.</span>}
    </>
  );
}
