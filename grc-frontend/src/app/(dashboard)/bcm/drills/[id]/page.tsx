'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > a drill or an invocation. One request (GET /bcm/drills/{id}, key ['bcm-drill', id]) brings the drill with its result and its findings. The page is a workspace: the head
// with the status moves, a strip that says where the drill stands (Scheduled, In progress, Completed, Closed), and three tabs kept in the address (?tab=): Overview (what needs doing, the
// scenario, the facts), Result (the form with its save bar, and the evidence the report was filed as) and Findings. What a person may do is what the page has always asked for
// (`bcm:drills:edit` to edit, move and record the result, `bcm:findings:create|edit|delete` for the findings): the same rights, and no button that does nothing for a person who has none of them.
// The times the server stamps (started, ended, recorded) are shown in the viewer's own day and clock, the scheduled day as the day it was written. A failed read says what the server said (a
// missing drill is not a broken server) with Retry only where trying again can help.
import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatCount, formatDateTime } from '@/lib/format';
import { drillStatus, drillType, sourceType } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, Fact, FactList, Menu, ReadOnlyNote, SectionCard, Skeleton, TabPanel, Tabs, useReportedMutation, useTabParam } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ClampedText, MUTED_LINK, Pill } from '../../_bcm-ui';
import { JourneyStrip } from '../../_record/JourneyStrip';
import { NextSteps } from '../../_record/NextSteps';
import { drillJourney, drillNextSteps } from '../../_record/recordModel';
import { DayCell, OwnerCell } from '../../_register/bits';
import { REFRESH_ALL } from '../../bcmData';
import { drillMoves, retryRead, type Drill } from '../../bcmModel';
import { DrillForm } from '../_DrillForm';
import { FindingsCard } from './_FindingsCard';
import { ResultBar, ResultCard, useResultForm } from './_ResultCard';

const BACK = { href: '/bcm/drills', label: 'Back to drills' };
const MUTED = 'text-ds-fg-muted';
const TABS = ['overview', 'result', 'findings'] as const;
type DrillTab = (typeof TABS)[number];

function DrillSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the drill</span>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[16px] h-[32px] w-full" /><Skeleton className="mt-[8px] h-[32px] w-[70%]" /></div>
      <div aria-hidden className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]"><Skeleton className="h-[12px] w-[64px]" /><Skeleton className="mt-[8px] h-[14px] w-[96px]" /></div>)}
      </div>
    </div>
  );
}

/** The tabs and the save bar: the form of the result lives here, so it is kept whichever tab is open. */
function DrillBody({ drill, canEdit, canFinding, canEditDrill, onEdit }: { drill: Drill; canEdit: boolean; canFinding: boolean; canEditDrill: boolean; onEdit: () => void }) {
  const [tab, setTab] = useTabParam<DrillTab>('tab', TABS, { fallback: 'overview' });
  const result = useResultForm(drill, canEdit);
  const [now] = useState(() => Date.now());
  const isIncident = drill.source_type === 'incident_triggered';
  const steps = drillNextSteps(drill, now).map((s) => (s.go === 'edit' && !canEditDrill ? { ...s, go: undefined } : s));
  const go = (to: NonNullable<(typeof steps)[number]['go']>) => {
    if (to === 'edit') onEdit();
    else if (to === 'result' || to === 'findings') setTab(to);
  };

  return (
    <>
      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'result', label: 'Result' },
          { key: 'findings', label: 'Findings', count: drill.finding_count },
        ]}
        value={tab}
        onChange={setTab}
        ariaLabel="Drill sections"
        countFormat="exact"
        className="flex flex-col gap-[16px]"
      >
        <TabPanel tabKey="overview">
          <div className="flex flex-col gap-[16px]">
          <NextSteps
            steps={steps}
            allClear="Nothing needs doing on this drill."
            goLabel={(g) => (g === 'edit' ? 'Edit drill' : g === 'result' ? 'Record the result' : g === 'findings' ? 'Open the findings' : 'Open')}
            onGo={go}
          />
          <SectionCard id="details" title="Details">
            {drill.scenario && (
              <div className="mb-[12px] flex flex-col gap-[2px]">
                <p className={`m-0 text-ds-label ${MUTED}`}>Scenario</p>
                <ClampedText text={drill.scenario} />
              </div>
            )}
            <FactList min={170}>
              <Fact label="Plan">{drill.plan_title ? <Link href={`/bcm/plans/${drill.plan_id}`} title={drill.plan_title} className={MUTED_LINK}><span className="line-clamp-2">{drill.plan_title}</span></Link> : null}</Fact>
              <Fact label="Type">{drillType.label(drill.drill_type)}</Fact>
              <Fact label="Source">{sourceType.label(drill.source_type)}</Fact>
              <Fact label="Scheduled" empty={NOT_SET}>{drill.scheduled_date ? <DayCell value={drill.scheduled_date} now={now} noun="Starts" late={drill.status === 'scheduled'} /> : null}</Fact>
              <Fact label="Started" empty="Not started">{drill.actual_start ? formatDateTime(drill.actual_start) : null}</Fact>
              <Fact label="Ended" empty="Not ended">{drill.actual_end ? formatDateTime(drill.actual_end) : null}</Fact>
              <Fact label="Owner" empty="Unassigned">{drill.owner_name ? <OwnerCell name={drill.owner_name} withName /> : null}</Fact>
              {isIncident && <Fact label="Incident">{drill.linked_incident_title || 'An incident that is no longer listed'}</Fact>}
              <Fact label="Result">{drill.has_result || drill.result ? 'Recorded' : 'Not recorded'}</Fact>
              <Fact label="Findings"><span className="tabular-nums">{formatCount(drill.finding_count)}</span></Fact>
            </FactList>
          </SectionCard>
          </div>
        </TabPanel>

        <TabPanel tabKey="result">
          <ResultCard state={result} canEdit={canEdit} />
        </TabPanel>

        <TabPanel tabKey="findings" lazy>
          <FindingsCard drill={drill} canAdd={canFinding} />
        </TabPanel>
      </Tabs>
      <ResultBar state={result} canEdit={canEdit} />
    </>
  );
}

export default function BcmDrillDetailPage() {
  const params = useParams<{ id: string }>();
  const drillId = Number(params?.id);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('bcm:drills:edit');
  const canFinding = hasPermission('bcm:findings:create');
  const canChangeFinding = hasPermission('bcm:findings:edit') || hasPermission('bcm:findings:delete');
  const [showEdit, setShowEdit] = useState(false);

  const query = useQuery({
    queryKey: ['bcm-drill', drillId],
    queryFn: async () => (await bcmApi.drills.get(drillId)).data as Drill,
    enabled: drillId > 0,
    retry: retryRead,
  });
  const drill = query.data;

  const move = useReportedMutation({
    mutationFn: async (status: string) => (await bcmApi.drills.transition(drillId, status)).data,
    success: (_data, status) => `Drill moved to ${drillStatus.label(status)}`, failure: "Couldn't change the drill's status",
    invalidate: [['bcm-drill', drillId], ...REFRESH_ALL],
  });

  if (!drill) {
    const head = <PageHeader variant="page" back={BACK} title="Drill" />;
    const noDrill = !(drillId > 0);                                // NaN too: "/bcm/drills/abc" has no drill number
    if (query.isError || noDrill) {
      return (
        <div className="flex flex-col gap-[16px]">
          {head}
          <ErrorState
            title={noDrill ? "This drill doesn't exist" : "Couldn't load this drill"}
            message={noDrill ? 'The address does not hold a drill number.' : errorMessage(query.error)}
            onRetry={!noDrill && canRetry(query.error) ? () => { void query.refetch(); } : undefined}
          />
        </div>
      );
    }
    return <div className="flex flex-col gap-[16px]">{head}<DrillSkeleton /></div>;
  }

  const readOnly = !canEdit && !canFinding && !canChangeFinding;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        back={BACK}
        title={drill.title}
        info={canEdit ? 'A drill can move to any status. Closing it needs a recorded result.' : undefined}
        meta={readOnly ? (
          <ReadOnlyNote>
            View only
            <InfoTip text="Only people who may edit drills or raise findings can change this drill." label="Why this drill is view only" />
          </ReadOnlyNote>
        ) : undefined}
        chips={<Pill registry={drillStatus} word={drill.effective_status} size="md" />}
        actions={canEdit ? (
          <>
            <Button leftIcon={<Pencil aria-hidden />} onClick={() => setShowEdit(true)}>Edit</Button>
            <Menu label="Change status" align="end" items={drillMoves(drill.status).map((s) => ({ key: s, label: drillStatus.label(s), onSelect: () => move.mutate(s) }))} />
          </>
        ) : undefined}
      />

      <JourneyStrip journey={drillJourney(drill.status)} label="Where the drill stands" />

      <DrillBody drill={drill} canEdit={canEdit} canFinding={canFinding} canEditDrill={canEdit} onEdit={() => setShowEdit(true)} />

      {showEdit && <DrillForm mode={{ kind: 'edit', drill }} onClose={() => setShowEdit(false)} />}
    </div>
  );
}
