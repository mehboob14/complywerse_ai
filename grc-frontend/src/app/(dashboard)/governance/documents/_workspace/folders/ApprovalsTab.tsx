'use client';

// The Approvals tab of a unit's popup (and of the organisation's: `departmentId="org"`): who reviews and approves the documents of the unit by default, and the unit's own workflow.
// Three cards (Reviewers, Approvers, Custom route), each with where it comes from (set here, "Inherited from Operations", the organisation's), Locked, and what the person may do:
// Set, Edit, Override, Revert to inherited (DefaultCard). At the top, what a document of the unit follows now (the server says: its route, reviewers then approvers, or whoever its
// author names). The defaults are copied into a document's sign-off when it is sent for review and nobody is named; the nearest one up the tree applies, a route beats reviewers
// and approvers set at its own level or above, a lock stands over every unit below it: the (i) says so once. Writes: the server's `can_edit` (`governance:settings:edit`, or managing
// the unit); anyone else reads. The server decides everything; this only shows its answer and its refusals.
//
// To mount it for the organisation: <ApprovalsTab departmentId="org" tree={tree} setDirty={setDirty} />. For a unit: departmentId is the unit's id.
import { InfoTip } from '@/components/ui/InfoTip';
import { followsWords, type Subject } from '@/lib/approvalDefaults';
import { DefaultCard } from './DefaultCard';
import { DefaultsGate, ViewOnly } from './DefaultsGate';
import { useDirtyReport, useUnitDefaults } from './defaultsData';
import type { DirectoryTree } from './directoryModel';

export interface DefaultsTabProps {
  /** the unit's id, or 'org' for the whole organisation */
  departmentId: number | 'org';
  tree: DirectoryTree;
  /** the popup's "Discard changes?" flag: true while a card holds typed input */
  setDirty?: (dirty: boolean) => void;
  /** open another unit's popup on this tab (the one that locked a default) */
  openUnit?: (id: number) => void;
  /** the popup around already says "View only" (the person may not manage the unit): this tab then leaves its own note out, though what it may change is still the server's answer */
  popupSaysViewOnly?: boolean;
}

const TAB_NOTE = "A default is copied into a document's sign-off when it is sent for review and nobody is named. The nearest default up the tree applies. A route beats reviewers and approvers set at its own level or above. A locked default stands over every one below it. A document already in review keeps the people it started with.";
const NOTES: Partial<Record<Subject, string>> = {
  doc_review: 'Asked together when a document of this unit, or of a unit under it, is sent for review. Everyone signs.',
  doc_approval: 'Asked together after the reviewers. Everyone signs.',
  doc_route: 'The stages a document goes through, in order. A route beats reviewers and approvers set at its own level or above; ones set lower down beat it.',
};
const CARDS = ['doc_review', 'doc_approval', 'doc_route'] as const;

export function ApprovalsTab({ departmentId, setDirty, openUnit, popupSaysViewOnly }: DefaultsTabProps) {
  const { answer, canEdit, targets, orgState } = useUnitDefaults(departmentId);
  const onDirty = useDirtyReport(setDirty);
  const isOrg = departmentId === 'org';

  return (
    <div className="flex flex-col gap-[16px]">
      <DefaultsGate query={answer} what="approvals">
        {(data) => (
          <>
            {!canEdit && !popupSaysViewOnly && <ViewOnly org={isOrg} />}
            <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
              <span className="text-ds-label font-normal text-ds-fg-muted">{isOrg ? 'A document with no unit follows' : 'A document here follows'}</span>
              <span className="text-ds-body font-[600] text-ds-fg">{followsWords(data.document)}</span>
              <InfoTip text={TAB_NOTE} label="About approval defaults" />
            </div>
            {CARDS.map((subject) => (
              <DefaultCard
                key={subject}
                subject={subject}
                unit={departmentId}
                unitName={isOrg ? 'the organisation' : data.department_name}
                state={data.subjects[subject]}
                org={isOrg ? null : orgState(subject)}
                canEdit={canEdit}
                targets={targets}
                info={NOTES[subject] ?? ''}
                onDirty={onDirty}
                openUnit={openUnit}
              />
            ))}
          </>
        )}
      </DefaultsGate>
    </div>
  );
}
