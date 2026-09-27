'use client';

// Yearly check-ins: once a year whoever looks after a supplier confirms who owns
// it, whether anything changed, and that the contact details are right.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, History as HistoryIcon, Loader2, Search, X } from 'lucide-react';
import { clsx } from 'clsx';
import { vendorOnboardingApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { usePeople } from '../_lib/intake/IntakeForm';
import { TIER_CLS, errText } from '../_lib/intake/types';

type State = 'overdue' | 'due_soon' | 'upcoming' | 'done';
interface Row {
  vendor_id: number; name: string; tier: string | null; owner: { id: number; name: string | null } | null;
  last: { at: string; by: string | null; changed: boolean } | null;
  due_date: string; state: State; days: number; can_check_in: boolean;
}
interface Board { items: Row[]; counts: Record<State, number>; every_days: number }
interface Past {
  id: number; completed_at: string; by: string | null; on_time: boolean; still_owner: boolean; new_owner: string | null;
  changed: boolean; change_notes: string | null; contact_current: boolean; contact_update: Record<string, string> | null;
}
interface History {
  vendor: { id: number; name: string; owner_id: number | null; owner: string | null; primary_contact_name: string | null;
            primary_contact_email: string | null; primary_contact_phone: string | null };
  due_date: string; state: string; can_check_in: boolean; items: Past[];
}

const TABS: Array<{ key: State | 'all'; label: string; cls: string }> = [
  { key: 'overdue', label: 'Overdue', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  { key: 'due_soon', label: 'Due within 30 days', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'upcoming', label: 'Upcoming', cls: 'bg-slate-50 text-slate-700 border-slate-200' },
  { key: 'done', label: 'Done recently', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'all', label: 'All', cls: '' },
];
const STATE_CLS = Object.fromEntries(TABS.map((t) => [t.key, t.cls])) as Record<State, string>;
const STATE_LABEL: Record<State, string> = { overdue: 'Overdue', due_soon: 'Due soon', upcoming: 'Upcoming', done: 'Done' };

const when = (days: number) => (days < 0 ? `${-days} day${days === -1 ? '' : 's'} overdue` : days === 0 ? 'due today' : `in ${days} day${days === 1 ? '' : 's'}`);

export default function CheckinsPage() {
  const params = useSearchParams();
  const [tab, setTab] = useState<State | 'all'>('overdue');
  const [scope, setScope] = useState<'all' | 'mine'>('mine');
  const [search, setSearch] = useState('');
  const [checking, setChecking] = useState<number | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  const { data, isLoading, isError } = useQuery<Board>({
    queryKey: ['tprm-checkins', scope, search],
    queryFn: async () => (await vendorOnboardingApi.checkins({ scope, search: search || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });
  // A link from a reminder or the attention queue opens that supplier directly.
  useEffect(() => {
    const vendor = Number(params?.get('vendor'));
    if (vendor) { setScope('all'); setTab('all'); setChecking(vendor); }
  }, [params]);
  const rows = (data?.items || []).filter((r) => tab === 'all' || r.state === tab);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Yearly check-ins</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            Once {data?.every_days && data.every_days !== 365 ? `every ${data.every_days} days` : 'a year'}, whoever looks after a
            supplier confirms who owns it, whether anything changed, and that the contact details are right. A reported
            change goes to the TPRM team.
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
          {(['mine', 'all'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setScope(s)}
              className={clsx('rounded-md px-3 py-1', scope === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>
              {s === 'mine' ? 'My suppliers' : 'Everyone'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {TABS.filter((t) => t.key !== 'all').map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={clsx('rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-sm', tab === t.key ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200')}>
            <p className="text-xs text-slate-500">{t.label}</p>
            <p className={clsx('mt-1 text-2xl font-semibold', t.key === 'overdue' && data?.counts.overdue ? 'text-rose-700' : 'text-slate-900')}>
              {data?.counts?.[t.key as State] ?? '—'}
            </p>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={clsx('rounded-full border px-3 py-1 text-xs font-medium', tab === t.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}>
              {t.label}
            </button>
          ))}
        </div>
        <label className="relative block w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers"
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load check-ins.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {tab === 'overdue' ? 'Nothing overdue.' : 'Nothing in this view.'}
          {scope === 'mine' && ' Switch to Everyone to see all suppliers.'}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Owner</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Last check-in</th>
                <th className="px-4 py-2.5 font-medium">Next due</th>
                <th className="px-4 py-2.5 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.vendor_id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{r.name}</p>
                    {r.tier && <span className={clsx('mt-0.5 inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[r.tier])}>{r.tier}</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{r.owner?.name || <span className="text-amber-700">No owner</span>}</td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                    {r.last ? <>{fmtDate(r.last.at)} <span className="text-xs text-slate-400">by {r.last.by || '—'}</span>
                      {r.last.changed && <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 text-[11px] text-amber-800">change reported</span>}</> : 'Never'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', STATE_CLS[r.state])}>{STATE_LABEL[r.state]}</span>
                    <p className="mt-0.5 text-xs text-slate-500">{fmtDate(r.due_date)} · {when(r.days)}</p>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1.5">
                      <button type="button" onClick={() => setViewing(r.vendor_id)} title="History"
                        className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50"><HistoryIcon className="h-4 w-4" /></button>
                      {r.can_check_in && (
                        <button type="button" onClick={() => setChecking(r.vendor_id)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
                          <CalendarCheck className="h-3.5 w-3.5" /> Check in
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {checking && <CheckinDialog vendorId={checking} onClose={() => setChecking(null)} />}
      {viewing && <HistoryDrawer vendorId={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function useHistory(vendorId: number) {
  return useQuery<History>({
    queryKey: ['tprm-checkin-history', vendorId],
    queryFn: async () => (await vendorOnboardingApi.checkinHistory(vendorId)).data,
  });
}

function YesNo({ value, onChange }: { value: boolean | null; onChange: (v: boolean) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5" role="radiogroup">
      {[true, false].map((v) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={clsx('rounded-md px-4 py-1 text-sm font-medium', value === v ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500')}>
          {v ? 'Yes' : 'No'}
        </button>
      ))}
    </div>
  );
}

function CheckinDialog({ vendorId, onClose }: { vendorId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const { data, isLoading } = useHistory(vendorId);
  const [stillOwner, setStillOwner] = useState<boolean | null>(null);
  const [newOwner, setNewOwner] = useState<number | ''>('');
  const [changed, setChanged] = useState<boolean | null>(null);
  const [notes, setNotes] = useState('');
  const [contactOk, setContactOk] = useState<boolean | null>(null);
  const [contact, setContact] = useState({ primary_contact_name: '', primary_contact_email: '', primary_contact_phone: '' });
  useEffect(() => {
    if (data) setContact({
      primary_contact_name: data.vendor.primary_contact_name || '', primary_contact_email: data.vendor.primary_contact_email || '',
      primary_contact_phone: data.vendor.primary_contact_phone || '',
    });
  }, [data]);
  const save = useMutation({
    mutationFn: () => vendorOnboardingApi.checkIn(vendorId, {
      still_owner: !!stillOwner, new_owner_id: stillOwner ? null : Number(newOwner) || null,
      changed: !!changed, change_notes: notes, contact_current: !!contactOk, contact: contactOk ? undefined : contact,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tprm-checkins'] });
      qc.invalidateQueries({ queryKey: ['tprm-checkin-history', vendorId] });
      onClose();
    },
  });
  const ready = stillOwner !== null && changed !== null && contactOk !== null
    && (stillOwner || !!newOwner) && (!changed || notes.trim().length >= 10);
  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Yearly check-in">
      <form className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
        onSubmit={(e) => { e.preventDefault(); if (ready) save.mutate(); }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Yearly check-in{data ? `: ${data.vendor.name}` : ''}</h2>
            {data && <p className="text-xs text-slate-500">Due {fmtDate(data.due_date)}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {isLoading || !data ? <Loader2 className="mt-4 h-4 w-4 animate-spin text-slate-400" /> : !data.can_check_in ? (
          <p className="mt-4 text-sm text-slate-600">Only the people looking after this supplier can check in on it.</p>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">Is {data.vendor.owner || 'the current owner'} still the right owner?</p>
              <YesNo value={stillOwner} onChange={setStillOwner} />
              {stillOwner === false && (
                <select className={input} value={newOwner} onChange={(e) => setNewOwner(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">Who owns it now?</option>
                  {people.filter((p) => p.id !== data.vendor.owner_id).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">Has anything about the relationship changed?</p>
              <p className="text-xs text-slate-500">New services, new data, new countries, or relying on them more or less.</p>
              <YesNo value={changed} onChange={setChanged} />
              {changed && (
                <textarea rows={3} className={input} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="What changed? The TPRM team will follow up." />
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-800">Are their contact details still right?</p>
              <p className="text-xs text-slate-500">
                {[data.vendor.primary_contact_name, data.vendor.primary_contact_email, data.vendor.primary_contact_phone].filter(Boolean).join(' · ') || 'No contact on record.'}
              </p>
              <YesNo value={contactOk} onChange={setContactOk} />
              {contactOk === false && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input className={input} placeholder="Name" value={contact.primary_contact_name}
                    onChange={(e) => setContact({ ...contact, primary_contact_name: e.target.value })} />
                  <input className={input} placeholder="Email" type="email" value={contact.primary_contact_email}
                    onChange={(e) => setContact({ ...contact, primary_contact_email: e.target.value })} />
                  <input className={input} placeholder="Phone" value={contact.primary_contact_phone}
                    onChange={(e) => setContact({ ...contact, primary_contact_phone: e.target.value })} />
                </div>
              )}
            </div>
            {save.isError && <p className="text-sm text-rose-700">{errText(save.error, 'Could not save the check-in')}</p>}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          {data?.can_check_in && (
            <button type="submit" disabled={!ready || save.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Save check-in
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function HistoryDrawer({ vendorId, onClose }: { vendorId: number; onClose: () => void }) {
  const { data, isLoading } = useHistory(vendorId);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label="Check-in history">
      <div className="flex h-full w-full max-w-md flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{data?.vendor.name || 'Check-ins'}</h2>
            {data && <p className="text-xs text-slate-500">Next due {fmtDate(data.due_date)}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : !data?.items.length ? (
            <p className="text-sm text-slate-500">No check-ins yet.</p>
          ) : (
            <ol className="space-y-3">
              {data.items.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <p className="font-medium text-slate-800">{fmtDate(c.completed_at)} · {c.by || '—'}
                    <span className={clsx('ml-2 rounded-full px-1.5 text-[11px]', c.on_time ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>
                      {c.on_time ? 'on time' : 'late'}</span></p>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-slate-600">
                    <li>Owner: {c.still_owner ? 'unchanged' : `moved to ${c.new_owner || 'someone else'}`}</li>
                    <li>Changes: {c.changed ? c.change_notes : 'none reported'}</li>
                    <li>Contact: {c.contact_current ? 'still right' : `updated (${Object.keys(c.contact_update || {}).map((k) => k.replace('primary_contact_', '')).join(', ')})`}</li>
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
