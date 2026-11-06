'use client';

// Assurance tab on an SCF control, on one screen.
//
// Testing works exactly as in the Controls catalog: test procedures with an AI
// recommendation, design and operating effectiveness with recorded tests and
// sign-off, samples, and the control's testing details. A strip says where the
// control stands; each card opens its full, working section in a side panel,
// so nothing needs a long scroll and nothing is more than one click away.

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, Star } from 'lucide-react';
import { automationApi } from '@/lib/api';
import EvidenceWorkspace, { ARTIFACT_STATE } from './EvidenceWorkspace';
import { DesignEffectiveness, ProcedureChecklist, SamplingPanel, TestingDetails, eff } from './TestingWorkbench';
import { DetailPanel, SummaryCard, Tally } from './cards';
import type { AssurancePayload, AutomatedResult, Objective, Readiness, TestRecord, TestingRecord } from './types';

type PanelId = 'objectives' | 'evidence' | 'procedures' | 'effectiveness' | 'sampling' | 'details' | 'automated';

// CDPAS Standard 6.5 designations, as written by test sign-off.
const DESIGNATION: Record<string, { label: string; cls: string; hint: string }> = {
  satisfactory: { label: 'Satisfactory', cls: 'text-emerald-700', hint: 'Design and operation tested effective, independently reviewed.' },
  partial: { label: 'Partial', cls: 'text-amber-700', hint: 'Tested, but not fully effective or not yet tested in operation.' },
  deficient: { label: 'Deficient', cls: 'text-rose-700', hint: 'A signed-off test found the control ineffective.' },
  alternative_control: { label: 'Alternative control', cls: 'text-emerald-700', hint: 'Met by a documented alternative.' },
  na: { label: 'Not applicable', cls: 'text-slate-500', hint: 'Out of scope for this organisation.' },
  not_assessed: { label: 'Not assessed', cls: 'text-slate-500', hint: 'No independently signed-off test yet.' },
};


const PPTDF_CLS: Record<string, string> = {
  Technology: 'bg-indigo-50 text-indigo-700',
  Process: 'bg-slate-100 text-slate-600',
  People: 'bg-amber-50 text-amber-700',
  Data: 'bg-sky-50 text-sky-700',
  Facility: 'bg-stone-100 text-stone-700',
};

const fmtDate = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString() : null);

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ReadinessBar({ r }: { r: Readiness }) {
  const parts: { key: keyof Readiness; cls: string }[] = [
    { key: 'satisfied', cls: 'bg-emerald-500' },
    { key: 'pending_review', cls: 'bg-sky-400' },
    { key: 'stale', cls: 'bg-orange-400' },
    { key: 'failing', cls: 'bg-rose-500' },
    { key: 'missing', cls: 'bg-slate-200' },
  ];
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100" role="img"
      aria-label={`${r.satisfied} satisfied, ${r.pending_review} pending review, ${r.stale} expired, ${r.failing} failing, ${r.missing} missing`}>
      {parts.map((p) => {
        const n = r[p.key] as number;
        return n ? <span key={p.key} className={p.cls} style={{ width: `${(100 * n) / r.total}%` }} /> : null;
      })}
    </div>
  );
}

function AutomatedResults({ results }: { results: AutomatedResult[] }) {
  if (!results.length) {
    return <p className="text-sm text-slate-500">No collector has recorded a result for this control. Connected checks write results here after each run.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-3 font-semibold">Check</th>
            <th className="py-2 pr-3 font-semibold">Result</th>
            <th className="py-2 pr-3 font-semibold">Tested</th>
            <th className="py-2 pr-3 font-semibold">Collected</th>
            <th className="py-2 font-semibold">Valid until</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {results.map((r, i) => {
            const tone = r.expired ? 'text-orange-700' : r.status === 'pass' ? 'text-emerald-700'
              : r.status === 'fail' ? 'text-rose-700' : 'text-slate-500';
            return (
              <tr key={`${r.check_id}-${r.ao_id}-${r.resource}-${i}`}>
                <td className="py-2 pr-3">
                  <span className="block font-medium text-slate-800">{r.check_id}</span>
                  <span className="block text-[11px] text-slate-400">{r.connector}{r.ao_id && ` · ${r.ao_id}`}</span>
                </td>
                <td className={`py-2 pr-3 font-semibold capitalize ${tone}`}>{r.expired ? 'Expired' : r.status.replace('_', ' ')}</td>
                <td className="py-2 pr-3 tabular-nums text-slate-600">
                  {r.population_size != null
                    ? <>{r.tested_size ?? r.population_size} of {r.population_size}{r.truncated && <span className="text-orange-600"> · partial</span>}</>
                    : '—'}
                </td>
                <td className="py-2 pr-3 text-slate-600">{fmtDate(r.collected_at) ?? '—'}</td>
                <td className="py-2 text-slate-600">{fmtDate(r.expires_at) ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One kind of effectiveness and the latest test behind it, as a one-line status. */
function EffectivenessLine({ label, value, test }: { label: string; value: string | null; test?: TestRecord }) {
  const e = eff(value);
  const status = !test ? 'No test recorded'
    : test.status === 'reviewed' ? `Signed off${test.independent_review === false ? ' (self)' : ''}`
      : test.status === 'completed' ? 'Awaiting sign-off'
        : `In progress · ${test.samples.filter((s) => s.result).length}/${test.samples.length} samples`;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-slate-800">{label}</p>
        <p className="truncate text-[11px] text-slate-500">{status}{test?.test_date ? ` · ${fmtDate(test.test_date)}` : ''}</p>
      </div>
      <span className={`inline-flex shrink-0 items-center gap-1.5 text-[12px] font-semibold ${e.text}`}>
        <span className={`h-2 w-2 rounded-full ${e.dot}`} />{e.label}
      </span>
    </div>
  );
}

export default function AssuranceTab({ code, objectives, note }:
  { code: string; objectives: Objective[]; note?: string | null }) {
  const qc = useQueryClient();
  const [panel, setPanel] = useState<PanelId | null>(null);
  // a test result moves the control's effectiveness, schedule and status, so both reads refresh
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['control-assurance-testing', code] }),
    qc.invalidateQueries({ queryKey: ['control-assurance', code] }),
  ]);
  const q = useQuery({
    queryKey: ['control-assurance', code],
    queryFn: () => automationApi.getControlAssurance(code).then((r) => r.data as AssurancePayload),
  });
  const testingQ = useQuery({
    queryKey: ['control-assurance-testing', code],
    queryFn: () => automationApi.getAssuranceTesting(code).then((r) => r.data as TestingRecord),
  });

  if (q.isLoading) {
    return <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading assurance…</div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
        <AlertCircle className="h-4 w-4" /> Could not load this control&apos;s assurance record.
      </div>
    );
  }

  const d = q.data;
  const t = testingQ.data;
  const wi = d.work_item;
  const r = d.readiness;
  const des = DESIGNATION[d.designation] || DESIGNATION.not_assessed;
  const close = () => setPanel(null);

  const byPptdf = objectives.reduce<Record<string, number>>((acc, o) => {
    const k = o.pptdf || 'Other'; acc[k] = (acc[k] || 0) + 1; return acc;
  }, {});
  const withNist = objectives.filter((o) => t?.nist?.[o.ao_id]?.length).length;

  const ORDER = ['failing', 'missing', 'stale', 'pending_review'] as const;
  const attention = [...d.artifacts]
    .filter((a) => a.state !== 'satisfied')
    .sort((a, b) => ORDER.indexOf(a.state as (typeof ORDER)[number]) - ORDER.indexOf(b.state as (typeof ORDER)[number]));

  const procedures = t?.procedures ?? [];
  const checked = procedures.filter((p) => p.is_checked).length;
  const latest = (type: 'design' | 'operating') => t?.tests.find((x) => x.test_type === type);
  const awaitingSignOff = (t?.tests ?? []).filter((x) => x.status === 'completed').length;
  const samples = t ? [...t.control_files, ...t.procedures.flatMap((p) => p.files)] : [];
  const samplesPending = samples.filter((s) => s.review_status === 'pending').length;
  const samplesApproved = samples.filter((s) => s.review_status === 'approved').length;
  const nextDate = wi.next_test_date ? new Date(wi.next_test_date) : null;
  const overdue = !!nextDate && nextDate < new Date();

  const results = d.automated.results;
  const passing = results.filter((x) => !x.expired && x.status === 'pass').length;
  const failing = results.filter((x) => !x.expired && x.status === 'fail').length;
  const expired = results.filter((x) => x.expired).length;
  const lastCollected = results.map((x) => x.collected_at).filter(Boolean).sort().pop();

  return (
    <div className="space-y-3">
      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Assurance status">
          <p className={`text-sm font-semibold ${des.cls}`} title={des.hint}>{des.label}</p>
        </Stat>
        {(['design_effectiveness', 'operating_effectiveness'] as const).map((k) => (
          <Stat key={k} label={k === 'design_effectiveness' ? 'Design effectiveness' : 'Operating effectiveness'}>
            <p className={`flex items-center gap-1.5 text-sm font-semibold ${eff(wi[k]).text}`}>
              <span className={`h-2 w-2 rounded-full ${eff(wi[k]).dot}`} />{eff(wi[k]).label}
            </p>
          </Stat>
        ))}
        <Stat label="Test schedule">
          {nextDate ? (
            <p className={`text-sm ${overdue ? 'font-semibold text-rose-600' : 'text-slate-700'}`}>
              {overdue ? 'Overdue since' : 'Next due'} {fmtDate(wi.next_test_date)}
            </p>
          ) : <p className="text-sm text-slate-400">No cadence set</p>}
          <p className="text-[11px] text-slate-500">{wi.last_tested_at ? `Last tested ${fmtDate(wi.last_tested_at)}` : 'Never tested'}</p>
        </Stat>
        <Stat label="Details">
          <button type="button" onClick={() => setPanel('details')} className="group text-left">
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
              {wi.is_key_control && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-label="Key control" />}
              <span className="capitalize">{(wi.implementation_status || 'not_started').replace(/_/g, ' ')}</span>
            </p>
            <p className="text-[11px] text-slate-500">
              <span className="capitalize">{wi.priority || 'medium'}</span> priority · <span className="font-semibold text-primary-700 group-hover:underline">Edit</span>
            </p>
          </button>
        </Stat>
      </section>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard title="What must be proven" meta={`${objectives.length} objective${objectives.length === 1 ? '' : 's'}`}
          action={objectives.length ? 'View objectives' : undefined} onAction={() => setPanel('objectives')}>
          {objectives.length ? (
            <>
              <div className="mb-2 flex flex-wrap gap-1">
                {Object.entries(byPptdf).map(([k, n]) => (
                  <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${PPTDF_CLS[k] || 'bg-slate-100 text-slate-600'}`}>{k} · {n}</span>
                ))}
              </div>
              <ul className="space-y-1.5">
                {objectives.slice(0, 2).map((o) => (
                  <li key={o.ao_id} className="line-clamp-2 text-[12px] leading-snug text-slate-600">
                    <span className="mr-1 font-mono text-[10px] text-slate-400">{o.ao_id}</span>{o.objective}
                  </li>
                ))}
              </ul>
              {withNist > 0 && <p className="mt-2 text-[11px] text-slate-500">NIST SP 800-53A guidance for {withNist} of {objectives.length}</p>}
            </>
          ) : <p className="text-[13px] text-slate-500">{note || 'This control has no published assessment objectives.'}</p>}
        </SummaryCard>

        <SummaryCard title="Required evidence" meta={r.total ? `${r.satisfied} of ${r.total} satisfied` : undefined}
          action={r.total ? 'Open checklist' : undefined} onAction={() => setPanel('evidence')}>
          {r.total ? (
            <>
              <ReadinessBar r={r} />
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                <Tally n={r.missing} label=" need evidence" dot="bg-slate-300" />
                <Tally n={r.failing} label=" failing" dot="bg-rose-500" />
                <Tally n={r.stale} label=" expired" dot="bg-orange-400" />
                <Tally n={r.pending_review} label=" pending review" dot="bg-sky-400" />
              </div>
              {attention.length ? (
                <ul className="mt-2.5 space-y-1.5">
                  {attention.slice(0, 3).map((a) => (
                    <li key={a.key} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-[12px] text-slate-700">{a.name}</span>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold ${ARTIFACT_STATE[a.state].cls}`}>
                        {ARTIFACT_STATE[a.state].label}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Every required artifact is satisfied.</p>
              )}
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-slate-500">
              None of your in-scope frameworks names a specific artifact for this control. Attach any evidence that shows it operating on the Evidence tab.
            </p>
          )}
        </SummaryCard>

        <SummaryCard title="Test procedures" meta={procedures.length ? `${checked} of ${procedures.length} done` : undefined}
          action={t ? (procedures.length ? 'Open test procedures' : 'Get AI recommendation') : undefined} onAction={() => setPanel('procedures')}>
          {!t ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : procedures.length ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                <span className="block h-full bg-emerald-500" style={{ width: `${(100 * checked) / procedures.length}%` }} />
              </div>
              <ol className="mt-2.5 space-y-1.5">
                {procedures.slice(0, 3).map((p) => (
                  <li key={p.id} className="flex items-start gap-2 text-[12px] leading-snug">
                    <span className={`mt-px flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${p.is_checked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {p.is_checked ? <CheckCircle2 className="h-3 w-3" /> : p.seq}
                    </span>
                    <span className={`line-clamp-1 ${p.is_checked ? 'text-slate-400 line-through' : 'text-slate-600'}`}>{p.description}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-slate-500">
              No test procedures yet. Get an AI recommendation for a numbered checklist to work through.
            </p>
          )}
        </SummaryCard>

        <SummaryCard title="Design & effectiveness" meta={awaitingSignOff ? `${awaitingSignOff} awaiting sign-off` : undefined}
          action={t ? 'Record or review tests' : undefined} onAction={() => setPanel('effectiveness')}>
          {t ? (
            <>
              <EffectivenessLine label="Design" value={wi.design_effectiveness} test={latest('design')} />
              <EffectivenessLine label="Operating" value={wi.operating_effectiveness} test={latest('operating')} />
            </>
          ) : <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>}
        </SummaryCard>

        <SummaryCard title="Sampling" meta={samples.length ? `${samples.length} sample${samples.length === 1 ? '' : 's'}` : undefined}
          action={t ? 'Open sampling' : undefined} onAction={() => setPanel('sampling')}>
          {samples.length ? (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <Tally n={samplesApproved} label=" approved" dot="bg-emerald-500" />
                <Tally n={samplesPending} label=" pending review" dot="bg-amber-400" />
              </div>
              <ul className="mt-2.5 space-y-1.5">
                {samples.slice(0, 3).map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-slate-700">{s.file_name || 'evidence'}</span>
                    <span className="shrink-0 text-[10.5px] text-slate-500">{s.review_status}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-slate-500">No samples attached yet. Upload the sampled evidence or link it from the library.</p>
          )}
        </SummaryCard>

        <SummaryCard title="Collected automatically" meta={results.length ? `${results.length} result${results.length === 1 ? '' : 's'}` : undefined}
          action={results.length ? 'View results' : undefined} onAction={() => setPanel('automated')}>
          {results.length ? (
            <>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                <Tally n={passing} label=" passing" dot="bg-emerald-500" />
                <Tally n={failing} label=" failing" dot="bg-rose-500" />
                <Tally n={expired} label=" expired" dot="bg-orange-400" />
              </div>
              {lastCollected && <p className="mt-2 text-[12px] text-slate-500">Last collected {fmtDate(lastCollected)}</p>}
            </>
          ) : (
            <p className="text-[13px] leading-relaxed text-slate-500">No collector has recorded a result for this control yet.</p>
          )}
        </SummaryCard>

      </div>

      <DetailPanel open={panel === 'objectives'} onClose={close} title="What must be proven"
        subtitle={note || `SCF assessment objectives for ${code}, as published.`}>
        <ol className="space-y-3">
          {objectives.map((o) => (
            <li key={o.ao_id} className="flex gap-3">
              <span className="w-24 shrink-0 pt-0.5 font-mono text-[11px] text-slate-400">{o.ao_id}</span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] leading-relaxed text-slate-700">{o.objective}</p>
                {(t?.nist?.[o.ao_id] ?? []).length > 0 && (
                  <p className="mt-1 text-[11px] text-slate-500">
                    NIST SP 800-53A: {Array.from(new Set((t?.nist?.[o.ao_id] ?? []).map((n) => n.control))).join(', ')}
                  </p>
                )}
              </div>
              {o.pptdf && (
                <span className={`h-fit shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PPTDF_CLS[o.pptdf] || 'bg-slate-100 text-slate-600'}`}>{o.pptdf}</span>
              )}
            </li>
          ))}
        </ol>
      </DetailPanel>

      <DetailPanel open={panel === 'evidence'} onClose={close} title="Required evidence" wide
        subtitle="What your in-scope frameworks ask for, what is linked, and matches from your evidence library.">
        <EvidenceWorkspace code={code} />
      </DetailPanel>

      <DetailPanel open={panel === 'procedures'} onClose={close} title="Test procedures"
        subtitle={`Numbered audit test procedures for ${code}.`}>
        {t && <ProcedureChecklist code={code} workItemId={wi.work_item_id} record={t} onChanged={refresh} />}
      </DetailPanel>

      <DetailPanel open={panel === 'effectiveness'} onClose={close} title="Design & effectiveness"
        subtitle="Record design and operating tests, schedule the next one, and sign them off.">
        {t && <DesignEffectiveness code={code} workItem={wi} record={t} onChanged={refresh} />}
      </DetailPanel>

      <DetailPanel open={panel === 'sampling'} onClose={close} title="Sampling"
        subtitle="The sampled evidence used to test this control.">
        {t && <SamplingPanel workItemId={wi.work_item_id} record={t} onChanged={refresh} />}
      </DetailPanel>

      <DetailPanel open={panel === 'details'} onClose={close} title="Testing details"
        subtitle="Priority, progress, key control and how often this control is retested.">
        <TestingDetails key={`${wi.priority}-${wi.implementation_status}-${wi.is_key_control}-${wi.frequency}`}
          code={code} workItem={wi} onChanged={refresh} />
      </DetailPanel>

      <DetailPanel open={panel === 'automated'} onClose={close} title="Collected automatically" wide
        subtitle="Latest result from each connected check. A collector tests the whole population it can see.">
        <AutomatedResults results={results} />
      </DetailPanel>
    </div>
  );
}
