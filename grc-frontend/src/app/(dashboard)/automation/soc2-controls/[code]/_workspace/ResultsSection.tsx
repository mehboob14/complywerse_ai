'use client';

// Testing > Results: how effective the control is by design and in operation, when it is next tested, the tests that were recorded (a sampled test in progress is continued here, a concluded one
// signed off) and the control's testing details (priority, progress, key control, retest cadence).
import { useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { Button, Checkbox, EmptyState, FormField, Select, StatusPill, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { automationApi } from '@/lib/api';
import { formatDate, statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { testResult, testRun, workProgress } from '@/lib/statuses/controls';
import { Loaded, Small } from './parts';
import type { TestRecord, WorkItem } from './types';
import { signOffNote, testLine, type TestRow } from './testRunModel';
import { testOverdue } from './workspaceModel';
import { useAssurance, useTesting } from './workspaceData';
import { useWorkspace } from './workspaceContext';

const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const PROGRESS = ['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'];
const CADENCES = ['monthly', 'quarterly', 'semi_annually', 'annually'];

function Details({ wi }: { wi: WorkItem }) {
  const { code, rights, why, refresh } = useWorkspace();
  const [f, setF] = useState({ priority: wi.priority || 'medium', implementation_status: wi.implementation_status || 'not_started', is_key_control: !!wi.is_key_control, frequency: wi.frequency || '' });
  const save = useReportedMutation({
    mutationFn: () => automationApi.updateTestingDetails(code, f),
    success: { title: 'Details saved', message: 'The testing details of the control are updated.' }, failure: "Couldn't save the details", onSuccess: () => { void refresh(); },
  });
  const off = !rights.testing;
  return (
    <div className="flex flex-col gap-[10px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <div className="grid gap-[10px] sm:grid-cols-2">
        <FormField label="Priority"><Select value={f.priority} disabled={off} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}</Select></FormField>
        <FormField label="Progress"><Select value={f.implementation_status} disabled={off} onChange={(e) => setF({ ...f, implementation_status: e.target.value })}>{PROGRESS.map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}</Select></FormField>
        <FormField label="Retest" hint="Sets when the next test is due."><Select value={f.frequency} disabled={off} onChange={(e) => setF({ ...f, frequency: e.target.value })} placeholder="No schedule">{CADENCES.map((x) => <option key={x} value={x}>{statusLabel(x)}</option>)}</Select></FormField>
        <div className="flex items-end pb-[6px]"><Checkbox label="Key control" checked={f.is_key_control} disabled={off} onChange={(e) => setF({ ...f, is_key_control: e.target.checked })} /></div>
      </div>
      <div><Button variant="primary" loading={save.isPending} disabled={off} title={why('testing')} onClick={() => save.mutate()}>Save the details</Button></div>
    </div>
  );
}

function TestItem({ t }: { t: TestRecord }) {
  const { code, rights, why, me, recordTest, refresh } = useWorkspace();
  const { confirm, confirmDialog } = useConfirm();
  const row = t as unknown as TestRow;
  const sign = useReportedMutation({
    mutationFn: () => automationApi.signOffTest(code, t.id),
    success: { title: 'Test signed off', message: 'It is locked as the audit record and the control’s assurance status is updated.' }, failure: "Couldn't sign off the test", onSuccess: () => { void refresh(); },
  });
  const askSign = async () => {
    const yes = await confirm({ title: 'Sign off this test?', message: `This test (${testLine(row).toLowerCase()}) is locked as the audit record and cannot be changed. ${signOffNote(row, me) ?? 'It will count towards the control’s assurance status.'}`, confirmLabel: 'Sign off' });
    if (yes) sign.mutate();
  };
  const sampled = t.samples.length > 0;
  const done = t.samples.filter((s) => s.result).length;
  return (
    <li className="flex flex-wrap items-center gap-x-[12px] gap-y-[6px] px-[12px] py-[10px]">
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="text-ds-body font-[600] text-ds-fg">{testLine(row)}</p>
        <Small>{`${formatDate(t.test_date)}${t.tester ? ` · ${t.tester}` : ''}${t.status === 'in_progress' && sampled ? ` · ${done} of ${t.samples.length} recorded` : ''}${t.status === 'reviewed' && t.reviewer ? ` · signed off by ${t.reviewer}${t.independent_review === false ? ' (not independent)' : ''}` : ''}`}</Small>
        {t.findings && <p className="mt-[2px] line-clamp-2 text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{t.findings}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-[6px]">
        {t.status !== 'in_progress' && t.result && <StatusPill size="sm" {...statusPill(testResult, t.result)} />}
        <StatusPill size="sm" {...statusPill(testRun, t.status)} />
      </div>
      <div className="flex flex-wrap items-center gap-[6px]">
        {t.status === 'completed' && <Button size="sm" disabled={!rights.signOff} title={why('signOff')} loading={sign.isPending} onClick={() => { void askSign(); }}>Sign off</Button>}
        <Button size="sm" onClick={() => recordTest(t.id)}>{t.status === 'in_progress' ? 'Continue' : t.status === 'completed' ? 'Review' : 'Open'}</Button>
      </div>
      {confirmDialog}
    </li>
  );
}

export function ResultsSection() {
  const { code, recordTest, rights, why } = useWorkspace();
  const a = useAssurance(code);
  const t = useTesting(code);
  const [details, setDetails] = useState(false);
  return (
    <Loaded q={a} what="the testing record" rows={3}>
      {(assurance) => {
        const wi = assurance.work_item;
        const overdue = testOverdue(wi.next_test_date, new Date());
        return (
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
              <div className="flex items-center gap-[6px]"><Small>Design</Small><StatusPill {...statusPill(testResult, wi.design_effectiveness || 'not_tested')} /></div>
              <div className="flex items-center gap-[6px]"><Small>Operating</Small><StatusPill {...statusPill(testResult, wi.operating_effectiveness || 'not_tested')} /></div>
              <div className="flex items-center gap-[6px]"><Small>Progress</Small><StatusPill {...statusPill(workProgress, wi.implementation_status || 'not_started')} /></div>
              <Small className={overdue ? 'font-[600] !text-ds-danger' : ''}>{wi.next_test_date ? `Next test ${formatDate(wi.next_test_date)}${overdue ? ' · overdue' : ''}` : 'No test is scheduled'}{wi.last_tested_at ? ` · last tested ${formatDate(wi.last_tested_at)}` : ''}</Small>
              <div className="ml-auto flex flex-wrap gap-[8px]">
                <Button leftIcon={<Settings2 aria-hidden />} aria-expanded={details} onClick={() => setDetails(!details)}>Details</Button>
                <Button variant="primary" leftIcon={<Plus aria-hidden />} disabled={!rights.testing} title={why('testing')} onClick={() => recordTest('new')}>Record a test</Button>
              </div>
            </div>
            {details && <Details wi={wi} />}
            <Loaded q={t} what="the tests" rows={2}>
              {(rec) => (rec.tests.length === 0
                ? <EmptyState kind="firstUse" bare title="No test recorded yet" description="Run a sampled test, or record the result of one done elsewhere." />
                : <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface" aria-label="Tests">{rec.tests.map((x) => <TestItem key={x.id} t={x} />)}</ul>)}
            </Loaded>
          </div>
        );
      }}
    </Loaded>
  );
}
