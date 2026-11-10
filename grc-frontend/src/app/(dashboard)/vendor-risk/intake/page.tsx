'use client';

// Intake: everything anyone has asked for, as a queue with the selected request beside it. The TPRM team approves a request (which starts the supplier's lifecycle), declines it with a reason
// or sends it back; the requester finishes a draft. A wide screen shows the queue and the request side by side (the first request is open, j and k step through them); a narrow one opens the
// request in a sheet. The switch (Pending, Drafts, Approved, Declined, All), Mine, the search, the page and the open request are in the address, and the server pages the list (25 a page).
// The page head carries "Request vendor" and "Add vendor"; ?request=1 opens the request sheet once.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { FileText, Inbox } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, DebouncedSearch, EmptyState, ErrorState, Pager, SegmentedControl, Sheet, SkeletonRows, useAddressState, useConfirm, useReportedMutation,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePanelMode } from '@/components/ui/ds/usePanelMode';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { titleFor } from '@/lib/navRegistry';
import VendorActions from '../_lib/VendorActions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { usePortfolioCounts } from '../_lib/portfolioApi';
import { intakeApi, requestsKey, type RequestListing, type RequestRow } from '../_lib/intakeApi';
import { INTAKE_SCHEMA, PAGE_SIZE, SCOPES, approvalNote, emptyCopy, lastPage, listParams, listPatch, scopeCounts, stepTo, type Scope } from '../_lib/intakeModel';
import ReasonDialog from './_components/ReasonDialog';
import RequestDialog from './_components/RequestDialog';
import QueueRow from './_queue/QueueRow';
import RequestPanel from './_queue/RequestPanel';

type Asking = { row: RequestRow; how: 'decline' | 'send-back' } | null;
const WHOSE = [{ value: 'everyone', label: 'Everyone’s' }, { value: 'mine', label: 'Mine' }] as const;

export default function RequestsPage() {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [address, set] = useAddressState(INTAKE_SCHEMA);
  const { scope, mine, q, page, open, request: wantsDialog } = address;
  const mode = usePanelMode(1024);
  const wide = mode === 'docked';
  const [asking, setAsking] = useState<Asking>(null);
  const counts = usePortfolioCounts();
  const searchBox = useRef<HTMLDivElement>(null);

  const params = useMemo(() => listParams({ scope, mine, q, page }), [scope, mine, q, page]);
  const list = useQuery<RequestListing>({
    queryKey: [...requestsKey, params],
    queryFn: async () => (await intakeApi.list(params)).data,
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
  const data = list.data;
  const rows = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? 0;
  const tabs = scopeCounts(data?.counts);
  const canCreate = data?.can_create;
  const canReview = !!data?.can_review;
  const now = useMemo(() => new Date(), [data]);                              // eslint-disable-line react-hooks/exhaustive-deps

  // a link to a page the list no longer reaches lands on the last one; the header's "Request vendor" is ?request=1 and is taken off once the sheet is shut or refused
  useEffect(() => {
    if (data && !list.isPlaceholderData && page > lastPage(total)) set({ page: lastPage(total) });
  }, [data, list.isPlaceholderData, page, total, set]);
  useEffect(() => { if (wantsDialog && canCreate === false) set({ request: false }); }, [wantsDialog, canCreate, set]);

  // the request on the right: the one in the address; on a wide screen the first of the page until one is chosen
  const chosen = rows.find((r) => r.id === open) ?? null;
  const selected = chosen ?? (wide ? rows[0] ?? null : null);

  const approve = useReportedMutation({
    mutationFn: async (row: RequestRow) => { await intakeApi.approve(row.id); return row; },
    success: (row) => `${row.name} added to the register`,
    failure: 'Not approved',
    invalidate: [requestsKey, ['tprm-dashboard'], ['tprm-attention'], ['vendors']],
    onSuccess: (row) => router.push(`/vendor-risk/vendors/${row.id}`),
  });
  const decide = useReportedMutation({
    mutationFn: async ({ row, how, reason }: { row: RequestRow; how: 'decline' | 'send-back'; reason: string }) => {
      await (how === 'decline' ? intakeApi.decline(row.id, reason) : intakeApi.sendBack(row.id, reason));
      return { row, how };
    },
    success: ({ row, how }) => (how === 'decline' ? `${row.name} declined` : `${row.name} sent back to the requester`),
    failure: 'That did not work',
    toast: 'success',
    invalidate: [requestsKey, ['tprm-dashboard'], ['tprm-attention']],
    onSuccess: () => setAsking(null),
  });
  const askApprove = async (row: RequestRow) => {
    const yes = await confirm({
      title: `Approve ${row.name}?`,
      message: <div className="flex flex-col gap-[8px]">{approvalNote(row.name, row.duplicates).map((line) => <p key={line} className="text-ds-body text-ds-fg-body">{line}</p>)}</div>,
      confirmLabel: 'Approve and create',
    });
    if (yes) approve.mutate(row);
  };
  const busy = approve.isPending || decide.isPending;
  const panel = (row: RequestRow) => (
    <RequestPanel
      row={row} canReview={canReview} busy={busy}
      onApprove={() => { void askApprove(row); }}
      onDecline={() => { decide.reset(); setAsking({ row, how: 'decline' }); }}
      onSendBack={() => { decide.reset(); setAsking({ row, how: 'send-back' }); }}
    />
  );

  // j and k step through the queue, "/" goes to the search
  const ids = useMemo(() => rows.map((r) => r.id), [rows]);
  useExplorerKeys({
    onSearch: () => searchBox.current?.querySelector('input')?.focus(),
    onMove: (dir) => { const next = stepTo(ids, selected?.id ?? null, dir); if (next != null) set({ open: next }); },
    onOpen: () => {},
    onEscape: () => { if (open) set({ open: 0 }); },
  }, rows.length > 0 && wide);                            // beside the queue only: below 1024 a key must not open the sheet

  const searching = q.trim() !== '';
  const empty = emptyCopy(scope, searching);
  const waiting = counts?.intake_pending;

  const queue = (() => {
    if (list.isPending) return <SkeletonRows rows={6} columns={2} label="Loading the requests" />;
    if (list.isError && !data) return <ErrorState title="Couldn't load the requests" message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />;
    if (rows.length === 0) {
      return (
        <EmptyState
          kind={searching ? 'noMatches' : 'firstUse'} bare icon={Inbox} title={empty.title} description={empty.hint}
          onClearFilters={searching ? () => set(listPatch({ q: '' })) : undefined}
          action={!searching && scope === 'pending' && canCreate ? <Button variant="primary" leftIcon={<FileText aria-hidden />} onClick={() => set({ request: true })}>Request vendor</Button> : undefined}
        />
      );
    }
    return (
      <div className={list.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
        {rows.map((r) => <QueueRow key={r.id} row={r} now={now} selected={selected?.id === r.id} onSelect={() => set({ open: r.id })} />)}
      </div>
    );
  })();

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={titleFor('/vendor-risk/intake') ?? 'Intake'}
        info="Everyone who asked to bring a vendor in. The review team approves a request, which starts the vendor's lifecycle, declines it with a reason, or sends it back; the requester finishes a draft."
        meta={waiting ? `${waiting} waiting for a decision` : undefined}
        actions={<VendorActions />}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
        <SegmentedControl
          label="Show requests" name="intake-scope" value={scope as Scope} onChange={(v) => set(listPatch({ scope: v }))}
          options={SCOPES.map((s) => ({ value: s.value, label: data ? `${s.label} ${tabs[s.value]}` : s.label }))}
        />
        <div className="flex flex-wrap items-center gap-[8px]">
          <SegmentedControl label="Whose requests" name="intake-whose" value={mine ? 'mine' : 'everyone'} onChange={(v) => set(listPatch({ mine: v === 'mine' }))} options={WHOSE} />
          <div ref={searchBox} className="w-full sm:w-[260px]">
            <DebouncedSearch label="Search requests" placeholder="Search vendors" value={q} loading={list.isFetching && !list.isPending} onSearch={(v) => set(listPatch({ q: v }))} />
          </div>
        </div>
      </div>

      {list.isError && data && (
        <ErrorState compact title="Couldn't refresh the requests" message={`${errorMessage(list.error)} What is shown may be out of date.`} onRetry={() => { void list.refetch(); }} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
      )}

      <div className={wide ? 'grid grid-cols-[minmax(300px,2fr)_minmax(0,3fr)] items-start gap-[16px]' : 'flex flex-col gap-[16px]'}>
        <section aria-label="Requests" className="min-w-0 overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
          {queue}
          {total > PAGE_SIZE && (
            <Pager className="border-t border-ds-border p-[8px]" page={page} pageSize={PAGE_SIZE} total={total} noun={{ one: 'request', other: 'requests' }} onPage={(p) => set({ page: p, open: 0 })} />
          )}
        </section>
        {wide && (
          <aside aria-label="Selected request" className="sticky top-[12px] min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            {selected ? panel(selected) : <p className="text-ds-body text-ds-fg-muted">Choose a request to read it and decide it here.</p>}
          </aside>
        )}
      </div>

      {!wide && (
        <Sheet open={!!chosen} onClose={() => set({ open: 0 })} title={chosen?.name ?? 'Request'} width="md">
          {chosen && panel(chosen)}
        </Sheet>
      )}

      <RequestDialog open={wantsDialog && canCreate !== false} onClose={() => set({ request: false })} />
      <ReasonDialog
        open={asking !== null} busy={decide.isPending} error={decide.isError ? errorMessage(decide.error, 'That did not work') : null}
        title={asking?.how === 'decline' ? `Decline ${asking.row.name}` : `Send back ${asking?.row.name ?? ''}`}
        description={asking?.how === 'decline' ? 'The requester sees this reason.' : 'Say what they need to change or add.'}
        confirmLabel={asking?.how === 'decline' ? 'Decline request' : 'Send back'} danger={asking?.how === 'decline'}
        onClose={() => setAsking(null)}
        onConfirm={(reason) => asking && decide.mutate({ row: asking.row, how: asking.how, reason })}
      />
      {confirmDialog}
    </div>
  );
}
