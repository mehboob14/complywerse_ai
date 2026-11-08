'use client';

// Auditor Portal > one journey: the REVIEW QUEUE. An auditor's job on a journey is to decide what is put in front of them, so the page is that: Queue (files to
// review, scope requests waiting, requirements nobody has asked about), Decisions (what was decided, by whom, when) and Summary (where the journey stands). The
// requirements, the scope decisions in full, the documents and the activity are the Frameworks workspace: this page links into it and copies none of its tabs.
// The state of the page lives in its address (?tab= ?kind= ?q= ?result= ?page= ?open=), so a link, a reload and Back land where the person was; the three old tab
// names (overview, controls, evidence) still arrive and are forwarded. One request feeds the head, the chips and the list (GET /auditor-portal/{id}/review-queue);
// a failure to load is said with Retry, and a journey the person may not open is said as that.
import { useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, IconButton, Notice, Skeleton, SkeletonRows, StatusPill, TabPanel, Tabs, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { statusPill } from '@/lib/status';
import { journeyStatus } from '@/lib/statuses/frameworkJourney';
import { clockOf } from '@/lib/inbox/inboxView';
import {
  ADDRESS, frameworksHref, parseOpen, skipFor, upgradeLegacyAddress, waitingTotal, type FileItem, type PortalTab, type ScopeItem,
} from '@/lib/auditorPortal/portalModel';
import { useJourney, useQueue, type QueueQuery } from '../_front/portalData';
import { DecisionHost } from './_queue/DecisionHost';
import { DecisionsTab } from './_queue/DecisionsTab';
import { QueueTab } from './_queue/QueueTab';
import { SummaryTab } from './_queue/SummaryTab';

const PAGE_SIZE = 25;

export default function AuditorJourneyPage() {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const journeyId = Number(params.frameworkId);
  const [address, set] = useAddressState(ADDRESS);

  // an address from before the revamp (?tab=overview|controls|evidence) is forwarded once
  useEffect(() => {
    const next = upgradeLegacyAddress(window.location.search);
    if (next !== null) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [router, pathname]);

  const { tab, kind, q, result, page } = address;
  const query: QueueQuery = tab === 'decisions'
    ? { kind: 'decided', status: result === 'all' ? undefined : result, q, skip: skipFor(page, PAGE_SIZE), limit: PAGE_SIZE }
    : tab === 'summary'
      ? { kind: 'files', skip: 0, limit: 1 }
      : { kind, q, skip: skipFor(page, PAGE_SIZE), limit: PAGE_SIZE };
  const queue = useQueue(journeyId, query, Number.isFinite(journeyId));
  const journey = useJourney(journeyId, tab === 'summary');

  const data = queue.data;
  const open = parseOpen(address.open);
  const items = (data?.items ?? []) as Array<FileItem | ScopeItem | { type: 'untouched'; id: number }>;
  const openItem = open && !queue.isPlaceholderData ? (items.find((i) => i.type === open.type && i.id === open.id) as FileItem | ScopeItem | undefined) ?? null : null;
  const missing = !!open && !openItem && !!data && !queue.isFetching && !queue.isPlaceholderData && data.kind !== 'untouched';

  if (!Number.isFinite(journeyId)) {
    return <ErrorState title="This journey does not exist" message="The address is not a journey. Open the Auditor Portal and pick one." />;
  }
  if (queue.isError && !data) {
    const status = statusOf(queue.error);
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Journey" back={{ href: '/auditor-portal', label: 'Back to the Auditor Portal' }} />
        <ErrorState
          title={status === 404 ? 'This journey was not found' : status === 403 ? 'You cannot open this journey' : "Couldn't load this journey"}
          message={errorMessage(queue.error)}
          onRetry={canRetry(queue.error) ? () => { void queue.refetch(); } : undefined}
        />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-[16px]" aria-busy="true">
        <Skeleton className="h-[32px] w-1/3" />
        <SkeletonRows rows={6} columns={4} label="Loading the journey" />
      </div>
    );
  }

  const name = data.journey?.name ?? data.framework.name;
  const waiting = waitingTotal(data.counts);
  const hasJourney = !!data.journey;
  const select = (next: PortalTab) => set({ tab: next, page: 1, open: '' });
  const updated = queue.dataUpdatedAt > 0 ? `Updated ${clockOf(queue.dataUpdatedAt)}` : undefined;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={name}
        back={{ href: '/auditor-portal', label: 'Back to the Auditor Portal' }}
        info="Decide the files and scope requests waiting on this journey. The requirements, documents and activity are in Frameworks."
        meta={<span className="inline-flex items-center gap-[2px]">{updated}<IconButton label="Refresh the queue" onClick={() => { void queue.refetch(); }}><RefreshCw aria-hidden /></IconButton></span>}
        chips={(
          <>
            {data.journey && <StatusPill {...statusPill(journeyStatus, data.journey.status)} />}
            {data.framework.name !== name && <StatusPill tone="neutral" label={[data.framework.name, data.framework.version].filter(Boolean).join(' ')} />}
          </>
        )}
        actions={hasJourney ? <Button href={frameworksHref(journeyId)}>Open in Frameworks</Button> : undefined}
      />

      <Tabs
        tabs={[
          { key: 'queue', label: 'Queue', count: waiting },
          { key: 'decisions', label: 'Decisions', count: data.counts.decided },
          { key: 'summary', label: 'Summary' },
        ]}
        value={tab}
        onChange={select}
        ariaLabel="Journey review"
        countFormat="exact"
      >
        {missing && (
          <Notice tone="info" title="That item is not in this list any more" className="mt-[12px]" action={<Button onClick={() => set({ open: '' })}>Dismiss</Button>}>
            It may have been decided by someone else, or the link is old. Decided items are under Decisions.
          </Notice>
        )}
        <TabPanel tabKey="queue" lazy>
          <div className="pt-[12px]">
            <QueueTab
              journeyId={journeyId}
              queue={queue}
              kind={kind}
              q={q}
              page={page}
              pageSize={PAGE_SIZE}
              set={set}
              onShowDecisions={() => select('decisions')}
            />
          </div>
        </TabPanel>
        <TabPanel tabKey="decisions" lazy>
          <div className="pt-[12px]">
            <DecisionsTab queue={queue} result={result} q={q} page={page} pageSize={PAGE_SIZE} set={set} />
          </div>
        </TabPanel>
        <TabPanel tabKey="summary" lazy>
          <div className="pt-[12px]">
            <SummaryTab journeyId={journeyId} queue={queue} journey={journey} />
          </div>
        </TabPanel>
      </Tabs>

      <DecisionHost journeyId={journeyId} item={openItem} onClose={() => set({ open: '' })} />
    </div>
  );
}
