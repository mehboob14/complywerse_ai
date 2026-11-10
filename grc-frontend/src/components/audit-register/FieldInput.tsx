'use client';

// One column of a finding as an input, on the kit: the control follows the column's kind (a code list, a list the register keeps, a person, a long text, a date, a number, text). Used by the
// finding's Fields tab, by Add finding and by the report form of Settings, always inside a FormField so the label, the hint and the error belong to it.
import { useId } from 'react';
import { Combobox, Select, TextInput, Textarea, type ListOption } from '@/components/ui/ds';
import { formatDate, formatCount } from '@/lib/format';

export interface FindingField { name: string; label: string; group: string; kind: string; value: unknown; raw?: string | null; edited: boolean }
export interface FindingProfile {
  issue_id: number; code: string | null; title: string; source: string; record_type: string; source_sheet: string | null; source_row: number | null; workflow_state: string | null;
  severity: string | null; owner_id: number | null; owner_name: string | null; layout: string; fields: FindingField[]; edited_fields: string[]; added_in_platform?: boolean;
  links?: FindingLinks;
}
export interface FindingLinks {
  observation: { id: number; code: string; status: string } | null;
  incident: { id: number; title: string; status: string } | null;
  business_unit: { id: number; name: string } | null;
  regulator_status: string | null;
  regulator_statuses: string[];
}
export interface RegisterOptions {
  choices: Record<string, string[]>;
  picks: Record<string, string[]>;
  users: Array<{ id: number; name: string; email: string | null }>;
}

/** The groups a finding's columns are shown in, in the order of the client's sheets. */
export const GROUP_ORDER = ['Where it came from', 'The finding', 'The response', 'Ownership', 'Dates and aging', 'Validation', 'IT finding'];

export const textOf = (value: unknown): string => (value === null || value === undefined ? '' : String(value));

/** A column's value as a person reads it, or null when it is empty. */
export function shownValue(field: Pick<FindingField, 'kind' | 'value'>, options?: RegisterOptions): string | null {
  const v = field.value;
  if (v === null || v === undefined || v === '') return null;
  if (field.kind === 'user') return options?.users.find((u) => u.id === v)?.name ?? null;
  if (field.kind === 'money') return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (field.kind === 'date') return formatDate(String(v), { calendar: true });
  if (field.kind === 'int') return formatCount(Number(v));
  return String(v);
}

export function FieldInput({ field, value, onChange, options, disabled }: {
  field: Pick<FindingField, 'name' | 'label' | 'kind'>; value: unknown; onChange: (v: unknown) => void; options?: RegisterOptions; disabled?: boolean;
}) {
  const listId = useId();
  const text = textOf(value);
  if (field.kind === 'user') {
    const people: ListOption[] = (options?.users || []).map((u) => ({ value: String(u.id), label: u.name, description: u.email || undefined }));
    return (
      <Combobox
        label={field.label} options={people} value={text === '' ? null : text} clearable disabled={disabled}
        placeholder="No owner" searchPlaceholder="Search people"
        onChange={(v) => onChange(v === null ? null : Number(v))}
      />
    );
  }
  if (field.kind === 'choice') {
    const known = options?.choices?.[field.name] || [];
    const all = text && !known.includes(text) ? [text, ...known] : known;          // a code the file used that is not in today's list still shows
    return (
      <Select value={text} disabled={disabled} placeholder="Choose one" onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        {all.map((c) => <option key={c} value={c}>{c}</option>)}
      </Select>
    );
  }
  if (field.kind === 'pick') {
    // the list Settings keeps plus what the register already uses; a value that is not in it is typed in
    const known = options?.picks?.[field.name] || [];
    return (
      <>
        <TextInput value={text} disabled={disabled} list={known.length ? listId : undefined} autoComplete="off" onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />
        {known.length > 0 && <datalist id={listId}>{known.map((c) => <option key={c} value={c} />)}</datalist>}
      </>
    );
  }
  if (field.kind === 'long') return <Textarea value={text} rows={4} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  const type = field.kind === 'date' ? 'date' : field.kind === 'int' || field.kind === 'money' ? 'number' : 'text';
  return (
    <TextInput
      type={type} step={field.kind === 'money' ? '0.01' : field.kind === 'int' ? '1' : undefined} disabled={disabled}
      value={field.kind === 'date' ? text.slice(0, 10) : text}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
