'use client';

// Onboarding requests: anyone who needs a new supplier starts here; the TPRM team
// picks requests up from the same list.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, ClipboardPlus, Inbox, Loader2, Plus, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { vendorOnboardingApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { RequestStatus, STATUS_CLS, STATUS_LABEL, TIER_CLS, errText } from '../_lib/intake/types';

interface Row {
  id: number; name: string; host: string; intake_status: RequestStatus; tier: string | null; tiered: boolean;
  requested_by: { id: number; name: string | null } | null; owner: { id: number; name: string | null } | null;
  submitted_at: string | null; created_at: string | null; updated_at: string | null;
  stage: { key: string; label: string | null } | null; open_problems: number;
}
interface Listing { items: Row[]; counts: Record<RequestStatus, number>; can_create: boolean; can_review: boolean }

const TABS: Array<{ key: RequestStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' }, { key: 'draft', label: 'Drafts' }, { key: 'submitted', label: 'Waiting for review' },
  { key: 'in_review', label: 'In review' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Turned down' },
];

function nextStep(r: Row): string {
  switch (r.intake_status) {
    case 'draft': return r.open_problems ? `${r.open_problems} answer${r.open_problems === 1 ? '' : 's'} to go` : 'Ready to submit';
    case 'submitted': return 'Waiting for the TPRM team';
    case 'in_review': return r.stage?.label ? `Stage: ${r.stage.label}` : 'Being reviewed';
    case 'approved': return 'Approved to use';
    default: return 'Turned down';
  }
}

export default function RequestsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<RequestStatus | 'all'>('all');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const { data, isLoading, isError } = useQuery<Listing>({
    queryKey: ['tprm-requests', scope, search],
    queryFn: async () => (await vendorOnboardingApi.requests({ scope, search: search || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });
  const rows = (data?.items || []).filter((r) => tab === 'all' || r.intake_status === tab);
  const total = Object.values(data?.counts || {}).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Onboarding requests</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            Need a new supplier? Raise a request and answer a few questions about what they will do and see. The
            TPRM team picks it up, tiers it from your answers and takes it to approval.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
            {(['all', 'mine'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setScope(s)}
                className={clsx('rounded-md px-3 py-1', scope === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                {s === 'all' ? 'Everyone' : 'Mine'}
              </button>
            ))}
          </div>
          {data?.can_create && (
            <button type="button" onClick={() => setCreating(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700">
              <Plus className="h-4 w-4" /> New request
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200">
        <div className="-mb-px flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => {
            const count = t.key === 'all' ? total : data?.counts?.[t.key] || 0;
            return (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={clsx('border-b-2 px-3 py-2 text-sm font-medium', tab === t.key ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
                {t.label}
                <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{count}</span>
              </button>
            );
          })}
        </div>
        <label className="relative mb-2 block w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers"
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading requests…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load the requests.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <Inbox className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">{total ? 'Nothing in this view' : 'No requests yet'}</p>
          <p className="mt-1 text-sm text-slate-500">Anyone who needs a new supplier starts here.</p>
          {data?.can_create && (
            <button type="button" onClick={() => setCreating(true)}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700">
              <ClipboardPlus className="h-4 w-4" /> Raise the first request
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Requested by</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Owner</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Submitted</th>
                <th className="px-4 py-2.5 font-medium">Tier</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Next step</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/vendor-risk/intake/${r.id}`)}>
                  <td className="px-4 py-3">
                    <Link href={`/vendor-risk/intake/${r.id}`} className="font-medium text-slate-900 hover:text-primary-700" onClick={(e) => e.stopPropagation()}>
                      {r.name}
                    </Link>
                    {r.host && <p className="text-xs text-slate-400">{r.host}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', STATUS_CLS[r.intake_status])}>
                      {STATUS_LABEL[r.intake_status]}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{r.requested_by?.name || '—'}</td>
                  <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">{r.owner?.name || '—'}</td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{r.submitted_at ? fmtDate(r.submitted_at) : '—'}</td>
                  <td className="px-4 py-3">
                    {r.tiered && r.tier ? (
                      <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize', TIER_CLS[r.tier])}>{r.tier}</span>
                    ) : <span className="text-xs text-slate-400">Not tiered yet</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">{nextStep(r)}</td>
                  <td className="px-2 text-slate-300"><ArrowRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <NewRequest onClose={() => setCreating(false)} onCreated={(id) => router.push(`/vendor-risk/intake/${id}`)} />}
    </div>
  );
}

function NewRequest({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const create = useMutation({
    mutationFn: async () => (await vendorOnboardingApi.createRequest({ name: name.trim(), website: website.trim() || undefined })).data as { id: number },
    onSuccess: (r) => onCreated(r.id),
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="new-request-title">
      <form className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}>
        <div className="flex items-start justify-between">
          <h2 id="new-request-title" className="text-base font-semibold text-slate-900">New onboarding request</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <p className="mt-1 text-sm text-slate-500">Start with who the supplier is. You answer the rest next, and it saves as you go.</p>
        <label className="mt-4 block text-xs font-medium text-slate-600">Supplier name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
        <label className="mt-3 block text-xs font-medium text-slate-600">Website <span className="font-normal text-slate-400">(helps spot a supplier we already use)</span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="supplier.com"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
        {create.isError && <p className="mt-3 text-sm text-rose-700">{errText(create.error, 'Could not create the request')}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={!name.trim() || create.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start the request
          </button>
        </div>
      </form>
    </div>
  );
}
