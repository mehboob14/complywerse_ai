'use client';

// The two things the Shared tab starts: Publish (snapshot a supplier's active assessment into a reusable shared assessment) and Import (pre-fill an assessment's questionnaire from a shared assessment, by
// token or from a package downloaded from another organisation). Both pick the supplier from the full list (a supplier with nothing to publish from is shown, disabled, with the reason), say what the
// server refused in plain words at the top of the sheet, and keep what was typed. The buyer always re-scores with their own engine: the sheet says so.
import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Combobox, FormError, FormField, Notice, Sheet, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { SHARED_KEY } from '../../_lib/questionnairesApi';
import { importPlan, pickerNote, vendorChoices } from '../../_lib/questionnaires/sharedModel';
import { SENT_REFRESH, useVendorOptions } from '../_sent/sentApi';

function SupplierField({ open, value, onChange, hint }: { open: boolean; value: string | null; onChange: (v: string | null) => void; hint: string }) {
  const options = useVendorOptions(open, true);
  const items = options.data?.items ?? [];
  const note = options.data ? pickerNote(options.data.total, items.length) : null;
  return (
    <>
      <FormField label="Supplier" required hint={note ?? hint}>
        <Combobox
          label="Supplier" searchable options={vendorChoices(items, { needAssessment: true })} value={value} onChange={onChange}
          placeholder={options.isPending ? 'Loading suppliers…' : 'Choose a supplier'} searchPlaceholder="Search suppliers" emptyText="No supplier matches"
          disabled={options.isPending || options.isError}
        />
      </FormField>
      {options.isError && <Notice tone="danger" title="Couldn't load the suppliers" action={<Button size="sm" onClick={() => { void options.refetch(); }}>Retry</Button>}>{errorMessage(options.error)}</Notice>}
      {options.data && items.length === 0 && <Notice tone="info">No supplier has an active assessment yet. Start one from the supplier&apos;s page.</Notice>}
    </>
  );
}

export function PublishSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const uid = useId();
  const [vendor, setVendor] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);
  const options = useVendorOptions(open, true);
  const chosen = useMemo(() => (options.data?.items ?? []).find((v) => String(v.id) === vendor), [options.data, vendor]);
  useEffect(() => { if (open) { setVendor(null); setProblem(null); } }, [open]);

  const publish = useReportedMutation({
    mutationFn: async () => {
      if (!chosen?.active_assessment_id) throw new Error('This supplier has no active assessment to publish.');
      return (await tpraApi.publishShared(chosen.active_assessment_id)).data;
    },
    success: () => `Shared: ${chosen?.name ?? 'the assessment'}`,
    failure: "Couldn't share the assessment",
    toast: 'success',
    retryable: false,                                              // a publish makes a new shared assessment each time
    invalidate: [[SHARED_KEY]],
    onSuccess: () => onClose(),
    onError: (e) => setProblem(e),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Publish a shared assessment"
      subtitle="Snapshot a supplier's active assessment, with its answers, evidence count and validation, into a record others can reuse."
      width="md"
      dirty={open && vendor !== null}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" loading={publish.isPending} disabled={!vendor}>Publish</Button>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (vendor && !publish.isPending) { setProblem(null); publish.mutate(); } }}>
        <FormError title="Couldn't share the assessment" error={problem} />
        <SupplierField open={open} value={vendor} onChange={setVendor} hint="Only suppliers with an active assessment can be published." />
      </form>
    </Sheet>
  );
}

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const uid = useId();
  const [target, setTarget] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [pasted, setPasted] = useState('');
  const [problem, setProblem] = useState<unknown>(null);
  const options = useVendorOptions(open, true);
  const chosen = useMemo(() => (options.data?.items ?? []).find((v) => String(v.id) === target), [options.data, target]);
  useEffect(() => { if (open) { setTarget(null); setToken(''); setPasted(''); setProblem(null); } }, [open]);

  const run = useReportedMutation({
    mutationFn: async () => {
      const plan = importPlan({ target: chosen?.active_assessment_id ?? null, token, pasted });
      if (!plan.ok) throw new Error(plan.problem);
      return (await tpraApi.importShared(chosen?.active_assessment_id as number, plan.body)).data as { responses: number; note: string };
    },
    success: (d) => ({ title: `Imported ${d.responses} ${d.responses === 1 ? 'answer' : 'answers'}`, message: d.note }),
    failure: "Couldn't import the answers",
    toast: 'success',
    retryable: false,
    invalidate: SENT_REFRESH,
    onSuccess: () => onClose(),
    onError: (e) => setProblem(e),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Import into an assessment"
      subtitle="Answers are pre-filled onto the supplier's active assessment. Run scoring there to work out your own residual."
      width="md"
      dirty={open && (target !== null || token !== '' || pasted !== '')}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form={`${uid}-form`} variant="primary" loading={run.isPending} disabled={!target}>Import and pre-fill</Button>
        </div>
      )}
    >
      <form id={`${uid}-form`} className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (target && !run.isPending) { setProblem(null); run.mutate(); } }}>
        <FormError title="Couldn't import the answers" error={problem} />
        <SupplierField open={open} value={target} onChange={setTarget} hint="The supplier whose active assessment gets the answers." />
        <FormField label="Share token" optional hint="From a shared assessment of this organisation. It wins over a pasted package.">
          <TextInput value={token} onChange={(e) => setToken(e.target.value)} placeholder="Paste a share token" autoComplete="off" />
        </FormField>
        <FormField label="Or a portable package" optional hint="The file downloaded from another organisation's shared assessment.">
          <Textarea rows={5} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the whole package" />
        </FormField>
      </form>
    </Sheet>
  );
}
