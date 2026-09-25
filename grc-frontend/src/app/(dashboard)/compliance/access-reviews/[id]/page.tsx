'use client';
// src/app/(dashboard)/compliance/access-reviews/[id]/page.tsx
// Review detail = gated 6-stage pipeline rail + per-stage action. Before the
// checks: which rules the review will run (changeable). After them, three views:
// Certify (decide per user, side panel), Rules checked (what every rule found,
// by category and framework) and the Report.
// Visual spec: "Access Reviews.dc.html" (review / certify / report screens).

import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ChevronLeft, ChevronRight, Check, Lock, RefreshCw, BarChart3, ClipboardCheck, ListChecks,
  PenLine, FileText, X, Sparkles, Paperclip, Info, CheckCircle2, XCircle, Loader2, Download, AlertTriangle,
} from 'lucide-react';
import { PageLoader } from '@/components/ui';
import {
  useCampaign, useReport, useSyncPopulation, useDrawSample, useRunChecks, useCloseCampaign, useSetDecision,
  useUploadEvidence, useAiSummary, useSetRules, downloadReport, errorText,
} from '../api';
import {
  STAGES, statusToStage, stageState, isClosed, scopeLabel,
  severityClass, decisionClass, decisionLabel, riskClass,
} from '../pipeline';
import type { AccessGrant, Campaign, Decision, ReviewItem, RuleResult, RuleSelection } from '../types';
import { RulePicker, selectionReady, useRulesFor } from '../_components/RulePicker';
import { FrameworkChips, RuleResultsTable, byCategory, shortFramework } from '../_components/RuleResults';

const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;
const stageIcon = [RefreshCw, BarChart3, ClipboardCheck, PenLine, FileText, Lock];
type View = 'certify' | 'rules' | 'report';

/** "SOC 2 rules (12)", "All enabled rules (18)", "5 picked rules". */
function ruleSetLabel(c: Campaign): string {
  const n = c.rules_run?.length;
  const count = n !== undefined ? ` (${n})` : '';
  if (c.rule_scope === 'framework') return `${shortFramework(c.rule_framework_name || c.rule_framework || 'Framework')} rules${count}`;
  if (c.rule_scope === 'custom') return `${n ?? c.rule_ids?.length ?? 0} picked rules`;
  return `All enabled rules${count}`;
}

export default function ReviewDetailPage() {
  const router = useRouter();
  const id = Number(useParams().id);
  const params = useSearchParams();
  const { data: c, isLoading } = useCampaign(id);
  const sync = useSyncPopulation(); const sample = useDrawSample();
  const checks = useRunChecks(); const close = useCloseCampaign();
  const [sel, setSel] = useState<number | null>(null);
  const [editingRules, setEditingRules] = useState(false);

  if (isLoading || !c) return <PageLoader />;
  const stage = statusToStage(c.status);
  const closed = isClosed(c.status);
  const checked = closed || stage >= 4;                 // the checks have run
  const reviewedCount = c.items.filter((i) => i.decision !== 'pending').length;
  const failedRules = (c.rule_results ?? []).filter((r) => r.status === 'fail').length;

  // ?view=certify|rules|report (the older ?stage=report still opens the report)
  const asked = (params.get('view') || (params.get('stage') === 'report' ? 'report' : '')) as View | '';
  const view: View = !checked ? 'certify' : asked === 'rules' || asked === 'report' ? asked
    : closed ? 'report' : 'certify';
  const go = (v: View) => router.replace(`/compliance/access-reviews/${id}?view=${v}`, { scroll: false });

  const stats = [
    { k: 'Population', v: c.population_size, s: 'in scope' },
    { k: 'Sample', v: stage >= 2 || closed ? c.sample_size : '—', s: stage >= 2 || closed ? 'frozen snapshot' : 'not drawn' },
    { k: 'Findings', v: checked ? c.exceptions_found : '—', s: checked ? `${failedRules} of ${(c.rule_results ?? []).length} rules failed` : 'not run' },
    { k: 'Certified', v: checked ? `${reviewedCount}/${c.sample_size}` : '—', s: checked ? 'reviewed' : 'pending' },
  ];

  const advance = () => {
    if (stage === 1) sync.mutate(id);
    else if (stage === 2) sample.mutate(id);
    else if (stage === 3) checks.mutate(id);
    else if (stage === 6) close.mutate(id);
  };
  const stagePending = sync.isPending || sample.isPending || checks.isPending || close.isPending;
  const stageError = sync.error || sample.error || checks.error || close.error;
  const cur = STAGES[stage - 1];
  const CurIcon = stageIcon[stage - 1];

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 pb-16 sm:px-8 sm:py-7">
      <button onClick={() => router.push('/compliance/access-reviews')} className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><ChevronLeft size={14} /> Access Reviews</button>
      <h1 className="text-[21px] font-bold tracking-tight text-slate-900">{c.name}</h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-slate-400">
        <span className="font-mono">AR-{c.id} · {scopeLabel[c.review_type] ?? c.review_type} · {c.sampling_method}</span>
        <span>·</span>
        <span className="inline-flex items-center gap-1 font-medium text-slate-600"><ListChecks size={13} /> {ruleSetLabel(c)}</span>
        {!closed && (
          <button onClick={() => setEditingRules(true)} className="text-[12px] font-semibold" style={{ color: 'var(--color-base-strong)' }}>Change</button>
        )}
      </div>

      <div className="my-6 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.k} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1.5 text-[11.5px] font-medium text-slate-500">{s.k}</div>
            <div className="font-mono text-[23px] font-bold tracking-tight text-slate-900">{s.v}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{s.s}</div>
          </div>
        ))}
      </div>

      {/* pipeline rail */}
      <div className="mb-5 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="mb-[18px] text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Review pipeline</div>
        <div className="flex min-w-[560px] items-start">
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

      {/* gated current-stage action (stages 1–3) and the rules it will run */}
      {!closed && stage <= 3 && (
        <>
          <div className="flex flex-wrap items-center gap-5 rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: 'var(--color-base)', boxShadow: '0 0 0 1px var(--color-base)' }}>
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--color-base-soft)', color: 'var(--color-base-strong)' }}><CurIcon size={24} /></div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-base-strong)' }}>Current stage · {stage} of 6</div>
              <div className="text-base font-bold text-slate-900">{cur.label}</div>
              <div className="text-[13px] text-slate-500">{cur.desc}</div>
            </div>
            <button onClick={advance} disabled={stagePending} style={ACCENT} className="inline-flex items-center gap-2 whitespace-nowrap rounded-md px-5 py-2.5 text-[13.5px] font-semibold shadow-sm disabled:opacity-60">
              {stagePending ? <><Loader2 size={15} className="animate-spin" /> Working…</> : <>{cur.label} <ChevronRight size={15} /></>}
            </button>
            {stageError && (
              <div role="alert" className="flex w-full items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {errorText(stageError)}
              </div>
            )}
          </div>
          <PlannedRules campaign={c} onChange={() => setEditingRules(true)} />
        </>
      )}

      {/* after the checks: certify · rules checked · report */}
      {checked && (
        <>
          <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
            {([
              ...(!closed ? [['certify', 'Certify', `${reviewedCount}/${c.sample_size}`]] : []),
              ['rules', 'Rules checked', failedRules ? `${failedRules} failed` : 'all passed'],
              ['report', 'Report', ''],
            ] as [View, string, string][]).map(([k, label, badge]) => (
              <button key={k} onClick={() => go(k)}
                className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2 text-[13px] font-semibold ${view === k ? 'text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
                style={view === k ? { borderColor: 'var(--color-base)' } : undefined}>
                {label}
                {badge && <span className={`rounded-full px-1.5 font-mono text-[10.5px] ${k === 'rules' && failedRules ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{badge}</span>}
              </button>
            ))}
          </div>

          {view === 'certify' && !closed && (
            <CertifyBlock campaignId={id} items={c.items} sampleSize={c.sample_size} sel={sel} setSel={setSel} onContinue={() => go('report')} />
          )}
          {view === 'rules' && (
            <RulesBlock campaign={c} onUser={(itemId) => setSel(itemId)} onChange={!closed ? () => setEditingRules(true) : undefined} />
          )}
          {view === 'report' && <ReportBlock campaign={c} closed={closed} onClose={() => close.mutate(id)} closing={close.isPending} />}
        </>
      )}

      {sel !== null && c.items.some((u) => u.id === sel) && (
        <UserPanel campaignId={id} user={c.items.find((u) => u.id === sel)!} results={c.rule_results ?? []} readOnly={closed} onClose={() => setSel(null)} />
      )}
      {editingRules && <RulesModal campaign={c} rerun={checked} onClose={() => setEditingRules(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- Rules
function selectionOf(c: Campaign): RuleSelection {
  return { rule_scope: c.rule_scope ?? 'enabled', rule_framework: c.rule_framework ?? null, rule_ids: c.rule_ids ?? [] };
}

/** Before the checks run: the rules they will run, by category. */
function PlannedRules({ campaign, onChange }: { campaign: Campaign; onChange: () => void }) {
  const { rules, loading } = useRulesFor(selectionOf(campaign));
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[13.5px] font-bold text-slate-900">Rules this review will run</div>
          <div className="text-[12px] text-slate-500">{loading ? 'Loading…' : `${rules.length} rule${rules.length === 1 ? '' : 's'} · ${ruleSetLabel(campaign).replace(/ \(\d+\)$/, '')}`}</div>
        </div>
        <button onClick={onChange} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">Change rules</button>
      </div>
      <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {byCategory(rules).map(([domain, list]) => (
          <div key={domain}>
            <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{domain}</div>
            {list.map((r) => (
              <div key={r.id} className="flex items-center gap-2 py-0.5 text-[12.5px]">
                <span className="font-mono text-[10.5px] text-slate-400">{r.id}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{r.name}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${severityClass[r.severity]}`}>{r.severity}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** After the checks: every rule's result, by category, with its frameworks. */
function RulesBlock({ campaign, onUser, onChange }: { campaign: Campaign & { items: ReviewItem[]; rule_results: RuleResult[] }; onUser: (id: number) => void; onChange?: () => void }) {
  const [filter, setFilter] = useState<'all' | 'fail' | 'pass'>('all');
  const results = campaign.rule_results ?? [];
  const failed = results.filter((r) => r.status === 'fail').length;
  const counts = { all: results.length, fail: failed, pass: results.length - failed };
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-bold text-slate-900">
            {results.length - failed} passed · <span className={failed ? 'text-rose-600' : ''}>{failed} failed</span>
          </div>
          <div className="text-[12px] text-slate-500">Each rule was run against all {campaign.sample_size} sampled users · {ruleSetLabel(campaign)}</div>
        </div>
        <div className="flex gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(['all', 'fail', 'pass'] as const).map((k) => (
            <button key={k} onClick={() => setFilter(k)} style={filter === k ? { background: '#fff' } : undefined}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-semibold ${filter === k ? 'text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {k === 'all' ? 'All' : k === 'fail' ? 'Failed' : 'Passed'}
              <span className="rounded-full bg-slate-100 px-1.5 font-mono text-[10.5px] text-slate-400">{counts[k]}</span>
            </button>
          ))}
        </div>
        {onChange && (
          <button onClick={onChange} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">Change rules</button>
        )}
      </div>
      <RuleResultsTable results={results} items={campaign.items} onUser={onUser} filter={filter} />
    </>
  );
}

/** Pick the review's rules again. After its checks, save runs them again (decisions stay). */
function RulesModal({ campaign, rerun, onClose }: { campaign: Campaign; rerun: boolean; onClose: () => void }) {
  const [value, setValue] = useState<RuleSelection>(selectionOf(campaign));
  const { rules } = useRulesFor(value);
  const save = useSetRules(campaign.id);
  const run = useRunChecks();
  const busy = save.isPending || run.isPending;
  const submit = () => save.mutate(value, {
    onSuccess: () => { if (rerun) run.mutate(campaign.id, { onSuccess: onClose }); else onClose(); },
  });
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div onClick={(e) => e.stopPropagation()} className="max-h-full w-[640px] max-w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-base font-bold text-slate-900">Rules this review runs</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {rerun ? 'Saving runs the checks again with these rules. Decisions already made are kept.' : 'They run at Stage 3.'}
            </div>
          </div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"><X size={15} /></button>
        </div>
        <div className="px-6 py-5">
          <RulePicker value={value} onChange={setValue} />
          {(save.isError || run.isError) && (
            <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              {errorText(save.error || run.error)}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={busy || !selectionReady(value, rules.length)} style={ACCENT}
            className="inline-flex items-center gap-2 rounded-md px-5 py-2 text-[13px] font-semibold shadow-sm disabled:opacity-60">
            {busy && <Loader2 size={14} className="animate-spin" />} {rerun ? `Save and run ${rules.length} rules` : 'Save'}
          </button>
        </div>
      </div>
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
            <button onClick={onContinue} style={remaining === 0 ? ACCENT : undefined}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-[13px] font-semibold ${remaining === 0 ? 'shadow-sm' : 'border border-slate-200 bg-white text-slate-600'}`}>
              {remaining === 0 ? 'Continue to report' : 'View report'} <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto"><div className="min-w-[860px]">
          <div className="grid grid-cols-[2.3fr_64px_1.2fr_1.1fr_132px] gap-4 border-b border-slate-200 bg-slate-50 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">
            <div>User</div><div>Risk</div><div>Rules</div><div>AI suggestion</div><div className="text-right">Decision</div>
          </div>
          {rows.map((u) => {
            const failedRules = (u.rules ?? []).filter((r) => r.status === 'fail');
            const top = failedRules.reduce<string>((m, f) => (['low', 'medium', 'high', 'critical'].indexOf(f.severity) > ['low', 'medium', 'high', 'critical'].indexOf(m) ? f.severity : m), 'low');
            return (
              <button key={u.id} onClick={() => setSel(u.id)} className={`grid w-full grid-cols-[2.3fr_64px_1.2fr_1.1fr_132px] items-center gap-4 border-b border-slate-100 px-5 py-3.5 text-left hover:bg-slate-50 ${sel === u.id ? 'bg-[color:var(--color-base-soft)]' : ''}`}>
                <div className="min-w-0"><div className="truncate text-[13px] font-semibold text-slate-900">{u.display_name}</div><div className="truncate text-[11px] text-slate-400">{u.department} · {u.designation}</div></div>
                <div><span className={`inline-flex h-6 min-w-[34px] items-center justify-center rounded-md px-2 font-mono text-[12.5px] font-semibold ${riskClass(u.risk_score)}`}>{u.risk_score ?? 0}</span></div>
                <div>
                  {failedRules.length
                    ? <span className={`rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${severityClass[top as keyof typeof severityClass]}`} title={failedRules.map((r) => `${r.id} ${r.name}`).join('\n')}>{failedRules.length} failed</span>
                    : <span className="inline-flex items-center gap-1 text-[11.5px] text-emerald-600"><Check size={13} /> all {(u.rules ?? []).length} passed</span>}
                </div>
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
    </>
  );
}

// ---------------------------------------------------------------- Side panel
function UserPanel({ campaignId, user, results, readOnly, onClose }: {
  campaignId: number; user: ReviewItem; results: RuleResult[]; readOnly: boolean; onClose: () => void;
}) {
  const setDecision = useSetDecision(campaignId);
  const uploadEvidence = useUploadEvidence(campaignId);
  const [note, setNote] = useState('');
  const aiMeta = user.ai_recommendation === 'revoke' ? ['Revoke', 'text-rose-600'] : user.ai_recommendation === 'exception' ? ['Exception', 'text-amber-600'] : ['Approve', 'text-emerald-600'];
  const frameworksOf = new Map(results.map((r) => [r.id, r]));
  const rules = [...(user.rules ?? [])].sort((a, b) => (a.status === b.status ? a.id.localeCompare(b.id) : a.status === 'fail' ? -1 : 1));

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[520px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl">
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
            <div className="col-span-2"><K>Access held</K><AccessList access={user.access} roles={user.roles} /></div>
            <div><K>MFA</K><div className={`font-semibold ${user.mfa_enabled ? 'text-emerald-600' : 'text-rose-600'}`}>{user.mfa_enabled ? 'Enabled' : 'Not enabled'}</div></div>
            <Field k="Account" v={user.account_enabled ? 'active' : 'disabled'} />
            <Field k="Last sign-in" v={user.last_sign_in ?? '—'} /><Field k="Terminated" v={user.termination_date ?? '—'} />
          </div>

          {rules.length > 0 && <>
            <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Rules checked · {rules.filter((r) => r.status === 'pass').length} passed, {rules.filter((r) => r.status === 'fail').length} failed
            </div>
            <div className="mb-5 space-y-3">
              {byCategory(rules).map(([category, list]) => (
                <div key={category}>
                  <div className="mb-1 text-[10.5px] font-semibold text-slate-500">{category}</div>
                  <div className="flex flex-col gap-1">
                    {list.map((r) => {
                      const meta = frameworksOf.get(r.id);
                      return (
                        <div key={r.id} className={`rounded-md border px-2.5 py-1.5 ${r.status === 'fail' ? 'border-rose-200 bg-rose-50/60' : 'border-slate-100 bg-white'}`}>
                          <div className="flex items-start gap-2">
                            {r.status === 'fail'
                              ? <XCircle size={14} className="mt-[2px] shrink-0 text-rose-500" />
                              : <CheckCircle2 size={14} className="mt-[2px] shrink-0 text-emerald-500" />}
                            <div className="min-w-0 flex-1">
                              <div className="text-[12.5px] font-medium text-slate-800">{r.name}</div>
                              {r.status === 'fail' && r.detail && <div className="text-[11px] text-slate-500">{r.detail}</div>}
                            </div>
                            <span className="shrink-0 font-mono text-[10.5px] text-slate-400">{r.id}</span>
                          </div>
                          {meta?.frameworks?.length ? <div className="mt-1 pl-[22px]"><FrameworkChips refs={meta.frameworks} max={2} /></div> : null}
                        </div>
                      );
                    })}
                  </div>
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

          <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">{readOnly ? 'Decision' : 'Your decision'}</div>
          {readOnly ? (
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${decisionClass[user.decision]}`}>{decisionLabel[user.decision]}</span>
          ) : (
            <>
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
// The access an identity holds, grouped by the system that granted it — a
// reviewer certifies access, so it has to be readable, not a comma string.
const SOURCE_LABEL: Record<string, string> = {
  digitalocean: 'DigitalOcean', okta: 'Okta', google: 'Google Workspace',
  ldap: 'Active Directory', sailpoint: 'SailPoint', entra_id: 'Microsoft Entra ID',
};
function sourceName(source?: string | null): string {
  if (!source) return 'Granted in this platform';
  if (SOURCE_LABEL[source]) return SOURCE_LABEL[source];
  const [kind, name] = source.includes(':') ? source.split(':') : ['', source];
  const pretty = name.replace(/_/g, ' ').replace(/\w/g, (c) => c.toUpperCase());
  return kind ? `${pretty} (${kind === 'iga' ? 'IGA' : 'App'})` : pretty;
}

function AccessList({ access, roles }: { access?: AccessGrant[]; roles: string[] }) {
  const grants = access?.length ? access : roles.map((name) => ({ name, source: null }));
  if (!grants.length) return <div className="font-semibold text-slate-800">No access recorded</div>;
  const bySource = new Map<string, string[]>();
  grants.forEach((g) => {
    const key = sourceName(g.source);
    bySource.set(key, [...(bySource.get(key) ?? []), g.name]);
  });
  const groups: [string, string[]][] = Array.from(bySource.entries());
  return (
    <div className="flex flex-col gap-2">
      {groups.map(([source, names]) => (
        <div key={source} className="rounded-lg border border-slate-100 bg-slate-50/70 px-2.5 py-2">
          <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">{source}</div>
          <ul className="flex flex-col gap-0.5">
            {names.map((n: string) => <li key={n} className="text-[12.5px] font-medium text-slate-800">{n}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

const K = ({ children }: { children: React.ReactNode }) => <div className="mb-0.5 text-[11px] font-medium text-slate-400">{children}</div>;
const Field = ({ k, v }: { k: string; v?: string | null }) => <div><K>{k}</K><div className="font-semibold text-slate-800">{v || '—'}</div></div>;

// ---------------------------------------------------------------- Report
const VERDICT: Record<string, { label: string; color: string; says: string }> = {
  effective: { label: 'Effective', color: '#2D6A4F', says: 'No open exception in the sample.' },
  deficient: { label: 'Deficient', color: '#A45D0A', says: 'A few sampled users have open exceptions.' },
  material_weakness: { label: 'Material weakness', color: '#B42318', says: 'More than a tenth of the sample has open exceptions.' },
};

function ReportBlock({ campaign, closed, onClose, closing }: {
  campaign: Campaign & { items: ReviewItem[] }; closed: boolean; onClose: () => void; closing: boolean;
}) {
  const { data: r, isLoading, error } = useReport(campaign.id);
  const summary = useAiSummary(campaign.id);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  if (error) return <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-[13px] text-rose-700">The report could not load: {errorText(error)}</div>;
  if (isLoading || !r) return <PageLoader />;

  const v = VERDICT[r.verdict] ?? { label: r.verdict, color: '#586472', says: '' };
  const sevRows = ['critical', 'high', 'medium', 'low'].map((s) => ({ s, n: r.findings_by_severity[s] ?? 0 }));
  const decRows = [['approved', 'Approved', '#2D6A4F'], ['revoke', 'Revoked', '#B42318'], ['exception', 'Exception', '#A45D0A'], ['pending', 'Pending', '#8A94A1']] as const;
  const results = r.rule_results ?? [];
  const failed = results.filter((x) => x.status === 'fail').length;
  const scopeText = r.rule_scope === 'framework' ? `The rules that evidence ${r.rule_framework_name || r.rule_framework}`
    : r.rule_scope === 'custom' ? 'Rules picked for this review' : 'Every rule enabled in the Rule library';
  const exportAs = async (f: 'csv' | 'xlsx' | 'pdf') => {
    setExporting(f); setExportError(null);
    try { await downloadReport(campaign.id, f); } catch (e) { setExportError(errorText(e, 'The download failed.')); }
    finally { setExporting(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Certification report</h2>
          <p className="text-[12.5px] text-slate-500">Rules run: {scopeText} · {results.length} rule{results.length === 1 ? '' : 's'}</p>
        </div>
        <div className="flex gap-2">
          {(['pdf', 'xlsx', 'csv'] as const).map((f) => (
            <button key={f} onClick={() => exportAs(f)} disabled={!!exporting}
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {exporting === f ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />} {f.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      {exportError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">{exportError}</div>}

      {r.provisional && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12.5px] text-amber-800">
          <Info size={15} className="mt-0.5 shrink-0" />
          {r.pending ? `Provisional — ${r.pending} user${r.pending === 1 ? '' : 's'} still to decide. The verdict can change until the review is sealed.`
            : 'Every user is decided. Seal the review to make this the final record.'}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-7 rounded-2xl border p-5" style={{ borderColor: v.color, background: `${v.color}14` }}>
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Verdict</div>
          <div className="flex items-center gap-2 text-[15px] font-bold" style={{ color: v.color }}><span className="h-2.5 w-2.5 rounded-full" style={{ background: v.color }} />{v.label}</div>
          {v.says && <div className="mt-0.5 text-[11.5px] text-slate-500">{v.says}</div>}
        </div>
        {[['Population', r.population_size], ['Sample', r.sample_size], ['Rules failed', `${failed}/${results.length}`], ['Open exceptions', r.exceptions_open ?? 0]].map(([k, val]) => (
          <div key={k as string}><div className="mb-0.5 text-[11px] text-slate-400">{k}</div><div className="font-mono text-[22px] font-bold text-slate-900">{val as number}</div></div>
        ))}
      </div>

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-[13.5px] font-bold text-slate-900">Rules checked</h3>
          <span className="text-[11.5px] text-slate-400">{results.length - failed} passed · {failed} failed</span>
        </div>
        <RuleResultsTable results={results} items={campaign.items} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Decisions">{decRows.map(([k, label, col]) => <Bar key={k} label={label} n={r.decisions[k] ?? 0} total={r.sample_size} color={col} />)}</Panel>
        <Panel title="Findings by severity">{sevRows.map(({ s, n }) => <Bar key={s} label={s[0].toUpperCase() + s.slice(1)} n={n} total={r.exceptions_total} color={s === 'critical' ? '#B42318' : s === 'high' ? '#C2410C' : s === 'medium' ? '#A45D0A' : '#586472'} />)}</Panel>
      </div>

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5">
        <div className="mb-2.5 flex items-center gap-2">
          <Sparkles size={15} className="text-slate-400" /><span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">AI summary · supplementary</span>
          <button onClick={() => summary.mutate()} disabled={summary.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60">
            {summary.isPending ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {r.ai_summary ? 'Write again' : 'Write summary'}
          </button>
        </div>
        <div className="text-[13px] leading-relaxed text-slate-700">{r.ai_summary ?? 'Have AI write a short auditor-facing summary from the recorded results and decisions.'}</div>
        {summary.isError && <div role="alert" className="mt-2 text-[12px] text-rose-700">{errorText(summary.error)}</div>}
      </div>

      {closed ? (
        <div className="flex items-center gap-4 rounded-2xl border border-emerald-600 bg-emerald-50 p-5">
          <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-white text-emerald-700"><Lock size={22} /></div>
          <div className="flex-1"><div className="text-[15px] font-bold text-emerald-700">Sealed — read-only audit evidence</div><div className="mt-0.5 text-xs text-slate-500">All decisions, findings and rule results are locked.</div></div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: 'var(--color-base)', boxShadow: '0 0 0 1px var(--color-base)' }}>
          <div className="flex-1"><div className="text-[15px] font-bold text-slate-900">Seal & close this review</div><div className="mt-0.5 text-[12.5px] text-slate-500">Locks all decisions, findings and rule results as read-only audit evidence. This cannot be undone.</div></div>
          <button onClick={onClose} disabled={closing} style={ACCENT} className="inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-[13.5px] font-semibold shadow-sm disabled:opacity-60">
            {closing ? <Loader2 size={17} className="animate-spin" /> : <Lock size={17} />} Seal & close
          </button>
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
