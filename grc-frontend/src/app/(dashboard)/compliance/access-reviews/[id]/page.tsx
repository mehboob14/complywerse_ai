'use client';
// src/app/(dashboard)/compliance/access-reviews/[id]/page.tsx
// Review detail = compact stats + 6-stage pipeline rail + per-stage action,
// the Certify table (sticky filter bar over an internally-scrolling body, so
// working a long sample doesn't scroll the whole page) + per-user side
// panel (stage 4), and the Report (stage 5/6). Module chrome/back-nav now
// live in layout.tsx — this page owns the review's own content only.
//
// All data/mutation logic is unchanged from before the redesign — same
// hooks, same stage machine (pipeline.ts), same optimistic-update behavior.

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Check, Lock, RefreshCw, BarChart3, ClipboardCheck,
  PenLine, FileText, X, Sparkles, Paperclip, Info,
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

const ACCENT = { background: 'var(--ar-accent)', color: '#fff' } as const;
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
    { k: 'Sample', v: stage >= 2 || closed ? c.requested_sample_size : '—', s: stage >= 2 || closed ? 'frozen' : 'not drawn' },
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
    <div className="px-6 py-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight" style={{ color: 'var(--ar-text)' }}>{c.name}</h1>
          <div className="mt-0.5 font-mono text-[11.5px]" style={{ color: 'var(--ar-text-muted)' }}>AR-{c.id} · {scopeLabel[c.review_type] ?? c.review_type} · {c.sampling_method}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          {stats.map((s) => (
            <div key={s.k} className="rounded-lg border bg-white px-3 py-1.5 text-right" style={{ borderColor: 'var(--ar-border)' }}>
              <div className="text-[9.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ar-text-muted)' }}>{s.k}</div>
              <div className="font-mono text-[15px] font-bold leading-tight" style={{ color: 'var(--ar-text)' }}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* pipeline rail — compact horizontal strip */}
      <div className="mb-4 rounded-xl border bg-white px-6 py-4 shadow-sm" style={{ borderColor: 'var(--ar-border)' }}>
        <div className="flex items-start">
          {STAGES.map((s, i) => {
            const st = stageState(s.n, stage, closed);
            const Icon = stageIcon[i];
            return (
              <div key={s.n} className="flex flex-1 items-start">
                <div className="flex w-[80px] flex-col items-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full"
                    style={st === 'done' ? ACCENT : st === 'current' ? { background: '#fff', color: 'var(--ar-accent-strong)', boxShadow: '0 0 0 2px var(--ar-accent), 0 0 0 5px var(--ar-accent-soft)' } : { background: '#fff', color: '#8A94A1', border: '1px solid #E4E8EC' }}>
                    {st === 'done' ? <Check size={15} /> : st === 'locked' ? <Lock size={13} /> : <Icon size={15} />}
                  </div>
                  <div className="mt-1.5 text-center text-[11px] font-semibold" style={{ color: st === 'current' ? 'var(--ar-text)' : st === 'done' ? 'var(--ar-text-muted)' : '#B4BAC5' }}>{s.label}</div>
                </div>
                {i < STAGES.length - 1 && <div className="mt-[15px] h-0.5 flex-1" style={{ background: st === 'done' ? 'var(--ar-accent)' : '#E4E8EC' }} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* gated current-stage action (stages 1–3, 6) */}
      {!closed && stage <= 3 && (
        <div className="flex items-center gap-4 rounded-xl border bg-white p-5 shadow-sm" style={{ borderColor: 'var(--ar-accent)', boxShadow: '0 0 0 1px var(--ar-accent)' }}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--ar-accent-soft)', color: 'var(--ar-accent-strong)' }}><CurIcon size={21} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-accent-strong)' }}>Current stage · {stage} of 6</div>
            <div className="text-[15px] font-bold" style={{ color: 'var(--ar-text)' }}>{cur.label}</div>
            <div className="text-[12.5px]" style={{ color: 'var(--ar-text-muted)' }}>{cur.desc}</div>
          </div>
          <button onClick={advance} disabled={stagePending} style={ACCENT} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm disabled:opacity-60">
            {stagePending ? 'Working…' : cur.label} <ChevronRight size={14} />
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
            <button onClick={() => router.push(`/compliance/access-reviews/${id}`)} className="mb-3 inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: 'var(--ar-text-muted)' }}><ChevronLeft size={13} /> Back to certify</button>
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
      {/* bounded region: filter bar stays put, the table body scrolls inside it */}
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm" style={{ borderColor: 'var(--ar-border)' }}>
        <div className="max-h-[65vh] overflow-y-auto">
          {/* sticky context bar = single guidance element */}
          <div className="sticky top-0 z-10 border-b px-[18px] py-3.5" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface)' }}>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex shrink-0 items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: 'var(--ar-accent-soft)', color: 'var(--ar-accent-strong)' }}><PenLine size={16} /></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-accent-strong)' }}>Stage 4 · Certify</div><div className="text-[13px] font-bold" style={{ color: 'var(--ar-text)' }}>Decide on each sampled user</div></div>
              </div>
              <div className="min-w-[160px] flex-1">
                <div className="mb-1 flex items-center justify-between"><span className="text-[11px] font-medium" style={{ color: 'var(--ar-text-muted)' }}>{decided} of {sampleSize} certified</span><span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--ar-accent-strong)' }}>{pct}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--ar-accent)' }} /></div>
              </div>
              <div className="flex shrink-0 gap-0.5 rounded-lg border p-0.5" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }}>
                {(['all', 'flagged', 'pending', 'decided'] as const).map((k) => (
                  <button key={k} onClick={() => setFilter(k)} style={filter === k ? { background: '#fff' } : undefined}
                    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-semibold capitalize ${filter === k ? 'shadow-sm' : ''}`}>
                    <span style={{ color: filter === k ? 'var(--ar-text)' : 'var(--ar-text-muted)' }}>{k}</span>
                    <span className="rounded-full bg-slate-100 px-1.5 font-mono text-[10px]" style={{ color: 'var(--ar-text-muted)' }}>{counts[k]}</span>
                  </button>
                ))}
              </div>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" className="w-[160px] rounded-md border px-3 py-1.5 text-[12px] outline-none" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }} />
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>{remaining ? `${remaining} pending` : 'All decided'}</span>
                <button disabled={remaining > 0} onClick={onContinue} style={remaining === 0 ? ACCENT : undefined}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12.5px] font-semibold ${remaining === 0 ? 'shadow-sm' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}>
                  Continue to report <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          <div className="min-w-[860px]">
            <div className="grid grid-cols-[2.3fr_64px_1.2fr_1.1fr_132px] gap-4 border-b px-5 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}>
              <div>User</div><div>Risk</div><div>Findings</div><div>AI suggestion</div><div className="text-right">Decision</div>
            </div>
            {rows.map((u) => {
              const top = u.findings.reduce<string>((m, f) => (['low', 'medium', 'high', 'critical'].indexOf(f.severity) > ['low', 'medium', 'high', 'critical'].indexOf(m) ? f.severity : m), 'low');
              return (
                <button key={u.id} onClick={() => setSel(u.id)} className="grid w-full grid-cols-[2.3fr_64px_1.2fr_1.1fr_132px] items-center gap-4 border-b px-5 py-3 text-left transition-colors hover:bg-[color:var(--ar-surface-alt)]"
                  style={{ borderColor: 'var(--ar-border)', background: sel === u.id ? 'var(--ar-accent-soft)' : undefined }}>
                  <div className="min-w-0"><div className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--ar-text)' }}>{u.display_name}</div><div className="truncate text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>{u.department} · {u.designation}</div></div>
                  <div><span className={`inline-flex h-6 min-w-[34px] items-center justify-center rounded-md px-2 font-mono text-[12px] font-semibold ${riskClass(u.risk_score)}`}>{u.risk_score ?? 0}</span></div>
                  <div>{u.findings.length ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${severityClass[top as keyof typeof severityClass]}`}>{u.findings.length} finding{u.findings.length > 1 ? 's' : ''}</span> : <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600"><Check size={12} /> clean</span>}</div>
                  <div><span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}><span className="text-[9px] tracking-wide" style={{ color: 'var(--ar-text-muted)' }}>AI</span>{aiWord(u.ai_recommendation)}</span></div>
                  <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    {u.decision !== 'pending' ? (
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${decisionClass[u.decision]}`}>{decisionLabel[u.decision]}</span>
                    ) : (
                      <div className="flex gap-1.5">
                        {(['approved', 'revoke', 'exception'] as Decision[]).map((d) => (
                          <button key={d} title={decisionLabel[d]} onClick={() => setDecision.mutate({ itemId: u.id, decision: d })}
                            className="flex h-[26px] w-7 items-center justify-center rounded-md border text-slate-400 hover:bg-slate-100" style={{ borderColor: 'var(--ar-border)' }}>
                            {d === 'approved' ? <Check size={13} /> : d === 'revoke' ? <X size={13} /> : <Info size={13} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ar-text-muted)' }}><Info size={12} /> Revoke records an instruction to remove access — disabling it in the source is a separate remediation step.</div>

      {selUser && <UserPanel campaignId={campaignId} user={selUser} onClose={() => setSel(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- Side panel
function UserPanel({ campaignId, user, onClose }: { campaignId: number; user: ReviewItem; onClose: () => void }) {
  const setDecision = useSetDecision(campaignId);
  const uploadEvidence = useUploadEvidence(campaignId);
  const [note, setNote] = useState('');
  const aiMeta = user.ai_recommendation === 'revoke' ? ['Revoke', '#B42318'] : user.ai_recommendation === 'exception' ? ['Exception', '#B45309'] : ['Approve', '#15803D'];

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[480px] max-w-[94%] flex-col border-l bg-white shadow-2xl" style={{ borderColor: 'var(--ar-border)' }}>
        <div className="border-b px-5 pb-4 pt-5" style={{ borderColor: 'var(--ar-border)' }}>
          <div className="flex items-start gap-3">
            <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">{user.display_name?.split(' ').map((p) => p[0]).slice(0, 2).join('')}</div>
            <div className="min-w-0 flex-1"><div className="text-[15px] font-bold" style={{ color: 'var(--ar-text)' }}>{user.display_name}</div><div className="text-xs" style={{ color: 'var(--ar-text-muted)' }}>{user.email}</div></div>
            <span className={`inline-flex h-6 min-w-[34px] items-center justify-center rounded-md px-2 font-mono text-[12.5px] font-semibold ${riskClass(user.risk_score)}`}>{user.risk_score ?? 0}</span>
            <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}><X size={15} /></button>
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
            <div className="col-span-2"><K>Roles</K><div className="font-semibold" style={{ color: 'var(--ar-text)' }}>{user.roles.join(', ') || '—'}</div></div>
            <div><K>MFA</K><div className={`font-semibold ${user.mfa_enabled ? 'text-emerald-600' : 'text-rose-600'}`}>{user.mfa_enabled ? 'Enabled' : 'Not enabled'}</div></div>
            <Field k="Account" v={user.account_enabled ? 'active' : 'disabled'} />
            <Field k="Last sign-in" v={user.last_sign_in ?? '—'} /><Field k="Terminated" v={user.termination_date ?? '—'} />
          </div>

          {user.findings.length > 0 && <>
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Findings</div>
            <div className="mb-5 flex flex-col gap-2.5">
              {user.findings.map((f) => (
                <div key={f.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }}>
                  <div className="flex items-center gap-2"><span className="text-[13px] font-semibold" style={{ color: 'var(--ar-text)' }}>{f.title}</span><span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase ${severityClass[f.severity]}`}>{f.severity}</span></div>
                  {f.detail && <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ar-text-muted)' }}>{f.detail}</div>}
                  <div className="mt-2 font-mono text-[10.5px]" style={{ color: 'var(--ar-text-muted)' }}>{f.type}</div>
                </div>
              ))}
            </div>
          </>}

          {/* AI suggestion — assistive, subordinate */}
          <div className="mb-5 rounded-lg border border-dashed p-3.5" style={{ borderColor: 'var(--ar-border)' }}>
            <div className="mb-1.5 flex items-center gap-1.5"><Sparkles size={14} style={{ color: 'var(--ar-text-muted)' }} /><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>AI suggestion · assistive</span><span className="ml-auto text-[11.5px] font-bold" style={{ color: aiMeta[1] }}>{aiMeta[0]}</span></div>
            <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ar-text)' }}>{user.ai_reason ?? 'No recommendation generated.'}</div>
            <div className="mt-2 text-[11px] italic" style={{ color: 'var(--ar-text-muted)' }}>You decide — this does not change the record.</div>
          </div>

          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Your decision</div>
          <div className="mb-3.5 flex gap-2.5">
            {([['approved', 'Approve', Check], ['revoke', 'Revoke', X], ['exception', 'Exception', Info]] as const).map(([d, label, Icon]) => {
              const on = user.decision === d; const col = d === 'approved' ? '#2D6A4F' : d === 'revoke' ? '#B42318' : '#A45D0A';
              return (
                <button key={d} onClick={() => setDecision.mutate({ itemId: user.id, decision: d, note })}
                  className="flex flex-1 flex-col items-center gap-1.5 rounded-lg border-[1.5px] py-3 text-[12.5px] font-semibold"
                  style={{ borderColor: on ? col : 'var(--ar-border)', background: on ? col : '#fff', color: on ? '#fff' : '#586472' }}>
                  <Icon size={18} /> {label}
                </button>
              );
            })}
          </div>
          {user.decision === 'revoke' && (
            <div className="mb-3.5 flex items-start gap-2 rounded-lg bg-rose-50 p-3 text-[11.5px] leading-snug text-rose-700"><Info size={14} className="mt-0.5 shrink-0" /> Recorded as a revoke instruction. Disabling the account in the source is a separate remediation step.</div>
          )}
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a justification (recorded as audit evidence)…" className="mb-3 min-h-[64px] w-full resize-y rounded-md border p-3 text-[12.5px] outline-none" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }} />
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-white px-3 py-2 text-[12.5px] font-semibold" style={{ borderColor: 'var(--ar-border)', color: 'var(--ar-text)' }}>
            <Paperclip size={14} /> {user.evidence_id ? 'Evidence attached' : 'Attach evidence'}
            <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && uploadEvidence.mutate({ itemId: user.id, file: e.target.files[0] })} />
          </label>
        </div>
      </div>
    </div>
  );
}
const K = ({ children }: { children: React.ReactNode }) => <div className="mb-0.5 text-[11px] font-medium" style={{ color: 'var(--ar-text-muted)' }}>{children}</div>;
const Field = ({ k, v }: { k: string; v?: string | null }) => <div><K>{k}</K><div className="font-semibold" style={{ color: 'var(--ar-text)' }}>{v || '—'}</div></div>;

// ---------------------------------------------------------------- Report
function ReportBlock({ campaignId, closed, onClose }: { campaignId: number; closed: boolean; onClose: () => void }) {
  const { data: r, isLoading } = useReport(campaignId);
  if (isLoading || !r) return <PageLoader />;
  const verdictColor = r.verdict?.toLowerCase().includes('pass') && !r.verdict.toLowerCase().includes('exception') ? '#2D6A4F' : r.verdict?.toLowerCase().includes('progress') ? '#1D6FE0' : '#A45D0A';
  const sevRows = ['critical', 'high', 'medium', 'low'].map((s) => ({ s, n: r.findings_by_severity[s] ?? 0 }));
  const decRows = [['approved', 'Approved', '#2D6A4F'], ['revoke', 'Revoked', '#B42318'], ['exception', 'Exception', '#A45D0A'], ['pending', 'Pending', '#8A94A1']] as const;

  return (
    <div className="space-y-3.5">
      <div className="flex items-end justify-between">
        <h2 className="text-[16px] font-bold" style={{ color: 'var(--ar-text)' }}>Certification report</h2>
        <div className="flex gap-2">
          {(['csv', 'xlsx', 'pdf'] as const).map((f) => (
            <a key={f} href={reportExportUrl(campaignId, f)} className="inline-flex items-center gap-2 rounded-md border bg-white px-3 py-1.5 text-[12px] font-semibold" style={{ borderColor: 'var(--ar-border)', color: 'var(--ar-text)' }}><FileText size={14} /> {f.toUpperCase()}</a>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-6 rounded-xl border p-4" style={{ borderColor: verdictColor, background: `${verdictColor}14` }}>
        <div><div className="mb-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Verdict</div><div className="flex items-center gap-2 text-[14px] font-bold" style={{ color: verdictColor }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: verdictColor }} />{r.verdict}</div></div>
        {[['Population', r.population_size], ['Sample', r.sample_size], ['Findings', r.exceptions_total], ['Exceptions', r.exceptions_open ?? r.decisions.exception ?? 0]].map(([k, v]) => (
          <div key={k as string}><div className="mb-0.5 text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>{k}</div><div className="font-mono text-[20px] font-bold" style={{ color: 'var(--ar-text)' }}>{v as number}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3.5">
        <Panel title="Decisions">{decRows.map(([k, label, col]) => <Bar key={k} label={label} n={r.decisions[k] ?? 0} total={r.sample_size} color={col} />)}</Panel>
        <Panel title="Findings by severity">{sevRows.map(({ s, n }) => <Bar key={s} label={s[0].toUpperCase() + s.slice(1)} n={n} total={r.exceptions_total} color={s === 'critical' ? '#B42318' : s === 'high' ? '#C2410C' : s === 'medium' ? '#A45D0A' : '#586472'} />)}</Panel>
        <div className="rounded-xl border p-4" style={{ borderColor: 'var(--ar-border)', background: 'white' }}>
          <div className="mb-2.5 flex items-center gap-2"><Sparkles size={14} style={{ color: 'var(--ar-text-muted)' }} /><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>AI summary · supplementary</span></div>
          <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--ar-text)' }}>{r.ai_summary ?? 'Generate an AI summary from the recorded decisions.'}</div>
        </div>
      </div>

      {closed ? (
        <div className="flex items-center gap-4 rounded-xl border border-emerald-600 bg-emerald-50 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-emerald-700"><Lock size={20} /></div>
          <div className="flex-1"><div className="text-[14px] font-bold text-emerald-700">Sealed — read-only audit evidence</div><div className="mt-0.5 text-xs text-slate-500">All decisions and findings are locked.</div></div>
        </div>
      ) : (
        <div className="flex items-center gap-4 rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: 'var(--ar-accent)', boxShadow: '0 0 0 1px var(--ar-accent)' }}>
          <div className="flex-1"><div className="text-[14px] font-bold" style={{ color: 'var(--ar-text)' }}>Seal & close this review</div><div className="mt-0.5 text-[12px]" style={{ color: 'var(--ar-text-muted)' }}>Locks all decisions and findings as read-only audit evidence. This cannot be undone.</div></div>
          <button onClick={onClose} style={ACCENT} className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold shadow-sm"><Lock size={16} /> Seal & close</button>
        </div>
      )}
    </div>
  );
}
const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-xl border p-4" style={{ borderColor: 'var(--ar-border)', background: 'white' }}><div className="mb-3 text-[13px] font-bold" style={{ color: 'var(--ar-text)' }}>{title}</div>{children}</div>
);
const Bar = ({ label, n, total, color }: { label: string; n: number; total: number; color: string }) => (
  <div className="mb-2.5"><div className="mb-1 flex items-center justify-between"><span className="text-[12px] font-medium" style={{ color: 'var(--ar-text-muted)' }}>{label}</span><span className="font-mono text-[12.5px] font-semibold" style={{ color }}>{n}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${total ? Math.round((n / total) * 100) : 0}%`, background: color }} /></div></div>
);
