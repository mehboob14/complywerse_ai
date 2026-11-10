'use client';

// The lifecycle workspace on our eleven stages (Verity's, in Compliverse's colours): a strip over it (the lifecycle chart and
// the tier), the stage rail on the left, the stage panel on the right (status, Complete stage, send back and skip, the checks with a
// button to where each is cleared, who is next, then the stage's own content), and under it what moved the work. The engagement is
// picked by the page; this reads /vendor-risk/tpra/vendors/{id}/lifecycle for it.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, ArrowRight, Calculator, AlertTriangle } from 'lucide-react';
import { BTN, BTN_PRIMARY } from '../_record/btn';
import { TierBadge } from '../_record/recordUi';
import RecordPanel from '../_record/RecordPanel';
import { tpraApi } from '@/lib/api';
import { ErrorState, Sheet, SkeletonLines } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { ActivityBody } from '../_record/Activity';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { engagementsKey, useEngagements, type Engagement } from '../../../_lib/engagementsApi';
import {
  apiErrorText, lifecycleKey, useLifecycle, type LifecycleView, type TierResult,
} from '../../../_lib/lifecycleApi';
import { fixAction, openChecks, stageName, STAGES, type Check, type Fix } from '../../../_lib/lifecycleLogic';
import type { ChecklistItem, TpraAssessment } from './types';
import { STAGE_META } from './constants';

import FindingsPanel from './FindingsPanel';
import ContractsPanel from './ContractsPanel';
import ApprovalPanel from './ApprovalPanel';
import SignalsPanel from './SignalsPanel';
import DomainRiskView from './DomainRiskView';
import IntakePanel from './IntakePanel';
import PlanningPanel from './PlanningPanel';
import QuestionnaireReviewPanel from './QuestionnaireReviewPanel';
import OffboardingPanel from './OffboardingPanel';
import TierRequirementsPanel from './TierRequirementsPanel';
import StageChecklist from './StageChecklist';
import StageWorkspace from './StageWorkspace';
import StageRail from './StageRail';
import HistoryCard from './HistoryCard';
import NextBar from './NextBar';
import TieringDialog from './TieringDialog';
import { LifecycleChart, TierHalf } from './LifecycleStrip';
import { ReasonDialog, SendBackDialog } from './StageDialogs';
import { EngagementFacts } from './EngagementsPanel';

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export default function TpraLifecycle({
  vendorId, onChanged, initialStage, initialFindingId, engagementId = null, onEngagementChange, tierRequest = false, onTierRequestHandled,
}: {
  vendorId: number;
  onChanged?: () => void;
  initialStage?: string | null;
  initialFindingId?: number | null;
  /** The engagement whose lifecycle this is; null is General, the supplier itself. The page owns the picker. */
  engagementId?: number | null;
  onEngagementChange?: (engagementId: number | null) => void;
  /** Open the tiering dialog (the address asked for it); said back once it is handled. */
  tierRequest?: boolean;
  onTierRequestHandled?: () => void;
}) {
  const qc = useQueryClient();
  const router = useRouter();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEditRisk = hasPermission('erm:risks:edit');
  const canAdvance = hasPermission('vendor_risk:lifecycle:advance') || canEditRisk;
  const canSendBack = hasPermission('vendor_risk:lifecycle:send_back') || canEditRisk;
  const canSkip = hasPermission('vendor_risk:lifecycle:skip') || canEditRisk;
  const canRunEngines = hasPermission('vendor_risk:assessments:edit') || canEditRisk;
  const canReassess = hasPermission('vendor_risk:assessments:create') || canEditRisk;

  const [selected, setSelected] = useState<string | null>(null);
  const [sendBackOpen, setSendBackOpen] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [reassessOpen, setReassessOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [tiering, setTiering] = useState(false);

  const { data, isLoading, error } = useLifecycle(vendorId, engagementId);
  const { data: scopes } = useEngagements(vendorId);
  const engagement: Engagement | null = (scopes?.items || []).find((e) => !e.is_general && e.id === engagementId && e.status !== 'ended') || null;
  const scopeName = engagement ? engagement.name : 'General';

  // The address asked for the tiering dialog (?tier=1): open it once, then say so, so the page removes the parameter.
  useEffect(() => {
    if (!tierRequest || isLoading) return;
    if (canRunEngines) setTiering(true);          // the link is only a door: without the right to tier there is nothing behind it
    onTierRequestHandled?.();
  }, [tierRequest, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Another engagement is another lifecycle: start from its current stage (not on first render, which keeps a deep link).
  const shown = useRef(engagementId);
  useEffect(() => {
    if (shown.current === engagementId) return;
    shown.current = engagementId;
    setSelected(null);
  }, [engagementId]);

  // Default the selected stage once loaded — honour a valid deep-link stage first, otherwise fall back to the current stage.
  useEffect(() => {
    if (selected !== null) return;
    if (initialStage && STAGE_META[initialStage]) { setSelected(initialStage); return; }
    if (data?.current) setSelected(data.current);
  }, [data?.current, selected, initialStage]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle', vendorId] });
    qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
    onChanged?.();
  };

  const initMut = useMutation({
    mutationFn: () => tpraApi.initLifecycle(vendorId, engagementId),
    onSuccess: () => { refresh(); toast({ type: 'success', title: 'Lifecycle started' }); },
    onError: (e) => toast({ type: 'error', title: 'Could not start', message: apiErrorText(e, 'Try again.') }),
  });

  const assessment = data?.assessment as TpraAssessment | null | undefined;
  const stages = data?.stages || [];
  const current = data?.current || null;
  const gate = data?.gate || null;
  const policy = data?.policy || null;
  const open = openChecks(gate?.checks);
  const firstOpen = stages.find((s) => s.status !== 'complete' && s.status !== 'skipped')?.stage_key ?? null;

  const advanceMut = useMutation({
    mutationFn: () => tpraApi.advance(assessment!.id, {}),
    onSuccess: (res) => {
      const r = res.data as { advanced: boolean; to?: string; blockers?: string[] };
      refresh();
      if (r.advanced) {
        setSelected(r.to || current);
        toast({ type: 'success', title: 'Advanced', message: `Now at ${stageName(r.to) || r.to}.` });
      } else {
        toast({ type: 'warning', title: 'Cannot advance yet', message: (r.blockers || [])[0] || 'Exit criteria not met.' });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Advance failed', message: apiErrorText(e, 'Try again.') }),
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
    onError: (e) => toast({ type: 'error', title: 'Scoring failed', message: apiErrorText(e, 'Try again.') }),
  });

  const reassessMut = useMutation({
    mutationFn: (reason: string) => tpraApi.reassess(vendorId, { reason, engagement_id: engagementId }),
    onSuccess: () => { refresh(); setReassessOpen(false); toast({ type: 'success', title: 'Reassessment opened' }); },
    onError: (e) => toast({ type: 'error', title: 'Failed', message: apiErrorText(e, 'Try again.') }),
  });

  const sendBackMut = useMutation({
    mutationFn: ({ target, reason }: { target: string; reason: string }) => tpraApi.sendBack(assessment!.id, { target_stage: target, reason }),
    onSuccess: (_res, vars) => { refresh(); setSendBackOpen(false); setSelected(vars.target); toast({ type: 'success', title: 'Sent back' }); },
    onError: (e) => toast({ type: 'error', title: 'Send-back failed', message: apiErrorText(e, 'Try again.') }),
  });

  const skipMut = useMutation({
    mutationFn: ({ stage, reason }: { stage: string; reason: string }) => tpraApi.skip(assessment!.id, { stage_key: stage, reason }),
    onSuccess: () => { refresh(); setSkipOpen(false); toast({ type: 'success', title: 'Stage skipped' }); },
    onError: (e) => toast({ type: 'error', title: 'Skip failed', message: apiErrorText(e, 'Try again.') }),
  });

  const tierDone = (r: TierResult) => {
    refresh();
    const moved = r.retier;
    const label = (k: string) => stageName(k).toLowerCase();
    toast({
      type: 'success', title: `Tier set to ${cap(r.tier)}`,
      message: moved?.sent_back_to ? `Sent back to ${stageName(moved.sent_back_to)}: ${moved.reopened.map(label).join(', ')} now apply.`
        : moved?.reopened.length ? `${moved.reopened.map(label).join(', ')} now apply.` : undefined,
    });
    if (moved?.sent_back_to) setSelected(moved.sent_back_to);
  };

  const onFix = (fix: Fix) => {
    const to = fixAction(fix, { vendorId, engagementId, firstOpen });
    if (to.kind === 'tier') setTiering(true);
    else if (to.kind === 'stage') setSelected(to.stage);
    else router.push(to.href);
  };

  const dialogs = (
    <TieringDialog
      open={tiering} onClose={() => setTiering(false)} vendorId={vendorId} engagementId={engagementId} engagementName={scopeName}
      assessmentId={assessment?.id ?? null} currentTier={assessment?.inherent_tier ?? null} policy={policy}
      blockedWhy={data?.retier_blocked ?? null} onDone={tierDone}
    />
  );

  if (isLoading) return <SkeletonLines lines={8} label="Loading the lifecycle" />;
  if (error) return <ErrorState title="Couldn’t load the lifecycle" message={errorMessage(error)} onRetry={() => { void qc.invalidateQueries({ queryKey: lifecycleKey(vendorId, engagementId) }); }} />;

  // No assessment yet → tier it (which starts the lifecycle) or just start it.
  if (!assessment) {
    return (
      <div className="space-y-[12px]">
        <div className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle p-[32px] text-center">
          <Sparkles aria-hidden className="mx-auto mb-2 h-7 w-7 text-ds-primary-text" />
          <p className="text-[15px] font-[600] text-ds-fg">No lifecycle yet</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] leading-5 text-ds-fg-muted">{scopeName} has not been tiered.</p>
          {canRunEngines && (
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button type="button" className={BTN_PRIMARY} onClick={() => setTiering(true)}><Calculator aria-hidden className="h-4 w-4" /> Tier engagement</button>
              <button type="button" className={BTN} onClick={() => initMut.mutate()} disabled={initMut.isPending}>
                {initMut.isPending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <ArrowRight aria-hidden className="h-4 w-4" />} Start lifecycle
              </button>
            </div>
          )}
        </div>
        {dialogs}
      </div>
    );
  }

  const selectedKey = selected || current || 'intake';
  const selStage = stages.find((s) => s.stage_key === selectedKey);
  const selMeta = STAGE_META[selectedKey];
  const isCurrent = selectedKey === current;
  const order = STAGES.findIndex((s) => s.key === current);
  // The stages work can go back to: those before this one that were not skipped.
  const earlier = STAGES.slice(0, Math.max(order, 0)).filter((s) => stages.find((x) => x.stage_key === s.key)?.status !== 'skipped');
  const viewing = earlier.find((s) => s.key === selectedKey);
  const skippableNow = !!current && !STAGES[order]?.gate && !!policy?.skips.includes(current) && selStage?.status === 'in_progress';

  // On the current stage: send back, skip, open a new review. On an earlier one: send the work back to it.
  const menu = isCurrent ? [
    ...(canSendBack && earlier.length ? [{ key: 'back', label: 'Send back…', onClick: () => setSendBackOpen(true) }] : []),
    ...(canSkip && skippableNow ? [{ key: 'skip', label: 'Skip stage…', onClick: () => setSkipOpen(true) }] : []),
    ...(canReassess ? [{ key: 'reassess', label: 'New reassessment…', onClick: () => setReassessOpen(true) }] : []),
  ] : (canSendBack && viewing ? [{ key: 'back', label: 'Send back here…', onClick: () => setSendBackOpen(true) }] : []);

  return (
    <div className="space-y-[16px]">
      {/* The strip: where the work is, and the tier */}
      <section className="grid gap-x-8 gap-y-5 rounded-ds-card border border-ds-border bg-ds-surface p-[16px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <LifecycleChart stages={stages} current={current} checks={gate?.checks} cycle={assessment.version_no} selected={selectedKey}
          onSelect={setSelected} />
        <TierHalf tier={assessment.inherent_tier} score={assessment.inherent_score} policy={policy} canTier={canRunEngines}
          blockedWhy={data?.retier_blocked} onTier={() => setTiering(true)} onOpenTiering={() => setSelected('tiering')} />
      </section>

      <div className="grid items-start overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface lg:grid-cols-[15rem_minmax(0,1fr)]">
        <StageRail stages={stages} current={current} selected={selectedKey} openChecks={open} tier={assessment.inherent_tier}
          onSelect={setSelected} />
        {selMeta && (
          <StageWorkspace
            vendorId={vendorId} assessmentId={assessment.id} stageKey={selectedKey}
            meta={selMeta} stage={selStage} assessment={assessment}
            isCurrent={isCurrent} gate={gate}
            canAdvance={isCurrent && canAdvance} advanceBusy={advanceMut.isPending} onAdvance={() => advanceMut.mutate()}
            menu={menu} canFix={canAdvance || canRunEngines} onFix={onFix}
            next={isCurrent ? (
              <NextBar vendorId={vendorId} engagementId={engagementId} stage={current} ready={canAdvance && !!gate?.passed && selStage?.status !== 'complete'}
                canNotify={canAdvance} />
            ) : null}
          >
            <StageBody stageKey={selectedKey} vendorId={vendorId} assessmentId={assessment.id} checklist={selStage?.checklist}
              checks={isCurrent ? gate?.checks : undefined} stageStatus={selStage?.status}
              assessment={assessment} engagement={engagement} canRunEngines={canRunEngines} onChanged={refresh}
              onTier={() => setTiering(true)} tierBlocked={data?.retier_blocked ?? null}
              onReassess={canReassess ? () => setReassessOpen(true) : undefined}
              onRunScoring={() => scoringMut.mutate()} scoringBusy={scoringMut.isPending}
              initialFindingId={initialFindingId} />
          </StageWorkspace>
        )}
      </div>

      <HistoryCard rows={data?.history || []} onActivity={() => setActivityOpen(true)} />

      {dialogs}
      <SendBackDialog open={sendBackOpen} onClose={() => setSendBackOpen(false)} busy={sendBackMut.isPending}
        targets={earlier.map((s) => ({ key: s.key, label: s.label }))}
        initial={viewing?.key ?? earlier[earlier.length - 1]?.key ?? ''}
        onSubmit={(target, reason) => sendBackMut.mutate({ target, reason })} />
      <ReasonDialog open={skipOpen} onClose={() => setSkipOpen(false)} busy={skipMut.isPending}
        title={`Skip ${stageName(current)}?`} description="Recorded against this vendor with your name." cta="Skip stage"
        onSubmit={(reason) => current && skipMut.mutate({ stage: current, reason })} />
      <ReasonDialog open={reassessOpen} onClose={() => setReassessOpen(false)} busy={reassessMut.isPending}
        title="New reassessment" description={`Opens a fresh review of ${scopeName}.`} cta="Open reassessment"
        onSubmit={(reason) => reassessMut.mutate(reason)} />

      <Sheet open={activityOpen} onClose={() => setActivityOpen(false)} title="Activity" subtitle="Who changed what on this supplier, newest first.">
        {activityOpen && <ActivityBody vendorId={vendorId} />}
      </Sheet>
    </div>
  );
}

function StageBody({
  stageKey, vendorId, assessmentId, checklist, checks, stageStatus, assessment, engagement, canRunEngines, onChanged, onTier, tierBlocked,
  onRunScoring, scoringBusy, initialFindingId, onReassess,
}: {
  stageKey: string; vendorId: number; assessmentId: number; checklist?: ChecklistItem[]; checks?: Check[] | null; stageStatus?: string;
  assessment: TpraAssessment; engagement: Engagement | null; canRunEngines: boolean; onChanged?: () => void;
  onTier: () => void; tierBlocked: string | null; onRunScoring: () => void; scoringBusy: boolean;
  initialFindingId?: number | null; onReassess?: () => void;
}) {
  switch (stageKey) {
    case 'intake':
      // An engagement is held to its own facts; General to the supplier's record.
      return engagement
        ? <EngagementFacts vendorId={vendorId} engagement={engagement} />
        : <IntakePanel vendorId={vendorId} onChanged={onChanged} />;
    case 'tiering':
      return (
        <div className="space-y-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-3">
            <div className="flex items-center gap-2.5">
              <TierBadge tier={assessment.inherent_tier} />
              <p className="text-[13px] text-ds-fg-muted">
                {assessment.inherent_tier ? `Score ${assessment.inherent_score ?? '—'}` : 'Not computed yet.'}
              </p>
            </div>
            {canRunEngines && (
              <span title={tierBlocked ?? undefined}>
                <button type="button" className={assessment.inherent_tier ? BTN : BTN_PRIMARY} disabled={!!tierBlocked} onClick={onTier}>
                  <Calculator aria-hidden className="h-4 w-4" /> {assessment.inherent_tier ? 'Re-tier' : 'Tier engagement'}
                </button>
              </span>
            )}
          </div>
          {assessment.inherent_tier && (
            <TierRequirementsPanel vendorId={vendorId} assessmentId={assessmentId} canEdit={canRunEngines}
              onRunTiering={onTier} tieringBusy={false} onChanged={onChanged} />
          )}
        </div>
      );
    case 'scoring':
      return (
        <div className="space-y-[12px]">
          <div className="flex flex-wrap items-center justify-between gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-3">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-ds-fg-body">
              Residual risk <InfoTip text="Scores the answers into a rating for each domain. A failed critical control raises a blocking finding." label="About scoring" />
            </p>
            {canRunEngines && (
              <button type="button" className={BTN_PRIMARY} disabled={scoringBusy} onClick={onRunScoring}>
                {scoringBusy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <Calculator aria-hidden className="h-4 w-4" />} Run scoring
              </button>
            )}
          </div>
          <DomainRiskView assessment={assessment} />
        </div>
      );
    case 'dd_planning':
      return (
        <div className="space-y-[12px]">
          <TierRequirementsPanel vendorId={vendorId} assessmentId={assessmentId} canEdit={canRunEngines}
            onRunTiering={onTier} tieringBusy={false} onChanged={onChanged} />
          <PlanningPanel vendorId={vendorId} assessmentId={assessmentId} assessment={assessment} engagementId={engagement?.id ?? null} />
        </div>
      );
    case 'questionnaire':
      return <QuestionnaireReviewPanel vendorId={vendorId} assessmentId={assessmentId} />;
    case 'findings':
      return <FindingsPanel assessmentId={assessmentId} initialFindingId={initialFindingId} />;
    case 'contracting':
      return <ContractsPanel vendorId={vendorId} assessmentId={assessmentId} />;
    case 'approval':
      return <ApprovalPanel assessmentId={assessmentId} checks={checks} stageStatus={stageStatus} />;
    case 'onboarding':
      return (
        <StageChecklist assessmentId={assessmentId} stageKey="onboarding" activities={STAGE_META.onboarding.activities} initial={checklist} />
      );
    case 'monitoring':
      return <SignalsPanel vendorId={vendorId} />;
    case 'reassessment':
      return (
        <div className="space-y-[16px]">
          {onReassess && (
            <div className="flex flex-wrap items-center justify-between gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-ds-fg-body">
                Next review <InfoTip text="Starts a new cycle and settles this one." label="About the next review" />
              </p>
              <button type="button" className={BTN} onClick={onReassess}>New reassessment</button>
            </div>
          )}
          <SignalsPanel vendorId={vendorId} />
          <OffboardingPanel vendorId={vendorId} assessmentId={assessmentId} engagement={engagement} />
        </div>
      );
    default:
      return null;
  }
}
