'use client';

export const dynamic = 'force-dynamic';

// Issue & Incident Management > Issue settings: one page, two sections (alternative A of the audit). The Severity matrix is a 3x3 grid of buttons that open a side sheet; Automation is the one switch
// that does something. The Classification matrix and the three switches nothing reads are not shown (they changed nothing; the data is untouched). Reached from the Settings button of the Overview (people
// who may edit issues) and by the old tabs' addresses. Anyone who may read issues can open it; changing needs the right to edit issues, which is what the server asks, so everybody else gets a
// view-only page.
import { PageHeader } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { ReadOnlyNote } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { AutomationCard } from './_settings/AutomationCard';
import { SeverityMatrix } from './_settings/SeverityMatrix';

export default function IssueSettingsPage() {
  const { hasPermission, isLoading } = usePermissions();
  const canEdit = !isLoading && hasPermission('issue_management:issues:edit');
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={routeFor('/issues/settings')?.label ?? 'Issue settings'}
        info="How serious a new issue is and how long it may take to fix, and what the platform raises by itself."
        back={{ href: '/issues', label: 'Back to the overview' }}
        meta={!isLoading && !canEdit ? <ReadOnlyNote>View only <InfoTip text="Only people who can edit issues can change these settings." label="Why these settings are view only" /></ReadOnlyNote> : undefined}
      />
      <SeverityMatrix canEdit={canEdit} />
      <AutomationCard canEdit={canEdit} />
    </div>
  );
}
