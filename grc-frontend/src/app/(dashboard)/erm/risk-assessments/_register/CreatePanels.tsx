'use client';

/**
 * The three ways to start an assessment, each a right-hand sheet from the home's "New assessment" menu:
 *   From a framework  the old Framework page's form (framework, name, coverage, a note on which methodology will be used), then the questions are written and the workspace opens;
 *   Blank (manual)    a campaign over risks that already exist in the Risk Register (name, type, method, scope, period, lead assessor);
 *   Import from Excel the old Upload panel, now saying BEFORE it runs that every row becomes a risk in the Risk Register (or uses the register risk of the same title) and AFTER it ran how many.
 * Nothing is sent that the old forms did not send except the lead assessor (the API always took it; no form set it, so "Lead" was empty for every assessment made on screen).
 * A failure is said in words inside the sheet with what to do next; typed text is never lost to a stray Escape (the sheet asks first).
 */
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, ShieldCheck, Sparkles } from 'lucide-react';
import { Button, Checkbox, Combobox, FormField, Notice, Select, Sheet, TextInput, Textarea, useNotify } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { ASSESSMENT_REFRESH, useAssessmentPeople } from './assessmentData';

const SAMPLE_SIZES = [10, 15, 20, 25, 30, 40, 50];
const TYPES: Array<[string, string]> = [['periodic', 'Periodic'], ['annual', 'Annual'], ['ad_hoc', 'Ad hoc'], ['triggered', 'Triggered']];
const METHODS: Array<[string, string]> = [['qualitative', 'Qualitative'], ['quantitative', 'Quantitative'], ['semi_quantitative', 'Semi-quantitative']];

/** What `generation_source` of the answer means for the notice the workspace shows: a methodology, the AI, or the standard template questions. */
export function madeFrom(source: string | null | undefined): 'methodology' | 'ai' | 'template' {
  const s = (source ?? '').toLowerCase();
  return s.startsWith('methodology') ? 'methodology' : s === 'fallback' ? 'template' : 'ai';
}

interface PanelProps { open: boolean; onClose: () => void }

// ── from a framework ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function FrameworkPanel({ open, onClose }: PanelProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const [frameworkId, setFrameworkId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'full' | 'sample'>('full');
  const [count, setCount] = useState('20');
  const [step, setStep] = useState<'idle' | 'creating' | 'writing'>('idle');
  const [failure, setFailure] = useState<{ words: string; madeId: number | null } | null>(null);

  const frameworks = useQuery({
    queryKey: ['erm-available-frameworks'],
    queryFn: async () => (await ermApi.frameworkRiskAssessments.getAvailableFrameworks()).data as Array<{ id: number; name: string; version?: string }>,
    enabled: open,
  });
  const detect = useQuery({
    queryKey: ['framework-methodology-detect', frameworkId],
    queryFn: async () => (await ermApi.frameworkRiskAssessments.detectMethodology(Number(frameworkId))).data,
    enabled: open && !!frameworkId,
  });
  const methodology = detect.data?.methodology ?? null;
  const options = useMemo(() => (frameworks.data ?? []).map((f) => ({ value: String(f.id), label: `${f.name}${f.version ? ` (${f.version})` : ''}` })), [frameworks.data]);
  const dirty = step === 'idle' && (!!frameworkId || !!name.trim() || !!description.trim());
  const busy = step !== 'idle';

  const reset = () => { setFrameworkId(null); setName(''); setDescription(''); setScope('full'); setCount('20'); setStep('idle'); setFailure(null); };
  const close = () => { reset(); onClose(); };

  const generate = async (id: number) => {
    setStep('writing');
    try {
      const res = await ermApi.frameworkRiskAssessments.generateQuestions(id, { count: Number(count) || 20, replace_existing: true, scope: methodology ? scope : undefined });
      const made = madeFrom((res.data as { generation_source?: string }).generation_source);
      ASSESSMENT_REFRESH.forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
      void qc.invalidateQueries({ queryKey: ['framework-risk-assessment', id] });
      notify.success('The questions are written. Assign them from the assessment.', { title: 'Assessment ready' });
      reset();
      onClose();
      router.push(`/erm/risk-assessments/framework/${id}?made=${made}`);
    } catch (e) {
      setStep('idle');
      setFailure({ words: `The assessment was created, but its questions were not written. ${errorMessage(e)}`, madeId: id });
    }
  };

  const submit = async () => {
    if (!frameworkId || busy) return;
    setFailure(null);
    setStep('creating');
    try {
      const created = await ermApi.frameworkRiskAssessments.create({ uploaded_framework_id: Number(frameworkId), name: name.trim() || undefined, description: description.trim() || undefined });
      await generate((created.data as { id: number }).id);
    } catch (e) {
      setStep('idle');
      setFailure({ words: errorMessage(e, 'The assessment could not be created.'), madeId: null });
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New assessment from a framework"
      subtitle="Questions are written from the framework's requirements"
      width="md"
      dirty={dirty}
      closeOnBackdrop={!busy}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!frameworkId} onClick={() => { void submit(); }}>
            {step === 'creating' ? 'Creating…' : step === 'writing' ? 'Writing the questions…' : scope === 'full' || !methodology ? 'Create and write the questions' : `Create with ${count} sampled questions`}
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Framework" required>
          {frameworks.isError
            ? <Notice tone="danger" title="The frameworks could not be loaded" action={<Button onClick={() => { void frameworks.refetch(); }}>Try again</Button>}>{errorMessage(frameworks.error)}</Notice>
            : <Combobox label="Framework" options={options} value={frameworkId} onChange={setFrameworkId} placeholder={frameworks.isPending ? 'Loading…' : 'Choose a framework'} searchPlaceholder="Search frameworks" disabled={busy} />}
        </FormField>

        {frameworkId && (
          <div className="rounded-ds-control border border-ds-border bg-ds-surface-subtle p-[12px]">
            {detect.isPending ? <p className="m-0 text-ds-body text-ds-fg-muted">Checking how this framework is assessed…</p>
              : methodology ? (
                <>
                  <p className="m-0 flex items-center gap-[6px] text-ds-body font-[600] text-ds-fg"><ShieldCheck aria-hidden className="h-[16px] w-[16px] text-ds-primary-text" />{methodology.display_name} will be used</p>
                  <p className="mb-0 mt-[4px] text-ds-label text-ds-fg-muted">{methodology.short_description} One question for each requirement, in {methodology.phases.length} {methodology.phases.length === 1 ? 'phase' : 'phases'}: {methodology.phases.map((p) => p.name).join(', ')}.</p>
                </>
              ) : (
                <p className="m-0 flex items-start gap-[6px] text-ds-body text-ds-fg-body"><Sparkles aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-primary-text" />No assessment method is set for this framework, so the AI writes the questions from its requirements. If the AI is not available, standard questions are used and the assessment says so.</p>
              )}
          </div>
        )}

        <FormField label="Name" optional hint="Left empty, it is named after the framework.">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={255} disabled={busy} placeholder="ISO 27005 risk assessment 2026" />
        </FormField>

        {frameworkId && (
          <div className="grid gap-[12px] sm:grid-cols-2">
            <FormField label="Coverage" info={methodology ? 'Full coverage writes one question for each requirement. A sample writes questions for evenly spaced requirements.' : 'The number of questions the AI writes.'}>
              <Select value={methodology ? scope : 'sample'} onChange={(e) => setScope(e.target.value as 'full' | 'sample')} disabled={busy || !methodology}>
                <option value="full">Full coverage</option>
                <option value="sample">A sample</option>
              </Select>
            </FormField>
            {(scope === 'sample' || !methodology) && (
              <FormField label={methodology ? 'Sample size' : 'Questions'}>
                <Select value={count} onChange={(e) => setCount(e.target.value)} disabled={busy}>{SAMPLE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
              </FormField>
            )}
          </div>
        )}

        <FormField label="Description" optional hint="Scope, business unit, environment: anything the assessors should know.">
          <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
        </FormField>

        {busy && <p role="status" className="m-0 text-ds-body text-ds-fg-muted">{step === 'creating' ? 'Creating the assessment…' : 'Writing the questions. A full framework can take a minute; leave this open.'}</p>}
        {failure && (
          <Notice
            tone="danger"
            title={failure.madeId ? 'Questions were not written' : 'Not created'}
            action={failure.madeId ? (
              <span className="flex flex-wrap gap-[8px]">
                <Button onClick={() => { void generate(failure.madeId as number); }}>Try again</Button>
                <Button onClick={() => { const id = failure.madeId; reset(); onClose(); router.push(`/erm/risk-assessments/framework/${id}`); }}>Open it</Button>
              </span>
            ) : undefined}
          >
            {failure.words}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

// ── a blank (manual) assessment ──────────────────────────────────────────────────────────────────────────────────────────

const BLANK = { name: '', description: '', assessment_type: 'periodic', methodology: 'qualitative', scope: '', start: '', end: '', notes: '', lead: '' };

export function ManualPanel({ open, onClose }: PanelProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const people = useAssessmentPeople();
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(BLANK);
  const close = () => { setF(BLANK); setFailure(null); onClose(); };

  const submit = async () => {
    if (!f.name.trim() || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const body: Record<string, unknown> = { name: f.name.trim(), assessment_type: f.assessment_type, methodology: f.methodology };
      if (f.description.trim()) body.description = f.description.trim();
      if (f.scope.trim()) body.scope = f.scope.trim();
      if (f.start) body.assessment_period_start = f.start;
      if (f.end) body.assessment_period_end = f.end;
      if (f.notes.trim()) body.notes = f.notes.trim();
      if (f.lead) body.lead_assessor_id = Number(f.lead);
      const res = await ermApi.riskAssessments.create(body);
      ASSESSMENT_REFRESH.forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
      notify.success('Add the risks to assess, then start it.', { title: 'Assessment created' });
      const id = (res.data as { id: number }).id;
      setF(BLANK);
      onClose();
      router.push(`/erm/risk-assessments/${id}`);
    } catch (e) {
      setFailure(errorMessage(e, 'The assessment could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New blank assessment"
      subtitle="A campaign over risks that are already in the Risk Register"
      width="md"
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!f.name.trim()} onClick={() => { void submit(); }}>Create assessment</Button>
        </div>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="flex flex-col gap-[16px]">
        <FormField label="Name" required><TextInput value={f.name} onChange={set('name')} maxLength={255} autoComplete="off" /></FormField>
        <FormField label="Description" optional><Textarea rows={2} value={f.description} onChange={set('description')} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Type"><Select value={f.assessment_type} onChange={set('assessment_type')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Method"><Select value={f.methodology} onChange={set('methodology')}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        </div>
        <FormField label="Lead assessor" optional hint="Who answers for it. Shown on the list and in Insights.">
          <Select placeholder="Nobody yet" value={f.lead} onChange={set('lead')}>{(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select>
        </FormField>
        <FormField label="Scope" optional><Textarea rows={2} value={f.scope} onChange={set('scope')} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Period starts" optional><TextInput type="date" value={f.start} onChange={set('start')} /></FormField>
          <FormField label="Period ends" optional><TextInput type="date" value={f.end} onChange={set('end')} /></FormField>
        </div>
        <FormField label="Notes" optional><Textarea rows={2} value={f.notes} onChange={set('notes')} /></FormField>
        {failure && <Notice tone="danger" title="Not created">{failure}</Notice>}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>Create</button>
      </form>
    </Sheet>
  );
}

// ── import from Excel ────────────────────────────────────────────────────────────────────────────────────────────────────

interface ImportResult { assessment_id: number; assessment_name: string; risks_created: number; risks_reused?: number; rows_skipped: number; rows_errored: number; skipped_details: Array<{ row: number; reason: string }>; error_details: Array<{ row: number; error: string }> }

export function ImportPanel({ open, onClose }: PanelProps) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState('ad_hoc');
  const [method, setMethod] = useState('qualitative');
  const [scope, setScope] = useState('');
  const [reuse, setReuse] = useState(true);
  const [picked, setPicked] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const dirty = !result && (!!picked || !!name.trim() || !!scope.trim());
  const reset = () => { setName(''); setType('ad_hoc'); setMethod('qualitative'); setScope(''); setReuse(true); setPicked(null); setFailure(null); setResult(null); if (file.current) file.current.value = ''; };
  const close = () => { reset(); onClose(); };

  const run = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const fd = new FormData();
      fd.append('file', picked);
      if (name.trim()) fd.append('name', name.trim());
      fd.append('assessment_type', type);
      fd.append('methodology', method);
      if (scope.trim()) fd.append('scope', scope.trim());
      fd.append('reuse_existing', String(reuse));
      const res = (await ermApi.riskAssessments.uploadExcel(fd)).data as ImportResult;
      setResult(res);
      ASSESSMENT_REFRESH.forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
      ['erm-risks-lean', 'erm-risks-dashboard', 'erm-risks-heatmap'].forEach((k) => { void qc.invalidateQueries({ queryKey: [k] }); });
      notify.success(`${formatCount(res.risks_created)} new ${res.risks_created === 1 ? 'risk is' : 'risks are'} in the Risk Register.`, { title: 'Workbook imported' });
    } catch (e) {
      setFailure(errorMessage(e, 'The workbook could not be imported.'));
    } finally {
      setBusy(false);
    }
  };

  const problems = (result?.error_details ?? []).slice(0, 8);
  return (
    <Sheet
      open={open}
      onClose={close}
      title="Import an assessment from Excel"
      subtitle="One row for each risk"
      width="md"
      dirty={dirty}
      footer={result ? (
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={close}>Close</Button>
          <Button variant="primary" onClick={() => { const id = result.assessment_id; reset(); onClose(); router.push(`/erm/risk-assessments/${id}`); }}>Open the assessment</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!picked} leftIcon={<FileSpreadsheet aria-hidden />} onClick={() => { void run(); }}>Import the workbook</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {!result && (
          <Notice tone="warning" title="This adds risks to the Risk Register">
            Each row of the workbook becomes a risk in the Risk Register, and is assessed here. {reuse ? 'A row whose title is already in the register uses that risk instead of making a second one.' : 'A row whose title is already in the register is added again as a second risk.'}
          </Notice>
        )}

        <div className="flex flex-col gap-[8px]">
          <input ref={file} type="file" accept=".xlsx,.xls" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => setPicked(e.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button leftIcon={<FileSpreadsheet aria-hidden />} onClick={() => file.current?.click()} disabled={busy || !!result}>{picked ? 'Choose another file' : 'Choose a workbook'}</Button>
            <span className="min-w-0 break-all text-ds-body text-ds-fg-body">{picked ? picked.name : 'An .xlsx or .xls file with a header row'}</span>
          </div>
        </div>

        <FormField label="Name" optional hint="Left empty, it takes the file's name."><TextInput value={name} onChange={(e) => setName(e.target.value)} maxLength={255} disabled={busy || !!result} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Type"><Select value={type} onChange={(e) => setType(e.target.value)} disabled={busy || !!result}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={busy || !!result}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        </div>
        <FormField label="Scope" optional><Textarea rows={2} value={scope} onChange={(e) => setScope(e.target.value)} disabled={busy || !!result} /></FormField>
        <Checkbox label="Use the register risk when a row has the same title as one already there" checked={reuse} onChange={(e) => setReuse(e.target.checked)} disabled={busy || !!result} />

        {failure && <Notice tone="danger" title="Not imported">{failure}</Notice>}
        {result && (
          <Notice tone={result.rows_errored ? 'warning' : 'info'} title={`“${result.assessment_name}” is created`}>
            <p className="m-0">{formatCount(result.risks_created)} new {result.risks_created === 1 ? 'risk was' : 'risks were'} added to the Risk Register{result.risks_reused ? `, and ${formatCount(result.risks_reused)} ${result.risks_reused === 1 ? 'risk that was' : 'risks that were'} already there ${result.risks_reused === 1 ? 'is' : 'are'} assessed here` : ''}.</p>
            {result.rows_skipped > 0 && <p className="m-0">{formatCount(result.rows_skipped)} {result.rows_skipped === 1 ? 'row was' : 'rows were'} skipped (empty, or no title).</p>}
            {result.rows_errored > 0 && (
              <>
                <p className="m-0">{formatCount(result.rows_errored)} {result.rows_errored === 1 ? 'row' : 'rows'} could not be read:</p>
                <ul className="m-0 list-disc pl-[20px]">{problems.map((p) => <li key={p.row} className="break-words">Row {p.row}</li>)}</ul>
                {result.rows_errored > problems.length && <p className="m-0">and {formatCount(result.rows_errored - problems.length)} more.</p>}
              </>
            )}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}
