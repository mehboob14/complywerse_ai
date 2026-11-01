'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > a drill or an invocation. One request (GET /bcm/drills/{id}, key ['bcm-drill', id]) brings the drill with its result and its findings; the page is that, in the order it
// has always been: head with the status moves, the facts, the result, the findings. What a person may do is what the page has always asked for (`bcm:drills:edit` to edit, move and record the result,
// `bcm:findings:create|edit|delete` for the findings): the same rights, and no button that does nothing for a person who has none of them. The times the server stamps (started, ended, recorded)
// are shown in the viewer's own day and clock, the scheduled day as the day it was written. A failed read says what the server said (a missing drill is not a broken server) with Retry only where
// trying again can help. On the design-system kit: PageHeader variant="page", Menu for the status, SectionCards (ResultCard with the kit's save bar, FindingsCard), DrillForm for editing.
import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { NOT_SET, formatCount, formatDate, formatDateTime } from '@/lib/format';
import { drillStatus, drillType, sourceType } from '@/lib/statuses/bcm';
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, ErrorState, Menu, PersonChip, ReadOnlyNote, Skeleton, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { Clamp, ClampedText, Fact, Pill, TitleLink } from '../../_bcm-ui';
import { drillMoves, retryRead, type Drill } from '../../bcmModel';
import { DrillForm } from '../_DrillForm';
import { FindingsCard } from './_FindingsCard';
import { ResultBar, ResultCard, useResultForm } from './_ResultCard';

const BACK = { href: '/bcm/drills', label: 'Back to drills' };
const MUTED = 'text-ds-fg-muted';

function DrillSkeleton() {
  const card = 'rounded-ds-card border border-ds-border bg-ds-surface p-[16px]';
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
      <span className="sr-only">Loading the drill</span>
      <div aria-hidden className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]"><Skeleton className="h-[12px] w-[64px]" /><Skeleton className="mt-[8px] h-[14px] w-[96px]" /></div>)}
      </div>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[140px]" /><Skeleton className="mt-[16px] h-[32px] w-full" /><Skeleton className="mt-[8px] h-[32px] w-[70%]" /></div>
      <div aria-hidden className={card}><Skeleton className="h-[16px] w-[100px]" /><Skeleton className="mt-[16px] h-[12px] w-full" /><Skeleton className="mt-[8px] h-[12px] w-[60%]" /></div>
    </div>
  );
}

/** The result, the findings and the save bar: the bar is last in the page so it stays in view whatever the person is reading. */
function DrillBody({ drill, canEdit, canFinding }: { drill: Drill; canEdit: boolean; canFinding: boolean }) {
  const result = useResultForm(drill, canEdit);
  return (
    <>
      <ResultCard state={result} canEdit={canEdit} />
      <FindingsCard drill={drill} canAdd={canFinding} />
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
    invalidate: [['bcm-drill', drillId]],
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

  const isIncident = drill.source_type === 'incident_triggered';
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

      {drill.scenario && (
        <div className="flex flex-col gap-[2px]">
          <p className={`text-ds-label ${MUTED}`}>Scenario</p>
          <ClampedText text={drill.scenario} />
        </div>
      )}

      <dl className="grid grid-cols-2 gap-[12px] sm:grid-cols-3 xl:grid-cols-4">
        <Fact label="Plan">{drill.plan_title ? <TitleLink href={`/bcm/plans/${drill.plan_id}`} title={drill.plan_title} /> : <span className={MUTED}>—</span>}</Fact>
        <Fact label="Type">{drillType.label(drill.drill_type)}</Fact>
        <Fact label="Source">{sourceType.label(drill.source_type)}</Fact>
        <Fact label="Scheduled"><span className={drill.scheduled_date ? '' : MUTED}>{formatDate(drill.scheduled_date, { calendar: true, empty: NOT_SET })}</span></Fact>
        <Fact label="Started"><span className={drill.actual_start ? '' : MUTED}>{formatDateTime(drill.actual_start)}</span></Fact>
        <Fact label="Ended"><span className={drill.actual_end ? '' : MUTED}>{formatDateTime(drill.actual_end)}</span></Fact>
        <Fact label="Owner"><PersonChip name={drill.owner_name} /></Fact>
        {isIncident
          ? <Fact label="Incident"><Clamp text={drill.linked_incident_title || `Incident #${drill.linked_incident_id}`} /></Fact>
          : <Fact label="Findings"><span className="tabular-nums">{formatCount(drill.finding_count)}</span></Fact>}
      </dl>

      <DrillBody drill={drill} canEdit={canEdit} canFinding={canFinding} />

      {showEdit && <DrillForm mode={{ kind: 'edit', drill }} onClose={() => setShowEdit(false)} />}
    </div>
  );
}
