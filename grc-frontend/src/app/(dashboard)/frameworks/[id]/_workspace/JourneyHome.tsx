'use client';

// The Journey tab (frameworks with an authored end-to-end flow): what waits for the person, the flow's stages with their owners, what happened last.
import { Fact, FactList, SectionCard } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { stageRows, stageSummary, type ActivityItem, type JourneyNumbers, type Waiting } from '@/lib/journeyModel';
import type { FrameworkFlow } from '../_data/frameworkFlows';
import type { StageOwner } from '../_tabs/_StageOwnerPicker';
import NextForMe from './NextForMe';
import RecentActivity from './RecentActivity';
import StageList from './StageList';

interface Props {
  journeyId: number;
  flow: FrameworkFlow | null;
  stageOwners?: Record<string, StageOwner>;
  frameworkId: number | null;
  frameworkName: string;
  waiting: Waiting<any, any>;
  controlsLoading: boolean;
  controlsFailed: boolean;
  scopeLoading: boolean;
  scopeFailed: boolean;
  activity: ActivityItem[];
  numbers: JourneyNumbers | null;
  onOpenRequirement: (control: any) => void;
  goTab: (tab: string) => void;
  entityLabelPlural: string;
}

export default function JourneyHome(p: Props) {
  const { hasPermission } = usePermissions();
  const canReview = hasPermission('frameworks:framework_library:edit');
  if (!p.flow) return null;
  const summary = stageSummary(stageRows(p.flow.phases, p.stageOwners));
  return (
    <div className="space-y-[16px]">
      <NextForMe
        waiting={p.waiting}
        canReview={canReview}
        controlsLoading={p.controlsLoading}
        controlsFailed={p.controlsFailed}
        scopeLoading={p.scopeLoading}
        scopeFailed={p.scopeFailed}
        onOpenRequirement={p.onOpenRequirement}
        goTab={p.goTab}
        entityLabelPlural={p.entityLabelPlural}
      />
      <SectionCard
        id="stages"
        title={p.flow.name}
        meta={`${summary.stages} stages · ${summary.external} external checks · ${summary.withOwner} with an owner`}
        info={`How a framework like this is taken from start to certificate or attestation, stage by stage. After the last stage the programme loops back to stage ${p.flow.loopback.to}: ${p.flow.loopback.label}.`}
      >
        <FactList>
          <Fact label="Authority">{p.flow.authority}</Fact>
          <Fact label="Assessment">{p.flow.assessmentType}</Fact>
          <Fact label="Cadence">{p.flow.cycle}</Fact>
        </FactList>
        <div className="mt-[16px]">
          <StageList flow={p.flow} journeyId={p.journeyId} stageOwners={p.stageOwners} frameworkId={p.frameworkId} frameworkName={p.frameworkName} />
        </div>
      </SectionCard>
      <RecentActivity items={p.activity} scopeFailed={p.scopeFailed} goTab={p.goTab} />
    </div>
  );
}
