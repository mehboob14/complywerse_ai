'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, ClipboardCheck, Pencil, Plus, RefreshCw, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { Button, ErrorState, FormField, Notice, Select, StatTile, StatusPill, TextInput, Textarea } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import ScenarioForm from './ScenarioForm';
import {
  appetiteVerdict, CARD, day, formatMoney, frequencyLabel, SCENARIO_STATUS, SCENARIOS, scenarioActions, STEPS, stepStates, type Scenario,
} from './scenarioModel';

const STEP_TONE = { done: 'text-emerald-700', current: 'text-slate-900 font-medium', todo: 'text-slate-400' } as const;

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5 last:border-0">
      <dt className="text-slate-600">{label}</dt>
      <dd className="text-right tabular-nums text-slate-900">{value}</dd>
    </div>
  );
}

function AddAction({ scenario, onDone }: { scenario: Scenario; onDone: () => void }) {
  const [riskId, setRiskId] = useState(scenario.risks[0] ? String(scenario.risks[0].id) : '');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const add = useReportedMutation({
    mutationFn: async () => (await ermApi.scenarios.addAction(scenario.id, {
      risk_id: Number(riskId), title: title.trim(), due_date: due ? new Date(due).toISOString() : undefined,
    })).data,
    success: 'Action added to the risk',
    failure: "Couldn't add the action",
    retryable: false,
    invalidate: [SCENARIOS],
    onSuccess: onDone,
  });
  return (
    <div className="grid gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_2fr_auto_auto] sm:items-end">
      <FormField label="Risk">
        <Select value={riskId} onChange={(e) => setRiskId(e.target.value)}>
          {scenario.risks.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </Select>
      </FormField>
      <FormField label="Action">
        <TextInput value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} placeholder="Contract a second card processor" />
      </FormField>
      <FormField label="Due" optional>
        <TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </FormField>
      <Button variant="primary" loading={add.isPending} disabled={!riskId || !title.trim()} onClick={() => add.mutate()}>Add</Button>
    </div>
  );
}

/** One scenario: where it is in Draft > Estimated > Reviewed > Approved, the assumptions and the run's results side by side, the
 *  appetite comparison, the linked risks and the agreed actions. Approve is offered only to someone other than the estimator and
 *  reviewer (the server decides and refuses the others). */
export default function ScenarioDetail({ id, canEdit, canCreate, canDelete, onOpen, onBack }: {
  id: number; canEdit: boolean; canCreate: boolean; canDelete: boolean; onOpen: (id: number) => void; onBack: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState('');
  const key = [...SCENARIOS, id];      // under the list's key, so a save anywhere refreshes both
  const q = useQuery({ queryKey: key, queryFn: async () => (await ermApi.scenarios.get(id)).data as Scenario });
  const step = (call: () => Promise<{ data: unknown }>, success: string, failure: string) => ({
    mutationFn: async () => (await call()).data as Scenario,
    success, failure, invalidate: [SCENARIOS], onSuccess: () => setNote(''),
  });
  const run = useReportedMutation(step(() => ermApi.scenarios.run(id), 'Scenario run on the FAIR engine', "Couldn't run the scenario"));
  const review = useReportedMutation(step(() => ermApi.scenarios.review(id, note.trim() || undefined), 'Marked as reviewed', "Couldn't mark it reviewed"));
  const approve = useReportedMutation(step(() => ermApi.scenarios.approve(id, note.trim() || undefined), 'Scenario approved', "Couldn't approve the scenario"));
  const sendBack = useReportedMutation(step(() => ermApi.scenarios.sendBack(id, note.trim()), 'Sent back to draft', "Couldn't send it back"));
  const reopen = useReportedMutation({
    mutationFn: async () => (await ermApi.scenarios.reopen(id)).data as Scenario,
    success: 'Re-opened as a new draft', failure: "Couldn't re-open the scenario", retryable: false,
    invalidate: [SCENARIOS], onSuccess: (made) => onOpen(made.id),
  });
  // a draft only: a scenario that was run, reviewed or approved stays on the record (the server refuses it)
  const remove = useReportedMutation({
    mutationFn: async () => { await ermApi.scenarios.delete(id); },
    success: 'Draft deleted', failure: "Couldn't delete the draft", retryable: false,
    invalidate: [SCENARIOS], onSuccess: onBack,
  });

  if (q.isLoading) return <p className="text-sm text-slate-500">Loading the scenario…</p>;
  if (q.isError || !q.data) return <ErrorState title="Couldn't load the scenario" message={errorMessage(q.error)} onRetry={() => { void q.refetch(); }} />;
  const s = q.data;
  if (editing) return <ScenarioForm scenario={s} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />;

  const actions = scenarioActions(s, canEdit).filter((a) => a !== 'reopen' || canCreate);
  const status = SCENARIO_STATUS[s.status];
  const states = stepStates(s.status);
  const r = s.result;
  const asRun = r?.inputs;
  const busy = run.isPending || review.isPending || approve.isPending || sendBack.isPending;
  const stale = s.status === 'draft' && !!r;

  return (
    <div className="space-y-4">
      <Button variant="link" leftIcon={<ArrowLeft />} onClick={onBack}>All scenarios</Button>

      <div className={`${CARD} space-y-3`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900">{s.title}</h3>
              <StatusPill tone={status.tone} label={status.label} />
            </div>
            {s.description && <p className="mt-1 text-sm text-slate-600">{s.description}</p>}
            <p className="mt-1 text-xs text-slate-500">
              {s.last_run_at ? `Last run ${day(s.last_run_at)} by ${s.estimated_by_name || '—'}` : 'Not run yet'}
              {s.previous_run_at ? ` · previous run ${day(s.previous_run_at)}` : ''}
              {s.reopened_from_id ? ` · re-opened from scenario ${s.reopened_from_id}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {actions.includes('edit') && <Button variant="secondary" leftIcon={<Pencil />} disabled={busy} onClick={() => setEditing(true)}>Edit</Button>}
            {actions.includes('run') && (
              <Button variant="secondary" leftIcon={<RefreshCw />} loading={run.isPending} disabled={busy} onClick={() => run.mutate()}>{r ? 'Re-run' : 'Run'}</Button>
            )}
            {actions.includes('review') && (
              <Button variant="primary" leftIcon={<ClipboardCheck />} loading={review.isPending} disabled={busy} onClick={() => review.mutate()}>Mark reviewed</Button>
            )}
            {actions.includes('approve') && (
              <Button variant="primary" leftIcon={<CheckCircle2 />} loading={approve.isPending} disabled={busy} onClick={() => approve.mutate()}>Approve</Button>
            )}
            {actions.includes('sendBack') && (
              <Button variant="secondary" leftIcon={<Undo2 />} loading={sendBack.isPending} disabled={busy || !note.trim()}
                title={note.trim() ? undefined : 'Write why in the note first'} onClick={() => sendBack.mutate()}>Send back</Button>
            )}
            {actions.includes('reopen') && (
              <Button variant="secondary" leftIcon={<RotateCcw />} loading={reopen.isPending} onClick={() => reopen.mutate()}>Re-open as new draft</Button>
            )}
            {canDelete && s.status === 'draft' && (
              <Button variant="secondary" leftIcon={<Trash2 />} loading={remove.isPending} disabled={busy}
                onClick={() => { if (confirm(`Delete the draft "${s.title}"? This cannot be undone.`)) remove.mutate(); }}>Delete draft</Button>
            )}
          </div>
        </div>

        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Scenario steps">
          {STEPS.map((st, i) => (
            <li key={st.status} className={STEP_TONE[states[i]]} aria-current={states[i] === 'current' ? 'step' : undefined}>
              {i + 1}. {st.label}{states[i] === 'done' ? ' ✓' : ''}
            </li>
          ))}
        </ol>

        {s.review_note && <p className="text-xs text-amber-700">Note: {s.review_note}</p>}
        {stale && <Notice tone="warning">The estimates changed after the last run. Run it again before the review.</Notice>}
        {s.status === 'reviewed' && !s.can_approve && (
          <Notice tone="info">Waiting for approval. Someone other than the person who ran and the person who reviewed it approves.</Notice>
        )}
        {s.status === 'approved' && (
          <Notice tone="info">Approved by {s.approved_by_name || '—'} on {day(s.approved_at)}. Read-only: re-open it as a new draft to change it.</Notice>
        )}
        {(actions.includes('review') || actions.includes('approve') || actions.includes('sendBack')) && (
          <FormField label="Note" optional hint="Needed to send it back">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </FormField>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="scenario-assumptions">
          <h4 id="scenario-assumptions" className="mb-2 font-medium text-slate-900">Assumptions{asRun ? ' (as run)' : ''}</h4>
          <dl className="text-sm">
            <Fact label="Frequency" value={frequencyLabel(asRun?.frequency_per_year ?? s.frequency_per_year)} />
            <Fact label="Least loss per event" value={formatMoney(asRun ? asRun.loss_low ?? 0 : s.loss_low, s.currency)} />
            <Fact label="Typical loss per event" value={formatMoney(asRun?.loss_typical ?? s.loss_typical, s.currency)} />
            <Fact label="Severe loss per event" value={formatMoney(asRun?.loss_severe ?? s.loss_severe, s.currency)} />
          </dl>
          <p className="mt-3 text-xs font-medium text-slate-500">Workshop notes</p>
          <p className="whitespace-pre-wrap text-sm text-slate-800">{s.workshop_notes || '—'}</p>
        </section>

        <section className={CARD} aria-labelledby="scenario-results">
          <h4 id="scenario-results" className="mb-2 font-medium text-slate-900">Estimated loss ({s.currency}) per year</h4>
          {r ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <StatTile label="Average" value={formatMoney(r.mean, r.currency)} />
                <StatTile label="1 in 20 years" value={formatMoney(r.one_in_20, r.currency)} />
                <StatTile label="1 in 100 years" value={formatMoney(r.one_in_100, r.currency)} info="The severe loss compared with appetite" />
              </div>
              <dl className="mt-3 text-sm">
                <Fact label="Median year" value={formatMoney(r.median, r.currency)} />
                <Fact label="1 in 10 years" value={formatMoney(r.p90, r.currency)} />
              </dl>
              <p className="mt-2 text-xs text-slate-500">
                {r.iterations.toLocaleString('en-GB')} simulated years on the FAIR engine ({r.engine_version}, seed {r.seed}), {day(r.run_at)}
              </p>
            </>
          ) : <p className="text-sm text-slate-500">Not run yet. Enter the estimates and run it.</p>}
        </section>
      </div>

      <section className={CARD} aria-labelledby="scenario-appetite">
        <h4 id="scenario-appetite" className="mb-2 font-medium text-slate-900">Compared with appetite</h4>
        {s.appetite.length === 0 ? <p className="text-sm text-slate-500">Link risks to compare with their categories&apos; tolerance.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-600">
              <th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 text-right font-medium">1 in 100</th>
              <th className="py-2 pr-3 text-right font-medium">Loss tolerance</th><th className="py-2 font-medium">Result</th>
            </tr></thead>
            <tbody>
              {s.appetite.map((a) => {
                const verdict = appetiteVerdict(a);
                return (
                  <tr key={a.category} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3 capitalize text-slate-900">{a.category.replace(/_/g, ' ')}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(r?.one_in_100, s.currency)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{a.tolerance === null ? '—' : `${formatMoney(a.tolerance, s.currency)} (${a.limit})`}</td>
                    <td className="py-2"><StatusPill size="sm" tone={verdict.tone} label={verdict.text} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={CARD} aria-labelledby="scenario-risks">
          <h4 id="scenario-risks" className="mb-2 font-medium text-slate-900">Linked risks</h4>
          {s.risks.length === 0 ? <p className="text-sm text-slate-500">No risks linked.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {s.risks.map((risk) => (
                <li key={risk.id} className="flex justify-between gap-3 py-1.5">
                  <Link href={`/erm/risks/${risk.id}`} className="text-slate-900 hover:underline">{risk.title}</Link>
                  <span className="text-xs capitalize text-slate-500">{risk.category?.replace(/_/g, ' ')}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${CARD} space-y-2`} aria-labelledby="scenario-actions">
          <div className="flex items-center justify-between gap-2">
            <h4 id="scenario-actions" className="font-medium text-slate-900">Agreed actions</h4>
            {actions.includes('addAction') && s.risks.length > 0 && !adding && (
              <Button variant="secondary" size="sm" leftIcon={<Plus />} onClick={() => setAdding(true)}>Add action</Button>
            )}
          </div>
          {adding && <AddAction scenario={s} onDone={() => setAdding(false)} />}
          {s.actions.length === 0 ? <p className="text-sm text-slate-500">No actions yet. They go on the risk, in Actions &amp; Acceptances.</p> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {s.actions.map((a) => (
                <li key={a.id} className="flex justify-between gap-3 py-1.5">
                  <span className="text-slate-900">{a.title}</span>
                  <span className="text-xs text-slate-500">
                    {s.risks.find((x) => x.id === a.risk_id)?.title ?? `Risk ${a.risk_id}`} · {a.status.replace(/_/g, ' ')} · due {day(a.due_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
