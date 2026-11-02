'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > a continuity plan. One request (GET /bcm/plans/{id}, key ['bcm-plan', id]) brings the plan with every BIA process (and its dependencies and strategies) and
// every drill; the page is that, in the order it has always been: head with the status moves, the facts of the plan, its business impact analysis, its drills. What a person may do is
// what the page has always asked for (`bcm:plans:edit` to edit and move it, `bcm:bia:create` to add a process, `bcm:drills:create` to schedule a drill, `bcm:bia:edit` inside a
// process): the same rights, and no button that does nothing for a person who has none of them. A failed read says what the server said (a missing plan is not a broken server) with
// Retry only where trying again can help. On the design-system kit: PageHeader variant="page", Menu for the status, RegisterTable sections, the drawers of PlanForm, BiaForm,
// BiaDrawer and DrillForm, useReportedMutation for the move.
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatDate } from '@/lib/format';
import { frequency, planStatus } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, Menu, PersonChip, ReadOnlyNote, Skeleton, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ClampedText, Clamp, Fact, HoursText, Pill, TitleLink } from '../../_bcm-ui';
import { planMoves, retryRead, type Plan } from '../../bcmModel';
import { DrillForm } from '../../drills/_DrillForm';
import { PlanForm } from '../_PlanForm';
import { BiaDrawer } from './_BiaDrawer';
import { BiaForm } from './_BiaForm';
import { BiaSection, DrillsSection } from './_Sections';

const BACK = { href: '/bcm/plans', label: 'Back to plans' };
const MUTED = 'text-ds-fg-muted';

function PlanSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the plan</span>
      <div aria-hidden className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]"><Skeleton className="h-[12px] w-[64px]" /><Skeleton className="mt-[8px] h-[14px] w-[96px]" /></div>)}
      </div>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[200px]" /><Skeleton className="mt-[16px] h-[12px] w-full" /><Skeleton className="mt-[8px] h-[12px] w-[70%]" /></div>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[120px]" /><Skeleton className="mt-[16px] h-[12px] w-full" /><Skeleton className="mt-[8px] h-[12px] w-[60%]" /></div>
    </div>
  );
}

export default function BcmPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Number(params?.id);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:plans:edit');
  const canDrill = hasPermission('bcm:drills:create');
  const canAddBia = hasPermission('bcm:bia:create');
  const canEditBia = hasPermission('bcm:bia:edit');

  const [showEdit, setShowEdit] = useState(false);
  const [addBia, setAddBia] = useState(false);
  const [openBiaId, setOpenBiaId] = useState<number | null>(null);
  const [scheduleDrill, setScheduleDrill] = useState(false);

  const query = useQuery({
    queryKey: ['bcm-plan', planId],
    queryFn: async () => (await bcmApi.plans.get(planId)).data as Plan,
    enabled: planId > 0,
    retry: retryRead,
  });
  const plan = query.data;

  const move = useReportedMutation({
    mutationFn: async (status: string) => (await bcmApi.plans.transition(planId, status)).data,
    success: (_data, status) => `Plan moved to ${planStatus.label(status)}`, failure: "Couldn't change the plan's status",
    invalidate: [['bcm-plan', planId], ['bcm-plans']],
  });

  if (!plan) {
    const head = <PageHeader variant="page" back={BACK} title="Continuity plan" />;
    const noPlan = !(planId > 0);                                  // NaN too: "/bcm/plans/abc" has no plan number
    if (query.isError || noPlan) {
      return (
        <div className="flex flex-col gap-[16px]">
          {head}
          <ErrorState
            title={noPlan ? "This plan doesn't exist" : "Couldn't load this plan"}
            message={noPlan ? 'The address does not hold a plan number.' : errorMessage(query.error)}
            onRetry={!noPlan && canRetry(query.error) ? () => { void query.refetch(); } : undefined}
          />
        </div>
      );
    }
    return <div className="flex flex-col gap-[16px]">{head}<PlanSkeleton /></div>;
  }

  const bia = plan.bia_records ?? [];
  const drills = plan.drills ?? [];
  const openBia = bia.find((b) => b.id === openBiaId) ?? null;
  const readOnly = !canEdit && !canAddBia && !canEditBia && !canDrill;
  const moves = planMoves(plan.status);

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        back={BACK}
        title={plan.title}
        info={canEdit ? 'A plan can move to any status. Approving it needs its RTO and RPO to be set.' : undefined}
        meta={readOnly ? (
          <ReadOnlyNote>
            View only
            <InfoTip text="Only people who may edit plans, business impact analysis or drills can change this plan." label="Why this plan is view only" />
          </ReadOnlyNote>
        ) : undefined}
        chips={(
          <>
            <Pill registry={planStatus} word={plan.status} size="md" />
            {plan.status === 'approved' && plan.approved_date && (
              <span className={`text-ds-body ${MUTED}`}>{`Approved ${formatDate(plan.approved_date)}${plan.approved_by_name ? ` by ${plan.approved_by_name}` : ''}`}</span>
            )}
          </>
        )}
        actions={canEdit ? (
          <>
            <Button leftIcon={<Pencil aria-hidden />} onClick={() => setShowEdit(true)}>Edit</Button>
            <Menu
              label="Change status"
              align="end"
              items={moves.map((s) => ({ key: s, label: planStatus.label(s), onSelect: () => move.mutate(s) }))}
            />
          </>
        ) : undefined}
      />

      {plan.description && <ClampedText text={plan.description} />}

      <dl className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        <Fact label="Business unit">{plan.business_unit ? <Clamp text={plan.business_unit} /> : <span className={MUTED}>{NOT_SET}</span>}</Fact>
        <Fact label="Owner"><PersonChip name={plan.owner_name} /></Fact>
        <Fact label="Review due"><span className={plan.next_review_due ? '' : MUTED}>{formatDate(plan.next_review_due, { calendar: true, empty: NOT_SET })}</span></Fact>
        <Fact label="Plan document">
          {plan.document_ref_id ? <TitleLink href={`/governance/documents/${plan.document_ref_id}`} title={plan.document_title || `Document #${plan.document_ref_id}`} /> : <span className={MUTED}>{NOT_SET}</span>}
        </Fact>
        <Fact label="RTO"><HoursText h={plan.rto_hours} /></Fact>
        <Fact label="RPO"><HoursText h={plan.rpo_hours} /></Fact>
        <Fact label="Testing cadence">{frequency.label(plan.testing_frequency)}</Fact>
      </dl>

      <BiaSection bia={bia} canAdd={canAddBia} onOpen={setOpenBiaId} onAdd={() => setAddBia(true)} />
      <DrillsSection drills={drills} canSchedule={canDrill} onSchedule={() => setScheduleDrill(true)} />

      {openBia && <BiaDrawer bia={openBia} planId={planId} onClose={() => setOpenBiaId(null)} />}
      {addBia && <BiaForm planId={planId} onClose={() => setAddBia(false)} />}
      {scheduleDrill && <DrillForm mode={{ kind: 'schedule', planId, planTitle: plan.title }} onClose={() => setScheduleDrill(false)} />}
      {showEdit && <PlanForm plan={plan} onClose={() => setShowEdit(false)} />}
    </div>
  );
}
