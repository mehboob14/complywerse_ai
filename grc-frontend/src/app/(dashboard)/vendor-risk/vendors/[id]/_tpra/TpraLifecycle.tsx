'use client';

// Productionized TPRA 11-stage lifecycle — the centerpiece UI. A phase-grouped
// stage rail with gate markers (02 Tiering, 08 Approval), the active stage panel
// (objective / activities / accountable roles / exit criteria + blockers), the
// per-stage CRUD surface, and the advance / send-back / skip / run-engine
// actions. Reads /vendor-risk/tpra/vendors/{id}/lifecycle.

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Lock, CheckCircle2, Circle, SkipForward, ArrowRight, RotateCcw, AlertTriangle,
  Loader2, Sparkles, Gauge, Calculator, RefreshCw, Users, ListChecks, Shield,
  ArrowDownToLine, FileText, Flag, History,
} from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { RightSlidePanel, ProgressRing } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import type { LifecycleResponse, StageInstance, AdvanceResult } from './types';
import { STAGE_META, PHASES, DOMAIN_LABELS, tierBadge, stageStatusStyle } from './constants';

import FindingsPanel from './FindingsPanel';
import ContractsPanel from './ContractsPanel';
import ApprovalPanel from './ApprovalPanel';
import SignalsPanel from './SignalsPanel';
import DomainRiskView from './DomainRiskView';
import EvidencePanel from './EvidencePanel';
import IntakePanel from './IntakePanel';
import PlanningPanel from './PlanningPanel';
import QuestionnaireReviewPanel from './QuestionnaireReviewPanel';
import OffboardingPanel from './OffboardingPanel';
import StageWorkspace from './StageWorkspace';
import { useUnsavedGuard } from './useUnsavedGuard';

function errMsg(e: unknown, fallback: string): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;
}

interface AuditEntry {
  id: number; entity: string; entity_id: number | null; action: string;
  actor_id: number | null; actor_name: string | null;
  from_value: string | null; to_value: string | null; reason: string | null;
  assessment_id: number | null; created_at: string;
}

export default function TpraLifecycle({
  vendorId, onChanged, initialStage, initialFindingId,
}: {
  vendorId: number;
  onChanged?: () => void;
  initialStage?: string | null;
  initialFindingId?: number | null;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEditRisk = hasPermission('erm:risks:edit');
  const canAdvance = hasPermission('vendor_risk:lifecycle:advance') || canEditRisk;
  const canSendBack = hasPermission('vendor_risk:lifecycle:send_back') || canEditRisk;
  const canSkip = hasPermission('vendor_risk:lifecycle:skip') || canEditRisk;
  const canRunEngines = hasPermission('vendor_risk:assessments:edit') || canEditRisk;
  const canReassess = hasPermission('vendor_risk:assessments:create') || canEditRisk;
  const canInit = canReassess;

  const [selected, setSelected] = useState<string | null>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [reassessOpen, setReassessOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  // Per-vendor audit timeline (TPRM-010) — loaded on demand.
  const { data: audit } = useQuery({
    queryKey: ['tpra-vendor-audit', vendorId],
    queryFn: async () => (await tpraApi.getVendorAudit(vendorId)).data as { items: AuditEntry[] },
    enabled: activityOpen,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['tpra-lifecycle', vendorId],
    queryFn: async () => (await tpraApi.getLifecycle(vendorId)).data as LifecycleResponse,
  });

  // Default the selected stage once loaded — honour a valid deep-link stage first,
  // otherwise fall back to the current stage.
  useEffect(() => {
    if (selected !== null) return;
    if (initialStage && STAGE_META[initialStage]) { setSelected(initialStage); return; }
    if (data?.current) setSelected(data.current);
  }, [data?.current, selected, initialStage]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle', vendorId] });
    onChanged?.();
  };

  const initMut = useMutation({
    mutationFn: () => tpraApi.initLifecycle(vendorId),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Lifecycle started' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not start', message: errMsg(e, 'Try again.') }),
  });

  const assessment = data?.assessment;
  const stages = data?.stages || [];
  const current = data?.current || null;
  const gate = data?.gate || null;

  const advanceMut = useMutation({
    mutationFn: () => tpraApi.advance(assessment!.id, {}),
    onSuccess: (res) => {
      const r = res.data as AdvanceResult;
      refresh();
      if (r.advanced) {
        setSelected(r.to || current);
        toast({ type: 'success', title: 'Advanced', message: `Now at ${STAGE_META[r.to || '']?.label || r.to}.` });
      } else {
        toast({ type: 'warning', title: 'Cannot advance yet', message: (r.blockers || [])[0] || 'Exit criteria not met.' });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Advance failed', message: errMsg(e, 'Try again.') }),
  });

  const tieringMut = useMutation({
    mutationFn: () => tpraApi.runTiering(assessment!.id, {}),
    onSuccess: (res) => {
      refresh();
      const r = res.data as { tier?: string; score?: number };
      toast({ type: 'success', title: 'Tier computed', message: `Inherent tier: ${r.tier} (${r.score}).` });
    },
    onError: (e) => toast({ type: 'error', title: 'Tiering failed', message: errMsg(e, 'Try again.') }),
  });

  const scoringMut = useMutation({
    mutationFn: () => tpraApi.runScoring(assessment!.id),
    onSuccess: (res) => {
      refresh();
      const r = res.data as { residual_rating?: string; findings_created?: number };
      toast({
        type: 'success', title: 'Scored',
        message: `Residual: ${r.residual_rating}. ${r.findings_created ? `${r.findings_created} critical finding(s) raised.` : ''}`,
      });
    },
    onError: (e) => toast({ type: 'error', title: 'Scoring failed', message: errMsg(e, 'Try again.') }),
  });

  const reassessMut = useMutation({
    mutationFn: (reason: string) => tpraApi.reassess(vendorId, { reason }),
    onSuccess: () => { refresh(); setReassessOpen(false); toast({ type: 'success', title: 'Reassessment opened' }); },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: errMsg(e, 'Try again.') }),
  });

  const sendBackMut = useMutation({
    mutationFn: ({ target, reason }: { target: string; reason: string }) => tpraApi.sendBack(assessment!.id, { target_stage: target, reason }),
    onSuccess: (_res, vars) => { refresh(); setSendBackOpen(false); setSelected(vars.target); toast({ type: 'success', title: 'Sent back' }); },
    onError: (e) => toast({ type: 'error', title: 'Send-back failed', message: errMsg(e, 'Try again.') }),
  });

  const skipMut = useMutation({
    mutationFn: ({ stage, reason }: { stage: string; reason: string }) => tpraApi.skip(assessment!.id, { stage_key: stage, reason }),
    onSuccess: () => { refresh(); setSkipOpen(false); toast({ type: 'success', title: 'Stage skipped' }); },
    onError: (e) => toast({ type: 'error', title: 'Skip failed', message: errMsg(e, 'Try again.') }),
  });

  if (isLoading) {
    return <div className="flex items-center gap-2 py-12 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading lifecycle…</div>;
  }
  if (error) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-red-500">
        <AlertTriangle className="mb-2 h-7 w-7" />
        <p className="text-sm">Failed to load the TPRA lifecycle.</p>
        <button onClick={() => refresh()} className="mt-2 text-xs font-medium text-primary-600 hover:underline">Retry</button>
      </div>
    );
  }

  // No assessment yet → start the lifecycle.
  if (!assessment) {
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
        <Sparkles className="mx-auto mb-2 h-7 w-7 text-primary-600" />
        <p className="text-sm font-semibold text-slate-900">No active TPRA assessment</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-gray-500">
          Start the 11-stage third-party risk lifecycle for this vendor. Intake begins immediately; the tiering gate sets depth and cadence.
        </p>
        {canInit && (
          <button onClick={() => initMut.mutate()} disabled={initMut.isPending}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {initMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Start TPRA lifecycle
          </button>
        )}
      </div>
    );
  }

  const completed = stages.filter((s) => s.status === 'complete' || s.status === 'skipped').length;
  const pct = Math.round((completed / 11) * 100);
  const selectedKey = selected || current || 'intake';
  const selStage = stages.find((s) => s.stage_key === selectedKey);
  const selMeta = STAGE_META[selectedKey];
  const isCurrent = selectedKey === current;
  const currentMeta = current ? STAGE_META[current] : null;
  const skippableNow = isCurrent && selMeta && !selMeta.gate &&
    ((assessment.inherent_tier === 'low' && ['dd_planning', 'questionnaire', 'scoring', 'findings'].includes(selectedKey)) ||
     (assessment.inherent_tier === 'medium' && selectedKey === 'dd_planning'));

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-gray-200 bg-white p-4">
        <ProgressRing percentage={pct} size={64} color="primary" showPercentage />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900">TPRA Lifecycle</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">v{assessment.version_no}</span>
            {assessment.inherent_tier && (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tierBadge(assessment.inherent_tier)}`}>
                inherent: {assessment.inherent_tier}
              </span>
            )}
            {assessment.residual_rating && (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tierBadge(assessment.residual_rating)}`}>
                residual: {assessment.residual_rating}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Current stage: <span className="font-medium text-slate-700">{currentMeta?.label || '—'}</span>
            {currentMeta?.gate && <span className="ml-1 inline-flex items-center gap-0.5 text-amber-600"><Lock className="h-3 w-3" /> gate</span>}
          </p>
        </div>
        {canReassess && (
          <button
            onClick={() => setReassessOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} /> New reassessment
          </button>
        )}
        <button onClick={() => setActivityOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <History className="h-3.5 w-3.5" /> Activity
        </button>
      </div>

      {/* Stage rail — grouped by phase */}
      <div className="space-y-3">
        {PHASES.map((phase) => {
          const phaseStages = stages
            .filter((s) => STAGE_META[s.stage_key]?.phase === phase)
            .sort((a, b) => a.stage_order - b.stage_order);
          if (phaseStages.length === 0) return null;
          return (
            <div key={phase}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{phase}</p>
              <div className="flex flex-wrap gap-1.5">
                {phaseStages.map((s) => (
                  <StageChip key={s.stage_key} stage={s} active={s.stage_key === selectedKey} isCurrent={s.stage_key === current}
                    onClick={() => setSelected(s.stage_key)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active stage — command center (compact header + tiles + drawers) */}
      {selMeta && (
        <StageWorkspace
          vendorId={vendorId} assessmentId={assessment.id} stageKey={selectedKey}
          meta={selMeta} stage={selStage} assessment={assessment}
          isCurrent={isCurrent} gate={gate}
          showAdvance={isCurrent && canAdvance} advanceBusy={advanceMut.isPending}
          advanceDisabled={gate ? !gate.passed : false} onAdvance={() => advanceMut.mutate()}
          showSendBack={!isCurrent && selMeta.order < (currentMeta?.order || 1) && canSendBack}
          onOpenSendBack={() => setSendBackOpen(true)}
          showSkip={isCurrent && !!skippableNow && canSkip}
          onOpenSkip={() => setSkipOpen(true)}
        >
          <StageBody stageKey={selectedKey} vendorId={vendorId} assessmentId={assessment.id}
            assessment={assessment} canRunEngines={canRunEngines} onChanged={refresh}
            onRunTiering={() => tieringMut.mutate()} tieringBusy={tieringMut.isPending}
            onRunScoring={() => scoringMut.mutate()} scoringBusy={scoringMut.isPending}
            initialFindingId={initialFindingId} />
        </StageWorkspace>
      )}

      {/* Send-back modal */}
      <ReasonModal open={sendBackOpen} onClose={() => setSendBackOpen(false)}
        title={`Send back to ${selMeta?.label || ''}`}
        cta="Send back" busy={sendBackMut.isPending}
        note="Downstream stages will be invalidated (not silently kept). The prior work stays in history."
        onSubmit={(reason) => sendBackMut.mutate({ target: selectedKey, reason })} />

      {/* Skip modal */}
      <ReasonModal open={skipOpen} onClose={() => setSkipOpen(false)}
        title={`Skip ${selMeta?.label || ''}`}
        cta="Skip stage" busy={skipMut.isPending}
        note="Allowed for this tier. The skip is recorded with your name and reason."
        onSubmit={(reason) => skipMut.mutate({ stage: selectedKey, reason })} />

      {/* New reassessment modal — replaces window.prompt; enforces a non-empty reason. */}
      <ReasonModal open={reassessOpen} onClose={() => setReassessOpen(false)}
        title="New reassessment"
        cta="Open reassessment" busy={reassessMut.isPending}
        note="Opens a fresh assessment version for this vendor. The reason is recorded on the audit trail."
        onSubmit={(reason) => reassessMut.mutate(reason)} />

      {/* Per-vendor activity timeline (TPRM-010) */}
      <RightSlidePanel isOpen={activityOpen} onClose={() => setActivityOpen(false)} title="Activity" width="w-full max-w-lg">
        <div className="space-y-2">
          <p className="text-[11px] text-gray-500">Every recorded change for this vendor, newest first — from the module&apos;s tamper-evident audit trail.</p>
          {!audit ? (
            <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : audit.items.length === 0 ? (
            <p className="py-6 text-sm text-gray-400">No recorded activity yet.</p>
          ) : (
            <ol className="relative space-y-3 border-l border-gray-200 pl-4">
              {audit.items.map((a) => (
                <li key={a.id} className="relative">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-primary-400 ring-2 ring-white" />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium capitalize text-slate-600">{a.action}</span>
                    <span className="text-xs font-medium text-slate-800 capitalize">{a.entity.replace('_', ' ')}{a.entity_id ? ` #${a.entity_id}` : ''}</span>
                  </div>
                  {(a.to_value || a.reason) && (
                    <p className="mt-0.5 text-[11px] text-gray-500">{a.to_value ? `→ ${a.to_value}` : ''}{a.to_value && a.reason ? ' · ' : ''}{a.reason || ''}</p>
                  )}
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {a.actor_name || (a.actor_id ? `User ${a.actor_id}` : 'System')} · {a.created_at ? new Date(a.created_at).toLocaleString() : ''}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </RightSlidePanel>
    </div>
  );
}

function StageChip({ stage, active, isCurrent, onClick }: { stage: StageInstance; active: boolean; isCurrent: boolean; onClick: () => void }) {
  const meta = STAGE_META[stage.stage_key];
  const st = stageStatusStyle(stage.status);
  return (
    <button onClick={onClick} aria-current={isCurrent ? 'step' : undefined}
      className={`group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        active ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-300' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}>
      <span className="flex h-5 w-5 items-center justify-center">
        {stage.status === 'complete' ? (
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        ) : stage.status === 'skipped' ? (
          <SkipForward className="h-3.5 w-3.5 text-gray-400" />
        ) : stage.is_gate ? (
          <Lock className={`h-3.5 w-3.5 ${isCurrent ? 'text-amber-600' : 'text-gray-400'}`} />
        ) : (
          <span className={`h-2.5 w-2.5 rounded-full ${st.dot}`} />
        )}
      </span>
      <span className="flex flex-col">
        <span className="text-[10px] font-semibold text-gray-400">{String(stage.stage_order).padStart(2, '0')}</span>
        <span className={`text-[11px] font-medium ${active ? 'text-primary-700' : 'text-slate-700'}`}>{meta?.label || stage.stage_key}</span>
      </span>
    </button>
  );
}

function StageBody({
  stageKey, vendorId, assessmentId, assessment, canRunEngines, onChanged, onRunTiering, tieringBusy, onRunScoring, scoringBusy, initialFindingId,
}: {
  stageKey: string; vendorId: number; assessmentId: number;
  assessment: LifecycleResponse['assessment']; canRunEngines: boolean; onChanged?: () => void;
  onRunTiering: () => void; tieringBusy: boolean; onRunScoring: () => void; scoringBusy: boolean;
  initialFindingId?: number | null;
}) {
  switch (stageKey) {
    case 'intake':
      return <IntakePanel vendorId={vendorId} onChanged={onChanged} />;
    case 'tiering':
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div>
              <p className="text-xs font-medium text-slate-800">Inherent risk tiering</p>
              <p className="text-[11px] text-gray-500">
                {assessment?.inherent_tier ? `Tier: ${assessment.inherent_tier} (score ${assessment.inherent_score ?? '—'})` : 'Not computed yet — runs from the vendor profile.'}
              </p>
            </div>
            {canRunEngines && (
              <button onClick={onRunTiering} disabled={tieringBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {tieringBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gauge className="h-3.5 w-3.5" />} Compute tier
              </button>
            )}
          </div>
        </div>
      );
    case 'scoring':
      return (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
            <div>
              <p className="text-xs font-medium text-slate-800">Risk analysis &amp; scoring</p>
              <p className="text-[11px] text-gray-500">Scores questionnaire responses into per-domain residual ratings; failed critical controls raise blocking findings.</p>
            </div>
            {canRunEngines && (
              <button onClick={onRunScoring} disabled={scoringBusy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {scoringBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Calculator className="h-3.5 w-3.5" />} Run scoring
              </button>
            )}
          </div>
          {assessment && <DomainRiskView assessment={assessment} />}
        </div>
      );
    case 'dd_planning':
      return assessment
        ? <PlanningPanel vendorId={vendorId} assessmentId={assessmentId} assessment={assessment} />
        : null;
    case 'questionnaire':
      return <QuestionnaireReviewPanel vendorId={vendorId} assessmentId={assessmentId} />;
    case 'findings':
      return <FindingsPanel assessmentId={assessmentId} initialFindingId={initialFindingId} />;
    case 'contracting':
      return <ContractsPanel vendorId={vendorId} assessmentId={assessmentId} />;
    case 'approval':
      return <ApprovalPanel assessmentId={assessmentId} />;
    case 'onboarding':
      return (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-800">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" />
          <p>Provision least-privilege access and stand up monitoring. Work the onboarding steps below; contractual obligations carry over from <span className="font-medium">Contracting &amp; Controls</span>, and monitoring feeds are managed from the <span className="font-medium">Monitoring</span> stage.</p>
        </div>
      );
    case 'monitoring':
      return <SignalsPanel vendorId={vendorId} />;
    case 'reassessment':
      return (
        <div className="space-y-4">
          <SignalsPanel vendorId={vendorId} />
          <OffboardingPanel vendorId={vendorId} assessmentId={assessmentId} />
        </div>
      );
    default:
      return (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500">
          <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400" />
          <p>Work this stage's activities in the checklist below, then advance.</p>
        </div>
      );
  }
}

function ReasonModal({
  open, onClose, title, cta, note, busy, onSubmit,
}: { open: boolean; onClose: () => void; title: string; cta: string; note?: string; busy: boolean; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  useUnsavedGuard(open && !!reason);
  return (
    <RightSlidePanel isOpen={open} onClose={onClose} title={title} width="w-full max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
          <button onClick={() => onSubmit(reason)} disabled={busy || !reason.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? 'Working…' : cta}
          </button>
        </div>
      }>
      <div className="space-y-3">
        {note && <p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-700">{note}</p>}
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-700">Reason</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} required
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        </div>
      </div>
    </RightSlidePanel>
  );
}
