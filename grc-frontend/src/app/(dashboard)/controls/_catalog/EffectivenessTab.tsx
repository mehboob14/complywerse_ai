'use client';

// The drawer's Design and effectiveness tab: how the control's design and its operation were last rated, when the next test is due, and the history of tests (record one, edit one, sign one off,
// delete one). A sign-off is asked first and says whose name it records; a signed-off test that the Assurance tab locked answers an edit or a delete with the server's own sentence.
import { useState } from 'react';
import { CalendarClock, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, FormField, Notice, Select, StatusPill, TextInput, Textarea, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { parseUtc } from '@/lib/serverTime';
import { testResult } from '@/lib/statuses/controls';
import { WB, type RefreshKeys } from './catalogData';
import { CADENCES, EFFECTIVENESS, daysWords, scheduleOf, type ControlDetail, type ControlTest } from './catalogModel';

const RESULTS = EFFECTIVENESS.filter((w) => w !== 'not_tested');
const TYPES = [['design', 'Design'], ['operating', 'Operating']] as const;
const resultLabel = (w: string) => statusPill(testResult, w).label;

interface FormState { test_type: string; result: string; sample_size: string; exceptions_found: string; findings: string; frequency: string }
const BLANK: FormState = { test_type: 'operating', result: 'effective', sample_size: '25', exceptions_found: '0', findings: '', frequency: 'quarterly' };
const fromTest = (t: ControlTest): FormState => ({
  test_type: t.test_type || 'operating', result: t.result || 'effective', sample_size: String(t.sample_size ?? 0), exceptions_found: String(t.exceptions_found ?? 0), findings: t.findings || '', frequency: '',
});
const num = (v: string): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };

function TestForm({ value, onChange, withCadence }: { value: FormState; onChange: (next: FormState) => void; withCadence: boolean }) {
  const set = (k: keyof FormState, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
      <FormField label="Test type"><Select value={value.test_type} onChange={(e) => set('test_type', e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
      <FormField label="Result"><Select value={value.result} onChange={(e) => set('result', e.target.value)}>{RESULTS.map((r) => <option key={r} value={r}>{resultLabel(r)}</option>)}</Select></FormField>
      <FormField label="Sample size"><TextInput type="number" min={0} inputMode="numeric" value={value.sample_size} onChange={(e) => set('sample_size', e.target.value)} /></FormField>
      <FormField label="Exceptions found"><TextInput type="number" min={0} inputMode="numeric" value={value.exceptions_found} onChange={(e) => set('exceptions_found', e.target.value)} /></FormField>
      {withCadence && (
        <FormField label="Repeat" hint="Sets the control's test schedule: the next test is due after this long." className="sm:col-span-2">
          <Select value={value.frequency} onChange={(e) => set('frequency', e.target.value)}>{CADENCES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select>
        </FormField>
      )}
      <FormField label="Findings" optional className="sm:col-span-2"><Textarea rows={3} value={value.findings} onChange={(e) => set('findings', e.target.value)} /></FormField>
    </div>
  );
}

export function EffectivenessTab({ d, keys }: { d: ControlDetail; keys: RefreshKeys }) {
  const { confirm, confirmDialog } = useConfirm();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<FormState>(BLANK);
  const [editId, setEditId] = useState<number | null>(null);
  const [edit, setEdit] = useState<FormState>(BLANK);
  const [editError, setEditError] = useState<string | null>(null);
  const schedule = scheduleOf(d.next_test_date, new Date(), parseUtc);

  const add = useReportedMutation({
    mutationFn: () => apiClient.post(`${WB}/items/${d.work_item_id}/tests`, { test_type: form.test_type, result: form.result, sample_size: num(form.sample_size), exceptions_found: num(form.exceptions_found), findings: form.findings, frequency: form.frequency }),
    success: { title: 'Test recorded', message: 'The control’s effectiveness and its next test date are updated.' },
    failure: "Couldn't record the test",
    invalidate: keys,
    onSuccess: () => { setAdding(false); setForm(BLANK); },
  });
  const review = useReportedMutation({
    mutationFn: (id: number) => apiClient.post(`${WB}/tests/${id}/review`, { action: 'reviewed' }),
    success: { title: 'Test signed off', message: 'It now shows you as its reviewer.' },
    failure: "Couldn't sign off the test",
    invalidate: keys,
  });
  const save = useReportedMutation({
    mutationFn: (id: number) => apiClient.patch(`${WB}/tests/${id}`, { test_type: edit.test_type, result: edit.result, sample_size: num(edit.sample_size), exceptions_found: num(edit.exceptions_found), findings: edit.findings }),
    success: { title: 'Test saved', message: 'The control’s effectiveness follows the latest test of each type.' },
    failure: "Couldn't save the test",
    toast: 'success',
    onError: (e) => setEditError(errorMessage(e)),
    invalidate: keys,
    onSuccess: () => { setEditId(null); setEditError(null); },
  });
  const remove = useReportedMutation({
    mutationFn: (id: number) => apiClient.delete(`${WB}/tests/${id}`),
    success: { title: 'Test deleted', message: 'The control’s effectiveness follows the tests that remain.' },
    failure: "Couldn't delete the test",
    toast: 'success',
    onError: (e) => setEditError(errorMessage(e)),
    invalidate: keys,
    onSuccess: () => { setEditId(null); setEditError(null); },
  });

  const signOff = async (t: ControlTest) => {
    const ok = await confirm({
      title: 'Sign off this test?',
      message: `It records you as the reviewer of the ${t.test_type} test of ${formatDate(t.test_date)}. If you ran the test yourself, it is not an independent review.`,
      confirmLabel: 'Sign off',
    });
    if (ok) review.mutate(t.id);
  };
  const askDelete = async (t: ControlTest) => {
    const ok = await confirm({ title: 'Delete this test?', message: `The ${t.test_type} test of ${formatDate(t.test_date)} is removed from the history. This cannot be undone.`, confirmLabel: 'Delete test', tone: 'danger' });
    if (ok) remove.mutate(t.id);
  };
  const scheduleLine = schedule.state === 'none'
    ? 'No test schedule yet. Record a test with a repeat to schedule the next one.'
    : `${schedule.state === 'overdue' ? 'Test overdue: it was due' : 'Next test due'} ${formatDate(d.next_test_date)} (${daysWords(schedule.days)})${d.frequency ? ` · repeats ${d.frequency.replace(/_/g, ' ')}` : ''}`;

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px]">
        {([['Design effectiveness', d.design_effectiveness], ['Operating effectiveness', d.operating_effectiveness]] as const).map(([label, word]) => (
          <div key={label} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
            <p className="m-0 text-ds-label text-ds-fg-muted">{label}</p>
            <div className="mt-[4px]"><StatusPill {...statusPill(testResult, word || 'not_tested')} /></div>
          </div>
        ))}
      </div>

      <Notice tone={schedule.state === 'overdue' ? 'danger' : 'info'} icon={CalendarClock}>{scheduleLine}</Notice>

      <div className="flex items-center justify-between gap-[8px]">
        <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">Test history</h3>
        <Button size="sm" leftIcon={adding ? undefined : <Plus aria-hidden />} onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : 'Record test'}</Button>
      </div>

      {adding && (
        <div className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
          <TestForm value={form} onChange={setForm} withCadence />
          <div><Button variant="primary" leftIcon={<Check aria-hidden />} loading={add.isPending} onClick={() => add.mutate()}>Save test</Button></div>
        </div>
      )}

      {d.tests.length === 0 ? (
        <p className="m-0 rounded-ds-card border border-dashed border-ds-border p-[12px] text-ds-body text-ds-fg-muted">No tests recorded yet.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
          {d.tests.map((t) => editId === t.id ? (
            <li key={t.id} className="flex flex-col gap-[12px] bg-ds-surface-subtle p-[12px]">
              <TestForm value={edit} onChange={setEdit} withCadence={false} />
              {editError && <p role="alert" className="m-0 text-ds-body text-ds-danger">{editError}</p>}
              <div className="flex flex-wrap items-center justify-between gap-[8px]">
                <Button variant="danger" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} onClick={() => askDelete(t)}>Delete</Button>
                <span className="flex gap-[8px]">
                  <Button onClick={() => { setEditId(null); setEditError(null); }}>Cancel</Button>
                  <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(t.id)}>Save changes</Button>
                </span>
              </div>
            </li>
          ) : (
            <li key={t.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] p-[12px]">
              <span className="min-w-[150px] text-ds-body text-ds-fg-body">{`${t.test_type === 'design' ? 'Design' : 'Operating'} test · ${formatDate(t.test_date)}`}</span>
              <StatusPill size="sm" {...statusPill(testResult, t.result || 'not_tested')} />
              {!!t.exceptions_found && <span className="text-ds-label text-ds-fg-muted">{`${t.exceptions_found} ${t.exceptions_found === 1 ? 'exception' : 'exceptions'}`}</span>}
              <span className="ml-auto flex flex-wrap items-center gap-[8px]">
                {t.status === 'reviewed'
                  ? <StatusPill size="sm" tone="success" label={t.reviewer ? `Signed off by ${t.reviewer}` : 'Signed off'} />
                  : <Button size="sm" leftIcon={<Check aria-hidden />} loading={review.isPending && review.variables === t.id} onClick={() => signOff(t)}>Sign off</Button>}
                <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => { setEditId(t.id); setEdit(fromTest(t)); setEditError(null); }}>Edit</Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </div>
  );
}
