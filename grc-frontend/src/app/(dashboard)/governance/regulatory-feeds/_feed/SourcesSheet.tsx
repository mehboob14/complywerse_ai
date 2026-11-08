'use client';

// Manage sources: the feeds the organisation reads, who watches each, when it was last checked, and what can be done with it (check it now, change who watches it, delete it with its items). A
// sheet over the Feed, so the inbox stays the page. Every action says what happened or why it did not; deleting asks first and names what goes.
import { Plus, Rss, Trash2, UserPlus } from 'lucide-react';
import { Button, EmptyState, ErrorState, IconButton, Notice, RegisterTable, Sheet, StatusPill, useConfirm, useReportedMutation, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatDateTime } from '@/lib/format';
import { FEED_REFRESH, useFeedSources } from '../../regulatory-changes/_lib/data';
import { feedApi } from '../../regulatory-changes/_lib/api';
import type { FeedSource } from '../../regulatory-changes/_lib/types';
import { assigneeLabel, categoryLabel, pollWords, type PollResult } from './feedModel';

export function SourcesSheet({ open, onClose, canCreate, canAssign, canDelete, onAdd, onAssign }: {
  open: boolean; onClose: () => void; canCreate: boolean; canAssign: boolean; canDelete: boolean; onAdd: () => void; onAssign: (s: FeedSource) => void;
}) {
  const { confirm, confirmDialog } = useConfirm();
  const q = useFeedSources();
  const sources = q.data ?? [];
  const invalidate = FEED_REFRESH.map((k) => [...k]);

  const poll = useReportedMutation({
    mutationFn: async (id: number) => (await feedApi.pollSource(id)).data as PollResult,
    success: (r) => { const w = pollWords([r]); return { title: w.title, message: w.message }; }, failure: "Couldn't check the feed", invalidate,
  });
  const seed = useReportedMutation({
    mutationFn: () => feedApi.seedDefaults(),
    success: { title: 'Feeds added', message: 'The Federal Reserve and ECB feeds are in the list.' }, failure: "Couldn't add the feeds", retryable: false, invalidate,
  });
  const remove = useReportedMutation({
    mutationFn: (id: number) => feedApi.deleteSource(id), success: { title: 'Feed deleted', message: 'Its items went with it.' }, failure: "Couldn't delete the feed", invalidate,
  });
  const askDelete = async (s: FeedSource) => {
    const yes = await confirm({ title: `Delete “${s.name}”?`, message: 'The feed and all the items read from it are removed. Changes already made from its items stay. It cannot be undone.', confirmLabel: 'Delete feed', tone: 'danger' });
    if (yes) remove.mutate(s.id);
  };

  const columns: RegisterColumn<FeedSource>[] = [
    {
      key: 'name', header: 'Feed', isRowHeader: true,
      cell: (s) => (
        <div className="min-w-0">
          <p className="m-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.name}</p>
          <p className="m-0 text-ds-label text-ds-fg-muted">{[s.regulator, s.country, categoryLabel(s.category)].filter((x) => x && x !== '—').join(' · ')}</p>
        </div>
      ),
    },
    { key: 'watchers', header: 'Watched by', priority: 2, card: 'meta', cell: (s) => <span className="text-ds-body text-ds-fg-body">{assigneeLabel(s)}</span> },
    { key: 'status', header: 'Status', card: 'meta', cell: (s) => <StatusPill size="sm" tone={s.is_active ? 'success' : 'neutral'} label={s.is_active ? 'Active' : 'Paused'} /> },
    { key: 'polled', header: 'Last checked', priority: 3, card: 'meta', cell: (s) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{formatDateTime(s.last_polled_at, { empty: 'Never' })}</span> },
    { key: 'items', header: 'Items', priority: 3, align: 'right', card: 'meta', cell: (s) => <span className="tabular-nums text-ds-body text-ds-fg-body">{s.items_processed}</span> },
    {
      key: 'actions', header: '', card: 'hide', width: 'w-[168px]',
      cell: (s) => (
        <span className="flex items-center justify-end gap-[4px]">
          <Button size="sm" loading={poll.isPending && poll.variables === s.id} onClick={() => poll.mutate(s.id)}>Check now</Button>
          {canAssign && <IconButton label={`Change who watches ${s.name}`} onClick={() => onAssign(s)}><UserPlus aria-hidden /></IconButton>}
          {canDelete && <IconButton label={`Delete ${s.name}`} onClick={() => { void askDelete(s); }}><Trash2 aria-hidden /></IconButton>}
        </span>
      ),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Manage sources"
      subtitle={q.data ? `${sources.length} ${sources.length === 1 ? 'feed' : 'feeds'}` : undefined}
      width="lg"
      actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add a feed</Button> : undefined}
    >
      {q.isError && !q.data ? (
        <ErrorState title="Couldn't load the feeds" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : (
        <div className="flex flex-col gap-[12px]">
          {sources.length > 0 && <Notice tone="info">Items from a feed that nobody watches still appear in the Feed. Watchers get them counted in My work.</Notice>}
          <RegisterTable<FeedSource>
            caption="Feed sources"
            columns={columns}
            rows={sources}
            getRowId={(s) => s.id}
            loading={q.isPending}
            cardTitle={(s) => <span className="text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{s.name}</span>}
            cardActions={(s) => (
              <span className="flex items-center gap-[2px]">
                <Button size="sm" loading={poll.isPending && poll.variables === s.id} onClick={() => poll.mutate(s.id)}>Check now</Button>
                {canDelete && <IconButton label={`Delete ${s.name}`} onClick={() => { void askDelete(s); }}><Trash2 aria-hidden /></IconButton>}
              </span>
            )}
            empty={(
              <EmptyState
                kind="firstUse" bare icon={Rss} title="No feeds yet"
                description="Add the address of a regulator's RSS feed, and its announcements arrive in the Feed to read."
                action={canCreate ? (
                  <span className="flex flex-wrap justify-center gap-[8px]">
                    <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onAdd}>Add a feed</Button>
                    <Button loading={seed.isPending} onClick={() => seed.mutate()}>Add Federal Reserve and ECB feeds</Button>
                  </span>
                ) : undefined}
              />
            )}
          />
          {canCreate && sources.length > 0 && <div><Button loading={seed.isPending} onClick={() => seed.mutate()}>Add Federal Reserve and ECB feeds</Button></div>}
        </div>
      )}
      {confirmDialog}
    </Sheet>
  );
}
