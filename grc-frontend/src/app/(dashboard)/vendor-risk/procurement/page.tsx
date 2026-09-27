'use client';

// Procurement's view: which suppliers are still being reviewed, how long they have
// waited, where they are, and what happened last — without opening each one.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Hourglass, Loader2, PackageCheck, X } from 'lucide-react';
import { clsx } from 'clsx';
import { vendorOnboardingApi, tpraApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate, titleCase } from '../_lib/tprmShared';
import { TIER_CLS } from '../_lib/intake/types';

interface Item {
  id: number; name: string; tier: string | null; intake_status: string | null; vendor_status: string | null;
  requested_by: string | null; owner: string | null; submitted_at: string | null; days_waiting: number;
  stage: { key: string; label: string; since: string | null };
  last_update: { at: string; what: string; by: string | null } | null;
}
interface Entry {
  id: number; entity: string; action: string; to_value: string | null; from_value: string | null;
  reason: string | null; actor_name: string | null; created_at: string;
}

const PAGE = 15;

export default function ProcurementPage() {
  const [open, setOpen] = useState<Item | null>(null);
  const { data, isLoading, isError } = useQuery<{ items: Item[] }>({
    queryKey: ['tprm-procurement'],
    queryFn: async () => (await vendorOnboardingApi.procurement()).data,
    ...TPRM_QUERY_OPTS,
  });
  const items = data?.items || [];
  const slow = items.filter((i) => i.days_waiting > 14).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Procurement status</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          Suppliers still in onboarding review: where each one is, how long it has waited, and what happened last.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: 'In review', value: items.length, icon: PackageCheck, tone: 'text-sky-700 bg-sky-50' },
          { label: 'Waiting over two weeks', value: slow, icon: Hourglass, tone: slow ? 'text-amber-800 bg-amber-50' : 'text-slate-600 bg-slate-50' },
          { label: 'Longest wait', value: items.length ? `${Math.max(...items.map((i) => i.days_waiting))} days` : '—', icon: Hourglass, tone: 'text-slate-700 bg-slate-50' },
        ].map((k) => (
          <div key={k.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <span className={clsx('flex h-9 w-9 items-center justify-center rounded-lg', k.tone)}><k.icon className="h-4 w-4" /></span>
            <div>
              <p className="text-xs text-slate-500">{k.label}</p>
              <p className="text-lg font-semibold text-slate-900">{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load procurement status.</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          Nothing is waiting. Suppliers appear here from the moment a request is submitted until they are approved.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Where it is</th>
                <th className="px-4 py-2.5 font-medium">Waiting</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Requested by</th>
                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Last update</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(i)}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{i.name}</p>
                    {i.tier && <span className={clsx('mt-0.5 inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[i.tier])}>{i.tier}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {i.stage.label}
                    {i.stage.since && <p className="text-xs text-slate-400">since {fmtDate(i.stage.since)}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('text-sm font-medium', i.days_waiting > 14 ? 'text-amber-700' : 'text-slate-700')}>
                      {i.days_waiting} day{i.days_waiting === 1 ? '' : 's'}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{i.requested_by || '—'}</td>
                  <td className="hidden px-4 py-3 text-xs text-slate-500 lg:table-cell">
                    {i.last_update ? <>{titleCase(i.last_update.what)}<br />{i.last_update.by || 'System'} · {fmtDate(i.last_update.at)}</> : '—'}
                  </td>
                  <td className="px-2 text-slate-300"><ArrowRight className="h-4 w-4" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && <History item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function History({ item, onClose }: { item: Item; onClose: () => void }) {
  const [page, setPage] = useState(0);
  const { data, isLoading } = useQuery<Entry[]>({
    queryKey: ['tprm-procurement-history', item.id],
    queryFn: async () => ((await tpraApi.getVendorAudit(item.id, 500)).data?.items || []) as Entry[],
  });
  const rows = data || [];
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label={`${item.name} update history`}>
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{item.name}</h2>
            <p className="text-xs text-slate-500">{item.stage.label} · waiting {item.days_waiting} days</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No updates yet.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-4">
              {shown.map((r) => (
                <li key={r.id}>
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-slate-300" />
                  <p className="text-sm text-slate-800">
                    {titleCase(`${r.entity} ${r.action}`)}{r.to_value ? <span className="text-slate-500"> → {titleCase(r.to_value)}</span> : null}
                  </p>
                  {r.reason && <p className="text-xs text-slate-500">“{r.reason}”</p>}
                  <p className="text-[11px] text-slate-400">{r.actor_name || 'System'} · {fmtDate(r.created_at)}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>{rows.length} update{rows.length === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Newer</button>
            <button type="button" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)} className="rounded border border-slate-200 px-2 py-1 disabled:opacity-40">Older</button>
            <Link href={`/vendor-risk/vendors/${item.id}`} className="ml-2 font-medium text-primary-700 hover:underline">Open vendor</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
