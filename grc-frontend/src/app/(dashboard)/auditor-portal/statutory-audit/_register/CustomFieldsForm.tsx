'use client';

// The organisation's own extra fields of an observation (Settings > Fields), on the kit: whatever it defined, with its label, its choices and its help. The server checks the same rules on
// save and says in words which one it refused; this only makes them visible while typing. Every field type the Settings can define is drawn (the older shared section skipped "person").
import { Checkbox, Combobox, FormField, MultiSelect, Select, Textarea, TextInput } from '@/components/ui/ds';
import { personOptions, useTenantUsers } from '@/components/records/lookups';
import type { FieldDef } from './observationModel';

export function CustomFieldsForm({ fields, values, onChange, disabled = false }: {
  fields: readonly FieldDef[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const people = useTenantUsers(fields.some((f) => f.type === 'user'));
  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });
  const live = fields.filter((f) => !f.archived);
  if (live.length === 0) return null;
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-[12px] rounded-ds-card border border-ds-border p-[12px]">
      <legend className="px-[4px] text-ds-body font-[600] text-ds-fg">Additional fields</legend>
      {live.map((f) => {
        const value = values[f.key];
        const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
        const common = { label: f.label, required: !!f.required, optional: !f.required, hint: f.help || undefined };
        switch (f.type) {
          case 'textarea':
            return <FormField key={f.key} {...common}><Textarea rows={3} value={text} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} /></FormField>;
          case 'number':
            return <FormField key={f.key} {...common}><TextInput type="number" inputMode="decimal" step="any" value={text} disabled={disabled} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} /></FormField>;
          case 'date':
            return <FormField key={f.key} {...common}><TextInput type="date" value={text} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} /></FormField>;
          case 'select':
            return (
              <FormField key={f.key} {...common}>
                <Select value={text} disabled={disabled} placeholder="Not set" onChange={(e) => set(f.key, e.target.value)}>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              </FormField>
            );
          case 'multiselect':
            return (
              <FormField key={f.key} {...common}>
                <MultiSelect label={f.label} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} value={Array.isArray(value) ? (value as string[]) : []} disabled={disabled} placeholder="Not set" onChange={(v) => set(f.key, v)} />
              </FormField>
            );
          case 'checkbox':
            return <div key={f.key}><Checkbox label={f.label} checked={!!value} disabled={disabled} onChange={(e) => set(f.key, e.target.checked)} />{f.help && <p className="mt-[2px] text-ds-label text-ds-fg-muted">{f.help}</p>}</div>;
          case 'user':
            return (
              <FormField key={f.key} {...common}>
                <Combobox label={f.label} options={personOptions(people.data)} value={typeof value === 'string' || typeof value === 'number' ? String(value) : null} clearable disabled={disabled || people.isError}
                  placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'} onChange={(v) => set(f.key, v)} />
              </FormField>
            );
          default:
            return <FormField key={f.key} {...common}><TextInput value={text} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} /></FormField>;
        }
      })}
    </fieldset>
  );
}
