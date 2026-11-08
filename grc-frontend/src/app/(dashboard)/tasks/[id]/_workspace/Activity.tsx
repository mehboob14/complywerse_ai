'use client';

// The task's Activity: ONE feed of what people wrote and what changed, newest first, with the box to write a comment on top (Ctrl+Enter or Cmd+Enter posts it). "All activity" shows the
// comments and every change in words (taskTimeline.ts: "changed the owners from A to B"); "Comments" shows the comments alone. A long feed shows the latest rows and a button for more.
// A comment cannot be edited or deleted (the server has no such request); posting says so only when it fails.
import { useState } from 'react';
import { Send } from 'lucide-react';
import { Button, EmptyState, PersonChip, SectionCard, SegmentedControl, Textarea, useReportedMutation } from '@/components/ui/ds';
import { criticalTasksApi } from '@/lib/api';
import { formatCount, formatDateTime } from '@/lib/format';
import { TASK_REFRESH } from '../../_register/taskData';
import { SECTION_IDS, type ActivityFilter, type TaskPageData } from './taskPageModel';
import { feedCounts, feedOf, type FeedRow } from './taskTimeline';

const PAGE = 30;

function Composer({ taskId }: { taskId: number }) {
  const [text, setText] = useState('');
  const post = useReportedMutation({
    mutationFn: (content: string) => criticalTasksApi.addComment(taskId, { content }),
    success: 'Comment added',
    failure: "Couldn't add the comment",
    invalidate: TASK_REFRESH,
    toast: 'errors',                                                    // the comment appearing at the top of the feed is the confirmation
    onSuccess: () => setText(''),
  });
  const send = () => { if (text.trim() && !post.isPending) post.mutate(text.trim()); };
  return (
    <div className="flex flex-col gap-[8px] sm:flex-row sm:items-start">
      <Textarea
        aria-label="Write a comment"
        rows={2}
        placeholder="Write a comment"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } }}
        className="sm:flex-1"
      />
      <Button variant="primary" leftIcon={<Send aria-hidden />} loading={post.isPending} disabled={!text.trim()} onClick={send}>Post</Button>
    </div>
  );
}

function Row({ row }: { row: FeedRow }) {
  if (row.kind === 'comment') {
    return (
      <li className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
        <div className="mb-[6px] flex flex-wrap items-center justify-between gap-x-[8px] gap-y-[2px]">
          <PersonChip name={row.who} emptyLabel="Someone no longer here" size={20} />
          <span className="text-ds-label text-ds-fg-muted">{formatDateTime(row.at)}</span>
        </div>
        <p dir="auto" className="m-0 whitespace-pre-wrap text-ds-body text-ds-fg [overflow-wrap:anywhere]">{row.text}</p>
      </li>
    );
  }
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[2px] px-[4px]">
      <span className="min-w-0 text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]"><span className="font-[600] text-ds-fg">{row.who ?? 'System'}</span> {row.text}</span>
      <span className="shrink-0 text-ds-label text-ds-fg-muted">{formatDateTime(row.at)}</span>
    </li>
  );
}

export function Activity({ task, filter, onFilter }: { task: TaskPageData; filter: ActivityFilter; onFilter: (next: ActivityFilter) => void }) {
  const [shown, setShown] = useState(PAGE);
  const counts = feedCounts(task);
  const rows = feedOf(task, filter);
  return (
    <SectionCard
      id={SECTION_IDS.activity}
      title="Activity"
      actions={(
        <SegmentedControl<ActivityFilter>
          label="Show"
          name="task-activity-filter"
          value={filter}
          onChange={(v) => { onFilter(v); setShown(PAGE); }}
          options={[{ value: 'all', label: `All (${formatCount(counts.all)})` }, { value: 'comments', label: `Comments (${formatCount(counts.comments)})` }]}
        />
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <Composer taskId={task.id} />
        {rows.length === 0 ? (
          <EmptyState bare kind="firstUse" title={filter === 'comments' ? 'No comments yet' : 'Nothing has happened yet'} info="Comments and every change to the task are listed here, newest first." />
        ) : (
          <>
            <ol className="m-0 flex list-none flex-col gap-[8px] p-0">
              {rows.slice(0, shown).map((r) => <Row key={r.key} row={r} />)}
            </ol>
            {rows.length > shown && <Button onClick={() => setShown(shown + PAGE)}>{`Show ${Math.min(PAGE, rows.length - shown)} more of ${formatCount(rows.length - shown)}`}</Button>}
          </>
        )}
      </div>
    </SectionCard>
  );
}
