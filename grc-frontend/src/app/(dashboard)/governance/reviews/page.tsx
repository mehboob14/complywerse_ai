'use client';

// Governance > Reviews (Documents area, the "Reviews" tab): the documents whose review is overdue or coming up, as a List or a Calendar of the same reviews, and
// the Actions section (the log of governance actions that ask for a review). The section, the view, the list's tab and the calendar's month and day are the
// address (?section= &view= &tab= &month= &day=: _useReviewsLocation, reviewsModel); /governance/reviews/calendar is this same page already on its calendar view.
// Complete Review keeps its endpoint, its payload and who sees the button (governance:document_management:edit); it now asks in a dialog and reports what
// happened (_useCompleteReview). It is built on the design-system kit (components/ui/ds); the rules of the dates are calendarModel.ts.
import { PageHeader } from '@/components/ui';
import { Tabs, TabPanel } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { todayKey } from './calendarModel';
import { ActionsSection } from './_ActionsSection';
import { DocumentReviews } from './_DocumentReviews';
import { useGovernanceActions, useReviewStatistics } from './_queries';
import { useCompleteReview } from './_useCompleteReview';
import { useReviewsLocation } from './_useReviewsLocation';
import type { Section } from './reviewsModel';

const TITLE = routeFor('/governance/reviews')?.label ?? 'Document Reviews';

export default function GovernanceReviewsPage() {
  const { loc, go } = useReviewsLocation();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('governance:document_management:edit');
  const { request, pendingId, confirmDialog } = useCompleteReview();
  const stats = useReviewStatistics();
  const pending = useGovernanceActions('pending_review');
  const s = stats.data;
  const waiting = pending.data && pending.data.total > 0 ? pending.data.total : undefined;
  const today = todayKey();

  return (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={TITLE}
        info="Track and complete document review schedules."
        meta={s ? `${formatCount(s.total_with_review_date)} with a review date · ${formatCount(s.overdue)} overdue` : undefined}
      />
      <Tabs
        ariaLabel="Review sections"
        value={loc.section}
        onChange={(section) => go({ section: section as Section })}
        tabs={[{ key: 'documents', label: 'Reviews' }, { key: 'actions', label: 'Actions', count: waiting }]}
      >
        <TabPanel tabKey="documents" className="pt-[12px]">
          {loc.section === 'documents' && <DocumentReviews loc={loc} go={go} canEdit={canEdit} today={today} onComplete={request} pendingId={pendingId} />}
        </TabPanel>
        <TabPanel tabKey="actions" className="pt-[12px]">
          {loc.section === 'actions' && <ActionsSection />}
        </TabPanel>
      </Tabs>
      {confirmDialog}
    </div>
  );
}
