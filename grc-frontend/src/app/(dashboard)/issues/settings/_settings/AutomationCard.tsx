'use client';

// Automation: the switches that make the platform raise issues by itself. Only one does anything today: an issue when a key risk indicator turns red (the Risk module asks for it when a value is
// measured). The three others the page used to list (a review date moved on when an issue is raised against a document, an issue for an overdue mitigation action, an issue for rejected evidence) are
// not read by anything, so they are not shown; nothing is deleted. The switch is read with the same right as the page and changed with the right to edit issues.
import { useQuery } from '@tanstack/react-query';
import { Checkbox, ErrorState, SectionCard, SkeletonRows, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { issuesApi } from '@/lib/api';
import { kriOn, kriPayload, type Flags } from './settingsModel';

const KEY = ['issues-automation-flags'] as const;
const retryLoad = (failures: number, error: unknown): boolean => failures < 2 && !(error as { response?: { status?: number } })?.response?.status;

export function AutomationCard({ canEdit }: { canEdit: boolean }) {
  const q = useQuery<Flags>({ queryKey: KEY, queryFn: async () => (await issuesApi.automationFlags.get()).data, staleTime: 30_000, retry: retryLoad });
  const toggle = useReportedMutation({
    mutationFn: async (on: boolean) => (await issuesApi.automationFlags.update(kriPayload(on))).data,
    success: (_d, on) => (on ? 'Automation turned on' : 'Automation turned off'),
    failure: "Couldn't change the automation",
    invalidate: [[...KEY]],
  });
  // while the change is on its way the box shows what was asked; if it fails it goes back to what the server holds
  const on = toggle.isPending && toggle.variables !== undefined ? toggle.variables : kriOn(q.data);

  return (
    <SectionCard id="automation" title="Automation" info="Switches that make the platform raise issues by itself. They are off until you turn them on.">
      {q.isPending && <SkeletonRows rows={1} columns={2} label="Loading the automation" />}
      {q.isError && !q.data && <ErrorState compact title="Couldn't load the automation" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
      {q.data && (
        <div>
          <Checkbox
            label={<span className="font-[500] text-ds-fg">Raise an issue when a key risk indicator turns red</span>}
            checked={on}
            disabled={!canEdit || toggle.isPending}
            onChange={(e) => toggle.mutate(e.target.checked)}
          />
          <p className="m-0 ml-[24px] max-w-[640px] text-ds-label text-ds-fg-muted">
            When a key risk indicator is measured at red, an issue is raised for it (high impact, high urgency, in operations) and linked to the indicator. While that issue is open, no second one is raised for the same indicator.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
