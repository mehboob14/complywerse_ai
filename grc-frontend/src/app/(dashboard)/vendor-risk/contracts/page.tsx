'use client';

// Every supplier contract on one page. What needs a decision (past its date,
// inside its notice period, or ending within the inbox window) sits at the top.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { FileSignature, Loader2, Paperclip, Plus, RefreshCw, Search } from 'lucide-react';
import { vendorContractsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { TIER_CLS } from '../_lib/intake/types';
import ContractDrawer, { CloseOutDialog, RenewDialog } from '../_lib/contracts/ContractDrawer';
import {
  RENEWAL_LABEL, STATE_META, countdown, money, type ContractRow, type ContractState, type Register,
} from '../_lib/contracts/shared';

const INBOX: ContractState[] = ['lapsed', 'decide', 'ending'];
const VIEWS: Array<{ key: 'current' | 'draft' | 'ended' | 'all'; label: string; states: ContractState[] }> = [
  { key: 'current', label: 'In force', states: ['lapsed', 'decide', 'ending', 'in_force'] },
  { key: 'draft', label: 'Drafts', states: ['draft'] },
  { key: 'ended', label: 'Ended', states: ['ended'] },
  { key: 'all', label: 'All', states: ['lapsed', 'decide', 'ending', 'in_force', 'draft', 'ended'] },
];

function StateChip({ state }: { state: ContractState }) {
  return <span className={clsx('inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium', STATE_META[state].cls)}>{STATE_META[state].label}</span>;
}

export default function ContractsPage() {
  const params = useSearchParams();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:contracts:edit') || hasPermission('erm:risks:edit');
  const canCreate = hasPermission('vendor_risk:contracts:create') || canEdit;
  const [view, setView] = useState<(typeof VIEWS)[number]['key']>('current');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [renewing, setRenewing] = useState<ContractRow | null>(null);
  const [closing, setClosing] = useState<ContractRow | null>(null);

  const { data, isLoading, isError } = useQuery<Register>({
    queryKey: ['tprm-contracts'],
    queryFn: async () => (await vendorContractsApi.list()).data,
    ...TPRM_QUERY_OPTS,
  });
  // Reminders and the attention queue link straight to one contract.
  useEffect(() => {
    const id = Number(params?.get('contract'));
    if (id) setOpen(id);
  }, [params]);

  const items = useMemo(() => data?.items || [], [data]);
  const inbox = items.filter((c) => INBOX.includes(c.state));
  const types = useMemo(() => Array.from(new Set(items.map((c) => c.contract_type))).sort(), [items]);
  const states = VIEWS.find((v) => v.key === view)!.states;
  const needle = search.trim().toLowerCase();
  const rows = items.filter((c) => states.includes(c.state) && (!type || c.contract_type === type)
    && (!needle || [c.vendor.name, c.title, c.reference, c.type_label].some((x) => (x || '').toLowerCase().includes(needle))));
  const value = Object.entries(data?.annual_value || {}).sort((a, b) => b[1] - a[1]);
  const counts = data?.counts;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Contracts</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            Every supplier contract in one place. Anything past its date, inside its notice period, or ending within
            {' '}{data?.inbox_days ?? 90} days is at the top, while there is still time to renew, renegotiate or leave.
          </p>
        </div>
        {canCreate && (
          <button type="button" onClick={() => setOpen('new')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700">
            <Plus className="h-4 w-4" /> Add contract
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Needs a decision now" value={counts ? counts.lapsed + counts.decide : undefined} tone={counts && counts.lapsed + counts.decide ? 'red' : undefined}
          note={counts?.lapsed ? `${counts.lapsed} past ${counts.lapsed === 1 ? 'its' : 'their'} date` : `Notice due within ${data?.decide_days ?? 30} days`} />
        <Kpi label={`Ending within ${data?.inbox_days ?? 90} days`} value={counts?.ending} tone={counts?.ending ? 'amber' : undefined} note="No notice due yet" />
        <Kpi label="In force" value={counts ? counts.lapsed + counts.decide + counts.ending + counts.in_force : undefined}
          note={counts?.draft ? `${counts.draft} draft${counts.draft === 1 ? '' : 's'} not signed` : 'Signed and running'} />
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Annual value in force</p>
          {value.length === 0 ? <p className="mt-1 text-2xl font-semibold text-slate-300">—</p> : (
            <>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{money(value[0][1], value[0][0] || null)}</p>
              {value.length > 1 && <p className="text-xs text-slate-500">+ {value.slice(1).map(([cur, v]) => money(v, cur || null)).join(' · ')}</p>}
            </>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load contracts.</p>
      ) : (
        <>
          <section aria-labelledby="tprm-contract-inbox" className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 id="tprm-contract-inbox" className="text-sm font-semibold text-slate-900">Needs a decision</h2>
              <span className="text-xs text-slate-500">{inbox.length} contract{inbox.length === 1 ? '' : 's'}</span>
            </div>
            {inbox.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing is ending or due for notice in the next {data?.inbox_days ?? 90} days.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {inbox.map((c) => (
                  <li key={c.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', c.state === 'lapsed' && 'bg-rose-50/40')}>
                    <button type="button" onClick={() => setOpen(c.id)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-slate-900">{c.vendor.name}
                        <span className="font-normal text-slate-500"> · {c.title || c.type_label}</span></p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.renewal_type ? RENEWAL_LABEL[c.renewal_type] : c.type_label}
                        {c.ends_on && <> · {c.renewal_type === 'auto' ? 'renews' : 'ends'} {fmtDate(c.ends_on)}</>}
                        {c.annual_value !== null && <> · {money(c.annual_value, c.currency)} a year</>}
                      </p>
                    </button>
                    <div className="text-right">
                      <StateChip state={c.state} />
                      <p className={clsx('mt-0.5 text-xs', c.state === 'lapsed' ? 'text-rose-700' : 'text-slate-500')}>{countdown(c)}</p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1.5">
                        <button type="button" onClick={() => setRenewing(c)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          <RefreshCw className="h-3.5 w-3.5" /> Renewed
                        </button>
                        <button type="button" onClick={() => setClosing(c)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
                          Close out
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="tprm-contract-register" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="tprm-contract-register" className="mr-1 text-sm font-semibold text-slate-900">All contracts</h2>
                <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
                  {VIEWS.map((v) => (
                    <button key={v.key} type="button" onClick={() => setView(v.key)} aria-pressed={view === v.key}
                      className={clsx('rounded-md px-3 py-1', view === v.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>
                      {v.label}
                    </button>
                  ))}
                </div>
                <select aria-label="Contract type" value={type} onChange={(e) => setType(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700">
                  <option value="">Every type</option>
                  {types.map((t) => <option key={t} value={t}>{data?.types[t] || t}</option>)}
                </select>
              </div>
              <label className="relative block w-full max-w-xs">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier, title or reference"
                  className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
              </label>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                <FileSignature className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                <p className="text-sm text-slate-600">{items.length ? 'No contract matches.' : 'No contracts yet.'}</p>
                {!items.length && canCreate && <p className="mt-1 text-xs text-slate-500">Add one here, or at the contracting stage of a supplier&apos;s assessment.</p>}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Supplier</th>
                      <th className="px-4 py-2.5 font-medium">Contract</th>
                      <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Started</th>
                      <th className="px-4 py-2.5 font-medium">Ends</th>
                      <th className="hidden px-4 py-2.5 font-medium md:table-cell">Notice by</th>
                      <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Per year</th>
                      <th className="px-4 py-2.5 font-medium">State</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((c) => (
                      <tr key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(c.id)}>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-900">{c.vendor.name}</p>
                          {c.vendor.tier && <span className={clsx('mt-0.5 inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[c.vendor.tier])}>{c.vendor.tier}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <button type="button" className="text-left text-slate-800 hover:text-primary-700 hover:underline" onClick={(e) => { e.stopPropagation(); setOpen(c.id); }}>
                            {c.title || c.type_label}
                          </button>
                          <p className="flex items-center gap-1 text-xs text-slate-500">
                            {c.type_label}{c.reference && <> · {c.reference}</>}
                            {c.evidence_id && <Paperclip className="h-3 w-3" aria-label="Signed copy attached" />}
                          </p>
                        </td>
                        <td className="hidden px-4 py-3 text-slate-600 lg:table-cell">{fmtDate(c.effective_date)}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {c.ends_on ? fmtDate(c.ends_on) : <span className="text-slate-400">No end date</span>}
                          {c.renewal_type && <p className="text-xs text-slate-400">{RENEWAL_LABEL[c.renewal_type]}</p>}
                        </td>
                        <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                          {c.act_by && c.act_by !== c.ends_on ? fmtDate(c.act_by) : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="hidden px-4 py-3 text-right tabular-nums text-slate-700 md:table-cell">{money(c.annual_value, c.currency)}</td>
                        <td className="px-4 py-3">
                          <StateChip state={c.state} />
                          {INBOX.includes(c.state) && <p className="mt-0.5 text-xs text-slate-500">{countdown(c)}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {open !== null && <ContractDrawer contractId={open === 'new' ? null : open} onClose={() => setOpen(null)} />}
      {renewing && <RenewDialog contract={renewing} onClose={() => setRenewing(null)} />}
      {closing && <CloseOutDialog contract={closing} onClose={() => setClosing(null)} />}
    </div>
  );
}

function Kpi({ label, value, note, tone }: { label: string; value?: number; note?: string; tone?: 'red' | 'amber' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold', tone === 'red' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-700' : 'text-slate-900')}>
        {value ?? '—'}
      </p>
      {note && <p className="text-xs text-slate-500">{note}</p>}
    </div>
  );
}
