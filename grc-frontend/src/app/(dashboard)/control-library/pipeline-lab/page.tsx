'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import {
  ChevronLeft, Loader2, UploadCloud, CheckCircle2, AlertTriangle, Rocket,
  Trash2, Radar, FileSearch, Layers, GitMerge, Database, FileCheck2, Sparkles,
  FileSpreadsheet, ArrowRight, Library, FlaskConical, Boxes,
} from 'lucide-react';

/* ── auto-trigger pipeline lab ──────────────────────────────────────────────
   A new framework enters the system → this page detects it and runs the whole
   absorb pipeline on its own, showing each phase live. Nothing touches the live
   library until you press "Keep". "Discard" removes the candidate + the upload. */

interface Pending { id: number; name: string; controls: number; domains: number }
type Status = 'watching' | 'running' | 'done' | 'error';

const PHASE_ICON: Record<string, any> = {
  read: FileSearch, domains: Layers, normalize: GitMerge, build: Database, evidence: FileCheck2,
};

export default function PipelineLabPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('watching');
  const [pendingList, setPendingList] = useState<Pending[]>([]);
  const [inBaseline, setInBaseline] = useState<number>(0);
  const [activeFw, setActiveFw] = useState<Pending | null>(null);
  const [job, setJob] = useState<any>(null);          // live job status
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [mock, setMock] = useState<any>(null);        // duplicate-library view + placements
  const fileRef = useRef<HTMLInputElement>(null);
  const handledRef = useRef<Set<number>>(new Set());  // fw ids we've already auto-started
  const jobTimer = useRef<any>(null);

  /* ── detection: poll for frameworks not yet in the live library ──────────── */
  const checkPending = useCallback(async () => {
    try {
      const r = await apiClient.get('/control-library/groups/extend/pending');
      setPendingList(r.data?.pending || []);
      setInBaseline(r.data?.in_baseline || 0);
      return r.data?.pending || [];
    } catch { return []; }
  }, []);

  /* ── start the phased job for a framework ────────────────────────────────── */
  const startJob = useCallback(async (fw: Pending) => {
    handledRef.current.add(fw.id);
    setActiveFw(fw); setStatus('running'); setJob(null); setMsg(null);
    try {
      await apiClient.post('/control-library/groups/extend/start', { framework_id: fw.id });
      pollJob(fw.id);
    } catch (e: any) {
      setStatus('error'); setMsg({ kind: 'err', text: e?.response?.data?.detail || 'Could not start the pipeline.' });
    }
  }, []);

  const pollJob = useCallback((fwId: number) => {
    clearInterval(jobTimer.current);
    jobTimer.current = setInterval(async () => {
      try {
        const r = await apiClient.get(`/control-library/groups/extend/job/${fwId}`);
        setJob(r.data);
        if (r.data?.status === 'done') { clearInterval(jobTimer.current); setStatus('done'); }
        else if (r.data?.status === 'error') { clearInterval(jobTimer.current); setStatus('error'); setMsg({ kind: 'err', text: r.data?.message || 'Pipeline failed.' }); }
      } catch { /* keep polling */ }
    }, 1300);
  }, []);

  /* ── watcher: when idle and something is pending, auto-trigger it ─────────── */
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      if (status !== 'watching') return;
      const pend = await checkPending();
      const next = pend.find((f: Pending) => !handledRef.current.has(f.id));
      if (!next) return;
      handledRef.current.add(next.id);
      // Resume an existing job instead of starting a duplicate: if this framework
      // already has a running/finished absorption, attach to it (don't re-absorb).
      let js: any = null;
      try { js = (await apiClient.get(`/control-library/groups/extend/job/${next.id}`)).data; } catch {}
      if (js?.status === 'running') { setActiveFw(next); setJob(js); setStatus('running'); pollJob(next.id); }
      else if (js?.status === 'done' && js?.result?.candidate_run_id) { setActiveFw(next); setJob(js); setStatus('done'); }
      else startJob(next);
    };
    tick();
    const t = setInterval(tick, 4000);
    return () => { alive = false; clearInterval(t); clearInterval(jobTimer.current); };
  }, [status, checkPending, startJob]);

  /* ── manual upload (the "I drop a seed file" path) ───────────────────────── */
  const onUpload = async (file: File) => {
    setUploading(true); setMsg(null);
    try {
      const fd = new FormData(); fd.append('file', file);
      const r = await apiClient.post('/control-library/groups/extend/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      handledRef.current.delete(r.data.framework_id);     // allow auto-trigger to pick it up
      setMsg({ kind: 'ok', text: `Ingested “${r.data.name}” (${r.data.controls} controls). Detecting & starting the pipeline…` });
      setStatus('watching'); await checkPending();
    } catch (e: any) {
      setMsg({ kind: 'err', text: e?.response?.data?.detail || 'Upload failed — must be a framework seed JSON.' });
    } finally { setUploading(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  /* ── keep / discard the result ───────────────────────────────────────────── */
  const result = job?.result;

  /* ── when done, load the mock (duplicate) library + placements ───────────── */
  useEffect(() => {
    if (status === 'done' && result?.candidate_run_id && activeFw?.id && !mock) {
      apiClient.get(`/control-library/groups/extend/candidate/${result.candidate_run_id}/placements`, { params: { framework_id: activeFw.id } })
        .then((r) => setMock(r.data)).catch(() => {});
    }
  }, [status, result, activeFw, mock]);

  const exportExcel = async () => {
    if (!result?.candidate_run_id || !activeFw?.id) return; setActing('excel');
    try {
      const r = await apiClient.get(`/control-library/groups/extend/candidate/${result.candidate_run_id}/export`, { params: { framework_id: activeFw.id }, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `absorption_run${result.candidate_run_id}.xlsx`; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(url);
    } catch (e: any) { setMsg({ kind: 'err', text: 'Excel export failed.' }); }
    finally { setActing(null); }
  };
  const keep = async () => {
    if (!result?.candidate_run_id) return; setActing('keep');
    try {
      await apiClient.post(`/control-library/groups/extend/promote/${result.candidate_run_id}`);
      setMsg({ kind: 'ok', text: `Kept — “${activeFw?.name}” is now part of your live library.` });
      resetToWatch();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.response?.data?.detail || 'Keep failed.' }); }
    finally { setActing(null); }
  };
  const discard = async () => {
    setActing('discard');
    try {
      if (result?.candidate_run_id) await apiClient.delete(`/control-library/groups/extend/candidate/${result.candidate_run_id}`);
      if (activeFw?.id) await apiClient.delete(`/control-library/groups/extend/framework/${activeFw.id}`);
      setMsg({ kind: 'ok', text: 'Discarded — candidate removed and the upload deleted. Your library is unchanged.' });
      resetToWatch();
    } catch (e: any) { setMsg({ kind: 'err', text: e?.response?.data?.detail || 'Discard failed.' }); }
    finally { setActing(null); }
  };
  const resetToWatch = () => { setStatus('watching'); setJob(null); setActiveFw(null); setMock(null); checkPending(); };

  /* ── render helpers ──────────────────────────────────────────────────────── */
  const phases: { key: string; label: string }[] = job?.phases || [];
  const curIdx = phases.findIndex((p) => p.key === (job?.phase));
  const pct = job?.percent ?? 0;

  const Stat = ({ v, l, grad, icon, warn }: any) => (
    <div className={`rounded-xl border bg-white p-3 ${warn ? 'border-red-200' : 'border-slate-200'}`}>
      <div className="flex items-center justify-between">
        <span className="text-2xl font-bold tabular-nums text-slate-900">{v}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${grad} text-white`}>{icon}</span>
      </div>
      <div className="mt-1 text-[11px] font-medium text-slate-500">{l}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <button onClick={() => router.push('/control-library')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-primary-700"><ChevronLeft size={14} />Control Library</button>

      {/* header */}
      <div className="relative rounded-2xl bg-gradient-to-br from-violet-600 via-purple-700 to-fuchsia-700 p-6 text-white shadow-sm">
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"><div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" /></div>
        <div className="relative flex items-start gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25"><Radar size={24} /></span>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-violet-100">Auto-pipeline · safe sandbox</div>
            <h1 className="text-2xl font-bold leading-tight">New-Framework Auto-Pipeline</h1>
            <p className="mt-1 max-w-2xl text-sm text-violet-50/90">Drop a new framework into the system and it gets <b>absorbed automatically</b>: read controls → reconcile its domains onto your existing ones → normalize into sets → generate recommended evidence. <b>Your live library is never touched until you press Keep.</b></p>
          </div>
        </div>
      </div>

      {msg && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ${msg.kind === 'ok' ? 'border border-emerald-200 bg-emerald-50 text-emerald-800' : 'border border-red-200 bg-red-50 text-red-700'}`}>
          {msg.kind === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}{msg.text}
        </div>
      )}

      {/* upload */}
      <div className="rounded-xl border border-dashed border-violet-300 bg-violet-50/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><UploadCloud size={20} /></span>
          <div className="min-w-[200px] flex-1">
            <div className="text-sm font-semibold text-slate-800">Add a new framework seed (.json)</div>
            <div className="text-[12px] text-slate-500">Simulates a developer seeding a framework. Once ingested, the pipeline triggers on its own below.</div>
          </div>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">
            {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />Ingesting…</> : <><UploadCloud className="h-4 w-4" />Upload seed file</>}
          </button>
        </div>
      </div>

      {/* WATCHING */}
      {status === 'watching' && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          {pendingList.length === 0 ? (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><CheckCircle2 size={18} /></span>
              <div><div className="font-semibold text-slate-800">Library is up to date</div><div className="text-[12px] text-slate-500">{inBaseline} frameworks in your live library. Watching for new ones…</div></div>
              <Loader2 className="ml-auto h-4 w-4 animate-spin text-slate-300" />
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100 text-amber-600"><Radar size={18} className="animate-pulse" /></span>
              <div><div className="font-semibold text-slate-800">New framework detected — starting the pipeline…</div><div className="text-[12px] text-slate-500">{pendingList.map((p) => `${p.name} (${p.controls} controls)`).join(', ')}</div></div>
              <Loader2 className="ml-auto h-4 w-4 animate-spin text-violet-400" />
            </div>
          )}
        </div>
      )}

      {/* RUNNING / DONE — phase timeline */}
      {(status === 'running' || status === 'done') && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
            {status === 'done' ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Loader2 className="h-4 w-4 animate-spin text-violet-600" />}
            {status === 'done' ? 'Absorption complete' : 'Absorbing'} <span className="text-violet-700">{activeFw?.name || job?.framework}</span>
          </div>
          {/* progress bar */}
          <div className="mb-4 mt-2">
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full rounded-full transition-all duration-500 ${status === 'done' ? 'bg-emerald-500' : 'bg-violet-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-[12px] text-slate-500">{job?.message || 'Starting…'}</div>
          </div>

          {/* the 5 phases */}
          <ol className="space-y-2">
            {phases.map((p, i) => {
              const Icon = PHASE_ICON[p.key] || Sparkles;
              const state = status === 'done' ? 'done' : i < curIdx ? 'done' : i === curIdx ? 'active' : 'todo';
              return (
                <li key={p.key} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${state === 'active' ? 'border-violet-200 bg-violet-50/50' : state === 'done' ? 'border-emerald-100 bg-emerald-50/30' : 'border-slate-100 bg-slate-50/40'}`}>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${state === 'done' ? 'bg-emerald-500 text-white' : state === 'active' ? 'bg-violet-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                    {state === 'done' ? <CheckCircle2 size={15} /> : state === 'active' ? <Loader2 size={15} className="animate-spin" /> : <Icon size={15} />}
                  </span>
                  <span className={`text-sm ${state === 'todo' ? 'text-slate-400' : 'text-slate-700 font-medium'}`}>{p.label}</span>
                  {/* live numbers per phase */}
                  <span className="ml-auto text-[12px] tabular-nums text-slate-500">
                    {p.key === 'read' && job?.new_controls != null && `${job.new_controls} controls · ${job?.evidence_in ?? 0} evidence · ${job?.artifacts_in ?? 0} artifacts`}
                    {p.key === 'domains' && job?.domains_used && `${job.domains_used.length} domains · ${(job?.new_domains?.length ?? 0)} new`}
                    {p.key === 'normalize' && job?.would_join != null && `${job.would_join} join · ${job.would_standalone} standalone`}
                    {p.key === 'build' && job?.candidate_run_id && `candidate #${job.candidate_run_id}`}
                    {p.key === 'evidence' && job?.evidence_merged != null && `${job.evidence_merged} merged · ${job.sets_evidence_enriched} sets`}
                    {p.key === 'artifacts' && job?.artifacts_new != null && `${job.artifacts_new} new · ${job.artifacts_duplicate} deduped`}
                  </span>
                </li>
              );
            })}
          </ol>

          {/* DONE — summary + keep / discard */}
          {status === 'done' && result && (
            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Stat v={result.new_controls} l="Controls absorbed" grad="from-sky-500 to-blue-600" icon={<FileSearch className="h-4 w-4" />} />
                <Stat v={result.would_join} l="Joined existing sets" grad="from-primary-500 to-primary-700" icon={<GitMerge className="h-4 w-4" />} />
                <Stat v={result.would_standalone} l="New (standalone)" grad="from-slate-400 to-slate-600" icon={<Layers className="h-4 w-4" />} />
                <Stat v={result.new_domains?.length ?? 0} warn={(result.new_domains?.length ?? 0) > 0} l="New domains (want 0)" grad={(result.new_domains?.length ?? 0) > 0 ? 'from-red-500 to-rose-600' : 'from-emerald-500 to-teal-600'} icon={<Database className="h-4 w-4" />} />
              </div>
              {/* evidence + artifact normalization strip */}
              <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><FileCheck2 className="h-3.5 w-3.5" />Evidence normalized</div>
                  <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">{result.evidence_merged ?? 0} <span className="text-[12px] font-normal text-slate-500">merged into {result.sets_evidence_enriched ?? 0} sets</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{result.evidence_deduped ?? 0} already covered{(result.evidence_generated ?? 0) > 0 ? ` · ${result.evidence_generated} generated` : ''}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Boxes className="h-3.5 w-3.5" />Artifacts normalized</div>
                  <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">{result.artifacts_new ?? 0} <span className="text-[12px] font-normal text-slate-500">new · {result.artifacts_duplicate ?? 0} deduped</span></div>
                  <div className="mt-0.5 text-[11px] text-slate-400">{result.artifacts_total ?? 0} carried by the framework</div>
                </div>
              </div>
              <div className="mt-2.5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-2.5 text-[11.5px] text-emerald-800">
                Domains reconciled onto your existing library: <b>{result.domains_used?.join(', ')}</b>
                {(result.new_domains?.length ?? 0) === 0 ? <span className="ml-1 font-semibold">— no new domains created ✓</span> : <span className="ml-1 font-semibold text-red-600">⚠ created: {result.new_domains.join(', ')}</span>}
              </div>
              {/* MOCK / DUPLICATE LIBRARY — live vs sandbox copy */}
              {mock && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800"><Library className="h-4 w-4 text-violet-600" />Mock library (sandbox copy) — your live library is untouched</div>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500"><Database className="h-3.5 w-3.5" />Live library · run #{mock.live?.run_id}</div>
                      <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{mock.live?.total} <span className="text-[12px] font-normal text-slate-500">entries · {mock.live?.domains} domains</span></div>
                      <div className="mt-0.5 text-[11px] text-emerald-600">untouched ✓</div>
                    </div>
                    <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-violet-600"><FlaskConical className="h-3.5 w-3.5" />Mock copy · run #{mock.candidate_run_id}</div>
                      <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums">{mock.mock?.total} <span className="text-[12px] font-normal text-slate-500">entries · {mock.mock?.domains} domains</span></div>
                      <div className="mt-0.5 text-[11px] text-violet-700">+{mock.mock?.enriched_sets} sets enriched · +{mock.mock?.new_entries} new standalone</div>
                    </div>
                  </div>

                  {/* per-domain composition */}
                  <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
                    <table className="w-full text-[12px]">
                      <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr><th className="px-3 py-1.5 text-left font-semibold">Library domain</th><th className="px-3 py-1.5 text-right font-semibold">Existing</th><th className="px-3 py-1.5 text-right font-semibold">+ From {mock.framework?.split('(')[0]?.trim() || 'framework'}</th><th className="px-3 py-1.5 text-right font-semibold">Total</th></tr>
                      </thead>
                      <tbody>
                        {(mock.per_domain || []).filter((d: any) => d.added > 0).map((d: any) => (
                          <tr key={d.domain} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 text-slate-700">{d.domain}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-400">{d.baseline}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-violet-700">+{d.added}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{d.total}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* VISIBLE PIPELINE: each control → where it landed in the mock library */}
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Pipeline: framework control → mock library ({mock.placements?.length})</div>
                    <button onClick={exportExcel} disabled={!!acting} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12px] font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      {acting === 'excel' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="h-3.5 w-3.5" />}Export to Excel
                    </button>
                  </div>
                  <div className="mt-2 max-h-80 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/40 p-2">
                    {(mock.placements || []).map((p: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px]">
                        <span className="shrink-0 font-mono text-[11px] text-slate-400">{p.control_id}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-700" title={p.title}>{p.title}</span>
                        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                        {p.disposition === 'joined' ? (
                          <span className="shrink-0 max-w-[45%] truncate rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700" title={`joined set: ${p.joined_set}`}>↳ {p.joined_set}</span>
                        ) : (
                          <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">standalone</span>
                        )}
                        <span className="shrink-0 text-[10.5px] text-slate-400">[{p.canonical_domain}]</span>
                      </div>
                    ))}
                  </div>

                  {/* ARTIFACT normalization — new vs deduped against the unified catalog */}
                  {mock.artifacts && (mock.artifacts.artifacts_total ?? 0) > 0 && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <Boxes className="h-3.5 w-3.5" />Artifacts normalized ({mock.artifacts.artifacts_new} new · {mock.artifacts.artifacts_duplicate} deduped)
                      </div>
                      <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/40 p-2">
                        {(mock.artifacts.artifacts_new_sample || []).map((a: any, i: number) => (
                          <div key={`n${i}`} className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-2.5 py-1.5 text-[12px]">
                            <span className="shrink-0 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">NEW</span>
                            <span className="min-w-0 flex-1 truncate text-slate-700" title={a.artifact}>{a.artifact}</span>
                            <span className="shrink-0 text-[10.5px] text-slate-400">{a.type}</span>
                          </div>
                        ))}
                        {(mock.artifacts.artifacts_dup_sample || []).map((a: any, i: number) => (
                          <div key={`d${i}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[12px]">
                            <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">DEDUPED</span>
                            <span className="min-w-0 flex-1 truncate text-slate-700" title={a.artifact}>{a.artifact}</span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" />
                            <span className="shrink-0 max-w-[40%] truncate text-[10.5px] text-slate-400" title={`${a.matches} (${a.in_framework})`}>≈ {a.matches}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[12px] text-slate-600">
                Built as candidate library <b>#{result.candidate_run_id}</b> — your live library is still untouched. Choose:
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={keep} disabled={!!acting} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {acting === 'keep' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}Keep — make it live
                </button>
                <button onClick={discard} disabled={!!acting} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-red-300 hover:bg-red-50 disabled:opacity-50">
                  {acting === 'discard' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Discard
                </button>
                <span className="text-[11px] text-slate-400">Keep promotes the candidate to your live library (reversible). Discard removes the candidate and the upload.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ERROR */}
      {status === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle size={16} />The pipeline hit an error</div>
          <div className="mt-1 text-[12.5px]">{job?.message || msg?.text}</div>
          <button onClick={resetToWatch} className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm hover:bg-red-100">Back to watching</button>
        </div>
      )}
    </div>
  );
}
