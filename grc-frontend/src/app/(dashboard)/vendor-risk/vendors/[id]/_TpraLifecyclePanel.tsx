'use client';

// ─────────────────────────────────────────────────────────────────────────────
// TPRA 8-stage lifecycle panel — the guided "where is this vendor in its
// lifecycle" view. Orchestrates the existing pieces (assessments, monitoring)
// and the new stage-specific trackers (remediation, reassessment, offboarding)
// + AI helpers. Self-contained: talks to vendorRiskApi, refetches the vendor
// via onChanged. Purely additive — nothing else on the page changes.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vendorRiskApi, governanceApi } from '@/lib/api';
import {
  Loader2, Sparkles, Plus, Check, ArrowRight, Trash2, ShieldCheck,
  CalendarClock, ClipboardList, AlertTriangle, FileSignature,
} from 'lucide-react';

interface Stage {
  key: string; order: number; label: string; description: string;
  actions?: string[]; recurring?: boolean;
}
interface VendorLite {
  id: number;
  tier?: string | null;
  lifecycle_stage?: string;
  reassessment_cadence_days?: number | null;
  next_reassessment_date?: string | null;
  contract_document_id?: number | null;
}
interface DocOption { id: number; title: string; document_code?: string | null; doc_type?: string | null }
interface RemediationAction {
  id: string; title: string; action?: string; treatment_type?: string;
  severity?: string; status?: string; due_date?: string | null;
  finding_ref?: string; rationale?: string;
}
interface OffItem { item: string; done: boolean }

const SEV_BADGE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700', high: 'bg-amber-100 text-amber-700',
  medium: 'bg-blue-100 text-blue-700', low: 'bg-gray-100 text-gray-600',
};
const STATUS_BADGE: Record<string, string> = {
  open: 'bg-gray-100 text-gray-700', in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700', accepted: 'bg-violet-100 text-violet-700',
};

export default function TpraLifecyclePanel({ vendorId, vendor, onChanged }: {
  vendorId: number; vendor: VendorLite; onChanged?: () => void;
}) {
  const [advancing, setAdvancing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [tierRec, setTierRec] = useState<{ recommended_tier?: string; rationale?: string; key_factors?: string[]; source?: string } | null>(null);
  const [newAction, setNewAction] = useState({ title: '', treatment_type: 'remediate', severity: 'medium', due_date: '' });

  const { data: stagesData } = useQuery({
    queryKey: ['tpra-stages'],
    queryFn: async () => (await vendorRiskApi.getLifecycleStages()).data,
    staleTime: 10 * 60_000,
  });
  const stages: Stage[] = stagesData?.stages || [];
  const currentStage = vendor.lifecycle_stage || 'intake';
  const currentMeta = stages.find((s) => s.key === currentStage);
  const currentOrder = currentMeta?.order ?? 1;
  const nextMeta = stages.find((s) => s.order === currentOrder + 1);

  const { data: remData, refetch: refetchRem } = useQuery({
    queryKey: ['tpra-remediation', vendorId],
    queryFn: async () => (await vendorRiskApi.getRemediation(vendorId)).data,
  });
  const remediation: RemediationAction[] = remData?.items || [];

  const { data: offData, refetch: refetchOff } = useQuery({
    queryKey: ['tpra-offboarding', vendorId],
    queryFn: async () => (await vendorRiskApi.getOffboarding(vendorId)).data,
    enabled: currentStage === 'offboarding',
  });
  const offItems: OffItem[] = offData?.items || [];

  // Governance documents to link as the executed contract (stage 6).
  const { data: docsData } = useQuery({
    queryKey: ['tpra-gov-docs'],
    queryFn: async () => (await governanceApi.getDocuments({ limit: 200 })).data,
    staleTime: 5 * 60_000,
  });
  const docs: DocOption[] = (() => {
    const raw: unknown = docsData;
    if (Array.isArray(raw)) return raw as DocOption[];
    const obj = raw as { items?: DocOption[]; documents?: DocOption[] } | undefined;
    return obj?.items || obj?.documents || [];
  })();
  const linkedDoc = docs.find((d) => d.id === vendor.contract_document_id);
  const linkContract = async (docId: number | null) => {
    setBusy('contract');
    try { await vendorRiskApi.updateVendor(vendorId, { contract_document_id: docId }); onChanged?.(); }
    finally { setBusy(null); }
  };

  const advance = async (target?: string) => {
    setAdvancing(true);
    try { await vendorRiskApi.advanceStage(vendorId, target ? { target_stage: target } : {}); onChanged?.(); refetchOff(); }
    finally { setAdvancing(false); }
  };
  const recommendTier = async () => {
    setBusy('tier');
    try { setTierRec((await vendorRiskApi.aiRecommendTier(vendorId)).data); }
    finally { setBusy(null); }
  };
  const addAction = async () => {
    if (!newAction.title.trim()) return;
    setBusy('add');
    try {
      await vendorRiskApi.addRemediation(vendorId, { ...newAction, due_date: newAction.due_date || undefined });
      setNewAction({ title: '', treatment_type: 'remediate', severity: 'medium', due_date: '' });
      refetchRem(); onChanged?.();
    } finally { setBusy(null); }
  };
  const patchAction = async (id: string, data: Record<string, unknown>) => {
    await vendorRiskApi.updateRemediation(vendorId, id, data); refetchRem(); onChanged?.();
  };
  const delAction = async (id: string) => {
    await vendorRiskApi.deleteRemediation(vendorId, id); refetchRem(); onChanged?.();
  };
  const aiPlan = async () => {
    setBusy('plan');
    try {
      const r = (await vendorRiskApi.aiRemediationPlan(vendorId)).data;
      for (const a of (r?.actions || [])) await vendorRiskApi.addRemediation(vendorId, a);
      refetchRem(); onChanged?.();
    } finally { setBusy(null); }
  };
  const schedule = async () => { setBusy('sched'); try { await vendorRiskApi.scheduleReassessment(vendorId); onChanged?.(); } finally { setBusy(null); } };
  const toggleOff = async (idx: number) => {
    const items = offItems.map((it, i) => ({ item: it.item, done: i === idx ? !it.done : it.done }));
    await vendorRiskApi.updateOffboarding(vendorId, items); refetchOff();
  };

  return (
    <div className="space-y-5">
      {/* ── Stage tracker ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-semibold text-slate-900">TPRA Lifecycle</h3>
          {nextMeta && (
            <button
              onClick={() => advance()}
              disabled={advancing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {advancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Advance to “{nextMeta.label}”
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-stretch gap-1.5">
          {stages.map((s) => {
            const done = s.order < currentOrder;
            const active = s.key === currentStage;
            return (
              <button
                key={s.key}
                onClick={() => advance(s.key)}
                title={s.description}
                className={`flex-1 min-w-[88px] rounded-lg border px-2 py-1.5 text-left transition ${
                  active ? 'border-blue-500 bg-blue-50' : done ? 'border-emerald-200 bg-emerald-50/50' : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-1">
                  <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${
                    active ? 'bg-blue-600 text-white' : done ? 'bg-emerald-500 text-white' : 'bg-gray-200 text-gray-600'
                  }`}>{done ? '✓' : s.order}</span>
                  {s.recurring && <span className="text-[8px] uppercase tracking-wide text-amber-600">loop</span>}
                </div>
                <p className={`mt-0.5 text-[10px] font-medium leading-tight ${active ? 'text-blue-700' : 'text-slate-600'}`}>{s.label}</p>
              </button>
            );
          })}
        </div>
        {currentMeta && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Stage {currentOrder}: {currentMeta.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{currentMeta.description}</p>
            {currentMeta.actions && currentMeta.actions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {currentMeta.actions.map((a) => (
                  <span key={a} className="rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600">{a}</span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── AI inherent-tier recommendation (stage 2) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">Inherent risk tiering</h3>
          <button onClick={recommendTier} disabled={busy === 'tier'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
            {busy === 'tier' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI recommend tier
          </button>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Current tier: <span className="font-semibold capitalize">{vendor.tier || 'medium'}</span></p>
        {tierRec && (
          <div className="mt-2 rounded-lg bg-indigo-50/60 border border-indigo-100 p-2.5">
            <p className="text-xs">
              Recommended: <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${SEV_BADGE[tierRec.recommended_tier || 'medium']}`}>{tierRec.recommended_tier}</span>
              {tierRec.source === 'fallback' && <span className="ml-2 text-[10px] italic text-slate-400">(heuristic — no AI key)</span>}
            </p>
            {tierRec.rationale && <p className="mt-1 text-[11px] text-slate-600">{tierRec.rationale}</p>}
          </div>
        )}
      </div>

      {/* ── Remediation & treatment tracker (stage 5) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900"><ClipboardList className="h-4 w-4 text-slate-500" /> Remediation & treatment</h3>
          <button onClick={aiPlan} disabled={busy === 'plan'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50">
            {busy === 'plan' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            AI draft plan
          </button>
        </div>
        {/* Add row */}
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <input value={newAction.title} onChange={(e) => setNewAction((p) => ({ ...p, title: e.target.value }))}
            placeholder="New finding / action…" className="flex-1 min-w-[160px] rounded border border-gray-300 px-2 py-1 text-xs" />
          <select value={newAction.treatment_type} onChange={(e) => setNewAction((p) => ({ ...p, treatment_type: e.target.value }))} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
            {['remediate', 'mitigate', 'transfer', 'accept'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={newAction.severity} onChange={(e) => setNewAction((p) => ({ ...p, severity: e.target.value }))} className="rounded border border-gray-300 px-1.5 py-1 text-xs">
            {['critical', 'high', 'medium', 'low'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input type="date" value={newAction.due_date} onChange={(e) => setNewAction((p) => ({ ...p, due_date: e.target.value }))} className="rounded border border-gray-300 px-1.5 py-1 text-xs" />
          <button onClick={addAction} disabled={busy === 'add' || !newAction.title.trim()} className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-1 text-xs font-medium text-white hover:bg-slate-900 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        {remediation.length === 0 ? (
          <p className="text-xs text-gray-400 py-2">No remediation actions yet. Add findings or let AI draft a plan from the latest assessment.</p>
        ) : (
          <div className="space-y-1.5">
            {remediation.map((a) => (
              <div key={a.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800">{a.title}</p>
                    {a.action && <p className="text-[11px] text-slate-500">{a.action}</p>}
                  </div>
                  <button onClick={() => delAction(a.id)} className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${SEV_BADGE[a.severity || 'medium']}`}>{a.severity}</span>
                  <span className="rounded-full bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] capitalize text-slate-600">{a.treatment_type}</span>
                  {a.due_date && <span className="text-[10px] text-slate-400">due {String(a.due_date).slice(0, 10)}</span>}
                  <select value={a.status || 'open'} onChange={(e) => patchAction(a.id, { status: e.target.value })}
                    className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-medium capitalize ${STATUS_BADGE[a.status || 'open']}`}>
                    {['open', 'in_progress', 'completed', 'accepted'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Continuous monitoring — reassessment scheduling (stage 7) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900"><CalendarClock className="h-4 w-4 text-slate-500" /> Continuous monitoring</h3>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
          <span>Reassessment cadence: <span className="font-semibold">{vendor.reassessment_cadence_days ? `${vendor.reassessment_cadence_days} days` : 'not set'}</span></span>
          <span>Next due: <span className="font-semibold">{vendor.next_reassessment_date ? String(vendor.next_reassessment_date).slice(0, 10) : '—'}</span></span>
          <button onClick={schedule} disabled={busy === 'sched'} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {busy === 'sched' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            Schedule by tier
          </button>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">Cadence defaults by tier (critical/high = annual, medium = 2y, low = 3y). A breach, expired cert, or scope change should re-trigger due diligence.</p>
      </div>

      {/* ── Contracting & onboarding — link the executed contract (stage 6) ── */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900"><FileSignature className="h-4 w-4 text-slate-500" /> Contracting &amp; onboarding</h3>
        <p className="mt-1 text-[11px] text-slate-500">Link the executed contract (with its security/privacy addenda and breach-notification terms) to a Governance Document.</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            value={vendor.contract_document_id ?? ''}
            onChange={(e) => linkContract(e.target.value ? Number(e.target.value) : null)}
            disabled={busy === 'contract'}
            className="min-w-[220px] flex-1 rounded border border-gray-300 px-2 py-1.5 text-xs"
          >
            <option value="">— No contract linked —</option>
            {docs.map((d) => (
              <option key={d.id} value={d.id}>{d.document_code ? `${d.document_code} · ` : ''}{d.title}</option>
            ))}
          </select>
          {busy === 'contract' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
          {linkedDoc && (
            <a href={`/governance/documents/${linkedDoc.id}`} className="text-[11px] font-medium text-blue-600 hover:text-blue-800">Open contract →</a>
          )}
        </div>
      </div>

      {/* ── Offboarding checklist (stage 8) ── */}
      {currentStage === 'offboarding' && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-amber-500" /> Offboarding & termination</h3>
          <div className="mt-2 space-y-1">
            {offItems.map((it, idx) => (
              <button key={idx} onClick={() => toggleOff(idx)} className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-50">
                <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${it.done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-gray-300'}`}>
                  {it.done && <Check className="h-3 w-3" />}
                </span>
                <span className={it.done ? 'text-slate-400 line-through' : 'text-slate-700'}>{it.item}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
