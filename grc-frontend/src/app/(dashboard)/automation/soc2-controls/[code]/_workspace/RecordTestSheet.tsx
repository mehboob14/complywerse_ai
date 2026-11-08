'use client';

// Record a test: a SAMPLED test (the server draws the sample, the tester records a result for each item, concludes, and someone signs it off) or a QUICK RESULT (type, result, how many were
// looked at, how many failed). A test in progress opens at its samples; a concluded one at its summary with Sign off; a signed-off one is the locked audit record and only readable. The rules the
// server enforces are checked here first, in its own words (testRunModel.ts), so a refusal is rare and a message is plain.
import { useEffect, useMemo, useState } from 'react';
import { Check, ShieldCheck } from 'lucide-react';
import { Button, FormField, Notice, SegmentedControl, Select, Sheet, StatusPill, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { automationApi } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { testResult, testRun } from '@/lib/statuses/controls';
import { Body, Loaded, Pair, Small } from './parts';
import type { TestingRecord, TestRecord } from './types';
import {
  RESULT_WORDS, SELECTION_WORDS, STEP_WORDS, canConclude, concludeProblem, emptyQuick, emptyStart, inProgress, isQuickResult, progress, quickBody, quickProblem, sampleProblem, signOffNote,
  sizeHint, startBody, startProblem, supported, testLine, type QuickForm, type Selection, type StartForm, type StepResult, type TestResult, type TestRow,
} from './testRunModel';
import { useTesting } from './workspaceData';
import { useWorkspace } from './workspaceContext';

const CADENCES = ['', 'monthly', 'quarterly', 'semi_annually', 'annually'] as const;
const RESULTS = Object.keys(RESULT_WORDS) as TestResult[];

type Target = number | 'new' | null;

// ── one sample ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function SampleLine({ s, locked, can, saving, onSave }: { s: TestRecord['samples'][number]; locked: boolean; can: boolean; saving: boolean; onSave: (result: StepResult | '', note: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(s.note ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setNote(s.note ?? ''); }, [s.note]);
  const off = locked || !can || saving;
  const choose = (r: StepResult) => {
    if (r === 'exception') { setAsking(true); return; }
    setAsking(false);
    onSave(r, note);
  };
  return (
    <li className="px-[12px] py-[8px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <span className="w-[28px] text-ds-label tabular-nums text-ds-fg-muted">{s.seq}.</span>
        <span className="min-w-0 flex-1 basis-[10rem] break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{s.item_ref || `Item ${s.seq}`}</span>
        <div role="group" aria-label={`Result for sample ${s.seq}`} className="flex flex-wrap gap-[4px]">
          {(['pass', 'exception', 'not_applicable'] as StepResult[]).map((r) => (
            <Button key={r} size="sm" variant={s.result === r ? 'primary' : 'secondary'} aria-pressed={s.result === r} disabled={off} onClick={() => choose(r)}>{STEP_WORDS[r]}</Button>
          ))}
          {s.result && !locked && <Button size="sm" variant="ghost" disabled={off} onClick={() => { setAsking(false); onSave('', ''); }}>Clear</Button>}
        </div>
      </div>
      {s.result === 'exception' && s.note && !asking && <Small className="mt-[4px] pl-[36px]">{`Exception: ${s.note}`}</Small>}
      {asking && (
        <div className="mt-[6px] flex flex-col gap-[6px] pl-[36px]">
          <FormField label="Describe the exception" required error={problem}>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} />
          </FormField>
          <div className="flex gap-[8px]">
            <Button size="sm" variant="primary" loading={saving} onClick={() => { const p = sampleProblem('exception', note); setProblem(p); if (!p) { onSave('exception', note); setAsking(false); } }}>Record the exception</Button>
            <Button size="sm" onClick={() => { setAsking(false); setProblem(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
}

// ── a test in progress, concluded, or signed off ─────────────────────────────────────────────────────────────────────────────────────
function TestWork({ t, onGone }: { t: TestRecord; onGone: () => void }) {
  const { code, rights, why, me, refresh } = useWorkspace();
  const { confirm, confirmDialog } = useConfirm();
  const row = t as unknown as TestRow;
  const sampled = !isQuickResult(row);
  const pr = progress(t.samples);
  const sug = supported(t.samples, t.tolerable_exceptions);
  const [final, setFinal] = useState<TestResult | ''>('');
  const [rationale, setRationale] = useState('');
  const [findings, setFindings] = useState(t.findings ?? '');
  const [recs, setRecs] = useState(t.recommendations ?? '');
  const [mgmt, setMgmt] = useState(t.management_response ?? '');
  const [shown, setShown] = useState<string | null>(null);
  const [edit, setEdit] = useState<QuickForm>({ test_type: t.test_type, result: (t.result ?? 'effective') as TestResult, sample: t.sample_size == null ? '' : String(t.sample_size), exceptions: String(t.exceptions_found ?? 0), findings: t.findings ?? '', frequency: '' });
  const done = () => { void refresh(); };
  const locked = t.locked || t.status === 'reviewed';

  const record = useReportedMutation({
    mutationFn: (v: { id: number; result: StepResult | ''; note: string }) => automationApi.recordSample(code, v.id, { result: v.result, note: v.note }),
    toast: 'errors', failure: "Couldn't record the result", onSuccess: done,
  });
  const conclude = useReportedMutation({
    mutationFn: () => automationApi.concludeTest(code, t.id, { result: final || undefined, conclusion_rationale: rationale.trim() || undefined, findings, recommendations: recs, management_response: mgmt }),
    success: { title: 'Test concluded', message: 'It now waits for someone to sign it off.' }, failure: "Couldn't conclude the test", toast: 'success', onSuccess: done,
  });
  const reopen = useReportedMutation({
    mutationFn: () => automationApi.reopenTest(code, t.id), success: 'Test reopened', failure: "Couldn't reopen the test", onSuccess: done,
  });
  const sign = useReportedMutation({
    mutationFn: () => automationApi.signOffTest(code, t.id),
    success: { title: 'Test signed off', message: 'It is locked as the audit record and the control’s assurance status is updated.' }, failure: "Couldn't sign off the test", onSuccess: done,
  });
  const drop = useReportedMutation({
    mutationFn: () => automationApi.deleteTest(code, t.id), success: 'Test deleted', failure: "Couldn't delete the test", onSuccess: () => { done(); onGone(); },
  });
  const fix = useReportedMutation({
    mutationFn: () => automationApi.editTest(code, t.id, { test_type: edit.test_type, result: edit.result, sample_size: quickBody(edit).sample_size, exceptions_found: quickBody(edit).exceptions_found, findings: edit.findings.trim() }),
    success: 'Test corrected', failure: "Couldn't correct the test", toast: 'success', onSuccess: done,
  });

  const askSign = async () => {
    const note = signOffNote(row, me);
    const yes = await confirm({ title: 'Sign off this test?', message: `This test (${testLine(row).toLowerCase()}) is locked as the audit record and cannot be changed. ${note ?? 'It will count towards the control’s assurance status.'}`, confirmLabel: 'Sign off' });
    if (yes) sign.mutate();
  };
  const askDelete = async () => {
    const yes = await confirm({ title: 'Delete this test?', message: `This test (${testLine(row).toLowerCase()}) and what was recorded on it go. It was never signed off, so nothing audited is lost.`, confirmLabel: 'Delete test', tone: 'danger' });
    if (yes) drop.mutate();
  };
  const tryConclude = () => {
    const p = concludeProblem(sug, final || null, rationale);
    setShown(p);
    if (!p) conclude.mutate();
  };
  const selfNote = signOffNote(row, me);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusPill {...statusPill(testRun, t.status)} />
        {t.result && <StatusPill {...statusPill(testResult, t.result)} />}
        <Small>{`${testLine(row)} · ${formatDate(t.test_date)}${t.tester ? ` · tested by ${t.tester}` : ''}`}</Small>
      </div>
      {locked && <Notice tone="info" title="Signed off">{`${t.reviewer ? `${t.reviewer} signed this off` : 'This was signed off'}${t.independent_review === false ? ' (not independent: the tester reviewed their own test)' : ''}. It is the audit record and cannot be changed. Start a new test to retest.`}</Notice>}

      {sampled && (
        <section aria-label="Samples" className="rounded-ds-card border border-ds-border bg-ds-surface">
          <div className="flex flex-wrap items-center justify-between gap-[8px] border-b border-ds-border px-[12px] py-[8px]">
            <p className="text-ds-body font-[600] text-ds-fg">Samples</p>
            <Small>{`${pr.done} of ${pr.total} recorded${pr.exceptions ? ` · ${pr.exceptions} ${pr.exceptions === 1 ? 'exception' : 'exceptions'}` : ''}`}</Small>
          </div>
          <ol className="divide-y divide-ds-border">
            {t.samples.map((s) => <SampleLine key={s.id} s={s} locked={t.status !== 'in_progress'} can={rights.testing} saving={record.isPending && record.variables?.id === s.id} onSave={(result, note) => record.mutate({ id: s.id, result, note })} />)}
          </ol>
        </section>
      )}

      {t.status === 'in_progress' && sampled && (
        <section aria-label="Conclude" className="flex flex-col gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <p className="text-ds-body font-[600] text-ds-fg">Conclude the test</p>
          {!canConclude(row) ? <Small>{`Record a result for every sample first${pr.open ? `: ${pr.open} still to do` : ''}.`}</Small> : (
            <>
              <Body>{`The samples support “${RESULT_WORDS[sug as TestResult].toLowerCase()}”.`}</Body>
              <FormField label="Your conclusion" hint="Leave as it is to accept what the samples support.">
                <Select value={final || (sug as string)} onChange={(e) => setFinal(e.target.value as TestResult)}>{RESULTS.map((r) => <option key={r} value={r}>{RESULT_WORDS[r]}</option>)}</Select>
              </FormField>
              {(final && final !== sug) && <FormField label="Why this conclusion" required><Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} rows={3} maxLength={4000} /></FormField>}
              <FormField label="Findings" optional><Textarea value={findings} onChange={(e) => setFindings(e.target.value)} rows={2} maxLength={8000} /></FormField>
              <FormField label="Recommendations" optional><Textarea value={recs} onChange={(e) => setRecs(e.target.value)} rows={2} maxLength={8000} /></FormField>
              <FormField label="Management response" optional><Textarea value={mgmt} onChange={(e) => setMgmt(e.target.value)} rows={2} maxLength={8000} /></FormField>
              {shown && <Notice tone="danger">{shown}</Notice>}
              <div><Button variant="primary" leftIcon={<Check aria-hidden />} loading={conclude.isPending} disabled={!rights.testing} title={why('testing')} onClick={tryConclude}>Conclude the test</Button></div>
            </>
          )}
        </section>
      )}

      {t.status === 'completed' && (
        <section aria-label="This test" className="flex flex-col gap-[10px]">
          <div className="grid gap-[10px] sm:grid-cols-2">
            <Pair label="Result">{t.result ? RESULT_WORDS[t.result as TestResult] : '—'}</Pair>
            <Pair label="Exceptions">{String(t.exceptions_found ?? 0)}</Pair>
          </div>
          {t.conclusion_rationale && <Pair label="Why">{t.conclusion_rationale}</Pair>}
          {t.findings && <Pair label="Findings"><Body>{t.findings}</Body></Pair>}
          {!sampled && (
            <details className="rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
              <summary className="cursor-pointer text-ds-body font-[600] text-ds-fg">Correct this result</summary>
              <div className="mt-[10px]"><QuickFields f={edit} onChange={setEdit} cadence={false} /></div>
              <div className="mt-[10px]"><Button variant="primary" loading={fix.isPending} disabled={!rights.testing || quickProblem(edit) != null} title={why('testing') ?? quickProblem(edit) ?? undefined} onClick={() => fix.mutate()}>Save the correction</Button></div>
            </details>
          )}
          {selfNote && <Notice tone="warning">{selfNote}</Notice>}
          <div className="flex flex-wrap gap-[8px]">
            <Button variant="primary" leftIcon={<ShieldCheck aria-hidden />} loading={sign.isPending} disabled={!rights.signOff} title={why('signOff')} onClick={() => { void askSign(); }}>Sign off</Button>
            {sampled && <Button loading={reopen.isPending} disabled={!rights.testing} title={why('testing')} onClick={() => reopen.mutate()}>Reopen the samples</Button>}
          </div>
        </section>
      )}

      {!locked && <div><Button variant="dangerOutline" loading={drop.isPending} disabled={!rights.testing} title={why('testing')} onClick={() => { void askDelete(); }}>Delete this test</Button></div>}
      {confirmDialog}
    </div>
  );
}

// ── the quick fields (a quick result, and its correction) ────────────────────────────────────────────────────────────────────────────
function QuickFields({ f, onChange, cadence }: { f: QuickForm; onChange: (f: QuickForm) => void; cadence: boolean }) {
  return (
    <div className="grid gap-[10px] sm:grid-cols-2">
      <FormField label="Kind of test"><Select value={f.test_type} onChange={(e) => onChange({ ...f, test_type: e.target.value as 'design' | 'operating' })}><option value="operating">Operating</option><option value="design">Design</option></Select></FormField>
      <FormField label="Result"><Select value={f.result} onChange={(e) => onChange({ ...f, result: e.target.value as TestResult })}>{RESULTS.map((r) => <option key={r} value={r}>{RESULT_WORDS[r]}</option>)}</Select></FormField>
      <FormField label="How many were looked at" optional><TextInput inputMode="numeric" value={f.sample} onChange={(e) => onChange({ ...f, sample: e.target.value })} /></FormField>
      <FormField label="How many failed"><TextInput inputMode="numeric" value={f.exceptions} onChange={(e) => onChange({ ...f, exceptions: e.target.value })} /></FormField>
      {cadence && <FormField label="Retest" className="sm:col-span-2" hint="Sets when the next test is due."><Select value={f.frequency} onChange={(e) => onChange({ ...f, frequency: e.target.value })} placeholder="No schedule">{CADENCES.filter(Boolean).map((c) => <option key={c} value={c}>{statusLabel(c)}</option>)}</Select></FormField>}
      <FormField label="Findings" optional className="sm:col-span-2"><Textarea value={f.findings} onChange={(e) => onChange({ ...f, findings: e.target.value })} rows={3} maxLength={8000} /></FormField>
    </div>
  );
}

// ── starting ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function NewTest({ record, onStarted, onClose }: { record: TestingRecord; onStarted: (id: number | null) => void; onClose: () => void }) {
  const { code, rights, why, refresh } = useWorkspace();
  const [kind, setKind] = useState<'sampled' | 'quick'>('sampled');
  const [f, setF] = useState<StartForm>(emptyStart());
  const [q, setQ] = useState<QuickForm>(emptyQuick(null));
  const [shown, setShown] = useState<string | null>(null);
  const sizes = record.sampling?.sizes ?? {};
  const recommended = f.frequency ? sizes[f.frequency] ?? null : null;
  const frequencyLabel = record.sampling?.frequencies.find((x) => x.value === f.frequency)?.label ?? null;

  const start = useReportedMutation({
    mutationFn: () => automationApi.startTest(code, startBody(f)).then((r) => r.data as TestingRecord),
    success: { title: 'Test started', message: 'The sample is drawn. Record a result for each item.' }, failure: "Couldn't start the test", toast: 'success',
    onSuccess: (rec) => { void refresh(); onStarted(inProgress(rec.tests as unknown as TestRow[])?.id ?? null); },
  });
  const quick = useReportedMutation({
    mutationFn: () => automationApi.recordTest(code, quickBody(q)),
    success: { title: 'Test recorded', message: 'Ask someone to sign it off when it is ready.' }, failure: "Couldn't record the test", toast: 'success',
    onSuccess: () => { void refresh(); onClose(); },
  });
  const off = !rights.testing;
  const go = () => {
    const p = kind === 'sampled' ? startProblem(f, recommended) : quickProblem(q);
    setShown(p);
    if (p) return;
    if (kind === 'sampled') start.mutate(); else quick.mutate();
  };
  const error = shown ?? (start.isError ? start.error.message : quick.isError ? quick.error.message : null);

  return (
    <div className="flex flex-col gap-[14px]">
      <SegmentedControl label="How to record it" name="ws-test-kind" options={[{ value: 'sampled', label: 'Run a sampled test' }, { value: 'quick', label: 'Quick result' }]} value={kind} onChange={(v) => { setKind(v); setShown(null); }} />
      {kind === 'sampled' ? (
        <>
          <Small>{f.test_type === 'design' ? 'A design test is one walkthrough: does the control, as designed, meet its objective?' : 'An operating test draws a sample from the items the control handled, and you record a result for each.'}</Small>
          <FormField label="Kind of test"><SegmentedControl label="Kind of test" name="ws-test-type" options={[{ value: 'operating', label: 'Operating' }, { value: 'design', label: 'Design' }]} value={f.test_type} onChange={(v) => setF({ ...f, test_type: v })} /></FormField>
          {f.test_type === 'operating' && (
            <>
              <FormField label="How often does the control operate?" hint={sizeHint(recommended, frequencyLabel)}>
                <Select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} placeholder="Choose">{(record.sampling?.frequencies ?? []).map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>
              </FormField>
              <FormField label="The items to draw from">
                <SegmentedControl label="How the items are given" name="ws-test-population" options={[{ value: 'count', label: 'A number' }, { value: 'items', label: 'A list' }]} value={f.populationMode} onChange={(v) => setF({ ...f, populationMode: v })} />
              </FormField>
              {f.populationMode === 'count'
                ? <FormField label="How many items were there?"><TextInput inputMode="numeric" value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} className="max-w-[200px]" /></FormField>
                : <FormField label="The items, one a line" hint="Ticket numbers, user names, change references."><Textarea value={f.items} onChange={(e) => setF({ ...f, items: e.target.value })} rows={5} /></FormField>}
              <div className="grid gap-[10px] sm:grid-cols-2">
                <FormField label="How the sample is drawn"><Select value={f.selection} onChange={(e) => setF({ ...f, selection: e.target.value as Selection })}>{(Object.keys(SELECTION_WORDS) as Selection[]).map((s) => <option key={s} value={s}>{SELECTION_WORDS[s]}</option>)}</Select></FormField>
                <FormField label="Sample size" optional hint={recommended ? `${recommended} recommended` : undefined}><TextInput inputMode="numeric" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })} placeholder={recommended ? String(recommended) : ''} /></FormField>
              </div>
              <FormField label="Exceptions you can tolerate" hint="With none, one exception makes the control ineffective."><TextInput inputMode="numeric" value={f.tolerable} onChange={(e) => setF({ ...f, tolerable: e.target.value })} className="max-w-[120px]" /></FormField>
            </>
          )}
          <FormField label="What is being tested" optional><TextInput value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={2000} /></FormField>
        </>
      ) : (
        <>
          <Small>For a test done elsewhere: record its result, how many were looked at and how many failed.</Small>
          <QuickFields f={q} onChange={setQ} cadence />
        </>
      )}
      {error && <Notice tone="danger" title="Check this first">{error}</Notice>}
      <div className="flex gap-[8px]">
        <Button variant="primary" loading={start.isPending || quick.isPending} disabled={off} title={why('testing')} onClick={go}>{kind === 'sampled' ? 'Start the test' : 'Record the result'}</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

export function RecordTestSheet({ target, onTarget, onClose }: { target: Target; onTarget: (t: Target) => void; onClose: () => void }) {
  const { code } = useWorkspace();
  const open = target !== null;
  const q = useTesting(code, open);
  const test = useMemo(() => (typeof target === 'number' ? q.data?.tests.find((t) => t.id === target) : undefined), [q.data, target]);
  return (
    <Sheet open={open} onClose={onClose} title={target === 'new' ? 'Record a test' : 'Test'} subtitle={code} width="lg">
      {open && (
        <Loaded q={q} what="the tests" rows={4}>
          {(rec) => (target === 'new'
            ? <NewTest record={rec} onStarted={(id) => onTarget(id ?? null)} onClose={onClose} />
            : test ? <TestWork key={test.id} t={test} onGone={onClose} /> : <Notice tone="warning">This test is no longer there.</Notice>)}
        </Loaded>
      )}
    </Sheet>
  );
}
