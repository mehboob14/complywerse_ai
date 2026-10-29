'use client';

// Intake: everything anyone has asked for, as cards. The TPRM team approves a request (which starts the supplier's lifecycle),
// declines it with a reason, or sends it back; the requester finishes a draft. The module header (layout) owns the title and the
// "Request vendor" button, which opens the dialog through ?request=1.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { BTN_PRIMARY, EmptyState, ErrorState, SegmentedControl, Skeleton, useUrlParams } from '../_ui';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { intakeApi, requestsKey, type RequestListing, type RequestRow } from '../_lib/intakeApi';
import { SCOPES, asScope, inQueueOrder, inScope, scopeCounts } from '../_lib/intakeModel';
import { errText } from '../_lib/intake/types';
import ReasonDialog from './_components/ReasonDialog';
import RequestCard from './_components/RequestCard';
import RequestDialog from './_components/RequestDialog';

type Asking = { row: RequestRow; how: 'decline' | 'send-back' } | null;

export default function RequestsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = useUrlParams();
  const scope = asScope(params.get('scope'));
  const mine = params.get('mine') === '1';
  const [search, setSearch] = useState('');
  const [asking, setAsking] = useState<Asking>(null);

  const { data, isLoading, isError, error, refetch } = useQuery<RequestListing>({
    queryKey: [...requestsKey, mine ? 'mine' : 'all', search],
    queryFn: async () => (await intakeApi.list({ scope: mine ? 'mine' : 'all', search: search || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });

  // The header's "Request vendor" is a link here with ?request=1; closing the dialog takes the parameter off again.
  const wantsDialog = params.get('request') === '1';
  const canCreate = data?.can_create;
  useEffect(() => { if (wantsDialog && canCreate === false) params.set({ request: null }); }, [wantsDialog, canCreate, params]);

  const refresh = () => qc.invalidateQueries({ queryKey: requestsKey });
  const fail = (title: string) => (e: unknown) => toast({ type: 'error', title, message: errText(e, 'Try again.') });
  const approve = useMutation({
    mutationFn: async (row: RequestRow) => { await intakeApi.approve(row.id); return row; },
    onSuccess: (row) => {
      refresh();
      toast({ type: 'success', title: `${row.name} added to the register` });
      router.push(`/vendor-risk/vendors/${row.id}`);
    },
    onError: fail('Not approved'),
  });
  const decide = useMutation({
    mutationFn: async ({ row, how, reason }: { row: RequestRow; how: 'decline' | 'send-back'; reason: string }) => {
      await (how === 'decline' ? intakeApi.decline(row.id, reason) : intakeApi.sendBack(row.id, reason));
      return { row, how };
    },
    onSuccess: ({ row, how }) => {
      refresh();
      setAsking(null);
      toast({ type: 'success', title: how === 'decline' ? `${row.name} declined` : `${row.name} sent back to the requester` });
    },
  });

  const counts = scopeCounts(data?.counts);
  const total = counts.all;
  const rows = inQueueOrder((data?.items ?? []).filter((r) => inScope(r.intake_status, scope)), scope);
  const busy = approve.isPending || decide.isPending;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl ariaLabel="Show requests" value={scope} onChange={(v) => params.set({ scope: v === 'pending' ? null : v })}
          options={SCOPES.map((s) => ({ ...s, count: data ? counts[s.value] : undefined }))} />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl ariaLabel="Whose requests" value={mine ? 'mine' : 'everyone'} onChange={(v) => params.set({ mine: v === 'mine' ? '1' : null })}
            options={[{ value: 'everyone', label: 'Everyone' }, { value: 'mine', label: 'Mine' }]} />
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Search requests</span>
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64707e]" />
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors"
              className="h-9 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] pl-9 pr-3 text-sm text-[#1f2933] placeholder:text-[#64707e] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30" />
          </label>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading requests">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
        </div>
      ) : isError ? (
        <ErrorState title="Couldn't load the requests" message={errText(error, 'Try again in a moment.')} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        scope === 'pending' && total === 0 ? (
          <EmptyState title="No pending requests" hint="Requests are screened against the register on arrival."
            action={data?.can_create ? <button type="button" onClick={() => params.set({ request: '1' })} className={BTN_PRIMARY}>Request vendor</button> : undefined} />
        ) : (
          <EmptyState title={scope === 'pending' ? 'No pending requests' : 'No requests in this state'} hint={scope === 'pending' ? 'Requests are screened against the register on arrival.' : 'Try another filter.'} />
        )
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id}>
              <RequestCard row={r} canReview={!!data?.can_review} busy={busy}
                onApprove={() => approve.mutate(r)} onDecline={() => { decide.reset(); setAsking({ row: r, how: 'decline' }); }}
                onSendBack={() => { decide.reset(); setAsking({ row: r, how: 'send-back' }); }} />
            </li>
          ))}
        </ul>
      )}

      <RequestDialog open={wantsDialog && canCreate !== false} onClose={() => params.set({ request: null })} />
      <ReasonDialog open={asking !== null} busy={decide.isPending} error={decide.isError ? errText(decide.error, 'That did not work') : null}
        title={asking?.how === 'decline' ? `Decline ${asking.row.name}` : `Send back ${asking?.row.name ?? ''}`}
        description={asking?.how === 'decline' ? 'The requester sees this reason.' : 'Say what they need to change or add.'}
        confirmLabel={asking?.how === 'decline' ? 'Decline request' : 'Send back'} danger={asking?.how === 'decline'}
        onClose={() => setAsking(null)}
        onConfirm={(reason) => asking && decide.mutate({ row: asking.row, how: asking.how, reason })} />
    </div>
  );
}
