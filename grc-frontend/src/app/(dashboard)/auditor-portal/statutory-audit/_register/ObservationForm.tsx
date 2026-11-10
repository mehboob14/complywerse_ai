'use client';

// Register / edit an observation, on the kit's sheet (focus, Escape, "Discard changes?" when something was typed). The same form for both: a new observation takes the organisation's own
// extra fields and an owner; an edit sends only the fields that changed (formModel.changes), so it never writes back what a colleague changed meanwhile, and on a copy of a register
// finding the fields the register owns are read-only with the reason said once at the top. A failed save stays in the sheet in words and the Save button is the retry.
import { useId, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Combobox, FormField, Notice, Select, Sheet, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { personOptions, useTenantUsers } from '@/components/records/lookups';
import { statutoryAuditApi } from '@/lib/api';
import { observationPriority, observationType } from '@/lib/statuses/statutory';
import { CustomFieldsForm } from './CustomFieldsForm';
import { changes, createPayload, draftOf, initialStatus, isDirty, problems, type FormDraft } from './formModel';
import { REFRESH } from './observationData';
import { PRIORITIES, TYPES, lockedField, type Level, type ObservationMeta, type ObservationRow } from './observationModel';
import { MirroredNote } from './parts';

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

export function ObservationForm({ observation, meta, levels, onClose, onSaved }: {
  /** null: a new observation */
  observation: ObservationRow | null;
  meta: ObservationMeta | undefined;
  levels: readonly Level[];
  onClose: () => void;
  /** after the server has confirmed: the saved observation's id */
  onSaved?: (id: number) => void;
}) {
  const isNew = observation === null;
  const mirrored = !!observation?.mirrored;
  const [opened] = useState(() => draftOf(observation));
  const [draft, setDraft] = useState<FormDraft>(opened);
  const [tried, setTried] = useState(false);
  const people = useTenantUsers();
  const ids = useId();
  const set = <K extends keyof FormDraft>(key: K, value: FormDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const locked = (field: string) => lockedField(mirrored, field);

  const save = useReportedMutation({
    mutationFn: async () => {
      const body = isNew ? createPayload(draft, initialStatus(levels)) : changes(opened, draft, mirrored);
      return ((isNew ? await statutoryAuditApi.create(body) : await statutoryAuditApi.update(observation!.id, body)).data) as { id: number };
    },
    success: isNew ? 'Observation registered' : 'Observation saved',
    failure: isNew ? "Couldn't register the observation" : "Couldn't save the observation",
    toast: 'success',                                                          // a failure is said here, in the sheet, once
    retryable: false,
    invalidate: REFRESH,
    onSuccess: (saved) => { onSaved?.(saved.id); onClose(); },
  });

  const dirty = isDirty(opened, draft);
  const wrong = problems(draft);
  const nothingChanged = !isNew && !dirty;
  const submit = () => {
    setTried(true);
    if (wrong.title || wrong.due_date) return;
    save.mutate();
  };

  const suggest = (list: string[] | undefined) => (list ?? []).filter(Boolean);
  const listFor = (name: string, items: string[]) => (
    <datalist id={`${ids}-${name}`}>{items.map((s) => <option key={s} value={s} />)}</datalist>
  );
  const sources = useMemo(() => suggest(meta?.regulator_sources), [meta]);
  const periods = useMemo(() => suggest(meta?.audit_periods), [meta]);
  const categories = useMemo(() => suggest(meta?.categories), [meta]);

  return (
    <Sheet
      open
      onClose={onClose}
      dirty={dirty}
      width="lg"
      title={isNew ? 'New observation' : 'Edit observation'}
      subtitle={isNew ? 'A regulator requirement, finding or audit observation to follow to closure' : [observation!.code, observation!.title].filter(Boolean).join(' · ')}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" leftIcon={isNew ? <Plus aria-hidden /> : undefined} loading={save.isPending} disabled={nothingChanged} onClick={submit}>
            {isNew ? 'Register observation' : 'Save changes'}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {mirrored && <MirroredNote issueId={observation!.mirrored_issue_id} compact />}
        {save.isError && <Notice tone="danger" title={isNew ? "The observation wasn't registered" : "The changes weren't saved"}>{errorMessage(save.error)} Nothing you typed is lost: fix it and save again.</Notice>}

        <FormField label="Title" required error={tried ? wrong.title : undefined}>
          <TextInput value={draft.title} maxLength={500} autoFocus={isNew} disabled={locked('title')} onChange={(e) => set('title', e.target.value)} placeholder="Strengthen the AML transaction monitoring thresholds" />
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} value={draft.description} disabled={locked('description')} onChange={(e) => set('description', e.target.value)} />
        </FormField>
        <div className={ROW2}>
          <FormField label="Type">
            <Select value={draft.observation_type} onChange={(e) => set('observation_type', e.target.value)}>
              {TYPES.map((t) => <option key={t} value={t}>{observationType.label(t)}</option>)}
            </Select>
          </FormField>
          <FormField label="Priority">
            <Select value={draft.priority} disabled={locked('priority')} onChange={(e) => set('priority', e.target.value)}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{observationPriority.label(p)}</option>)}
            </Select>
          </FormField>
          <FormField label="Regulator or source" optional>
            <TextInput list={`${ids}-sources`} value={draft.regulator_source} maxLength={120} disabled={locked('regulator_source')} onChange={(e) => set('regulator_source', e.target.value)} placeholder="SBP, SAMA, the external auditor" autoComplete="off" />
            {listFor('sources', sources)}
          </FormField>
          <FormField label="Reference" optional>
            <TextInput value={draft.regulation_reference} maxLength={255} disabled={locked('regulation_reference')} onChange={(e) => set('regulation_reference', e.target.value)} placeholder="Circular or clause" />
          </FormField>
          <FormField label="Period" optional>
            <TextInput list={`${ids}-periods`} value={draft.audit_period} maxLength={120} disabled={locked('audit_period')} onChange={(e) => set('audit_period', e.target.value)} placeholder="FY2025, Q1 2026" autoComplete="off" />
            {listFor('periods', periods)}
          </FormField>
          <FormField label="Due date" optional error={tried ? wrong.due_date : undefined}>
            <TextInput type="date" value={draft.due_date} disabled={locked('due_date')} onChange={(e) => set('due_date', e.target.value)} />
          </FormField>
          <FormField label="Category" optional hint="Groups related observations: a circular, an inspection, a theme.">
            <TextInput list={`${ids}-categories`} value={draft.category} maxLength={120} disabled={locked('category')} onChange={(e) => set('category', e.target.value)} placeholder="IFPD circular, Inspection" autoComplete="off" />
            {listFor('categories', categories)}
          </FormField>
          <FormField label="Area" optional>
            <TextInput value={draft.area_domain} maxLength={255} disabled={locked('area_domain')} onChange={(e) => set('area_domain', e.target.value)} placeholder="AML, IT, Credit" />
          </FormField>
        </div>
        <FormField label="Owner" optional>
          <Combobox label="Owner" options={personOptions(people.data)} value={draft.owner} clearable disabled={locked('owner_id') || people.isError} placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'} onChange={(v) => set('owner', v)} />
        </FormField>
        <FormField label="Management response" optional>
          <Textarea rows={3} value={draft.management_response} disabled={locked('management_response')} onChange={(e) => set('management_response', e.target.value)} />
        </FormField>
        <FormField label="Notes" optional>
          <Textarea rows={3} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </FormField>
        <CustomFieldsForm fields={meta?.custom_fields ?? []} values={draft.custom} onChange={(next) => set('custom', next)} />
      </div>
    </Sheet>
  );
}
