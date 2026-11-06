'use client';

// Governance > Approval Workflows (/governance/workflows): the older approval queue and its templates. Hidden: it opens from a document's menu ("Older approval
// requests", where the document lifecycle is off) and right after "Submit for review" on the classic document page. Built on the design-system kit
// (components/ui/ds): PageHeader variant="page", Tabs, StatTile, RegisterTable (cards below 768px), StatusPill, drawers and a dialog that ask "Discard changes?",
// useConfirm for deleting and useReportedMutation for every write. The open tab, the Approvals list and the open template are the address (?tab= &list=
// &template=), and the bare path is still Approvals > Pending, which is what every link into the page opens. What the page calls, what it sends and the query keys
// are the ones it has always had (the tests pin them); what changed is that every outcome is said, a failed read is never drawn as zero, and the forms work.
//   _Approvals.tsx  counts, the open approvals, Approve / Reject   _DecisionDialog.tsx  the decision   _Templates.tsx  the template list, Seed Defaults, Delete
//   _TemplateDetail.tsx  a template's steps   _TemplateForm.tsx, _StepForm.tsx  the drawers   _model.ts  the rules (tested)   _parts.tsx  shared bits
import { PageHeader } from '@/components/ui';
import { TabPanel, Tabs, useAddressState } from '@/components/ui/ds';
import { routeFor } from '@/lib/navRegistry';
import { ApprovalsTab } from './_Approvals';
import { TemplatesTab } from './_Templates';
import { ADDRESS } from './_model';

const TITLE = routeFor('/governance/workflows')?.label ?? 'Approval Workflows';

export default function GovernanceWorkflowsPage() {
  const [loc, set] = useAddressState(ADDRESS);
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={TITLE}
        info="Manage document approvals, workflow templates, and review pending requests"
        back={{ href: '/governance/documents', label: 'Back to documents' }}
      />
      <Tabs
        ariaLabel="Approval workflows"
        value={loc.tab}
        onChange={(tab) => set({ tab, template: 0 })}
        tabs={[{ key: 'approvals', label: 'Approvals' }, { key: 'templates', label: 'Workflow Templates' }]}
      >
        <TabPanel tabKey="approvals" className="pt-[16px]">
          {loc.tab === 'approvals' && <ApprovalsTab list={loc.list} onList={(list) => set({ list })} />}
        </TabPanel>
        <TabPanel tabKey="templates" className="pt-[16px]">
          {loc.tab === 'templates' && <TemplatesTab templateId={loc.template} />}
        </TabPanel>
      </Tabs>
    </div>
  );
}
