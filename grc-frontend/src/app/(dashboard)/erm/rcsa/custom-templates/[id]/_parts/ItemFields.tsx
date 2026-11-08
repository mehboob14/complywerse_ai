'use client';

// The fields of one register item: every column of the workbook, grouped the way the sheet groups them (Risk, Inherent, Residual ...), each with the control its data type asks for (a number,
// a yes or no, a long text or a short one). Used by the item's Fields tab and by the "Add an item" sheet. It holds nothing: the caller owns the values.
import type { ColumnGroup } from '@/lib/rcsa/registerModel';
import { inputKind } from '@/lib/rcsa/registerModel';
import { FormField, Select, TextInput, Textarea } from '@/components/ui/ds';

export function ItemFields({ groups, value, onChange, disabled = false }: { groups: ColumnGroup[]; value: (key: string) => string; onChange: (key: string, next: string) => void; disabled?: boolean }) {
  if (groups.length === 0) return <p className="text-ds-body text-ds-fg-muted">This register has no columns.</p>;
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      {groups.map((g) => (
        <fieldset key={g.key} className="m-0 min-w-0 rounded-ds-card border border-ds-border px-[12px] pb-[12px] pt-[4px]">
          <legend className="px-[4px] text-ds-label font-[600] text-ds-fg-muted [overflow-wrap:anywhere]">{g.label}</legend>
          <div className="grid min-w-0 gap-[12px] sm:grid-cols-2">
            {g.columns.map((c) => {
              const kind = inputKind(c);
              const current = value(c.key);
              const hint = c.sample_values && c.sample_values[0] ? `For example: ${String(c.sample_values[0]).slice(0, 60)}` : undefined;
              return (
                <FormField key={c.key} label={c.label} className={kind === 'long' ? 'sm:col-span-2' : undefined}>
                  {kind === 'yes_no' ? (
                    <Select placeholder="Not set" value={current} disabled={disabled} onChange={(e) => onChange(c.key, e.target.value)}>
                      {['Yes', 'No'].concat(current && current !== 'Yes' && current !== 'No' ? [current] : []).map((o) => <option key={o} value={o}>{o}</option>)}
                    </Select>
                  ) : kind === 'number' ? (
                    <TextInput type="number" inputMode="decimal" value={current} disabled={disabled} onChange={(e) => onChange(c.key, e.target.value)} />
                  ) : kind === 'long' ? (
                    <Textarea rows={3} value={current} disabled={disabled} placeholder={hint} onChange={(e) => onChange(c.key, e.target.value)} />
                  ) : (
                    <TextInput value={current} disabled={disabled} placeholder={hint} onChange={(e) => onChange(c.key, e.target.value)} />
                  )}
                </FormField>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
