'use client';

// The Overview tab: what happened, the root cause and (once closed) the closure notes on the left; the rest of the details and the latest three events on the right. The people, the target date
// and the type are in the facts band above the tabs, so nothing is said twice. A part with nothing in it says so and, for a person who may edit, offers the edit panel.
import Link from 'next/link';
import { ArrowUpRight, Pencil } from 'lucide-react';
import { Button, ClampedText, Fact, FactList, SectionCard, StatusPill } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { latestItems, type ActivityRow } from '@/lib/issues/timeline';
import { sourceWord } from '@/lib/issues/words';
import { statusPill } from '@/lib/status';
import { issueSeverity } from '@/lib/statuses/issues';
import { sourceHref } from '../_linked/linkedModel';
import { EventRow, Feed, type FeedState } from '../_timeline/TimelineTab';
import type { IssueRecord } from '../workspaceData';

const MUTED = 'text-ds-fg-muted';
const title = (word?: string | null): string | null => (word ? word.charAt(0).toUpperCase() + word.slice(1) : null);
const Words = ({ label, children }: { label: string; children: React.ReactNode }) => <div><p className={`m-0 mb-[4px] text-ds-label ${MUTED}`}>{label}</p>{children}</div>;
const Nothing = ({ children }: { children: string }) => <p className={`m-0 text-ds-body ${MUTED}`}>{children}</p>;

export function OverviewTab({ issue, events, canEdit, onEdit, onTimeline }: {
  issue: IssueRecord;
  events: FeedState<ActivityRow[]>;
  canEdit: boolean;
  onEdit: () => void;
  onTimeline: () => void;
}) {
  const edit = (what: string) => (canEdit ? <Button size="sm" aria-label={`Edit ${what}`} leftIcon={<Pencil aria-hidden />} onClick={onEdit}>Edit</Button> : undefined);
  const origin = sourceHref(issue.source_type, issue.source_id);
  const set = !!issue.severity_override;
  return (
    <div className="grid gap-[16px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-[16px]">
        <SectionCard id="what" title="What happened" actions={edit('what happened')}>
          {issue.description?.trim() ? <ClampedText text={issue.description} lines={6} /> : <Nothing>Not described yet.</Nothing>}
        </SectionCard>
        <SectionCard id="cause" title="Root cause" actions={edit('the root cause')}>
          <div className="flex flex-col gap-[12px]">
            <Words label="Why it happened">{issue.root_cause?.trim() ? <p dir="auto" className="m-0 break-words text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{issue.root_cause}</p> : <Nothing>Not recorded yet.</Nothing>}</Words>
            <Words label="Analysis">{issue.root_cause_analysis?.trim() ? <ClampedText text={issue.root_cause_analysis} lines={6} /> : <Nothing>Not documented yet.</Nothing>}</Words>
          </div>
        </SectionCard>
        {issue.closure_notes?.trim() && (
          <SectionCard id="closure" title="Closure notes" meta={issue.approved_by?.display_name ? `Approved by ${issue.approved_by.display_name}${issue.approved_at ? ` · ${formatDate(issue.approved_at)}` : ''}` : undefined}>
            <ClampedText text={issue.closure_notes} lines={6} />
          </SectionCard>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-[16px]">
        <SectionCard id="details" title="Details">
          <FactList min={140}>
            <Fact label="Severity">
              {issue.severity ? (
                <span className="flex flex-col items-start gap-[4px]">
                  <StatusPill size="sm" {...statusPill(issueSeverity, issue.severity)} />
                  {set && <span className={`text-ds-label ${MUTED}`}>Set by hand{issue.severity_override_reason ? `: ${issue.severity_override_reason}` : ''}</span>}
                </span>
              ) : null}
            </Fact>
            <Fact label="Impact">{title(issue.impact)}</Fact>
            <Fact label="Urgency">{title(issue.urgency)}</Fact>
            <Fact label="Raised from">
              {origin ? <Link href={origin} className="inline-flex min-h-ds-control items-center gap-[4px] rounded-ds-control text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{sourceWord(issue.source_type)}<ArrowUpRight aria-hidden size={14} /></Link> : sourceWord(issue.source_type)}
            </Fact>
            <Fact label="Raised">{issue.created_at ? formatDate(issue.created_at) : null}</Fact>
            <Fact label="Detected">{issue.detected_at ? formatDate(issue.detected_at) : null}</Fact>
            <Fact label="Due date" empty="Not set">{issue.due_date ? formatDate(issue.due_date, { calendar: true }) : null}</Fact>
            {issue.resolved_at && <Fact label="Resolved">{formatDate(issue.resolved_at)}</Fact>}
            {issue.closed_at && <Fact label="Closed">{formatDate(issue.closed_at)}</Fact>}
          </FactList>
        </SectionCard>

        <SectionCard id="latest" title="Latest activity" actions={<Button size="sm" onClick={onTimeline}>See the timeline</Button>}>
          <Feed state={events} noun="activity">
            {(rows) => {
              const items = latestItems(rows, 3);
              return items.length === 0
                ? <Nothing>Nothing has happened yet.</Nothing>
                : <ol className="m-0 flex list-none flex-col gap-[14px] p-0">{items.map((item) => <EventRow key={item.id} item={item} />)}</ol>;
            }}
          </Feed>
        </SectionCard>
      </div>
    </div>
  );
}
