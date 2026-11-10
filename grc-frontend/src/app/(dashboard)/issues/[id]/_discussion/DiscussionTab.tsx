'use client';

// The Discussion tab: the comments on the issue, oldest first (a conversation reads down), and a box to add one. Adding a comment needs the right to edit issues, which is what the server asks;
// a person who may only read sees the conversation and no box. A failed read says so with Retry (never "no comments"); a failed post keeps what was typed and says why.
import { useState } from 'react';
import { Button, EmptyState, FormField, PersonChip, Textarea, useReportedMutation } from '@/components/ui/ds';
import { issuesApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Feed } from '../_timeline/TimelineTab';
import { REFRESH, useIssueComments, type IssueRecord } from '../workspaceData';

const MUTED = 'text-ds-fg-muted';

export function DiscussionTab({ issue, canEdit }: { issue: IssueRecord; canEdit: boolean }) {
  const comments = useIssueComments(issue.id, true);
  const [text, setText] = useState('');
  const post = useReportedMutation({
    mutationFn: async (body: string) => (await issuesApi.comments.create(issue.id, { body })).data,
    success: 'Comment added',
    failure: "Couldn't add the comment",
    toast: 'errors',                                                        // the comment appearing in the conversation is the confirmation
    invalidate: REFRESH,
    onSuccess: () => setText(''),
  });
  return (
    <div className="flex flex-col gap-[16px]">
      <Feed state={comments} noun="comments">
        {(rows) => rows.length === 0 ? (
          <EmptyState bare kind="firstUse" title="No comments yet" description={canEdit ? 'Start the conversation: questions, progress, who is waiting on whom.' : 'Nobody has commented on this issue yet.'} />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[16px] p-0">
            {rows.map((c) => (
              <li key={c.id} className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
                  <PersonChip name={c.user?.display_name} emptyLabel="Someone" />
                  <span className={`text-ds-label ${MUTED}`}>{formatDateTime(c.created_at)}</span>
                </div>
                <p dir="auto" className="m-0 mt-[4px] whitespace-pre-line break-words pl-[32px] text-ds-body text-ds-fg-body [overflow-wrap:anywhere]">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Feed>
      {canEdit && (
        <form
          className="flex flex-col gap-[8px] border-t border-ds-border pt-[16px]"
          onSubmit={(e) => { e.preventDefault(); if (text.trim()) post.mutate(text.trim()); }}
        >
          <FormField label="Add a comment">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </FormField>
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={post.isPending} disabled={!text.trim()}>Post comment</Button>
          </div>
        </form>
      )}
    </div>
  );
}
