'use client';

// Raise or change an exception, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The fields are the
// kit's (FormField with TextInput, Textarea, Select); the picker of assets that searches is still MultiSelectDropdown, which the kit has no replacement for
// yet. The document is chosen in _DocumentPicker (any kind of document, with a Type filter); the unit defaults to the document's and says so. The
// requester writes the title, the justification, the business impact, the assets and the period; the potential risks and the compensating controls are
// recorded by the people who judge and carry them out, so the form no longer has boxes for them and never sends them. The AI helpers (_assistOwner.tsx) are
// opt-in, as they always were: nothing is drafted until a button is pressed, and what they write is a draft in this form, saved only by Save. What is
// required, what is sent and how the dates are read are in _logic.ts (formErrors, payloadOf, formFrom).
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { exceptionRulesApi, policyExceptionApi } from '@/lib/api';
import { TYPES_KEY, askOptions, typeChoiceLabel, typeChoices } from '@/lib/exceptionRules';
import { useAutoGrow } from '@/lib/useAutoGrow';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, FormField, MultiSelect, Notice, Select, Textarea, TextInput, useReportedMutation, type TextareaProps } from '@/components/ui/ds';
import { DepartmentSelect } from '@/components/governance/DepartmentSelect';
import { useAdminDepartments } from '@/components/admin/DepartmentForm';
import { isRuled } from './_approval';
import { IMPLEMENTER_NOTE, documentUnitPath, formErrors, payloadOf, resolveDocument, sameForm, unitPlaceholder, type DocRef, type DocumentOption, type ExceptionForm } from './_logic';
import { AssetAssist, DraftAssist, PeriodAssist } from './_assistOwner';
import { DocumentPicker } from './_DocumentPicker';
import { LIST_KEYS, type AssetOption, type ExceptionItem } from './_types';

/** What a query tells the drawer about a list it needs to fill a picker. */
interface Source<T> { data?: T[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }

const IMPLEMENTER_OPTIONS_KEY = ['exception-implementer-options'];

const PRIORITIES = [{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'critical', label: 'Critical' }];

/** The kit's Textarea that grows with its text (to ten lines or 40% of the window, then it scrolls inside). */
function GrowTextarea(props: TextareaProps & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useAutoGrow(ref, props.value);
  return <Textarea ref={ref} rows={3} {...props} />;
}

/** A label for a picker that is not a kit control: names its group, with the (i) beside it. */
function PickerField({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-[4px]">
      <div className="flex items-center gap-[4px]">
        <span id={id} className="text-ds-label text-ds-fg">{label}</span>
        {info && <InfoTip text={info} label={`About ${label.toLowerCase()}`} />}
      </div>
      {children}
    </div>
  );
}

/** A picker's list could not load: say so where the picker is (an empty picker would read as "there are none"). */
function SourceFailed({ what, source }: { what: string; source: Source<unknown> }) {
  return <ErrorState compact title={`Couldn't load the ${what}`} message={errorMessage(source.error)} onRetry={() => { void source.refetch(); }} />;
}

export function ExceptionFormDrawer({ exception, initial, documents, assets, onClose }: {
  /** the exception being changed; null raises a new one */
  exception: ExceptionItem | null;
  /** where the form starts (formFrom for an edit; emptyForm or formForPolicy for a new one): the drawer is dirty when it differs */
  initial: ExceptionForm;
  documents: Source<DocumentOption>;
  assets: Source<AssetOption>;
  onClose: () => void;
}) {
  const editing = exception !== null;
  const [form, setForm] = useState<ExceptionForm>(initial);
  const [picked, setPicked] = useState<DocRef | null>(null);           // the document the person chose in this form (the list may not hold it)
  const [tried, setTried] = useState(false);                          // errors are shown once a save was tried, not while the person is still typing
  const errors = tried ? formErrors(form) : {};
  const set = (patch: Partial<ExceptionForm>) => setForm((f) => ({ ...f, ...patch }));

  const create = useReportedMutation({
    mutationFn: (payload: Record<string, unknown>) => policyExceptionApi.create(payload),
    success: 'Exception created',
    failure: 'Not created',
    retryable: false,                                                  // a second try could make a second exception: the drawer is still open to press Create again
    invalidate: LIST_KEYS,
    onSuccess: onClose,
  });
  const update = useReportedMutation({
    mutationFn: (payload: Record<string, unknown>) => policyExceptionApi.update(exception!.id, payload),
    success: 'Changes saved',
    failure: 'Not saved',
    invalidate: LIST_KEYS,
    onSuccess: onClose,
  });

  const busy = create.isPending || update.isPending;
  const submit = () => {
    setTried(true);
    if (Object.keys(formErrors(form)).length > 0) return;
    if (editing) update.mutate(payloadOf(form, true));
    else create.mutate(payloadOf(form, false));
  };
  const locked = exception !== null && isRuled(exception);                  // it waits under an approval rule: what chose the rule stays as it is
  // the organisation's types: those in use, and the one the exception holds even if it was taken off the list since
  const types = useQuery({ queryKey: TYPES_KEY, queryFn: async () => (await exceptionRulesApi.types()).data, staleTime: 60_000 });
  const typeOptions = typeChoices(types.data?.types ?? [], form.exception_type ? [form.exception_type] : []);
  // who can be chosen to carry it out: people, roles and the unit's owners; a person the exception already names who the list no longer holds stays, so it shows and can be taken off
  const people = useQuery({ queryKey: IMPLEMENTER_OPTIONS_KEY, queryFn: async () => (await policyExceptionApi.implementerOptions()).data, staleTime: 60_000 });
  const implementerChoices = useMemo(() => askOptions(people.data ?? null, exception?.implementer?.people ?? []), [people.data, exception]);
  const daysWrong = errors.implementer && !errors.implementer.startsWith('Choose');

  // the unit the exception will follow when none is chosen: the chosen document's, or what the exception being changed already follows
  const departments = useAdminDepartments();
  const chosen = useMemo(
    () => resolveDocument(form.document_id ? Number(form.document_id) : 0, picked, documents.data ?? [], exception),
    [form.document_id, picked, documents.data, exception],
  );
  const inherited = exception?.department_inherited ? exception.department_path?.join(' › ') ?? '' : '';
  const unitHint = unitPlaceholder(documentUnitPath(chosen, departments.data), inherited);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={editing ? 'Edit exception' : 'New exception'}
      widthClassName="w-[780px] max-w-full"
      dirty={!sameForm(form, initial)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={submit}>{editing ? 'Save changes' : 'Create exception'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {locked && <Notice>Priority, unit, type and document are locked while it waits for approval. Withdraw it to change them.</Notice>}
        <FormField label="Title" required error={errors.title}>
          <TextInput value={form.title} maxLength={500} onChange={(e) => set({ title: e.target.value })} />
        </FormField>
        <PickerField label="Document" info="Any policy, standard, procedure, guideline, charter or framework you can read.">
          <DocumentPicker
            chosen={chosen}
            documents={documents}
            onPick={(doc) => { setPicked(doc); set({ document_id: doc.id }); }}
            onClear={() => { setPicked(null); set({ document_id: '' }); }}
            disabled={locked}
          />
        </PickerField>

        <DraftAssist form={form} setForm={setForm} />

        <FormField label="Justification" required error={errors.justification}>
          <GrowTextarea value={form.justification} placeholder="Why is it needed?" onChange={(e) => set({ justification: e.target.value })} />
        </FormField>
        <FormField label="Business impact" optional info="What refusing the exception would mean for the business.">
          <GrowTextarea value={form.business_impact} placeholder="What happens if it is refused?" onChange={(e) => set({ business_impact: e.target.value })} />
        </FormField>

        <PickerField label="Assets" info="Linked assets' CIA ratings and criticality weight this exception's risk posture; the most critical one drives the score.">
          {assets.isError && !assets.data ? <SourceFailed what="assets" source={assets} /> : (
            <MultiSelectDropdown
              title="Assets"
              items={(assets.data ?? []).map((a) => ({ value: String(a.id), label: a.name, subLabel: [a.criticality, a.asset_type].filter(Boolean).join(' · ') || undefined }))}
              selectedValues={form.asset_ids.map(String)}
              onApply={(values) => set({ asset_ids: values.map(Number) })}
              multiSelect
              triggerVariant="input"
              triggerClassName="w-full"
              size="sm"
              placeholder={assets.isLoading ? 'Loading assets…' : 'Link assets…'}
              forceSearch
            />
          )}
          <AssetAssist form={form} setForm={setForm} />
        </PickerField>

        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Unit" optional info="Defaults to the document's unit. Approval rules follow it.">
            <DepartmentSelect label="Unit" value={String(form.department_id)} onChange={(v) => set({ department_id: v })} disabled={locked}
              placeholder={unitHint} keep={form.department_id ? [Number(form.department_id)] : []} />
          </FormField>
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })} disabled={locked}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </FormField>
        </div>
        {(typeOptions.length > 0 || types.isError) && (
          <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
            <FormField label="Type" optional info="What kind of exception it is. Approval rules may follow it.">
              <Select value={form.exception_type} onChange={(e) => set({ exception_type: e.target.value })} disabled={locked || (types.isError && !form.exception_type)}
                placeholder={types.isError ? "Couldn't load the types" : 'No type'}>
                {typeOptions.map((t) => <option key={t.value} value={t.value}>{typeChoiceLabel(t)}</option>)}
              </Select>
            </FormField>
          </div>
        )}
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Implementer" optional info={IMPLEMENTER_NOTE} error={daysWrong ? undefined : errors.implementer} className="sm:col-span-2">
            {people.isError && !people.data ? <SourceFailed what="people" source={people} /> : (
              <MultiSelect label="Implementer: who carries it out" options={implementerChoices} value={form.implementer_people} onChange={(implementer_people) => set({ implementer_people })}
                display="chips" placeholder={people.isLoading ? 'Loading people…' : 'People, roles or owners'} />
            )}
          </FormField>
          {form.implementer_people.length > 0 && (
            <FormField label="Days to implement" optional error={daysWrong ? errors.implementer : undefined}>
              <TextInput type="number" inputMode="numeric" min={1} max={365} step={1} unit="days" className="w-[168px]" value={form.implementer_days} onChange={(e) => set({ implementer_days: e.target.value })} />
            </FormField>
          )}
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Effective date">
            <TextInput type="date" value={form.effective_date} onChange={(e) => set({ effective_date: e.target.value })} />
          </FormField>
          <FormField label="Expiry date">
            <TextInput type="date" value={form.expiry_date} onChange={(e) => set({ expiry_date: e.target.value })} />
          </FormField>
        </div>
        {!locked && <PeriodAssist form={form} setForm={setForm} />}                {/* it writes the priority too, which is locked while it waits */}
      </div>
    </RightSlidePanel>
  );
}
