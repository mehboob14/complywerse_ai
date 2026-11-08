'use client';

// Regulatory Feeds: the Feed of Regulatory Changes. The same strip as the rest of the leaf (Overview, Changes, Feed); this address keeps working for every link and bookmark. The inbox and the
// reader are _feed/FeedInbox; the feeds themselves (check, who watches, add, delete) are the Manage sources sheet. Poll all checks every feed and says how many items are new.
import { useState } from 'react';
import { RefreshCw, Rss } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, useReportedMutation } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { feedApi } from '../regulatory-changes/_lib/api';
import { FEED_REFRESH } from '../regulatory-changes/_lib/data';
import type { FeedSource } from '../regulatory-changes/_lib/types';
import { RegulatoryShell } from '../regulatory-changes/_parts/shared';
import { AddFeedPanel, AssignPanel } from './_feed/FeedPanels';
import { FeedInbox } from './_feed/FeedInbox';
import { SourcesSheet } from './_feed/SourcesSheet';
import { pollWords, type PollResult } from './_feed/feedModel';

export default function RegulatoryFeedsPage() {
  const { hasPermission, hasAnyPermission } = usePermissions();
  const canCreate = hasPermission('governance:regulatory_changes:create');
  // who may change who watches a feed: the same people who may add one (the old page also listed a right that does not exist)
  const canAssign = canCreate || hasAnyPermission(['governance:regulatory_changes:*', 'governance:*:*']);
  const canDelete = hasPermission('governance:regulatory_changes:delete');
  const [sources, setSources] = useState(false);
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState<FeedSource | null>(null);

  const pollAll = useReportedMutation({
    mutationFn: async () => ((await feedApi.pollAll()).data || []) as PollResult[],
    success: (results) => { const w = pollWords(results); return { title: w.title, message: w.message }; }, failure: "Couldn't check the feeds",
    invalidate: FEED_REFRESH.map((k) => [...k]),
  });

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={routeFor('/governance/regulatory-feeds')?.label ?? 'Regulatory Feeds'}
        info="What the regulators publish. Read each new item, let the AI analyse it, then turn it into a regulatory change or set it aside."
        actions={(
          <>
            <Button leftIcon={<Rss aria-hidden />} onClick={() => setSources(true)}>Manage sources</Button>
            <Button variant="primary" leftIcon={<RefreshCw aria-hidden />} loading={pollAll.isPending} onClick={() => pollAll.mutate()}>Check all feeds</Button>
          </>
        )}
      />
      <RegulatoryShell value="feed">
        <FeedInbox canCreate={canCreate} onAdd={() => setAdding(true)} />
      </RegulatoryShell>
      <SourcesSheet open={sources} onClose={() => setSources(false)} canCreate={canCreate} canAssign={canAssign} canDelete={canDelete} onAdd={() => setAdding(true)} onAssign={setAssigning} />
      <AddFeedPanel open={adding} onClose={() => setAdding(false)} />
      <AssignPanel source={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
