'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > a continuity plan. One request (GET /bcm/plans/{id}, key ['bcm-plan', id]) brings the plan with every BIA process (and its dependencies and strategies) and every drill.
// The page is a workspace: the head with the status moves, a strip that says where the plan stands (Draft, Under review, Approved), and three tabs kept in the address (?tab=): Overview (what
// needs doing, then the facts), Business impact analysis (the processes as a master-detail, ?process=) and Drills. What a person may do is what the page has always asked for
// (`bcm:plans:edit` to edit and move it, `bcm:bia:create` to add a process, `bcm:drills:create` to schedule a drill, `bcm:bia:edit|delete` inside a process): the same rights, and no button that
// does nothing for a person who has none of them. A failed read says what the server said (a missing plan is not a broken server) with Retry only where trying again can help.
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
import { Button, ErrorState, Fact, FactList, Menu, ReadOnlyNote, SectionCard, Skeleton, TabPanel, Tabs, useReportedMutation, useTabParam } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useNarrow } from '@/components/overview/useNarrow';
import { ClampedText, HoursText, Pill, TitleLink } from '../../_bcm-ui';
import { JourneyStrip } from '../../_record/JourneyStrip';
import { NextSteps } from '../../_record/NextSteps';
import { lastDrillAt, planJourney, planNextSteps } from '../../_record/recordModel';
import { DayCell, OwnerCell } from '../../_register/bits';
import { REFRESH_ALL } from '../../bcmData';
import { planMoves, retryRead, type Plan } from '../../bcmModel';
import { DrillForm } from '../../drills/_DrillForm';
import { PlanForm } from '../_PlanForm';
import { BiaTab } from './_BiaTab';
import { DrillsSection } from './_Sections';

const BACK = { href: '/bcm/plans', label: 'Back to plans' };
const MUTED = 'text-ds-fg-muted';
const TABS = ['overview', 'bia', 'drills'] as const;
type PlanTab = (typeof TABS)[number];

function PlanSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the plan</span>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[200px]" /><Skeleton className="mt-[16px] h-[12px] w-full" /><Skeleton className="mt-[8px] h-[12px] w-[70%]" /></div>
      <div aria-hidden className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]"><Skeleton className="h-[12px] w-[64px]" /><Skeleton className="mt-[8px] h-[14px] w-[96px]" /></div>)}
      </div>
    </div>
  );
}

export default function BcmPlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = Number(params?.id);
  const narrow = useNarrow();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:plans:edit');
  const canDrill = hasPermission('bcm:drills:create');
  const canAddBia = hasPermission('bcm:bia:create');
  const canEditBia = hasPermission('bcm:bia:edit');
  const canDeleteBia = hasPermission('bcm:bia:delete');

  const [tab, setTab] = useTabParam<PlanTab>('tab', TABS, { fallback: 'overview' });
  const [showEdit, setShowEdit] = useState(false);
  const [scheduleDrill, setScheduleDrill] = useState(false);
  const [now] = useState(() => Date.now());

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
    invalidate: [['bcm-plan', planId], ...REFRESH_ALL],
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
  const readOnly = !canEdit && !canAddBia && !canEditBia && !canDeleteBia && !canDrill;
  const moves = planMoves(plan.status);
  const retired = plan.status === 'retired';
  const steps = planNextSteps(plan, now);
  const last = lastDrillAt(drills);

  const go = (to: NonNullable<(typeof steps)[number]['go']>) => {
    if (to === 'edit') { if (canEdit) setShowEdit(true); } else if (to === 'schedule') { if (canDrill) setScheduleDrill(true); } else if (to === 'bia' || to === 'drills') setTab(to);
  };
  // a button for work the person may not do is not drawn: the line stays, without it
  const doable = steps.map((s) => (s.go === 'edit' && !canEdit) || (s.go === 'schedule' && !canDrill) ? { ...s, go: undefined } : s);

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

      <JourneyStrip journey={planJourney(plan.status)} label="Where the plan stands" />

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'bia', label: 'Business impact analysis', count: bia.length },
          { key: 'drills', label: 'Drills', count: drills.length },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Continuity plan sections"
        countFormat="exact"
        className="flex flex-col gap-[16px]"
      >
        <TabPanel tabKey="overview">
          <div className="flex flex-col gap-[16px]">
          {!retired && (
            <NextSteps
              steps={doable}
              allClear="Nothing needs doing on this plan."
              goLabel={(g) => (g === 'edit' ? 'Edit plan' : g === 'bia' ? 'Open the processes' : g === 'schedule' ? 'Schedule drill' : 'Open')}
              onGo={go}
            />
          )}
          <SectionCard id="details" title="Details">
            {plan.description && <ClampedText text={plan.description} className="mb-[12px]" />}
            <FactList min={170}>
              <Fact label="Business unit" empty={NOT_SET}>{plan.business_unit}</Fact>
              <Fact label="Owner" empty="Unassigned">{plan.owner_name ? <OwnerCell name={plan.owner_name} withName /> : null}</Fact>
              <Fact label="Review due" empty={NOT_SET}>{plan.next_review_due ? <DayCell value={plan.next_review_due} now={now} noun="Review" late={!retired} /> : null}</Fact>
              <Fact label="Plan document" empty={NOT_SET}>
                {plan.document_ref_id ? <TitleLink href={`/governance/documents/${plan.document_ref_id}`} title={plan.document_title || 'Open the document'} /> : null}
              </Fact>
              <Fact label="RTO"><HoursText h={plan.rto_hours} /></Fact>
              <Fact label="RPO"><HoursText h={plan.rpo_hours} /></Fact>
              <Fact label="Testing cadence">{frequency.label(plan.testing_frequency)}</Fact>
              <Fact label="Last drill" empty="No drill yet">{last ? formatDate(last, { calendar: true }) : null}</Fact>
            </FactList>
          </SectionCard>
          </div>
        </TabPanel>

        <TabPanel tabKey="bia" lazy>
          <BiaTab planId={planId} bia={bia} canAdd={canAddBia} canEdit={canEditBia} canDelete={canDeleteBia} narrow={narrow} />
        </TabPanel>

        <TabPanel tabKey="drills" lazy>
          <DrillsSection drills={drills} canSchedule={canDrill} onSchedule={() => setScheduleDrill(true)} />
        </TabPanel>
      </Tabs>

      {scheduleDrill && <DrillForm mode={{ kind: 'schedule', planId, planTitle: plan.title }} onClose={() => setScheduleDrill(false)} />}
      {showEdit && <PlanForm plan={plan} onClose={() => setShowEdit(false)} />}
    </div>
  );
}
