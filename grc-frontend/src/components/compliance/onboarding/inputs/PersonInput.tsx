'use client';

/**
 * A person: someone on the platform (chosen from the people of the organisation) or someone outside (a name, an email, their organisation). The value is
 * `{user_id}` or `{name, email?, organisation?}`. The three boxes of an outside person are held here until they say who: an email with no name is not sent
 * (the server refuses a person with no name, and that would stop every other save on the page).
 */
import { useEffect, useMemo, useState } from 'react';
import { Combobox, SegmentedControl, TextInput, type ListOption } from '@/components/ui/ds';
import type { FieldInputProps } from '@/lib/frameworkOnboarding';
import { draftOfPerson, personFromDraft, personKind, type PersonDraft } from '../fieldModel';
import { usePeopleOptions } from './lookups';
import { useDraft } from './useDraft';

const KINDS = [{ value: 'user', label: 'On the platform' }, { value: 'outside', label: 'Outside' }] as const;

const asOutside = (d: PersonDraft, v: unknown): boolean => {
  const mine = personFromDraft(d);
  if (mine === 'incomplete') return true;                                    // being typed: kept as it is
  if (mine === null) return personKind(v) !== 'outside';
  return personKind(v) === 'outside' && JSON.stringify(mine) === JSON.stringify(personFromDraft(draftOfPerson(v)));
};

export default function PersonInput({ id, label, value, onChange, refs, onRefs, readOnly = false, invalid = false }: Pick<FieldInputProps, 'value' | 'onChange' | 'refs' | 'onRefs' | 'readOnly'> & { id: string; label: string; invalid?: boolean }) {
  const kind = personKind(value);
  const [mode, setMode] = useState<'user' | 'outside'>(kind ?? 'user');
  useEffect(() => { if (kind) setMode(kind); }, [kind]);
  const { people, options } = usePeopleOptions();
  const [draft, setDraft] = useDraft<PersonDraft, unknown>(value, draftOfPerson, asOutside);

  const userId = kind === 'user' ? String((value as { user_id: number | string }).user_id) : null;
  const choices = useMemo<ListOption[]>(
    () => (userId && !options.some((o) => o.value === userId) ? [...options, { value: userId, label: refs.users?.[userId] ?? 'Unknown person' }] : options),
    [options, userId, refs.users],
  );

  const edit = (patch: Partial<PersonDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const person = personFromDraft(next);
    if (person !== 'incomplete') onChange(person);
  };
  const pickKind = (next: string) => {
    setMode(next as 'user' | 'outside');
    if (kind && kind !== next) onChange(null);
  };

  return (
    <div role="group" aria-label={label} className="space-y-[8px]">
      {!readOnly && <SegmentedControl label={`${label}: where the person is`} name={`${id}-kind`} options={KINDS} value={mode} onChange={pickKind} />}
      {mode === 'user' ? (
        <>
          <Combobox
            id={`${id}-user`} label={label} options={choices} value={userId} clearable invalid={invalid} disabled={readOnly}
            placeholder={people.isLoading ? 'Loading…' : 'Choose a person'} searchPlaceholder="Search people"
            onChange={(v) => {
              onChange(v ? { user_id: Number(v) } : null);
              const name = choices.find((o) => o.value === v)?.label;
              if (v && name) onRefs?.({ users: { [v]: name } });
            }}
          />
          {people.isError && <span className="block text-ds-label text-ds-danger">Couldn&apos;t load the people. Reload the page to try again.</span>}
        </>
      ) : (
        <div className="grid grid-cols-1 gap-[8px] sm:grid-cols-3">
          <TextInput aria-label={`${label}: name`} placeholder="Name" value={draft.name} maxLength={200} readOnly={readOnly} invalid={invalid} autoComplete="off" onChange={(e) => edit({ name: e.target.value })} />
          <TextInput aria-label={`${label}: email`} placeholder="Email" type="email" value={draft.email} maxLength={200} readOnly={readOnly} autoComplete="off" onChange={(e) => edit({ email: e.target.value })} />
          <TextInput aria-label={`${label}: organisation`} placeholder="Organisation" value={draft.organisation} maxLength={200} readOnly={readOnly} autoComplete="off" onChange={(e) => edit({ organisation: e.target.value })} />
        </div>
      )}
      {mode === 'outside' && personFromDraft(draft) === 'incomplete' && <span className="block text-ds-label text-ds-fg-muted">Add a name to save this person.</span>}
    </div>
  );
}
