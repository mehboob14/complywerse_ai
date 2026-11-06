'use client';

/**
 * The input for one field of framework onboarding or the organisation profile, whatever its type (lib/frameworkOnboarding.ts `FieldInputProps`): a text box,
 * a growing text area, a number, a date, a Yes/No, a choice (segments for a few short answers, else a list), ticks, a country picker, a person, a table of
 * rows (each cell is this same input), assets from the library, a vendor, rows picked from the organisation profile, or the department tree. `onChange` gets
 * the NEW WHOLE value of the field; the caller saves it. The label is the caller's (FieldBlock): a single control takes `id`, so a label points at it; a group
 * of controls is a `role="group"` named by the field's label. The error shows under the input, and the input is marked invalid and described by it.
 */
import { useId, useMemo, useRef, useState } from 'react';
import { Checkbox, Combobox, MultiSelect, SegmentedControl, Select, Textarea, TextInput, type ListOption } from '@/components/ui/ds';
import { useAutoGrow } from '@/lib/useAutoGrow';
import type { Column, Field, FieldInputProps } from '@/lib/frameworkOnboarding';
import { COUNTRIES, countryChoices } from './countries';
import { choiceLayout, fromYesNo, parseNumberText, toggleOption, toYesNo, withSaved } from './fieldModel';
import AssetsInput from './inputs/AssetsInput';
import OrgPickInput, { DerivedDepartments } from './inputs/OrgPickInput';
import PersonInput from './inputs/PersonInput';
import TableInput from './inputs/TableInput';
import VendorInput from './inputs/VendorInput';

/** What every control of a field is given. */
interface Control {
  field: Field | Column;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  label: string;
  readOnly: boolean;
  invalid: boolean;
  describedBy: string | undefined;
  required: boolean;
}

const YES_NO = [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] as const;
const BASE_COUNTRIES: ListOption[] = COUNTRIES.map((c) => ({ value: c, label: c }));
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function TextControl({ field, value, onChange, id, readOnly, invalid, describedBy, required }: Control) {
  const listId = `${id}-suggestions`;
  const suggestions = field.suggestions ?? [];
  return (
    <>
      <TextInput
        id={id} value={typeof value === 'string' ? value : ''} maxLength={500} readOnly={readOnly} invalid={invalid} aria-describedby={describedBy} aria-required={required || undefined}
        list={suggestions.length > 0 ? listId : undefined} autoComplete="off" onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
      {suggestions.length > 0 && <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>}
    </>
  );
}

function LongTextControl({ value, onChange, id, readOnly, invalid, describedBy, required }: Control) {
  const box = useRef<HTMLTextAreaElement>(null);
  const text = typeof value === 'string' ? value : '';
  useAutoGrow(box, text);
  return <Textarea ref={box} id={id} rows={3} value={text} readOnly={readOnly} invalid={invalid} aria-describedby={describedBy} aria-required={required || undefined} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)} />;
}

function NumberControl({ field, value, onChange, id, readOnly, invalid, describedBy, required }: Control) {
  // the box keeps what is typed ("1.", "-") until it is a number; the page gets numbers only
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (typeof value === 'number' ? String(value) : '');
  return (
    <TextInput
      id={id} type="number" inputMode="decimal" min={'min' in field ? field.min : undefined} value={shown} readOnly={readOnly} invalid={invalid} aria-describedby={describedBy} aria-required={required || undefined}
      onWheel={(e) => e.currentTarget.blur()} onBlur={() => setTyped(null)}
      onChange={(e) => {
        setTyped(e.target.value);
        const n = parseNumberText(e.target.value);
        if (n !== undefined) onChange(n);
      }}
    />
  );
}

/** Radios drawn as segments. Pressing the chosen one again clears the answer (for a yes/no or a choice that may stay unanswered). */
function Segments({ label, name, options, value, onChange, disabled }: { label: string; name: string; options: readonly { value: string; label: string }[]; value: string; onChange: (v: string | null) => void; disabled: boolean }) {
  return (
    <div onClick={(e) => { const t = e.target; if (!disabled && t instanceof HTMLInputElement && t.value === value) onChange(null); }}>
      <SegmentedControl label={label} name={name} options={options} value={value} onChange={onChange} disabled={disabled} />
    </div>
  );
}

function BoolControl({ value, onChange, id, label, readOnly }: Control) {
  return <Segments label={label} name={id} options={YES_NO} value={toYesNo(value)} onChange={(v) => onChange(fromYesNo(v ?? ''))} disabled={readOnly} />;
}

function ChoiceControl({ field, value, onChange, id, label, readOnly, invalid, describedBy, required }: Control) {
  const own = field.options ?? [];
  const options = withSaved(own, [value]);
  const current = typeof value === 'string' ? value : '';
  if (choiceLayout(own) === 'segmented') {
    return <Segments label={label} name={id} options={options.map((o) => ({ value: o, label: o }))} value={current} onChange={(v) => onChange(v)} disabled={readOnly} />;
  }
  return (
    <Select id={id} placeholder="Choose" value={current} disabled={readOnly} invalid={invalid} aria-describedby={describedBy} aria-required={required || undefined} onChange={(e) => onChange(e.target.value || null)}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </Select>
  );
}

function MultiControl({ field, value, onChange, label, readOnly }: Control) {
  const options = withSaved(field.options ?? [], strings(value));
  const chosen = strings(value);
  return (
    <div role="group" aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-[16px]">
      {options.map((o) => <Checkbox key={o} label={o} checked={chosen.includes(o)} disabled={readOnly} onChange={(e) => onChange(toggleOption(options, chosen, o, e.target.checked))} />)}
    </div>
  );
}

function CountryControl({ value, onChange, id, label, readOnly, invalid }: Control) {
  const current = typeof value === 'string' && value ? value : null;
  const options = useMemo(() => (current && !COUNTRIES.includes(current) ? countryChoices([current]).map((c) => ({ value: c, label: c })) : BASE_COUNTRIES), [current]);
  return <Combobox id={id} label={label} options={options} value={current} onChange={onChange} clearable searchable placeholder="Choose a country" searchPlaceholder="Search countries" emptyText="No country matches" disabled={readOnly} invalid={invalid} />;
}

function CountriesControl({ value, onChange, id, label, readOnly, invalid }: Control) {
  const chosen = strings(value);
  const options = useMemo(() => countryChoices(chosen).map((c) => ({ value: c, label: c })), [chosen.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  return <MultiSelect id={id} label={label} options={options} value={chosen} onChange={onChange} display="chips" searchable placeholder="Choose countries" searchPlaceholder="Search countries" emptyText="No country matches" disabled={readOnly} invalid={invalid} />;
}

export default function FieldInput(props: FieldInputProps) {
  const { field, value, onChange, error, readOnly = false, refs, onRefs, orgRows, departments } = props;
  const auto = useId();
  const id = props.id ?? auto;
  const errorId = error ? `${id}-error` : undefined;
  const required = 'level' in field ? field.level === 'required' : Boolean(field.required);
  const c: Control = { field, value, onChange, id, label: field.label, readOnly, invalid: Boolean(error), describedBy: errorId, required };

  let control;
  switch (field.type) {
    case 'text': control = <TextControl {...c} />; break;
    case 'longtext': control = <LongTextControl {...c} />; break;
    case 'number': control = <NumberControl {...c} />; break;
    case 'date': control = <TextInput id={id} type="date" value={typeof value === 'string' ? value.slice(0, 10) : ''} readOnly={readOnly} invalid={c.invalid} aria-describedby={errorId} aria-required={required || undefined} onChange={(e) => onChange(e.target.value || null)} />; break;
    case 'bool': control = <BoolControl {...c} />; break;
    case 'choice': control = <ChoiceControl {...c} />; break;
    case 'multichoice': control = <MultiControl {...c} />; break;
    case 'country': control = <CountryControl {...c} />; break;
    case 'countries': control = <CountriesControl {...c} />; break;
    case 'person': control = <PersonInput id={id} label={field.label} value={value} onChange={onChange} refs={refs} onRefs={onRefs} readOnly={readOnly} invalid={c.invalid} />; break;
    case 'vendor_ref': control = <VendorInput id={id} label={field.label} value={value} onChange={onChange} refs={refs} onRefs={onRefs} readOnly={readOnly} invalid={c.invalid} />; break;
    case 'asset_refs': control = <AssetsInput id={id} label={field.label} value={value} onChange={onChange} refs={refs} onRefs={onRefs} readOnly={readOnly} />; break;
    case 'org_pick': control = <OrgPickInput id={id} label={field.label} field={field} value={value} onChange={onChange} refs={refs} onRefs={onRefs} readOnly={readOnly} orgRows={orgRows} departments={departments} />; break;
    case 'departments_derived': control = <DerivedDepartments label={field.label} value={value} departments={departments} />; break;
    case 'table':
      control = (
        <TableInput
          id={id} label={field.label} field={field} value={value} onChange={onChange} readOnly={readOnly}
          cell={(column, cellValue, set, cellId) => (
            <FieldInput field={column} value={cellValue} onChange={set} id={cellId} readOnly={readOnly} refs={refs} onRefs={onRefs} orgRows={orgRows} departments={departments} />
          )}
        />
      );
      break;
    default: control = null;
  }

  return (
    <div className="min-w-0 space-y-[4px]">
      {control}
      {error && <p id={errorId} role="alert" className="break-words text-ds-label font-normal text-ds-danger">{error}</p>}
    </div>
  );
}
