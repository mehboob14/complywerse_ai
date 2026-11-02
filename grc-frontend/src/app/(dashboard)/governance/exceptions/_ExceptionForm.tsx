'use client';

// Raise or change an exception, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The fields are the
// kit's (FormField with TextInput, Textarea, Select); the two pickers that search (the policy, the assets) are still MultiSelectDropdown, which the kit has
// no replacement for yet. A save is reported by useReportedMutation: said only after the server answered, with the server's words when it refused, and
// the drawer stays open with everything typed. AI Assist is opt-in, as it was: nothing is drafted until it is pressed. What is required, what is sent and
// how the dates are read are in _logic.ts (formErrors, payloadOf, formFrom).
import { useId, useRef, useState, type ReactNode } from 'react';
import { Sparkles } from 'lucide-react';
import { policyExceptionApi } from '@/lib/api';
import { useAutoGrow } from '@/lib/useAutoGrow';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, FormField, Select, Textarea, TextInput, useReportedMutation, type TextareaProps } from '@/components/ui/ds';
import { formErrors, payloadOf, sameForm, type ExceptionForm } from './_logic';
import { toEditableText } from './_text';
import { LIST_KEYS, type AssetOption, type ExceptionItem, type PolicyOption } from './_types';

/** What a query tells the drawer about a list it needs to fill a picker. */
interface Source<T> { data?: T[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown }

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

export function ExceptionFormDrawer({ exception, initial, policies, assets, onClose }: {
  /** the exception being changed; null raises a new one */
  exception: ExceptionItem | null;
  /** where the form starts (formFrom for an edit; emptyForm or formForPolicy for a new one): the drawer is dirty when it differs */
  initial: ExceptionForm;
  policies: Source<PolicyOption>;
  assets: Source<AssetOption>;
  onClose: () => void;
}) {
  const editing = exception !== null;
  const [form, setForm] = useState<ExceptionForm>(initial);
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
  const draft = useReportedMutation({
    mutationFn: async (v: { title: string; document_id: number }) =>
      (await policyExceptionApi.suggestContent(v)).data as { justification?: string; risk_assessment?: string; compensating_controls?: string },
    success: { title: 'Details drafted', message: 'Check them before you save. Anything you wrote was kept.' },
    failure: "Couldn't draft the details",
    onSuccess: (data) => setForm((prev) => ({                          // what is already written is kept
      ...prev,
      justification: prev.justification.trim() ? prev.justification : toEditableText(data.justification),
      risk_assessment: prev.risk_assessment.trim() ? prev.risk_assessment : toEditableText(data.risk_assessment),
      compensating_controls: prev.compensating_controls.trim() ? prev.compensating_controls : toEditableText(data.compensating_controls),
    })),
  });

  const busy = create.isPending || update.isPending;
  const submit = () => {
    setTried(true);
    if (Object.keys(formErrors(form)).length > 0) return;
    if (editing) update.mutate(payloadOf(form, true));
    else create.mutate(payloadOf(form, false));
  };
  const policyId = form.document_id ? Number(form.document_id) : 0;

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
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Title" required error={errors.title}>
            <TextInput value={form.title} maxLength={500} onChange={(e) => set({ title: e.target.value })} />
          </FormField>
          <PickerField label="Policy">
            {policies.isError && !policies.data ? <SourceFailed what="policies" source={policies} /> : (
              <MultiSelectDropdown
                title="Policy"
                items={(policies.data ?? []).map((d) => ({ value: String(d.id), label: d.title, subLabel: d.document_code || d.doc_type }))}
                selectedValues={form.document_id ? [String(form.document_id)] : []}
                onApply={(values) => set({ document_id: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                size="sm"
                placeholder={policies.isLoading ? 'Loading policies…' : 'Select a policy…'}
                forceSearch
              />
            )}
          </PickerField>
        </div>

        {!editing && (
          <div className="flex items-center gap-1">
            <Button leftIcon={<Sparkles aria-hidden />} loading={draft.isPending} disabled={!policyId || !form.title.trim()}
              onClick={() => draft.mutate({ title: form.title.trim(), document_id: policyId })}>
              {draft.isPending ? 'Drafting…' : 'AI Assist'}
            </Button>
            <InfoTip label="About AI Assist" text="Select a policy and enter a title, then AI Assist fills in suggested details. Anything you already wrote is kept." />
            <span role="status" className="sr-only">{draft.isPending ? 'AI is drafting suggestions' : ''}</span>
          </div>
        )}

        <FormField label="Justification" required error={errors.justification}>
          <GrowTextarea value={form.justification} placeholder="Why is it needed?" onChange={(e) => set({ justification: e.target.value })} />
        </FormField>
        <FormField label="Potential risks">
          <GrowTextarea value={form.risk_assessment} placeholder="What could go wrong?" onChange={(e) => set({ risk_assessment: e.target.value })} />
        </FormField>
        <FormField label="Compensating controls">
          <GrowTextarea value={form.compensating_controls} placeholder="What covers the gap?" onChange={(e) => set({ compensating_controls: e.target.value })} />
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
        </PickerField>

        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Effective date">
            <TextInput type="date" value={form.effective_date} onChange={(e) => set({ effective_date: e.target.value })} />
          </FormField>
          <FormField label="Expiry date">
            <TextInput type="date" value={form.expiry_date} onChange={(e) => set({ expiry_date: e.target.value })} />
          </FormField>
        </div>
      </div>
    </RightSlidePanel>
  );
}
