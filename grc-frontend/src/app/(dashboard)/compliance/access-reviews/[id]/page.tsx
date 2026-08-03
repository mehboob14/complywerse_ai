'use client';
// src/app/(dashboard)/compliance/access-reviews/[id]/page.tsx
// Review detail = gated 6-stage pipeline rail + per-stage action, the Certify
// table + per-user side panel (stage 4), and the Report (stage 5/6).
// Visual spec: "Access Reviews.dc.html" (review / certify / report screens).

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Check, Lock, RefreshCw, BarChart3, ClipboardCheck,
  PenLine, FileText, ShieldCheck, X, Sparkles, Paperclip, Info, ArrowRight,
} from 'lucide-react';
import { PageLoader } from '@/components/ui';
import {
  useCampaign, useReport, useSyncPopulation, useDrawSample, useRunChecks,
  useCloseCampaign, useSetDecision, useUploadEvidence, reportExportUrl,
} from '../api';
import {
  STAGES, statusToStage, stageState, isClosed, scopeLabel,
  severityClass, decisionClass, decisionLabel, riskClass,
} from '../pipeline';
import type { ReviewItem, Decision } from '../types';

const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;
const stageIcon = [RefreshCw, BarChart3, ClipboardCheck, PenLine, FileText, Lock];

export default function ReviewDetailPage() {
  const router = useRouter();
  const id = Number(useParams().id);
  // Backend keeps status at 'in_review' through certify+report (no 'reporting'
  // status), so the report view is opened via ?stage=report from "Continue".
  const wantReport = useSearchParams().get('stage') === 'report';
  const { data: c, isLoading } = useCampaign(id);
  const sync = useSyncPopulation(); const sample = useDrawSample();
  const checks = useRunChecks(); const close = useCloseCampaign();
  const [sel, setSel] = useState<number | null>(null);

  if (isLoading || !c) return <PageLoader />;
  const stage = statusToStage(c.status);
  const closed = isClosed(c.status);
  const reviewedCount = c.items.filter((i) => i.decision !== 'pending').length;

  const stats = [
    { k: 'Population', v: c.population_size, s: 'in scope' },
    { k: 'Sample', v: stage >= 2 || closed ? c.requested_sample_size : '—', s: stage >= 2 || closed ? 'frozen snapshot' : 'not drawn' },
    { k: 'Findings', v: stage >= 3 || closed ? c.exceptions_found : '—', s: stage >= 3 || closed ? 'across sample' : 'not run' },
    { k: 'Certified', v: stage >= 4 || closed ? `${reviewedCount}/${c.requested_sample_size}` : '—', s: stage >= 4 || closed ? 'reviewed' : 'pending' },
  ];

  const advance = () => {
    if (stage === 1) sync.mutate(id);
    else if (stage === 2) sample.mutate(id);
    else if (stage === 3) checks.mutate(id);
    else if (stage === 6) close.mutate(id);
  };
  const stagePending = sync.isPending || sample.isPending || checks.isPending || close.isPending;
  const cur = STAGES[stage - 1];
  const CurIcon = stageIcon[stage - 1];

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-7 pb-16">
      <button onClick={() => router.push('/compliance/access-reviews')} className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><ChevronLeft size={14} /> Access Reviews</button>
      <h1 className="text-[21px] font-bold tracking-tight text-slate-900">{c.name}</h1>
      <div className="mt-1 font-mono text-[12.5px] text-slate-400">AR-{c.id} · {scopeLabel[c.review_type] ?? c.review_type} · {c.sampling_method}</div>

      <div className="my-6 grid grid-cols-4 gap-3.5">
        {stats.map((s) => (
          <div key={s.k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1.5 text-[11.5px] font-medium text-slate-500">{s.k}</div>
            <div className="font-mono text-[23px] font-bold tracking-tight text-slate-900">{s.v}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{s.s}</div>
          </div>
        ))}
      </div>

      {/* pipeline rail */}
      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-[18px] text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Review pipeline</div>
        <div className="flex items-start">
          {STAGES.map((s, i) => {
            const st = stageState(s.n, stage, closed);
            const Icon = stageIcon[i];
            return (
              <div key={s.n} className="flex flex-1 items-start">
                <div className="flex w-[88px] flex-col items-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full"
                    style={st === 'done' ? ACCENT : st === 'current' ? { background: '#fff', color: 'var(--color-base-strong)', boxShadow: '0 0 0 2px var(--color-base), 0 0 0 6px var(--color-base-soft)' } : { background: '#fff', color: '#8A94A1', border: '1px solid #E4E8EC' }}>
                    {st === 'done' ? <Check size={18} /> : st === 'locked' ? <Lock size={16} /> : <Icon size={18} />}
                  </div>
                  <div className={`mt-2 text-center text-xs font-semibold ${st === 'current' ? 'text-slate-900' : st === 'done' ? 'text-slate-500' : 'text-slate-400'}`}>{s.label}</div>
                </div>
                {i < STAGES.length - 1 && <div className="mt-[19px] h-0.5 flex-1" style={{ background: st === 'done' ? 'var(--color-base)' : '#E4E8EC' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* gated current-stage action (stages 1–3, 6) */}
      {!closed && stage <= 3 && (
        <div className="flex items-center gap-5 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: 'var(--color-base)', boxShadow: '0 0 0 1px var(--color-base)' }}>
          <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--color-base-soft)', color: 'var(--color-base-strong)' }}><CurIcon size={24} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-base-strong)' }}>Current stage · {stage} of 6</div>
            <div className="text-base font-bold text-slate-900">{cur.label}</div>
            <div className="text-[13px] text-slate-500">{cur.desc}</div>
          </div>
          <button onClick={advance} disabled={stagePending} style={ACCENT} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-5 py-2.5 text-[13.5px] font-semibold shadow-sm disabled:opacity-60">
            {stagePending ? 'Working…' : cur.label} <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* stage 4 — certify */}
      {!closed && stage === 4 && !wantReport && (
        <CertifyBlock campaignId={id} items={c.items} sampleSize={c.requested_sample_size} sel={sel} setSel={setSel} onContinue={() => router.push(`/compliance/access-reviews/${id}?stage=report`)} />
      )}

      {/* stage 5/6 — report (also reachable from certify via ?stage=report) */}
      {(stage >= 5 || closed || (stage === 4 && wantReport)) && (
        <>
          {!closed && stage === 4 && wantReport && (
            <button onClick={() => router.push(`/compliance/access-reviews/${id}`)} className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><ChevronLeft size={14} /> Back to certify</button>
          )}
          <ReportBlock campaignId={id} closed={closed} onClose={() => close.mutate(id)} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Certify
function CertifyBlock({ campaignId, items, sampleSize, sel, setSel, onContinue }: {
  campaignId: number; items: ReviewItem[]; sampleSize: number; sel: number | null; setSel: (n: number | null) => void; onContinue: () => void;
}) {
  const setDecision = useSetDecision(campaignId);
  const [filter, setFilter] = useState<'all' | 'flagged' | 'pending' | 'decided'>('all');
  const [q, setQ] = useState('');
  const decided = items.filter((i) => i.decision !== 'pending').length;
  const pct = sampleSize ? Math.round((decided / sampleSize) * 100) : 0;
  const remaining = items.filter((i) => i.decision === 'pending').length;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items
      .filter((u) => (filter === 'flagged' ? u.findings.length : filter === 'pending' ? u.decision === 'pending' : filter === 'decided' ? u.decision !== 'pending' : true))
      .filter((u) => !t || [u.display_name, u.email, u.department].some((s) => s?.toLowerCase().includes(t)))
      .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  }, [items, filter, q]);

  const counts = { all: items.length, flagged: items.filter((i) => i.findings.length).length, pending: remaining, decided };
  const selUser = items.find((u) => u.id === sel) ?? null;
  const aiWord = (r?: string | null) => (r === 'revoke' ? 'Revoke' : r === 'approved' || r === 'approve' ? 'Approve' : r === 'exception' ? 'Exception' : '—');

  return (
    <>
      {/* context bar = single guidance element */}
      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-[18px] shadow-sm">
        <div className="flex flex-wrap items-center gap-[18px]">
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex h-[38px] w-[38px] items-center justify-center rounded-xl" style={{ background: 'var(--color-base-soft)', color: 'var(--color-base-strong)' }}><PenLine size={20} /></div>
            <div><div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-base-strong)' }}>Stage 4 · Certify</div><div className="text-sm font-bold text-slate-900">Decide on each sampled user</div></div>
          </div>
          <div className="min-w-[180px] flex-1">
            <div className="mb-1 flex items-center justify-between"><span className="text-[11.5px] font-medium text-slate-500">{decided} of {sampleSize} certified</span><span className="font-mono text-[11.5px] font-semibold" style={{ color: 'var(--color-base-strong)' }}>{pct}%</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--color-base)' }} /></div>
          </div>
          <div className="flex shrink-0 gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(['all', 'flagged', 'pending', 'decided'] as const).map((k) => (
              <button key={k} onClick={() => setFilter(k)} style={filter === k ? { background: '#fff' } : undefined}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold capitalize ${filter === k ? 'text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {k}<span className="rounded-full bg-slate-100 px-1.5 font-mono text-[10.5px] text-slate-400">{counts[k]}</span>
              </button>
            ))}
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="w-[170px] rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12.5px] outline-none" />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-[11.5px] text-slate-400">{remaining ? `${remaining} pending` : 'All decided'}</span>
            <button disabled={remaining > 0} onClick={onContinue} style={remaining === 0 ? ACCENT : undefined}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold ${remaining === 0 ? 'shadow-sm' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}>
              Continue to report <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto"><div className="min-w-[860px]">
          <div className="grid grid-cols-[2.3fr_64px_1.2fr_1.1fr_132px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
            <div>User</div><div>Risk</div><div>Findings</div><div>AI suggestion</div><div className="text-right">Decision</div>
          </div>
          {rows.map((u) => {
            const top = u.findings.reduce<string>((m, f) => (['low', 'medium', 'high', 'critical'].indexOf(f.severity) > ['low', 'medium', 'high', 'critical'].indexOf(m) ? f.severity : m), 'low');
            return (
              <button key={u.id} onClick={() => setSel(u.id)} className={`grid w-full grid-cols-[2.3fr_64px_1.2fr_1.1fr_132px] items-center gap-4 border-b border-slate-100 px-5 py-3.5 text-left hover:bg-slate-50 ${sel === u.id ? 'bg-[color:var(--color-base-soft)]' : ''}`}>
                <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-slate-900">{u.display_name}</div><div className="truncate text-[11px] text-slate-400">{u.department} · {u.designation}</div></div>
                <div><span className={`inline-flex h-6 min-w-[34px] items-center justify-center rounded-md px-2 font-mono text-[12.5px] font-semibold ${riskClass(u.risk_score)}`}>{u.risk_score ?? 0}</span></div>
                <div>{u.findings.length ? <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${severityClass[top as keyof typeof severityClass]}`}>{u.findings.length} finding{u.findings.length > 1 ? 's' : ''}</span> : <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-600"><Check size={13} /> clean</span>}</div>
                <div><span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500"><span className="text-[9px] tracking-wide text-slate-400">AI</span>{aiWord(u.ai_recommendation)}</span></div>
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  {u.decision !== 'pending' ? (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${decisionClass[u.decision]}`}>{decisionLabel[u.decision]}</span>
                  ) : (
                    <div className="flex gap-1.5">
                      {(['approved', 'revoke', 'exception'] as Decision[]).map((d) => (
                        <button key={d} title={decisionLabel[d]} onClick={() => setDecision.mutate({ itemId: u.id, decision: d })}
                          className="flex h-[26px] w-7 items-center justify-center rounded-md border border-slate-200 text-slate-400 hover:bg-slate-100">
                          {d === 'approved' ? <Check size={14} /> : d === 'revoke' ? <X size={14} /> : <Info size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div></div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[11.5px] text-slate-400"><Info size={13} /> Revoke records an instruction to remove access — disabling it in the source is a separate remediation step.</div>

      {selUser && <UserPanel campaignId={campaignId} user={selUser} onClose={() => setSel(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- Side panel
function UserPanel({ campaignId, user, onClose }: { campaignId: number; user: ReviewItem; onClose: () => void }) {
  const setDecision = useSetDecision(campaignId);
  const uploadEvidence = useUploadEvidence(campaignId);
  const [note, setNote] = useState('');
  const aiMeta = user.ai_recommendation === 'revoke' ? ['Revoke', 'text-rose-600'] : user.ai_recommendation === 'exception' ? ['Exception', 'text-amber-600'] : ['Approve', 'text-emerald-600'];

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[480px] max-w-[94%] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-5 pb-4 pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{user.display_name?.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
            <div className="min-w-0 flex-1"><div className="text-base font-bold text-slate-900">{user.display_name}</div><div className="text-xs text-slate-400">{user.email}</div></div>
            <span className={`inline-flex h-6 min-w-[34px] items-center justify-center rounded-md px-2 font-mono text-[12.5px] font-semibold ${riskClass(user.risk_score)}`}>{user.risk_score ?? 0}</span>
            <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"><X size={15} /></button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {user.is_privileged && <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-semibold text-orange-700">privileged</span>}
            {user.is_terminated && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">terminated</span>}
            {user.is_anomaly && <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">anomaly</span>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-5 grid grid-cols-2 gap-x-4 gap-y-3.5 text-[13px]">
            <Field k="Department" v={user.department} /><Field k="Title" v={user.designation} />
            <div className="col-span-2"><K>Roles</K><div className="font-semibold text-slate-800">{user.roles.join(', ') || '—'}</div></div>
            <div><K>MFA</K><div className={`font-semibold ${user.mfa_enabled ? 'text-emerald-600' : 'text-rose-600'}`}>{user.mfa_enabled ? 'Enabled' : 'Not enabled'}</div></div>
            <Field k="Account" v={user.account_enabled ? 'active' : 'disabled'} />
            <Field k="Last sign-in" v={user.last_sign_in ?? '—'} /><Field k="Terminated" v={user.termination_date ?? '—'} />
          </div>

          {user.findings.length > 0 && <>
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Findings</div>
            <div className="mb-5 flex flex-col gap-2.5">
              {user.findings.map((f) => (
                <div key={f.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center gap-2"><span className="text-[13px] font-semibold text-slate-900">{f.title}</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${severityClass[f.severity]}`}>{f.severity}</span></div>
                  {f.detail && <div className="mt-1 text-[11.5px] text-slate-500">{f.detail}</div>}
                  <div className="mt-2 font-mono text-[10.5px] text-slate-400">{f.type}</div>
                </div>
              ))}
            </div>
          </>}

          {/* AI suggestion — assistive, subordinate */}
          <div className="mb-5 rounded-lg border border-dashed border-slate-300 bg-white p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5"><Sparkles size={14} className="text-slate-400" /><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">AI suggestion · assistive</span><span className={`ml-auto text-[11.5px] font-bold ${aiMeta[1]}`}>{aiMeta[0]}</span></div>
            <div className="text-[12.5px] leading-relaxed text-slate-600">{user.ai_reason ?? 'No recommendation generated.'}</div>
            <div className="mt-2 text-[11px] italic text-slate-400">You decide — this does not change the record.</div>
          </div>

          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">Your decision</div>
          <div className="mb-3.5 flex gap-2.5">
            {([['approved', 'Approve', Check], ['revoke', 'Revoke', X], ['exception', 'Exception', Info]] as const).map(([d, label, Icon]) => {
              const on = user.decision === d; const col = d === 'approved' ? '#2D6A4F' : d === 'revoke' ? '#B42318' : '#A45D0A';
              return (
                <button key={d} onClick={() => setDecision.mutate({ itemId: user.id, decision: d, note })}
                  className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border-[1.5px] py-3 text-[12.5px] font-semibold"
                  style={{ borderColor: on ? col : '#E4E8EC', background: on ? col : '#fff', color: on ? '#fff' : '#586472' }}>
                  <Icon size={18} /> {label}
                </button>
              );
            })}
          </div>
          {user.decision === 'revoke' && (
            <div className="mb-3.5 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[11.5px] leading-snug text-rose-700"><Info size={14} className="mt-0.5 shrink-0" /> Recorded as a revoke instruction. Disabling the account in the source is a separate remediation step.</div>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a justification (recorded as audit evidence)…" className="mb-3 min-h-[64px] w-full resize-y rounded-md border border-slate-200 bg-slate-50 p-3 text-[12.5px] outline-none" />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-600">
            <Paperclip size={14} /> {user.evidence_id ? 'Evidence attached' : 'Attach evidence'}
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadEvidence.mutate({ itemId: user.id, file: e.target.files[0] })} />
          </label>
        </div>
      </div>
    </div>
  );
}
const K = ({ children }: { children: React.ReactNode }) => <div className="mb-0.5 text-[11px] font-medium text-slate-400">{children}</div>;
const Field = ({ k, v }: { k: string; v?: string | null }) => <div><K>{k}</K><div className="font-semibold text-slate-800">{v || '—'}</div></div>;

// ---------------------------------------------------------------- Report
function ReportBlock({ campaignId, closed, onClose }: { campaignId: number; closed: boolean; onClose: () => void }) {
  const { data: r, isLoading } = useReport(campaignId);
  if (isLoading || !r) return <PageLoader />;
  const verdictColor = r.verdict?.toLowerCase().includes('pass') && !r.verdict.toLowerCase().includes('exception') ? '#2D6A4F' : r.verdict?.toLowerCase().includes('progress') ? '#1D6FE0' : '#A45D0A';
  const sevRows = ['critical', 'high', 'medium', 'low'].map((s) => ({ s, n: r.findings_by_severity[s] ?? 0 }));
  const decRows = [['approved', 'Approved', '#2D6A4F'], ['revoke', 'Revoked', '#B42318'], ['exception', 'Exception', '#A45D0A'], ['pending', 'Pending', '#8A94A1']] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div><h2 className="text-lg font-bold text-slate-900">Certification report</h2></div>
        <div className="flex gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
            <a key={f} href={reportExportUrl(campaignId, f)} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-slate-600"><FileText size={15} /> {f.toUpperCase()}</a>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-7 rounded-2xl border p-5" style={{ borderColor: verdictColor, background: `${verdictColor}14` }}>
        <div><div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Verdict</div><div className="flex items-center gap-2 text-[15px] font-bold" style={{ color: verdictColor }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: verdictColor }} />{r.verdict}</div></div>
        {[['Population', r.population_size], ['Sample', r.sample_size], ['Findings', r.exceptions_total], ['Exceptions', r.exceptions_open ?? r.decisions.exception ?? 0]].map(([k, v]) => (
          <div key={k as string}><div className="mb-0.5 text-[11px] text-slate-400">{k}</div><div className="font-mono text-[22px] font-bold text-slate-900">{v as number}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Panel title="Decisions">{decRows.map(([k, label, col]) => <Bar key={k} label={label} n={r.decisions[k] ?? 0} total={r.sample_size} color={col} />)}</Panel>
        <Panel title="Findings by severity">{sevRows.map(({ s, n }) => <Bar key={s} label={s[0].toUpperCase() + s.slice(1)} n={n} total={r.exceptions_total} color={s === 'critical' ? '#B42318' : s === 'high' ? '#C2410C' : s === 'medium' ? '#A45D0A' : '#586472'} />)}</Panel>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5">
        <div className="mb-2.5 flex items-center gap-2"><Sparkles size={15} className="text-slate-400" /><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">AI summary · supplementary</span></div>
        <div className="text-[13px] leading-relaxed text-slate-700">{r.ai_summary ?? 'Generate an AI summary from the recorded decisions.'}</div>
      </div>

      {closed ? (
        <div className="flex items-center gap-4 rounded-2xl border border-emerald-600 bg-emerald-50 p-5">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-white text-emerald-700"><Lock size={22} /></div>
          <div className="flex-1"><div className="text-[15px] font-bold text-emerald-700">Sealed — read-only audit evidence</div><div className="mt-0.5 text-xs text-slate-500">All decisions and findings are locked.</div></div>
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: 'var(--color-base)', boxShadow: '0 0 0 1px var(--color-base)' }}>
          <div className="flex-1"><div className="text-[15px] font-bold text-slate-900">Seal & close this review</div><div className="mt-0.5 text-[12.5px] text-slate-500">Locks all decisions and findings as read-only audit evidence. This cannot be undone.</div></div>
          <button onClick={onClose} style={ACCENT} className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[13.5px] font-semibold shadow-sm"><Lock size={17} /> Seal & close</button>
        </div>
      )}
    </div>
  );
}
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-3.5 text-[13px] font-bold text-slate-900">{title}</div>{children}</div>
);
const Bar = ({ label, n, total, color }: { label: string; n: number; total: number; color: string }) => (
  <div className="mb-3"><div className="mb-1.5 flex items-center justify-between"><span className="text-[12.5px] font-medium text-slate-500">{label}</span><span className="font-mono text-[13px] font-semibold" style={{ color }}>{n}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${total ? Math.round((n / total) * 100) : 0}%`, background: color }} /></div></div>
);
