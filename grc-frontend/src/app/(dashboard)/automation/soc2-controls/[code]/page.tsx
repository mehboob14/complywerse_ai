'use client';

// SOC 2 control detail — faithful to the Verity reference control-detail-page:
// breadcrumb, header (code · status · sub-type · category + Run test), tabbed
// body (Overview / Evidence / Tests / Requirements / History) and a right rail
// (Status facts · Framework mappings · Related controls). Tests + Run test are
// wired live to /automation/soc2 (the GitHub/AWS checks actually execute here).

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertCircle, ChevronRight, FileText, Loader2, Play, Users,
} from 'lucide-react';
import { automationApi } from '@/lib/api';
import {
  CodeChip, ControlStatusPill, SubTypeChip, CONTROL_STATUS,
  type Soc2Control, type Soc2Criterion, type LinkedCheck,
} from '@/components/soc2/ui';

const SOURCE_BADGE: Record<string, string> = {
  connector: 'bg-indigo-100 text-indigo-800',
  aws: 'bg-amber-100 text-amber-800',
};
const sevCls = (s: string | null) =>
  /crit|high/.test(s || '') ? 'text-rose-600' : /med/.test(s || '') ? 'text-amber-600' : 'text-slate-400';

type Tab = 'overview' | 'evidence' | 'tests' | 'requirements' | 'history';

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function Fact({ label, value, muted = false }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-100 py-2.5 last:border-0">
      <span className="shrink-0 text-sm text-slate-400">{label}</span>
      <span className={`min-w-0 text-right text-sm font-semibold ${muted ? 'text-slate-300' : 'text-slate-700'}`}>{value}</span>
    </div>
  );
}

function CheckRow({ chk, onRan }: { chk: LinkedCheck; onRan: () => void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; msg?: string } | null>(null);
  const run = async () => {
    if (!chk.id) return;
    setBusy(true);
    try {
      const r = await automationApi.runCheck(chk.id);
      const run = (r.data as { run?: { status?: string } })?.run;
      setResult({ status: run?.status || 'done' });
      onRan();
    } catch (e: unknown) {
      setResult({ status: 'error', msg: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed' });
    } finally {
      setBusy(false);
    }
  };
  const status = result?.status || chk.last_run?.status || 'not_run';
  const st = CONTROL_STATUS[status] || CONTROL_STATUS.not_run;
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium text-slate-700">{chk.title || chk.plugin_key}</span>
          {chk.source && <span className={`rounded px-1 py-0.5 text-[9px] font-bold uppercase ${SOURCE_BADGE[chk.source] || 'bg-slate-100 text-slate-600'}`}>{chk.source}</span>}
          {chk.severity && <span className={`text-[10px] font-semibold uppercase ${sevCls(chk.severity)}`}>{chk.severity}</span>}
        </div>
        {result?.msg && <p className="mt-1 text-[11px] text-rose-600">{result.msg}</p>}
        {chk.last_run?.result_summary && !result?.msg && <p className="mt-1 truncate text-[11px] text-slate-400">{chk.last_run.result_summary}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.cls}`}><span className={`size-1.5 rounded-full ${st.dot}`} />{st.label}</span>
        {chk.id && (
          <button onClick={run} disabled={busy} title="Run this test" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-primary-700 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </button>
        )}
      </div>
    </li>
  );
}

export default function ControlDetailPage() {
  const params = useParams();
  const code = decodeURIComponent(String(params.code || ''));
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');
  const [runningAll, setRunningAll] = useState(false);

  const controlsQ = useQuery({
    queryKey: ['soc2-library'],
    queryFn: () => automationApi.listControls().then((r) => r.data as { controls: Soc2Control[] }),
  });
  const criteriaQ = useQuery({
    queryKey: ['soc2-criteria'],
    queryFn: () => automationApi.listCriteria().then((r) => r.data as { criteria: Soc2Criterion[] }),
  });

  const controls = controlsQ.data?.controls ?? [];
  const control = controls.find((c) => c.control_id === code);
  const criteriaByCode = useMemo(() => {
    const m = new Map<string, Soc2Criterion>();
    for (const c of criteriaQ.data?.criteria ?? []) m.set(c.code, c);
    return m;
  }, [criteriaQ.data]);

  const mappedCriteria = useMemo(
    () => (control?.criteria || []).map((k) => criteriaByCode.get(k)).filter(Boolean) as Soc2Criterion[],
    [control, criteriaByCode],
  );
  const related = useMemo(() => {
    if (!control) return [];
    const mine = new Set(control.criteria || []);
    return controls.filter((c) => c.control_id !== control.control_id && (c.criteria || []).some((k) => mine.has(k))).slice(0, 12);
  }, [control, controls]);

  const runTest = async () => {
    const ids = (control?.checks || []).map((c) => c.id).filter(Boolean) as number[];
    if (!ids.length) return;
    setRunningAll(true);
    for (const id of ids) {
      try { await automationApi.runCheck(id); } catch { /* surfaced per-row */ }
    }
    await qc.invalidateQueries({ queryKey: ['soc2-library'] });
    setRunningAll(false);
  };

  if (controlsQ.isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!control) {
    return (
      <div className="mx-auto max-w-[1200px] py-10 text-center">
        <p className="text-sm text-slate-500">Control <span className="font-mono">{code}</span> not found.</p>
        <Link href="/automation/soc2-controls" className="mt-2 inline-block text-sm font-semibold text-primary-700">← Back to controls</Link>
      </div>
    );
  }

  const lastTested = (control.checks || [])
    .map((c) => c.last_run?.started_at)
    .filter(Boolean)
    .sort()
    .pop();
  const evidence = (control.checks || []).filter((c) => c.last_run);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'evidence', label: 'Evidence', count: evidence.length },
    { id: 'tests', label: 'Tests', count: control.checks?.length || 0 },
    { id: 'requirements', label: 'Requirements', count: mappedCriteria.length },
    { id: 'history', label: 'History' },
  ];

  return (
    <div className="mx-auto max-w-[1200px] px-1 py-1">
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-sm">
        <Link href="/automation/soc2-controls" className="text-slate-400 hover:text-slate-700">Controls</Link>
        <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
        <span className="font-semibold text-slate-700">{control.control_id}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <CodeChip code={control.control_id} />
            <ControlStatusPill status={control.overall_status} />
            {control.importance && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">{control.importance}</span>}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{control.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-500">
            {control.sub_type && (
              <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5 text-slate-400" />{control.sub_type}</span>
            )}
            <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-slate-400" />Unassigned</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{control.category}</span>
          </div>
        </div>
        <button
          onClick={runTest}
          disabled={runningAll || !(control.checks?.length)}
          title={control.checks?.length ? 'Run all automated tests for this control' : 'This control is evidenced manually — no automated test'}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
          Run test
        </button>
      </div>

      <nav aria-label="Sections" className="mb-5 mt-5 flex gap-1 border-b border-slate-200">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative -mb-px flex items-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'text-primary-700' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {t.label}
              {t.count !== undefined && <span className="tabular-nums text-xs text-slate-400">{t.count}</span>}
              {active && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-primary-600" />}
            </button>
          );
        })}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-4">
          {tab === 'overview' && (
            <>
              <Panel title="Control statement">
                <p className="text-sm leading-relaxed text-slate-600">{control.description}</p>
                {control.guidance && (
                  <>
                    <h3 className="mb-2 mt-5 text-sm font-bold text-slate-900">Implementation guidance</h3>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{control.guidance}</p>
                  </>
                )}
              </Panel>
              <Panel title="Automated tests">
                {control.checks?.length ? (
                  <ul className="space-y-2">
                    {control.checks.map((chk, i) => <CheckRow key={i} chk={chk} onRan={() => qc.invalidateQueries({ queryKey: ['soc2-library'] })} />)}
                  </ul>
                ) : (
                  <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-3">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    <p className="text-sm text-slate-600">No automated test covers this control’s criteria yet — it is evidenced manually. Connect a collector on the Connections page to add live checks.</p>
                  </div>
                )}
              </Panel>
            </>
          )}

          {tab === 'tests' && (
            <Panel title="Automated tests">
              {control.checks?.length ? (
                <ul className="space-y-2">
                  {control.checks.map((chk, i) => <CheckRow key={i} chk={chk} onRan={() => qc.invalidateQueries({ queryKey: ['soc2-library'] })} />)}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
                  No automated tests. Continuous tests run against connected systems — connect a collector to cover this control’s criteria.
                </div>
              )}
            </Panel>
          )}

          {tab === 'requirements' && (
            <Panel title="SOC 2 requirements" action={<span className="text-xs text-slate-400">The criterion text this control is written against</span>}>
              {mappedCriteria.length ? (
                <ul className="divide-y divide-slate-100">
                  {mappedCriteria.map((r) => (
                    <li key={r.code} className="py-4 first:pt-0 last:pb-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <CodeChip code={r.code} />
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{r.trust_services_category}</span>
                        {r.is_always_in_scope && <span className="text-[11px] text-slate-400">always in scope</span>}
                      </div>
                      <p className="text-sm leading-relaxed text-slate-700">{r.name}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-amber-600">Not mapped to any criterion.</div>
              )}
            </Panel>
          )}

          {tab === 'evidence' && (
            <Panel title="Evidence">
              {evidence.length ? (
                <ul className="divide-y divide-slate-100">
                  {evidence.map((chk, i) => {
                    const st = CONTROL_STATUS[chk.last_run?.status || 'not_run'] || CONTROL_STATUS.not_run;
                    return (
                      <li key={i} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                        <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-700">{chk.title || chk.plugin_key}</span>
                          <span className="block truncate text-[11px] text-slate-400">{chk.last_run?.started_at ? new Date(chk.last_run.started_at).toLocaleString() : 'collected'}</span>
                        </span>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-bold ${st.cls}`}><span className={`size-1.5 rounded-full ${st.dot}`} />{st.label}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                  No evidence collected yet. Run this control’s tests, or attach evidence from the collectors.
                </div>
              )}
            </Panel>
          )}

          {tab === 'history' && (
            <Panel title="History">
              <div className="rounded-lg border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                Change history is written to the audit trail as controls and evidence are edited.
              </div>
            </Panel>
          )}
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-1 text-base font-bold text-slate-900">Status</h2>
            <Fact label="Implementation" value={<ControlStatusPill status={control.overall_status} inline />} />
            <Fact label="Owner" value="Unassigned" muted />
            <Fact label="Sub-type" value={control.sub_type || '—'} />
            <Fact label="Source" value="Template" />
            <Fact label="Checks" value={`${control.checks_count} linked`} />
            <Fact label="Last tested" value={lastTested ? new Date(lastTested).toLocaleDateString() : 'Not tested'} muted={!lastTested} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 text-base font-bold text-slate-900">Framework mappings</h2>
            {mappedCriteria.length ? (
              <ul className="space-y-2.5">
                {mappedCriteria.map((r) => (
                  <li key={r.code} className="flex items-start gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-50 text-[9px] font-bold text-primary-700">SOC2</span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-700">SOC 2</span>
                      <span className="block truncate text-[11px] text-slate-400">{r.code} · {r.name}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-amber-600">Not mapped to any criterion</p>
            )}
          </section>

          {related.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-1 text-base font-bold text-slate-900">Related controls</h2>
              <p className="mb-3 text-[11px] text-slate-400">Also satisfying a criterion this control covers.</p>
              <div className="flex flex-wrap gap-1.5">
                {related.map((c) => (
                  <Link key={c.control_id} href={`/automation/soc2-controls/${c.control_id}`} title={c.title}>
                    <CodeChip code={c.control_id} className="hover:bg-primary-600 hover:text-white" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
