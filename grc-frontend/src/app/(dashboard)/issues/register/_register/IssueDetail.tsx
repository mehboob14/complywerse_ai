'use client';

// The drawer of one issue in the register: what a person needs to decide the next step without leaving the list (the pills, the dates and people, the words of the issue, the last
// three things that happened). The long text a lean row leaves out is read when the drawer opens, and a failed read says so and offers Retry. Everything else is on the issue's own page.
import { ClampedText, ErrorState, Fact, FactList, PersonChip, Skeleton, StatusPill } from '@/components/ui/ds';
import { EMPTY, formatCount, formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { issueCategory, issueSeverity, issueState, issueType, lateness } from '@/lib/statuses/issues';
import { eventLine, lateWord, sourceWord } from '@/lib/issues/words';
import { lateDays, personName, type IssueRow } from '@/lib/issues/issueDef';
import { useIssueDetail, useIssueEvents } from './issueData';

const MUTED = 'text-ds-fg-muted';
const Words = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className={`mb-[4px] text-ds-label ${MUTED}`}>{label}</p>{children}</div>;

export function SeverityPill({ i }: { i: IssueRow }) {
  return i.severity ? <StatusPill size="sm" {...statusPill(issueSeverity, i.severity)} /> : null;
}
export function StatePill({ i }: { i: IssueRow }) {
  return <StatusPill size="sm" {...statusPill(issueState, i.workflow_state || 'new')} />;
}
export function LatePill({ i, now }: { i: IssueRow; now: Date }) {
  const days = lateDays(i, now);
  return days == null ? null : <StatusPill size="sm" tone={lateness.tone('overdue')} label={lateWord(days)} />;
}

export function IssueDetail({ i, now }: { i: IssueRow; now: Date }) {
  const full = useIssueDetail(i.id);
  const events = useIssueEvents(i.id);
  const d = full.data;
  const done = i.actions_done ?? 0;
  const total = i.action_count ?? 0;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><SeverityPill i={i} /><StatePill i={i} /><LatePill i={i} now={now} /></div>
      <FactList min={150}>
        <Fact label="Target date">{i.target_closure_date ? formatDate(i.target_closure_date) : null}</Fact>
        <Fact label="Assigned to"><PersonChip name={personName(i.assignee)} /></Fact>
        <Fact label="Owner">{personName(i.owner) ? <PersonChip name={personName(i.owner)} /> : null}</Fact>
        <Fact label="Reported by">{personName(i.reporter) ? <PersonChip name={personName(i.reporter)} /> : null}</Fact>
        <Fact label="Type">{i.issue_type ? issueType.label(i.issue_type) : null}</Fact>
        <Fact label="Category">{i.category ? issueCategory.label(i.category) : null}</Fact>
        <Fact label="Raised from">{sourceWord(i.source_type)}</Fact>
        <Fact label="Raised">{i.created_at ? formatDate(i.created_at) : null}</Fact>
        <Fact label="Corrective actions">{total > 0 ? `${formatCount(done)} of ${formatCount(total)} done` : null}</Fact>
        {i.closed_at && <Fact label="Closed">{formatDate(i.closed_at)}</Fact>}
      </FactList>

      {full.isLoading && <div aria-busy="true"><Skeleton className="h-[14px] w-[60%]" /><Skeleton className="mt-[8px] h-[14px] w-[90%]" /></div>}
      {full.isError && <ErrorState compact title="Couldn't read the issue's details" onRetry={() => { void full.refetch(); }} />}
      {d?.description && <Words label="What happened"><ClampedText text={d.description} lines={5} /></Words>}
      {d?.root_cause && <Words label="Root cause"><ClampedText text={d.root_cause} lines={4} /></Words>}
      {d?.closure_notes && <Words label="Closure notes"><ClampedText text={d.closure_notes} lines={4} /></Words>}

      <Words label="Latest activity">
        {events.isLoading && <p role="status" className={`text-ds-label ${MUTED}`}>Reading the activity…</p>}
        {events.isError && <ErrorState compact title="Couldn't read the activity" onRetry={() => { void events.refetch(); }} />}
        {events.data && events.data.length === 0 && <p className={`text-ds-body ${MUTED}`}>Nothing has happened yet.</p>}
        {events.data && events.data.length > 0 && (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {events.data.map((e) => (
              <li key={e.id} className="text-ds-body text-ds-fg-body">
                <span className="font-[600] text-ds-fg">{eventLine(e.type, e.payload)}</span>
                <span className={`block text-ds-label ${MUTED}`}>{[e.user?.display_name, formatDateTime(e.created_at)].filter(Boolean).join(' · ') || EMPTY}</span>
              </li>
            ))}
          </ul>
        )}
      </Words>
    </div>
  );
}
