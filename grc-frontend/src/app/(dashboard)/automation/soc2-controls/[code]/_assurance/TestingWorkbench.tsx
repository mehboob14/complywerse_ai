'use client';

// The Controls catalog's testing workbench, on an SCF control. Numbered test
// procedures with an AI recommendation, design and operating effectiveness with
// recorded tests and sign-off, the samples behind them, and the control's
// testing details. Same flow and words as the catalog, reading and writing the
// same rows, so a tester never relearns it. Two safeguards the catalog lacks: a
// signed-off test is locked as the audit record, and every change is audit-logged.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Check, ClipboardCheck, FileClock, Loader2, Lock, Pencil, Plus, Search, ShieldCheck, Sparkles, Star, Trash2, Upload, X,
} from 'lucide-react';
import { apiClient, automationApi } from '@/lib/api';
import type { ProcedureFile, TestingRecord, TestRecord, WorkItem } from './types';

const EFFECTIVENESS: Record<string, { label: string; text: string; dot: string }> = {
  effective: { label: 'Effective', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  partially_effective: { label: 'Partially effective', text: 'text-amber-700', dot: 'bg-amber-500' },
  ineffective: { label: 'Ineffective', text: 'text-rose-700', dot: 'bg-rose-500' },
};
export const eff = (v?: string | null) => EFFECTIVENESS[v || ''] ?? { label: 'Not tested', text: 'text-slate-400', dot: 'bg-slate-300' };

const RESULTS = ['effective', 'partially_effective', 'ineffective'];
const CADENCES = ['', 'monthly', 'quarterly', 'semi_annually', 'annually'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const PROGRESS = ['not_started', 'in_progress', 'implemented', 'verified', 'not_applicable'];
const words = (s: string) => s.replace(/_/g, ' ');

const inp = 'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-800 focus:border-primary-500 focus:outline-none';
const WB = '/control-library/workbench';

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if ((e as { response?: { status?: number } })?.response?.status === 403) return 'You don’t have permission to do that.';
  return fallback;
}

/** Runs one action at a time, with its spinner key and its error. */
function useAction(onDone: () => Promise<unknown> | void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, fallback: string) => {
    setBusy(key); setErr(null);
    try {
      await fn();
      await onDone();
      return true;
    } catch (e) {
      setErr(errorText(e, fallback));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { busy, err, run };
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-slate-400">{children}</span>;
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">{text}</p> : null;
}

function upload(workItemId: number, fields: Record<string, string | Blob>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return apiClient.post(`${WB}/items/${workItemId}/evidence`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
}

// ── Test procedures ─────────────────────────────────────────────────────────
export function ProcedureChecklist({ code, workItemId, record, onChanged }: {
  code: string; workItemId: number; record: TestingRecord; onChanged: () => Promise<unknown> | void;
}) {
  const { busy, err, run } = useAction(onChanged);
  const [templateNote, setTemplateNote] = useState(false);
  const procs = record.procedures;

  const generate = () => run('generate', async () => {
    const r = await automationApi.suggestProcedures(code, procs.length > 0);
    setTemplateNote(r.data?.source === 'template');
  }, 'Could not generate test procedures.');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-slate-500">Numbered audit test procedures. Check each as you complete it; attach evidence per step (optional).</p>
        <button type="button" onClick={generate} disabled={busy === 'generate'}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
          {busy === 'generate' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {procs.length ? 'Regenerate' : 'Get AI Recommendation'}
        </button>
      </div>
      {templateNote && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          The AI recommendation wasn’t available, so the catalog’s standard steps were added (marked template).
        </p>
      )}
      <ErrorLine text={err} />
      {procs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-[12px] text-slate-400">
          No test procedures yet. Click <b>Get AI Recommendation</b>.
        </div>
      ) : (
        <ol className="space-y-2">
          {procs.map((p) => (
            <li key={p.id} className="rounded-lg border border-slate-200 p-2.5">
              <div className="flex items-start gap-2.5">
                <input type="checkbox" checked={p.is_checked} disabled={busy === `check-${p.id}`} aria-label={`Step ${p.seq} done`}
                  onChange={(e) => run(`check-${p.id}`, () => automationApi.updateProcedure(code, p.id, { is_checked: e.target.checked }),
                    'Could not update the step.')}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-400">{p.seq}.</span>
                    {p.procedure_type && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">{p.procedure_type}</span>}
                    {p.frequency && <span className="text-[10.5px] text-slate-400">{p.frequency}{p.sample_size ? ` · n=${p.sample_size}` : ''}</span>}
                    {p.source === 'template' && (
                      <span title="A standard step, added when the AI recommendation wasn’t available" className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">template</span>
                    )}
                    {p.result && (
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${p.result === 'exception' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{words(p.result)}</span>
                    )}
                  </div>
                  <p className={`mt-1 whitespace-pre-line text-[12.5px] ${p.is_checked ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{p.description}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-primary-600 hover:text-primary-700">
                      {busy === `attach-${p.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />} Attach sample
                      <input type="file" className="hidden" disabled={busy === `attach-${p.id}`}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void run(`attach-${p.id}`, () => upload(workItemId, { test_procedure_id: String(p.id), file }), 'Upload failed.');
                        }} />
                    </label>
                    {p.files.map((f) => (
                      <span key={f.id} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] text-slate-600">
                        <ClipboardCheck className="h-3 w-3" />{f.file_name || 'evidence'} · {f.review_status}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ── Design & effectiveness ──────────────────────────────────────────────────
type TestForm = { test_type: string; result: string; sample_size: number; exceptions_found: number; findings: string };

function TestFields({ value, onChange }: { value: TestForm; onChange: (v: TestForm) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="block"><Label>Test type</Label>
        <select value={value.test_type} onChange={(e) => onChange({ ...value, test_type: e.target.value })} className={inp}>
          <option value="design">Design</option><option value="operating">Operating</option>
        </select>
      </label>
      <label className="block"><Label>Result</Label>
        <select value={value.result} onChange={(e) => onChange({ ...value, result: e.target.value })} className={inp}>
          {RESULTS.map((r) => <option key={r} value={r}>{eff(r).label}</option>)}
        </select>
      </label>
      <label className="block"><Label>Sample size</Label>
        <input type="number" min={0} value={value.sample_size} onChange={(e) => onChange({ ...value, sample_size: Math.max(0, +e.target.value) })} className={inp} />
      </label>
      <label className="block"><Label>Exceptions</Label>
        <input type="number" min={0} value={value.exceptions_found} onChange={(e) => onChange({ ...value, exceptions_found: Math.max(0, +e.target.value) })} className={inp} />
      </label>
    </div>
  );
}

function testStatus(x: TestRecord) {
  if (x.status === 'reviewed') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700"
        title={x.independent_review === false ? 'Signed off by the tester: recorded as not independent' : 'Locked as the audit record'}>
        <ShieldCheck className="h-3 w-3" /> Signed off{x.reviewer ? ` · ${x.reviewer}` : ''}{x.independent_review === false ? ' (self)' : ''}
        <Lock className="h-2.5 w-2.5" />
      </span>
    );
  }
  return null;
}

export function DesignEffectiveness({ code, workItem, record, onChanged }: {
  code: string; workItem: WorkItem; record: TestingRecord; onChanged: () => Promise<unknown> | void;
}) {
  const { busy, err, run } = useAction(onChanged);
  const [show, setShow] = useState(false);
  const [t, setT] = useState<TestForm & { frequency: string }>({
    test_type: 'operating', result: 'effective', sample_size: 25, exceptions_found: 0, findings: '', frequency: workItem.frequency || 'quarterly',
  });
  const [editId, setEditId] = useState<number | null>(null);
  const [ef, setEf] = useState<TestForm>({ test_type: 'operating', result: 'effective', sample_size: 0, exceptions_found: 0, findings: '' });

  const nextDate = workItem.next_test_date ? new Date(workItem.next_test_date) : null;
  const overdue = nextDate ? nextDate < new Date() : false;
  const daysTo = nextDate ? Math.round((nextDate.getTime() - Date.now()) / 86_400_000) : null;

  const save = () => run('record', async () => {
    await automationApi.recordTest(code, {
      test_type: t.test_type as 'design' | 'operating', result: t.result, sample_size: t.sample_size,
      exceptions_found: t.exceptions_found, findings: t.findings, frequency: t.frequency,
    });
    setShow(false);
    setT((v) => ({ ...v, findings: '', exceptions_found: 0 }));
  }, 'Could not record the test.');

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {(['design_effectiveness', 'operating_effectiveness'] as const).map((k) => (
          <div key={k} className="rounded-lg border border-slate-200 p-3">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">{k === 'design_effectiveness' ? 'Design' : 'Operating'} effectiveness</div>
            <div className={`mt-1 flex items-center gap-1.5 text-[14px] font-semibold ${eff(workItem[k]).text}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${eff(workItem[k]).dot}`} />{eff(workItem[k]).label}
            </div>
          </div>
        ))}
      </div>

      <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-[12px] ${overdue ? 'border-rose-200 bg-rose-50 text-rose-700' : nextDate ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-dashed border-slate-200 bg-white text-slate-400'}`}>
        <FileClock className="h-4 w-4 shrink-0" />
        {nextDate ? (
          <span>
            {overdue ? <b>Test overdue</b> : 'Next test'} due <b>{nextDate.toISOString().slice(0, 10)}</b>
            {daysTo != null && <span className="text-slate-400"> · {overdue ? `${-daysTo}d ago` : `in ${daysTo}d`}</span>}
            {workItem.frequency && <span className="text-slate-400"> · {words(workItem.frequency)}</span>}
          </span>
        ) : <span>No test cadence set — record a test with a frequency to schedule the next one.</span>}
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-[13px] font-semibold text-slate-700">Test history</h4>
        <button type="button" onClick={() => setShow((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50">
          {show ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />} {show ? 'Cancel' : 'Record test'}
        </button>
      </div>
      <ErrorLine text={err} />

      {show && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <TestFields value={t} onChange={(v) => setT({ ...t, ...v })} />
          <label className="block"><Label>Retest cadence (schedules the next test)</Label>
            <select value={t.frequency} onChange={(e) => setT({ ...t, frequency: e.target.value })} className={inp}>
              {CADENCES.map((f) => <option key={f} value={f}>{f ? words(f) : 'no schedule'}</option>)}
            </select>
          </label>
          <textarea value={t.findings} onChange={(e) => setT({ ...t, findings: e.target.value })} placeholder="Findings" rows={2} className={inp} />
          <button type="button" onClick={save} disabled={busy === 'record'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {busy === 'record' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save test
          </button>
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {record.tests.length === 0 ? <div className="p-3 text-[12px] text-slate-400">No tests recorded.</div> : record.tests.map((x) => (
          editId === x.id ? (
            <div key={x.id} className="space-y-2 bg-slate-50 p-2.5">
              <TestFields value={ef} onChange={setEf} />
              <textarea value={ef.findings} onChange={(e) => setEf({ ...ef, findings: e.target.value })} placeholder="Findings" rows={2} className={inp} />
              <div className="flex items-center justify-between">
                <button type="button" disabled={busy === `delete-${x.id}`}
                  onClick={() => run(`delete-${x.id}`, async () => { await automationApi.deleteTest(code, x.id); setEditId(null); }, 'Could not delete the test.')}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1.5 text-[11.5px] font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setEditId(null)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11.5px] text-slate-500">Cancel</button>
                  <button type="button" disabled={busy === `edit-${x.id}`}
                    onClick={() => run(`edit-${x.id}`, async () => { await automationApi.editTest(code, x.id, ef); setEditId(null); }, 'Could not save the changes.')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-[11.5px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                    {busy === `edit-${x.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save changes
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div key={x.id} className="p-2.5 text-[12px]">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="capitalize text-slate-700">{x.test_type} · {x.test_date?.slice(0, 10)}</span>
                {x.status === 'in_progress' ? (
                  <span className="text-slate-500">In progress · {x.samples.filter((s) => s.result).length}/{x.samples.length} samples</span>
                ) : (
                  <span className={`flex items-center gap-1 font-medium ${eff(x.result).text}`}>
                    <span className={`h-2 w-2 rounded-full ${eff(x.result).dot}`} />{eff(x.result).label}
                    {x.exceptions_found ? ` · ${x.exceptions_found} exc` : ''}
                    {x.sample_size ? <span className="font-normal text-slate-400"> · n={x.sample_size}</span> : null}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1.5">
                  {testStatus(x)}
                  {x.status === 'completed' && (
                    <button type="button" disabled={busy === `review-${x.id}`}
                      onClick={() => run(`review-${x.id}`, () => automationApi.signOffTest(code, x.id), 'Could not sign off the test.')}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-0.5 text-[10.5px] font-medium text-slate-500 hover:border-emerald-300 hover:text-emerald-700 disabled:opacity-50">
                      {busy === `review-${x.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Sign off
                    </button>
                  )}
                  {x.status === 'completed' && (
                    <button type="button" title="Edit this test"
                      onClick={() => { setEditId(x.id); setEf({ test_type: x.test_type, result: x.result || 'effective', sample_size: x.sample_size ?? 0, exceptions_found: x.exceptions_found ?? 0, findings: x.findings || '' }); }}
                      className="rounded border border-slate-200 p-1 text-slate-400 hover:border-primary-300 hover:text-primary-600">
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                  {x.status === 'in_progress' && (
                    <button type="button" title="Delete this test" disabled={busy === `delete-${x.id}`}
                      onClick={() => run(`delete-${x.id}`, () => automationApi.deleteTest(code, x.id), 'Could not delete the test.')}
                      className="rounded border border-slate-200 p-1 text-slate-400 hover:border-rose-300 hover:text-rose-600 disabled:opacity-50">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>
              {x.findings && <p className="mt-1 whitespace-pre-line text-[11.5px] text-slate-500">{x.findings}</p>}
            </div>
          )
        ))}
      </div>
    </div>
  );
}

// ── Sampling ────────────────────────────────────────────────────────────────
export function SamplingPanel({ workItemId, record, onChanged }: {
  workItemId: number; record: TestingRecord; onChanged: () => Promise<unknown> | void;
}) {
  const { busy, err, run } = useAction(onChanged);
  const [linking, setLinking] = useState(false);
  const [q, setQ] = useState('');
  const lib = useQuery({
    queryKey: ['wb-evidence-lib', q],
    enabled: linking,
    queryFn: async () => (await apiClient.get(`${WB}/evidence-library`, { params: { limit: 30, ...(q ? { q } : {}) } })).data as {
      items: { id: number; name: string; file_name?: string; evidence_type?: string; status?: string }[];
    },
  });
  const items: (ProcedureFile & { step: number | null })[] = [
    ...record.control_files.map((f) => ({ ...f, step: null })),
    ...record.procedures.flatMap((p) => p.files.map((f) => ({ ...f, step: p.seq }))),
  ];
  const linked = new Set(items.map((e) => e.evidence_id).filter(Boolean));
  const available = (lib.data?.items || []).filter((e) => !linked.has(e.id));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-primary-700">
          {busy === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload sample
          <input type="file" className="hidden" disabled={busy === 'upload'}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void run('upload', () => upload(workItemId, { file }), 'Upload failed.');
            }} />
        </label>
        <button type="button" onClick={() => setLinking((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-[13px] font-medium text-slate-600 hover:bg-slate-50">
          <Search className="h-4 w-4" /> Link from library
        </button>
      </div>
      <p className="text-[11px] text-slate-400">Attach the sampled evidence used to test this control. Uploads are saved to the Evidence Library (OCR-processed &amp; reviewable there too).</p>
      <ErrorLine text={err} />

      {linking && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the evidence library…"
              className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-8 pr-3 text-[13px] focus:border-primary-500 focus:outline-none" />
          </div>
          {lib.isLoading ? <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" /></div> : (
            <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 bg-white">
              {available.length === 0 ? <li className="p-3 text-center text-[12px] text-slate-400">Nothing to link.</li> : available.map((e) => (
                <li key={e.id} className="flex items-center gap-2.5 p-2.5 hover:bg-slate-50">
                  <ClipboardCheck className="h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-medium text-slate-800">{e.name}</div>
                    <div className="text-[11px] text-slate-400">{e.evidence_type || 'evidence'}{e.status ? ` · ${e.status}` : ''}</div>
                  </div>
                  <button type="button" disabled={busy === `link-${e.id}`}
                    onClick={() => run(`link-${e.id}`, async () => { await upload(workItemId, { evidence_id: String(e.id) }); setLinking(false); setQ(''); }, 'Could not link the evidence.')}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-[11.5px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                    {busy === `link-${e.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Link
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {items.length === 0 ? <div className="p-3 text-[12px] text-slate-400">No samples attached yet.</div> : items.map((e) => (
          <div key={e.id} className="flex items-center justify-between gap-2 p-2.5 text-[12.5px]">
            <span className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-slate-700">
              <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" />{e.file_name || 'evidence'}
              {e.step != null && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">step {e.step}</span>}
              {e.evidence_id ? <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">in library</span> : null}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${e.review_status === 'approved' ? 'bg-emerald-100 text-emerald-700' : e.review_status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{e.review_status}</span>
            {e.review_status === 'pending' && (
              <span className="flex gap-1">
                <button type="button" title="Approve" disabled={busy === `review-${e.id}`}
                  onClick={() => run(`review-${e.id}`, () => apiClient.post(`${WB}/evidence/${e.id}/review`, { action: 'approved' }), 'Could not approve.')}
                  className="rounded p-1 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"><Check className="h-3.5 w-3.5" /></button>
                <button type="button" title="Reject" disabled={busy === `review-${e.id}`}
                  onClick={() => run(`review-${e.id}`, () => apiClient.post(`${WB}/evidence/${e.id}/review`, { action: 'rejected' }), 'Could not reject.')}
                  className="rounded p-1 text-rose-600 hover:bg-rose-50 disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Details ─────────────────────────────────────────────────────────────────
export function TestingDetails({ code, workItem, onChanged }: {
  code: string; workItem: WorkItem; onChanged: () => Promise<unknown> | void;
}) {
  const { busy, err, run } = useAction(onChanged);
  const [f, setF] = useState({
    priority: workItem.priority || 'medium',
    implementation_status: workItem.implementation_status || 'not_started',
    is_key_control: !!workItem.is_key_control,
    frequency: workItem.frequency || '',
  });
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><Label>Priority</Label>
          <select value={f.priority} onChange={(e) => { setF({ ...f, priority: e.target.value }); setSaved(false); }} className={inp}>
            {PRIORITIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
        <label className="block"><Label>Progress</Label>
          <select value={f.implementation_status} onChange={(e) => { setF({ ...f, implementation_status: e.target.value }); setSaved(false); }} className={inp}>
            {PROGRESS.map((s) => <option key={s} value={s}>{words(s)}</option>)}
          </select>
        </label>
        <label className="block"><Label>Retest cadence</Label>
          <select value={f.frequency} onChange={(e) => { setF({ ...f, frequency: e.target.value }); setSaved(false); }} className={inp}>
            {CADENCES.map((c) => <option key={c} value={c}>{c ? words(c) : 'no schedule'}</option>)}
          </select>
        </label>
        <label className="flex items-end gap-2 pb-2 text-[13px] text-slate-600">
          <input type="checkbox" checked={f.is_key_control} onChange={(e) => { setF({ ...f, is_key_control: e.target.checked }); setSaved(false); }}
            className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" />
          <Star className={`h-3.5 w-3.5 ${f.is_key_control ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /> Key control
        </label>
      </div>
      <ErrorLine text={err} />
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy === 'save'}
          onClick={async () => { if (await run('save', () => automationApi.updateTestingDetails(code, f), 'Could not save the details.')) setSaved(true); }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
        </button>
        {saved && <span className="text-[12px] text-emerald-700">Saved.</span>}
      </div>
    </div>
  );
}
