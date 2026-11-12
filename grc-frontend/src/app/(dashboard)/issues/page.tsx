'use client';

export const dynamic = 'force-dynamic';

// Issue & Incident Management > Overview (Overview v2: posture in graphics, minimal text, everything opens the records, Back returns to the same place; the frame of the other Overviews is
// components/overview with the chart kit components/overview/charts). It leads with six figures (open issues with their shape over twelve months, late issues, critical or high issues, issues closed
// on time, late corrective actions and, with the incident right, open incidents), each a way into the records it counts and coloured by its own status; then three rows of graphic cards (the module
// score with its sections, open issues by severity and by stage; raised and closed or the open backlog over twelve months, open issues by severity and age; who holds the open issues, corrective
// actions by status, open incidents by severity); then the person's own work, slim: three one-line rows and "See all N" (a sheet). There is no chip wall of "needs attention": attention is the status
// colour of the graphics. It replaces the page of eight tabs: Enterprise Log, Contract Compliance and CAPA Actions are the register pages (/issues/register, /issues/actions), the Severity matrix and
// Automation tabs are /issues/settings. Every old address still lands where its thing is now (_overview/forwards.ts).
// ONE definition: a figure is the number of rows the register's own chip keeps (overviewModel.ts, chartModel.ts), so the number here is the number there after the click. Every request loads, fails
// (with Retry) and has nothing on its own: a failed list is never read as 0. The score and its sections are the server's scorecard (GET /issue-management/dashboard/sections-overview, key and payload
// unchanged: the main Dashboard reads the same key). What changes what the page shows (the twelve-month view, the score sheet, the full work list) is in the address (v2Model.ts ADDRESS), and
// useReturnToPlace puts the page back where it was when the person comes Back.
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Settings } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, IconButton, NoAccessState, Notice, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { useReturnToPlace } from '@/components/overview/useReturnToPlace';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { usePermissions } from '@/hooks/usePermissions';
import { auditRegisterApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { IssueForm } from './_components/IssueForm';
import { feedOf, useActionRows, useIncidentRows, useIssueRows, useMe, useScorecard } from './_overview/data';
import { forwardFor } from './_overview/forwards';
import { IssueHero } from './_overview/hero';
import { IssueVisuals, type ErrorInfo, type Errors } from './_overview/cards';
import { ScoreSheet } from './_overview/score';
import { MyWork, WorkSheet } from './_overview/work';
import { SECTION_ORDER, buildWork, countersOf, incidentsFeed, postureOf, sectionRows } from './_overview/overviewModel';
import { ADDRESS, type FeedStatus } from './_overview/v2Model';
import { useWorkSteps } from './_overview/useWorkSteps';

const NO_ROWS: never[] = [];                          // one empty list, so a memo keyed on "the rows" does not run again while nothing has loaded

type Q = { isPending: boolean; isError: boolean; error: unknown; data?: unknown; refetch: () => unknown };
const statusOfQuery = (q: Q): FeedStatus => ({ isPending: q.isPending, isError: q.isError, hasData: q.data != null, error: q.error, refetch: q.refetch });
const errorOf = (q: Pick<Q, 'error' | 'refetch'>): ErrorInfo => ({ message: errorMessage(q.error), onRetry: canRetry(q.error) ? () => { void q.refetch(); } : undefined });

// An old address of this page (a tab, "the issues of this record", the SCF record link, the audit-register switch) goes to the page that took its place; nothing is asked for meanwhile.
export default function IssuesPage() {
  const router = useRouter();
  const params = useSearchParams();
  const forward = forwardFor(params.toString());
  useEffect(() => { if (forward) router.replace(forward); }, [forward, router]);
  return forward ? <div role="status" aria-busy="true"><span className="sr-only">Opening the page</span></div> : <IssuesOverview />;
}

function IssuesOverview() {
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canEdit = hasPermission('issue_management:issues:edit');
  const canCreate = hasPermission('issue_management:issues:create');
  const canIncidents = hasPermission('erm:incidents:*');
  const [raising, setRaising] = useState(false);
  const [view, setView] = useAddressState(ADDRESS);
  const { run, busy, dialog } = useWorkSteps();

  const me = useMe();
  const issues = useIssueRows(null);
  const actions = useActionRows();
  const incidents = useIncidentRows(canIncidents);
  const score = useScorecard();
  const register = useQuery<{ has_register: boolean }>({ queryKey: ['audit-register-status'], queryFn: async () => (await auditRegisterApi.status()).data, retry: false, staleTime: 60_000 });

  // incidents are read with another right than issues are: a person who may not read them (or whose read the server refuses) simply has no incident figures
  const incidentsRefused = !incidents.data && statusOf(incidents.error) === 403;
  const feeds = {
    issues: feedOf({ data: issues.data?.items, isError: issues.isError }),
    actions: feedOf({ data: actions.data?.items, isError: actions.isError }),
    incidents: incidentsFeed(permissionsLoading, canIncidents && !incidentsRefused, feedOf({ data: incidents.data, isError: incidents.isError })),
  };
  const issuesRefused = !issues.data && statusOf(issues.error) === 403;

  const now = useMemo(() => new Date(), [issues.dataUpdatedAt, actions.dataUpdatedAt, incidents.dataUpdatedAt]);          // eslint-disable-line react-hooks/exhaustive-deps
  const counters = countersOf(feeds, now);

  const issueRows = issues.data?.items ?? NO_ROWS;
  const actionRows = actions.data?.items ?? NO_ROWS;
  const incidentRows = incidents.data ?? NO_ROWS;
  const work = useMemo(() => buildWork({ me: me.data ?? null, now, canEdit, issues: issueRows, actions: actionRows, incidents: incidentRows }), [me.data, now, canEdit, issueRows, actionRows, incidentRows]);
  const sources = [
    { label: 'Your account', feed: statusOfQuery(me) },
    { label: 'Issues', feed: statusOfQuery(issues) },
    { label: 'Corrective actions', feed: statusOfQuery(actions) },
    ...(feeds.incidents ? [{ label: 'Incidents', feed: statusOfQuery(incidents) }] : []),
  ];

  const scoreStatus: FeedStatus = { ...statusOfQuery(score), isError: score.isError || (score.isSuccess && !score.data) };
  const posture = postureOf(score.data);
  const sectionList = sectionRows(score.data);
  const fullSections = SECTION_ORDER.map((k) => score.data?.sections?.[k]).filter((s): s is OverviewSection => !!s);

  const errors: Errors = { issues: errorOf(issues), actions: errorOf(actions), incidents: errorOf(incidents) };

  const updatedAt = Math.max(issues.dataUpdatedAt, actions.dataUpdatedAt, score.dataUpdatedAt);
  const refreshAll = () => { [me, issues, actions, score].forEach((q) => { void q.refetch(); }); if (canIncidents && !incidentsRefused) void incidents.refetch(); };
  const staleQueries = [issues, actions, score, ...(feeds.incidents ? [incidents] : [])].filter((q) => q.isError && q.data);
  const cut = issues.data && issues.data.total > issues.data.items.length ? issues.data : null;
  const hasRegister = !!register.data?.has_register;

  // the page is drawn (not just asked for) when every list that feeds a card has answered: then Back puts the scroll position back
  const ready = !issues.isPending && !actions.isPending && !score.isPending && !me.isPending && (!feeds.incidents || feeds.incidents.state !== 'loading');
  useReturnToPlace(ready);

  return (
    <div className="flex flex-col gap-[16px]">
      <SkipToWork />
      <PageHeader
        variant="page"
        title={titleFor('/issues') ?? 'Issue & Incident Overview'}
        info="How the issues, incidents and corrective actions are doing, and what needs you."
        meta={issuesRefused ? undefined : <span className="inline-flex items-center gap-[2px]">{updatedAt > 0 ? `Updated ${clockOf(updatedAt)}` : null}<IconButton label="Refresh the overview" onClick={refreshAll}><RefreshCw aria-hidden /></IconButton></span>}
        actions={issuesRefused ? undefined : (
          <>
            <Button href="/issues/register">Issues</Button>
            <Button href="/issues/actions">Corrective actions</Button>
            {hasRegister && <Button href="/issues/register?register=audit">Audit register</Button>}
            {canEdit && <Button href="/issues/settings" leftIcon={<Settings aria-hidden />}>Settings</Button>}
            {canCreate && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setRaising(true)}>Raise issue</Button>}
          </>
        )}
      />
      {issuesRefused ? (
        <NoAccessState title="You don't have access to the issues" reason={errorMessage(issues.error)} action={<Button href="/dashboard">Back to the dashboard</Button>} />
      ) : (
        <>
          {staleQueries.length > 0 && (
            <Notice tone="warning" title="Some numbers could not be refreshed" action={<Button leftIcon={<RefreshCw aria-hidden />} onClick={refreshAll}>Retry</Button>}>
              {`Showing what they said at ${clockOf(Math.min(...staleQueries.map((q) => q.dataUpdatedAt)))}.`}
            </Notice>
          )}
          {cut && (
            <Notice tone="info" title="The counts cover part of the register">
              {`They are worked out from the newest ${formatCount(cut.items.length)} of ${formatCount(cut.total)} issues.`}
            </Notice>
          )}
          <Cockpit
            hero={<IssueHero now={now} feeds={feeds} errors={errors} counters={counters} />}
            visuals={(
              <IssueVisuals
                now={now} feeds={feeds} errors={errors} trend={view.trend} onTrend={(trend) => setView({ trend })}
                score={{ feed: scoreStatus, posture, sections: sectionList, onOpen: () => setView({ score: true }) }}
              />
            )}
            work={<MyWork id="work" items={work} now={now} sources={sources} run={run} busy={busy} onAll={() => setView({ work: true })} />}
          />
          <ScoreSheet open={view.score} onClose={() => setView({ score: false })} sections={fullSections} posture={posture} />
          <WorkSheet open={view.work} onClose={() => setView({ work: false })} items={work} now={now} run={run} busy={busy} />
        </>
      )}
      {raising && <IssueForm open onClose={() => setRaising(false)} />}
      {dialog}
    </div>
  );
}
