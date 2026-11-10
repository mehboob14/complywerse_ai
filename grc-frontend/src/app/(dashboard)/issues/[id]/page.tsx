'use client';

export const dynamic = 'force-dynamic';

/**
 * Issue & Incident Management > Issue: the record workspace. A head with the title, the severity, the state and how late it is, the ONE step the issue expects next, Edit details and a menu
 * for the other steps; a band of the facts that matter (who it is assigned to, the owner, who reported it, the target date, the type and category); and tabs: Overview (what happened, the
 * root cause, the details, the latest activity), Actions (the corrective actions), Linked records, Discussion, Timeline, and for a finding of the client's audit register, Audit register.
 * The tab, and a deep link such as ?tab=actions, live in the address. It replaces a 1,400-line page whose four cards opened popups over popups.
 *
 * Who may do what follows what the server enforces today and nothing more: reading needs `issue_management:issues:view`, every write (a step, an edit, an action, a link, a comment) needs
 * `issue_management:issues:edit`. Closure approval is an edit too (the assignee can approve their own work): kept as it is, and listed for the user. Every write goes through a reported
 * mutation: a refused one says so in words, with a Retry where one makes sense.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, ErrorState, Fact, FactList, Menu, Notice, PersonChip, SkeletonRows, StatusPill, TabPanel, Tabs, useConfirm, useReportedMutation, useTabParam, type MenuItem, type TabItem,
} from '@/components/ui/ds';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { RegisterPanel } from '@/components/audit-register/RegisterPanel';
import { usePermissions } from '@/hooks/usePermissions';
import { auditRegisterApi, issuesApi } from '@/lib/api';
import { formatDate, truncate } from '@/lib/format';
import { codeOf, personName } from '@/lib/issues/issueDef';
import { stepsFrom, type IssueStep } from '@/lib/issues/words';
import { issueCategory, issueState, issueType } from '@/lib/statuses/issues';
import { LatePill, SeverityPill, StatePill } from '../register/_register/IssueDetail';
import { StepDialog } from '../register/_register/StepDialog';
import { ActionsTab } from './_actions/ActionsTab';
import { DiscussionTab } from './_discussion/DiscussionTab';
import { LinkedTab } from './_linked/LinkedTab';
import { linkedTotal } from './_linked/linkedModel';
import { EditPanel } from './_overview/EditPanel';
import { OverviewTab } from './_overview/OverviewTab';
import { TimelineTab } from './_timeline/TimelineTab';
import { REFRESH, failureWords, issueKey, useIssue, useIssueActions, useIssueActivity, useRegisterProfile } from './workspaceData';

const TABS = ['overview', 'actions', 'linked', 'discussion', 'timeline', 'register'] as const;
type Tab = (typeof TABS)[number];

export default function IssuePage() {
  const params = useParams();
  const issueId = Number(params.id);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('issue_management:issues:edit');
  const { confirm, confirmDialog } = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<IssueStep | null>(null);
  const now = useMemo(() => new Date(), []);

  const issueQ = useIssue(issueId);
  const issue = issueQ.data;
  const events = useIssueActivity(issueId);

  // a tenant that keeps the client's audit register: its panel is a tab for the findings that came from it
  const register = useQuery<{ has_register: boolean }>({ queryKey: ['audit-register-status'], queryFn: async () => (await auditRegisterApi.status()).data, retry: false, staleTime: 60_000 });
  const profile = useRegisterProfile(issueId, !!register.data?.has_register);
  const hasRegisterTab = !!profile.data;
  const keys: Tab[] = hasRegisterTab ? [...TABS] : TABS.filter((t) => t !== 'register');
  const [tab, setTab] = useTabParam<Tab>('tab', keys, { fallback: 'overview' });
  const actions = useIssueActions(issueId, tab === 'actions');

  useEffect(() => { document.title = issue ? `${issue.title} · Issue` : 'Issue'; }, [issue]);

  const step = useReportedMutation({
    mutationFn: async (v: { step: IssueStep; text?: string }) => {
      if (v.step.kind === 'close') return (await issuesApi.close(issueId, { closure_notes: v.text ?? '' })).data;
      if (v.step.kind === 'reopen') return (await issuesApi.reopen(issueId, { reason: v.text ?? '' })).data;
      return (await issuesApi.transition(issueId, { to_state: v.step.to })).data;
    },
    success: (_d, v) => (v.step.kind === 'close' ? 'Closure approved' : v.step.kind === 'reopen' ? 'Issue reopened' : v.step.to === 'cancelled' ? 'Issue cancelled' : `Moved to ${issueState.label(v.step.to)}`),
    failure: "Couldn't change the issue",
    invalidate: REFRESH,
    onSuccess: () => setAsking(null),
    onError: () => { void qc.invalidateQueries({ queryKey: issueKey(issueId) }); },     // the issue may have moved on under this screen: read it again so the next step offered is the right one
  });
  const run = async (s: IssueStep) => {
    if (!issue) return;
    if (s.kind === 'close' || s.kind === 'reopen') { setAsking(s); return; }
    if (s.danger) {
      const yes = await confirm({ title: 'Cancel this issue?', message: `“${truncate(issue.title, 80).text}” will be cancelled. You can reopen it later.`, confirmLabel: 'Cancel issue', tone: 'danger' });
      if (!yes) return;
    }
    step.mutate({ step: s });
  };

  // ── states ──
  // no issue yet: still reading, or it could not be read. (A refresh that fails later keeps the issue on screen, with a notice.)
  if (!issue) {
    if (issueQ.isPending) {
      return <div aria-busy="true" className="flex flex-col gap-[16px]"><SkeletonRows rows={1} columns={2} label="Loading the issue" /><SkeletonRows rows={8} columns={3} label="Loading the issue" /></div>;
    }
    return (
      <div className="flex flex-col gap-[16px]">
        <ErrorState {...failureWords(issueQ.error)} onRetry={canRetry(issueQ.error) ? () => { void issueQ.refetch(); } : undefined} />
        <div><Button href="/issues/register">Back to Issues</Button></div>
      </div>
    );
  }

  const steps = canEdit ? stepsFrom(issue.workflow_state) : [];
  const primary = steps.find((s) => s.primary) ?? null;
  const rest: MenuItem[] = steps.filter((s) => s !== primary).map((s) => ({ key: s.key, label: s.label, danger: s.danger, onSelect: () => { void run(s); } }));
  const counts = issue.link_counts;
  const tabs: TabItem[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'actions', label: 'Actions', count: counts?.actions || undefined },
    { key: 'linked', label: 'Linked records', count: linkedTotal(counts) || undefined },
    { key: 'discussion', label: 'Discussion', count: counts?.comments || undefined },
    { key: 'timeline', label: 'Timeline' },
    ...(hasRegisterTab ? [{ key: 'register', label: 'Audit register' }] : []),
  ];
  const shown: Tab = keys.includes(tab) ? tab : 'overview';
  const assignee = personName(issue.assignee);

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={issue.title}
        back={{ href: '/issues/register', label: 'Back to Issues' }}
        meta={[codeOf(issue), issue.created_at ? `Raised ${formatDate(issue.created_at)}` : null].filter(Boolean).join(' · ')}
        chips={(
          <>
            <SeverityPill i={issue} />
            <StatePill i={issue} />
            <LatePill i={issue} now={now} />
            {issue.severity_override && <StatusPill tone="warning" label="Severity set by hand" />}
          </>
        )}
        actions={(
          <>
            {primary && <Button variant="primary" loading={step.isPending && !asking} onClick={() => { void run(primary); }}>{primary.label}</Button>}
            {canEdit && <Button variant={primary ? 'secondary' : 'primary'} leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit details</Button>}
            {rest.length > 0 && <Menu label="More" items={rest} />}
          </>
        )}
      />

      {issueQ.isError && (
        <Notice tone="warning" title="Couldn't refresh this issue" action={<Button onClick={() => { void issueQ.refetch(); }}>Retry</Button>}>
          What you see may be out of date.
        </Notice>
      )}

      <FactList variant="boxed" min={150}>
        <Fact label="Assigned to">
          <span className="flex flex-wrap items-center gap-[8px]">
            <PersonChip name={assignee} />
            {canEdit && <Button size="sm" aria-label={assignee ? 'Change who it is assigned to' : 'Assign this issue'} onClick={() => setEditing(true)}>{assignee ? 'Change' : 'Assign'}</Button>}
          </span>
        </Fact>
        <Fact label="Owner" empty={canEdit ? 'Not set' : undefined}>{personName(issue.owner) ? <PersonChip name={personName(issue.owner)} /> : null}</Fact>
        <Fact label="Reported by">{personName(issue.reporter) ? <PersonChip name={personName(issue.reporter)} /> : null}</Fact>
        <Fact label="Target date">{issue.target_closure_date ? formatDate(issue.target_closure_date) : null}</Fact>
        <Fact label="Type">{issue.issue_type ? issueType.label(issue.issue_type) : null}</Fact>
        <Fact label="Category">{issue.category ? issueCategory.label(issue.category) : null}</Fact>
      </FactList>

      <Tabs tabs={tabs} value={shown} onChange={setTab} ariaLabel="Issue sections" countFormat="exact">
        <TabPanel tabKey="overview">
          <div className="pt-[16px]"><OverviewTab issue={issue} events={events} canEdit={canEdit} onEdit={() => setEditing(true)} onTimeline={() => setTab('timeline')} /></div>
        </TabPanel>
        <TabPanel tabKey="actions" lazy>
          <div className="pt-[16px]"><ActionsTab issue={issue} actions={actions} canEdit={canEdit} /></div>
        </TabPanel>
        <TabPanel tabKey="linked" lazy>
          <div className="pt-[16px]"><LinkedTab issue={issue} canEdit={canEdit} /></div>
        </TabPanel>
        <TabPanel tabKey="discussion" lazy>
          <div className="pt-[16px]"><DiscussionTab issue={issue} canEdit={canEdit} /></div>
        </TabPanel>
        <TabPanel tabKey="timeline" lazy>
          <div className="pt-[16px]"><TimelineTab events={events} /></div>
        </TabPanel>
        {hasRegisterTab && (
          <TabPanel tabKey="register" lazy>
            <div className="pt-[16px]"><RegisterPanel issueId={issueId} /></div>
          </TabPanel>
        )}
      </Tabs>

      {editing && <EditPanel issue={issue} onClose={() => setEditing(false)} />}
      {asking && (
        <StepDialog
          step={asking}
          issueName={`${codeOf(issue)} · ${truncate(issue.title, 80).text}`}
          saving={step.isPending}
          onClose={() => setAsking(null)}
          onSubmit={(text) => step.mutate({ step: asking, text })}
        />
      )}
      {confirmDialog}
    </div>
  );
}
