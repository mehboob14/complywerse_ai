'use client';

export const dynamic = 'force-dynamic';

// Issue & Incident Management > Overview, a graphical cockpit (the frame of the Risk Management and Governance Overviews: components/overview, with the chart kit components/overview/charts): the
// figures it leads with (open, late, critical or high, raised and closed in 30 days, closed on time, each with its shape over twelve months), what needs attention across the module as a band of
// counters, the cards of the whole register (raised and closed, severity, state, age, impact by urgency, the open backlog, who holds the issues, where they came from, how well they close, the
// corrective actions, the incidents), then the person's own prioritised work beside one compact score card. It replaces the page of eight tabs: Enterprise Log, Contract Compliance and CAPA
// Actions are the register pages (/issues/register, /issues/actions), the Closure Tracker's lenses are the cards, and the Severity matrix and Automation tabs are /issues/settings. Every old
// address still lands where its thing is now (_overview/forwards.ts).
// ONE definition: a counter and a figure are the number of rows the register's own chip keeps (overviewModel.ts, chartModel.ts), so the number here is the number there after the click. "Needs
// attention" counts each record once. Every request loads, fails (with Retry) and has nothing on its own: a failed list is never read as 0. The score and its sections are the server's scorecard (GET
// /issue-management/dashboard/sections-overview, key and payload unchanged: the main Dashboard reads the same key).
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, RefreshCw, Settings } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, IconButton, NoAccessState, Notice } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { Cockpit, SkipToWork } from '@/components/overview/Cockpit';
import { CounterBand, type BandCounter } from '@/components/overview/CounterBand';
import { layoutOf, workRowLimit } from '@/components/overview/cockpitModel';
import { useNarrow } from '@/components/overview/useNarrow';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import { usePermissions } from '@/hooks/usePermissions';
import { auditRegisterApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { clockOf } from '@/lib/inbox/inboxView';
import { titleFor } from '@/lib/navRegistry';
import { IssueForm } from './_components/IssueForm';
import { feedOf, useActionRows, useClosing, useIncidentRows, useIssueRows, useMe, useScorecard, useSeverityMatrix } from './_overview/data';
import { forwardFor } from './_overview/forwards';
import { ScoreCard, ScoreSheet, WorkCard, type FeedStatus } from './_overview/parts';
import { SECTION_ORDER, buildWork, countersOf, incidentsFeed, needsAttention, postureOf, sectionRows, type FeedKey } from './_overview/overviewModel';
import { useWorkSteps } from './_overview/useWorkSteps';
import { IssueHero, IssueVisuals, type ErrorInfo, type Errors } from './_overview/visuals';

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
  const narrow = useNarrow();
  const { hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canEdit = hasPermission('issue_management:issues:edit');
  const canCreate = hasPermission('issue_management:issues:create');
  const canIncidents = hasPermission('erm:incidents:*');
  const [raising, setRaising] = useState(false);
  const [scoreOpen, setScoreOpen] = useState(false);
  const { run, busy, dialog } = useWorkSteps();

  const me = useMe();
  const issues = useIssueRows(null);
  const actions = useActionRows();
  const incidents = useIncidentRows(canIncidents);
  const score = useScorecard();
  const closing = useClosing();
  const matrix = useSeverityMatrix();
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
  const measured = countersOf(feeds, now);
  const counters: BandCounter[] = measured.map((c) => {
    const q = c.feed === 'issues' ? issues : c.feed === 'actions' ? actions : incidents;
    return { key: c.key, label: c.label, href: c.href, tone: c.tone, state: c.state, value: c.value, onRetry: c.state === 'error' && canRetry(q.error) ? () => { void q.refetch(); } : undefined };
  });
  const attention = needsAttention(feeds, now);
  const shownFeeds = (['issues', 'actions', 'incidents'] as FeedKey[]).filter((k) => feeds[k]);
  const allFailed = shownFeeds.every((k) => feeds[k]?.state === 'error');
  const total = attention !== null ? `${formatCount(attention)} ${attention === 1 ? 'item' : 'items'}`
    : shownFeeds.some((k) => feeds[k]?.state === 'error') ? 'Total unavailable' : undefined;

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
  const workLoading = sources.some((s) => !s.feed.hasData && s.feed.isPending);
  const mode = layoutOf({ refused: false, workCount: workLoading ? null : work.length });
  const limit = workRowLimit(mode, narrow);

  const scoreStatus: FeedStatus = { ...statusOfQuery(score), isError: score.isError || (score.isSuccess && !score.data) };
  const posture = postureOf(score.data);
  const sectionList = sectionRows(score.data);
  const fullSections = SECTION_ORDER.map((k) => score.data?.sections?.[k]).filter((s): s is OverviewSection => !!s);

  const errors: Errors = { issues: errorOf(issues), actions: errorOf(actions), incidents: errorOf(incidents) };
  const closingFeed = { state: closing.data ? 'ready' as const : closing.isError ? 'error' as const : 'loading' as const, data: closing.data, error: errorOf(closing) };

  const updatedAt = Math.max(issues.dataUpdatedAt, actions.dataUpdatedAt, score.dataUpdatedAt);
  const refreshAll = () => { [me, issues, actions, score, closing].forEach((q) => { void q.refetch(); }); if (canIncidents && !incidentsRefused) void incidents.refetch(); };
  const staleQueries = [issues, actions, score, ...(feeds.incidents ? [incidents] : [])].filter((q) => q.isError && q.data);
  const cut = issues.data && issues.data.total > issues.data.items.length ? issues.data : null;
  const hasRegister = !!register.data?.has_register;

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
            mode={mode}
            narrow={narrow}
            hero={<IssueHero now={now} feeds={feeds} errors={errors} counters={measured} />}
            visuals={<IssueVisuals now={now} feeds={feeds} errors={errors} matrix={matrix.data?.cells} closing={closingFeed} />}
            band={(
              <CounterBand
                id="attention"
                title="Needs attention"
                info="Each count opens the records it counts, in the register. The total counts every issue, action or incident once, however many of these it matches. Open issues and open incidents are shown for context and are not in it."
                total={total}
                counters={counters}
                narrow={narrow}
                failure={allFailed ? { title: "Couldn't load the counters", message: errorMessage(issues.error ?? actions.error), onRetry: canRetry(issues.error ?? actions.error) ? refreshAll : undefined } : undefined}
              />
            )}
            work={<WorkCard id="work" items={work} now={now} sources={sources} limit={limit} run={run} busy={busy} />}
            posture={<ScoreCard id="score" feed={scoreStatus} posture={posture} sections={sectionList} onOpen={() => setScoreOpen(true)} />}
            breakdowns={[]}
          />
          <ScoreSheet open={scoreOpen} onClose={() => setScoreOpen(false)} sections={fullSections} posture={posture} />
        </>
      )}
      {raising && <IssueForm open onClose={() => setRaising(false)} />}
      {dialog}
    </div>
  );
}
