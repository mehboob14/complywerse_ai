'use client';

// Software our people use that no one has assessed: brought in from a discovery
// export or Grip (or recorded by hand), scored on what makes it risky here, and decided
// once — onboarded as a supplier request, linked to a supplier we already have, denied
// (and blocked), or dismissed.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Ban, ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Search, ShieldCheck, Upload, Users, X } from 'lucide-react';
import { vendorShadowApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, BTN_PRIMARY, Dialog } from '../_ui';
import { shadowApi } from '../_lib/intakeApi';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { errText } from '../_lib/intake/types';

type Status = 'pending' | 'onboarded' | 'linked' | 'denied' | 'dismissed';
interface App {
  id: number; name: string; domain: string | null; category: string | null; description: string | null; users: number | null;
  owner_name: string | null; owner_email: string | null; source: string; source_risk: number | null; risk: number;
  level: 'high' | 'medium' | 'low'; why: string[]; status: Status; vendor_id: number | null; blocked: boolean;
  /** the supplier it is linked to, and the one a pending app already is */
  vendor_name: string | null; supplier: { id: number; name: string } | null;
  decided_by: string | null; decided_at: string | null; decision_note: string | null; last_seen: string;
  people_count: number;
}
interface Board {
  items: App[]; counts: Record<Status, number>; pending_high: number; people_on_pending: number; blocked: number;
  records: Array<{ name: string; asset_count: number; products: string[]; sources: string[] }>;
  connected: { grip: boolean; zscaler: boolean };
}
interface ImportResult { new: number; updated: number; suppliers: Array<{ name: string; supplier: string }>; rows: number; skipped: number }

const TABS: Array<[Status | '', string]> = [['pending', 'To decide'], ['onboarded', 'Onboarded'], ['linked', 'Already ours'], ['denied', 'Denied'], ['dismissed', 'Dismissed'], ['', 'All']];
const LEVEL_CLS = { high: 'border-rose-200 bg-rose-50 text-rose-700', medium: 'border-amber-200 bg-amber-50 text-amber-800', low: 'border-slate-200 bg-slate-50 text-slate-600' };
const SOURCE = { csv: 'Import', grip: 'Grip', records: 'Our records', manual: 'Entered by hand' } as Record<string, string>;
const STATUS_WORD = { linked: 'Already ours' } as Record<string, string>;

export default function ShadowSaasPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [status, setStatus] = useState<Status | ''>('pending');
  const [open, setOpen] = useState<number | null>(null);
  const [deciding, setDeciding] = useState<{ app: App; how: 'deny' | 'dismiss' } | null>(null);
  const [importing, setImporting] = useState(false);
  const [roster, setRoster] = useState<App | null>(null);
  const [linking, setLinking] = useState<App | null>(null);
  const key = ['tprm-shadow', status];
  const { data, isLoading, isError } = useQuery<Board>({
    queryKey: key,
    queryFn: async () => (await vendorShadowApi.board({ status: status || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['tprm-shadow'] });
  const fail = (title: string) => (e: unknown) => toast({ type: 'error', title, message: errText(e, 'Try again.') });
  const sync = useMutation({
    mutationFn: async () => (await vendorShadowApi.syncGrip()).data as ImportResult,
    onSuccess: (r) => { refresh(); toast({ type: 'success', title: `Grip: ${r.new} new, ${r.updated} updated` }); },
    onError: fail('Grip could not be read'),
  });
  const onboard = useMutation({
    mutationFn: async (id: number) => (await vendorShadowApi.onboard(id)).data as App & { request_id: number },
    onSuccess: (r) => { refresh(); toast({ type: 'success', title: `${r.name} is now a supplier request`, message: 'Its requester finishes the intake.' }); },
    onError: fail('Not onboarded'),
  });
  const reopen = useMutation({ mutationFn: (id: number) => vendorShadowApi.reopen(id), onSuccess: refresh, onError: fail('Not reopened') });
  const bringIn = useMutation({ mutationFn: (name: string) => vendorShadowApi.fromRecords(name), onSuccess: refresh, onError: fail('Not added') });
  const template = async () => {
    const res = await vendorShadowApi.template();
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'shadow-saas-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Shadow SaaS</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            Software our people already use that no one has assessed. Each app is scored on what makes it risky here and
            decided once: onboard it as a supplier, deny it, or dismiss it as noise.
          </p>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={template} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <Download className="h-4 w-4" /> Template
            </button>
            {data?.connected.grip && (
              <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60">
                {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Sync from Grip
              </button>
            )}
            <button type="button" onClick={() => setImporting(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700">
              <Upload className="h-4 w-4" /> Import
            </button>
          </div>
        )}
      </div>
      {data && !data.connected.grip && (
        <p className="text-xs text-slate-500">
          Import any discovery tool&apos;s CSV or Excel export, or connect Grip Security under
          {' '}<Link href="/admin/connectors" className="text-primary-700 hover:underline">Admin → Connectors</Link> to sync it.
          {!data.connected.zscaler && ' Connect Zscaler there too to block what you deny.'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Waiting for a decision" value={data?.counts.pending} />
        <Kpi label="High risk, waiting" value={data?.pending_high} tone={data?.pending_high ? 'red' : undefined} />
        <Kpi label="People using apps not yet decided" value={data?.people_on_pending} />
        <Kpi label="Blocked at the web gateway" value={data?.blocked} />
      </div>

      {canEdit && <RecordForm onDone={refresh} />}

      <div className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-0.5 text-sm">
        {TABS.map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setStatus(k)} aria-pressed={status === k}
            className={clsx('rounded-md px-3 py-1', status === k ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            {label}{k && data?.counts[k] ? ` (${data.counts[k]})` : ''}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load shadow SaaS.</p>
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {status === 'pending' ? 'Nothing waiting for a decision.' : 'Nothing here.'} Import a discovery export to start.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="w-8 px-2 py-2.5" />
                <th className="px-3 py-2.5 font-medium">App</th>
                <th className="px-3 py-2.5 text-right font-medium">People</th>
                <th className="px-3 py-2.5 font-medium">Risk here</th>
                <th className="hidden px-3 py-2.5 font-medium md:table-cell">Owner</th>
                <th className="hidden px-3 py-2.5 font-medium lg:table-cell">Seen</th>
                <th className="px-3 py-2.5 text-right font-medium"> </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((a) => (
                <Row key={a.id} app={a} open={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} canEdit={canEdit}
                  busy={onboard.isPending || reopen.isPending} onPeople={() => setRoster(a)}
                  onOnboard={() => onboard.mutate(a.id)} onDeny={() => setDeciding({ app: a, how: 'deny' })}
                  onDismiss={() => setDeciding({ app: a, how: 'dismiss' })} onReopen={() => reopen.mutate(a.id)}
                  onLink={() => setLinking(a)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!data?.records.length && (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="shadow-records">
          <h2 id="shadow-records" className="text-sm font-semibold text-slate-900">Named in our records, not on the register</h2>
          <p className="mb-2 text-xs text-slate-500">Publishers of software on our estate and vendors named on our assets that no supplier record covers.</p>
          <ul className="divide-y divide-slate-100">
            {data.records.slice(0, 20).map((r) => (
              <li key={r.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><span className="font-medium text-slate-800">{r.name}</span>
                  <span className="text-xs text-slate-500"> · {r.asset_count} asset{r.asset_count === 1 ? '' : 's'} · {r.sources.join(', ')}{r.products.length ? ` · ${r.products.slice(0, 2).join(', ')}` : ''}</span></span>
                {canEdit && (
                  <button type="button" onClick={() => bringIn.mutate(r.name)} disabled={bringIn.isPending}
                    className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Review it</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && <GatewayCard connected={data.connected.zscaler} canEdit={canEdit} onDone={refresh} />}

      {deciding && <DecideDialog app={deciding.app} how={deciding.how} gateway={!!data?.connected.zscaler} onClose={() => setDeciding(null)} onDone={refresh} />}
      {roster && <PeopleDialog app={roster} onClose={() => setRoster(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={refresh} />}
      <LinkDialog app={linking} onClose={() => setLinking(null)} onDone={refresh} />
    </div>
  );
}

function Row({ app: a, open, onToggle, canEdit, busy, onOnboard, onDeny, onDismiss, onReopen, onPeople, onLink }: {
  app: App; open: boolean; onToggle: () => void; canEdit: boolean; busy: boolean;
  onOnboard: () => void; onDeny: () => void; onDismiss: () => void; onReopen: () => void; onPeople: () => void; onLink: () => void;
}) {
  return (
    <>
      <tr className="hover:bg-slate-50">
        <td className="px-2 py-3">
          <button type="button" onClick={onToggle} aria-label={open ? 'Hide details' : 'Show details'} aria-expanded={open} className="text-slate-400 hover:text-slate-600">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-3">
          <p className="font-medium text-slate-900">{a.name}</p>
          <p className="text-xs text-slate-500">{[a.domain, a.category, SOURCE[a.source] || a.source].filter(Boolean).join(' · ')}</p>
          {a.status === 'pending' && a.supplier && <p className="mt-0.5 text-xs text-amber-800">Looks like {a.supplier.name}, a supplier we already have</p>}
        </td>
        <td className="px-3 py-3 text-right tabular-nums text-slate-700">
          {a.people_count > 0 ? (
            <button type="button" onClick={onPeople} className="inline-flex items-center gap-1 text-primary-700 hover:underline"
              aria-label={`Who uses ${a.name}`}>
              <Users className="h-3.5 w-3.5" aria-hidden /> {a.users ?? a.people_count}
            </button>
          ) : (a.users ?? '—')}
        </td>
        <td className="px-3 py-3">
          <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize', LEVEL_CLS[a.level])}>{a.level} · {a.risk}</span>
          {a.source_risk !== null && <p className="mt-0.5 text-[11px] text-slate-400">{SOURCE[a.source] || 'Source'} says {a.source_risk}</p>}
        </td>
        <td className="hidden px-3 py-3 text-slate-600 md:table-cell">{a.owner_name || a.owner_email || '—'}</td>
        <td className="hidden px-3 py-3 text-slate-600 lg:table-cell">{fmtDate(a.last_seen)}</td>
        <td className="px-3 py-3 text-right">
          {a.status === 'pending' ? (canEdit && (
            <div className="inline-flex flex-wrap justify-end gap-1.5">
              {a.supplier ? (
                <button type="button" onClick={onLink} className="rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700">Link to vendor</button>
              ) : (
                <>
                  <button type="button" onClick={onOnboard} disabled={busy} className="rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-60">Onboard</button>
                  <button type="button" onClick={onLink} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Link to vendor</button>
                </>
              )}
              <button type="button" onClick={onDeny} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Deny</button>
              <button type="button" onClick={onDismiss} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">Dismiss</button>
            </div>
          )) : (
            <div className="inline-flex items-center gap-2 text-xs">
              <span className="capitalize text-slate-600">{STATUS_WORD[a.status] ?? a.status}{a.blocked ? ' · blocked' : ''}</span>
              {a.status === 'onboarded' && a.vendor_id && <Link href={`/vendor-risk/intake/${a.vendor_id}`} className="text-primary-700 hover:underline">Request</Link>}
              {a.status === 'linked' && a.vendor_id && <Link href={`/vendor-risk/vendors/${a.vendor_id}`} className="text-primary-700 hover:underline">{a.vendor_name || 'Open vendor'}</Link>}
              {canEdit && (a.status === 'denied' || a.status === 'dismissed' || a.status === 'linked') && (
                <button type="button" onClick={onReopen} disabled={busy} className="rounded-lg border border-slate-200 px-2 py-0.5 text-slate-700 hover:bg-slate-50">Reopen</button>
              )}
            </div>
          )}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={6} className="px-3 pb-3 text-xs text-slate-600">
            {a.description && <p className="mb-1.5">{a.description}</p>}
            {a.why.length > 0 && <ul className="ml-4 list-disc">{a.why.map((w) => <li key={w}>{w}</li>)}</ul>}
            {a.decision_note && <p className="mt-1.5">Decided by {a.decided_by || '—'} on {fmtDate(a.decided_at)}: “{a.decision_note}”</p>}
            {a.people_count > 0 && (
              <button type="button" onClick={onPeople} className="mt-1.5 inline-flex items-center gap-1 text-primary-700 hover:underline">
                <Users className="h-3.5 w-3.5" /> See the {a.people_count} {a.people_count === 1 ? 'person' : 'people'} {SOURCE[a.source] || 'the source'} has seen using it
              </button>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// An app someone knows is in use, entered by hand: it joins the list to be decided like any other.
function RecordForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [people, setPeople] = useState('');
  const record = useMutation({
    mutationFn: async () => (await shadowApi.record({ name: name.trim(), users: people.trim() === '' ? null : Number(people) })).data as App,
    onSuccess: (a) => { onDone(); setName(''); setPeople(''); toast({ type: 'success', title: `${a.name} recorded` }); },
    onError: (e) => toast({ type: 'error', title: 'Not recorded', message: errText(e, 'Try again.') }),
  });
  const field = 'h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none';
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !record.isPending) record.mutate(); }}>
      <label className="block text-xs font-medium text-slate-600">App in use
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Figma" maxLength={255} className={`${field} mt-1 block w-56`} />
      </label>
      <label className="block text-xs font-medium text-slate-600">People <span className="font-normal text-slate-500">(optional)</span>
        <input type="number" min={0} value={people} onChange={(e) => setPeople(e.target.value)} className={`${field} mt-1 block w-28`} />
      </label>
      <button type="submit" disabled={!name.trim() || record.isPending}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {record.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Record
      </button>
    </form>
  );
}

// The app is a supplier we already have: pick it from the register and it is settled as "Already ours".
function LinkDialog({ app, onClose, onDone }: { app: App | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const open = app !== null;
  useEffect(() => {
    if (!app) return;
    setSearch(app.supplier?.name ?? app.name);
    setPicked(app.supplier?.id ?? null);
    setNote('');
  }, [app]);
  const { data, isFetching } = useQuery({
    queryKey: ['tprm-shadow-vendors', search],
    queryFn: async () => (await shadowApi.vendors(search.trim())).data.items,
    enabled: open,
    staleTime: 30_000,
  });
  const link = useMutation({
    mutationFn: async () => (await shadowApi.link((app as App).id, picked as number, note.trim())).data as App,
    onSuccess: (a) => { onDone(); onClose(); toast({ type: 'success', title: `${a.name} is already ours`, message: a.vendor_name ? `Linked to ${a.vendor_name}.` : undefined }); },
    onError: (e) => toast({ type: 'error', title: 'Not linked', message: errText(e, 'Try again.') }),
  });
  return (
    <Dialog open={open} onClose={onClose} title={`Link ${app?.name ?? 'the app'} to a vendor`}
      description="It is settled as already ours, and nothing is raised."
      footer={(
        <>
          <button type="button" onClick={onClose} className={BTN}>Cancel</button>
          <button type="button" onClick={() => link.mutate()} disabled={picked === null || link.isPending} className={BTN_PRIMARY}>
            {link.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Link
          </button>
        </>
      )}>
      <label className="block text-[13px] font-medium leading-5 text-[#26323d]">Find the vendor
        <input data-autofocus type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the register"
          className="mt-1 block h-10 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm text-[#1f2933] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30" />
      </label>
      <div role="radiogroup" aria-label="Vendors" className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[#d5dbe1]">
        {isFetching && !data ? <p className="px-3 py-3 text-[13px] text-[#586472]">Searching…</p>
          : !data?.length ? <p className="px-3 py-3 text-[13px] text-[#586472]">No vendor matches.</p>
          : data.map((v) => (
            <label key={v.id} className="flex cursor-pointer items-center gap-2.5 border-b border-[#e1e6eb] px-3 py-2 text-[13px] text-[#26323d] last:border-b-0 hover:bg-[#f3f6f8] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[#0f766e]">
              <input type="radio" name="link-vendor" checked={picked === v.id} onChange={() => setPicked(v.id)} className="h-4 w-4 accent-[#0f766e]" />
              <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
              {v.website && <span className="truncate text-[12px] text-[#64707e]">{v.website}</span>}
            </label>
          ))}
      </div>
      <label className="mt-3 block text-[13px] font-medium leading-5 text-[#26323d]">Note <span className="text-[12px] font-normal text-[#64707e]">(optional)</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
          className="mt-1 block w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 py-2 text-sm text-[#1f2933] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30" />
      </label>
    </Dialog>
  );
}

function PeopleDialog({ app, onClose }: { app: App; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['tprm-shadow-people', app.id],
    queryFn: async () => (await vendorShadowApi.people(app.id)).data as
      { items: Array<{ email: string | null; name: string | null; department: string | null; last_seen: string | null }>; total: number },
  });
  const needle = search.trim().toLowerCase();
  const shown = (data?.items || []).filter((p) => !needle || Object.values(p).join(' ').toLowerCase().includes(needle));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={`Who uses ${app.name}`}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Who uses {app.name}</h2>
            <p className="text-xs text-slate-500">The people {SOURCE[app.source] || 'the source'} has seen using it: those a breach of it would touch.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="border-b border-slate-100 p-3">
          <label className="relative block">
            <span className="sr-only">Find a person</span>
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find by name, email or team"
              className="w-full rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
          </label>
        </div>
        <ul className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {isLoading && <li className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</li>}
          {!isLoading && shown.length === 0 && <li className="p-4 text-sm text-slate-500">Nobody matches.</li>}
          {shown.map((p, i) => (
            <li key={`${p.email || p.name}-${i}`} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-slate-800">{p.name || p.email}</span>
                <span className="block truncate text-xs text-slate-500">{[p.name ? p.email : null, p.department].filter(Boolean).join(' · ')}</span>
              </span>
              {p.last_seen && <span className="shrink-0 text-xs text-slate-400">{fmtDate(p.last_seen)}</span>}
            </li>
          ))}
        </ul>
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">{data ? `${data.total} in all` : ''}</p>
      </div>
    </div>
  );
}

function GatewayCard({ connected, canEdit, onDone }: { connected: boolean; canEdit: boolean; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [domain, setDomain] = useState('');
  const [action, setAction] = useState<'block' | 'allow'>('block');
  const [reason, setReason] = useState('');
  const { data } = useQuery({
    queryKey: ['tprm-shadow-gateway'],
    queryFn: async () => (await vendorShadowApi.gatewayHistory()).data as
      { items: Array<{ domain: string; action: 'block' | 'allow'; reason: string | null; at: string; by: string | null }> },
    enabled: connected,
  });
  const change = useMutation({
    mutationFn: () => vendorShadowApi.gateway({ domain, action, reason }),
    onSuccess: () => {
      toast({ type: 'success', title: action === 'block' ? `${domain} is blocked` : `${domain} is off the block list` });
      setDomain(''); setReason('');
      qc.invalidateQueries({ queryKey: ['tprm-shadow-gateway'] });
      onDone();
    },
    onError: (e) => toast({ type: 'error', title: 'Zscaler did not take it', message: errText(e, 'Try again.') }),
  });
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="shadow-gateway">
      <h2 id="shadow-gateway" className="flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldCheck className="h-4 w-4 text-slate-500" /> The web gateway</h2>
      {!connected ? (
        <p className="mt-1 text-xs text-slate-500">
          Connect Zscaler under <Link href="/admin/connectors" className="text-primary-700 hover:underline">Admin → Connectors</Link> to block a domain, or take one off the block list, from here.
        </p>
      ) : (
        <>
          <p className="mb-3 mt-1 text-xs text-slate-500">Block any domain at Zscaler, or take one off the block list, with the reason on the record. Nothing else in Zscaler changes.</p>
          {canEdit && (
            <form className="grid gap-2 sm:grid-cols-[1fr_auto_2fr_auto]" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
              <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="files.example.com" required aria-label="Domain"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              <select value={action} onChange={(e) => setAction(e.target.value as 'block' | 'allow')} aria-label="What to do"
                className="rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm">
                <option value="block">Block it</option>
                <option value="allow">Take it off the block list</option>
              </select>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (kept on the record)" required minLength={5} aria-label="Why"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              <button type="submit" disabled={change.isPending}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
                {change.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Apply
              </button>
            </form>
          )}
          {!!data?.items.length && (
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {data.items.slice(0, 10).map((h, i) => (
                <li key={`${h.domain}-${i}`} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span><span className={clsx('mr-2 rounded-full border px-1.5 text-[11px]', h.action === 'block' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-800')}>
                    {h.action === 'block' ? 'Blocked' : 'Unblocked'}</span>{h.domain}
                    {h.reason && <span className="text-xs text-slate-500"> · {h.reason}</span>}</span>
                  <span className="text-xs text-slate-400">{h.by || '—'} · {fmtDate(h.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function DecideDialog({ app, how, gateway, onClose, onDone }: { app: App; how: 'deny' | 'dismiss'; gateway: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(gateway && !!app.domain);
  const save = useMutation({
    mutationFn: async () => (how === 'deny' ? await vendorShadowApi.deny(app.id, note, block) : await vendorShadowApi.dismiss(app.id, note)).data as App & { block_error?: string | null },
    onSuccess: (r) => {
      onDone();
      if (r.block_error) toast({ type: 'error', title: 'Denied, but not blocked', message: r.block_error });
      else toast({ type: 'success', title: how === 'deny' ? (r.blocked ? `${app.name} denied and blocked` : `${app.name} denied`) : `${app.name} dismissed` });
      onClose();
    },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label={how === 'deny' ? 'Deny an app' : 'Dismiss an app'}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <form className="w-full max-w-md space-y-4 rounded-xl bg-white p-5 shadow-xl" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{how === 'deny' ? `Deny ${app.name}` : `Dismiss ${app.name}`}</h2>
            <p className="text-xs text-slate-500">{how === 'deny' ? 'Our people should stop using it.' : 'Not a real app, or not ours to decide.'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <label className="block text-xs font-medium text-slate-700">Why
          <textarea rows={3} required minLength={5} value={note} onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            placeholder={how === 'deny' ? 'e.g. Use the approved tool instead; data can leave without controls' : 'e.g. A browser extension, not a service'} />
        </label>
        {how === 'deny' && (
          gateway && app.domain ? (
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input type="checkbox" className="mt-1" checked={block} onChange={(e) => setBlock(e.target.checked)} />
              <span>Block {app.domain} in Zscaler<span className="block text-[11px] text-slate-500">Added to the URL category your policy blocks; reopening the app removes it.</span></span>
            </label>
          ) : <p className="text-xs text-slate-500">{app.domain ? 'Connect Zscaler under Admin → Connectors to block it as well.' : 'No domain is known, so it cannot be blocked.'}</p>
        )}
        {save.isError && <p className="text-sm text-rose-700">{errText(save.error, 'Not saved')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={note.trim().length < 5 || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {how === 'deny' ? 'Deny' : 'Dismiss'}
          </button>
        </div>
      </form>
    </div>
  );
}

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const check = useMutation({
    mutationFn: async (f: File) => (await vendorShadowApi.importFile(f, true)).data as ImportResult,
    onSuccess: setPreview,
  });
  const run = useMutation({
    mutationFn: async () => (await vendorShadowApi.importFile(file as File, false)).data as ImportResult,
    onSuccess: (r) => { onDone(); toast({ type: 'success', title: `${r.new} new, ${r.updated} updated` }); onClose(); },
  });
  const error = check.error || run.error;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="Import apps"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Import discovered apps</h2>
            <p className="text-xs text-slate-500">CSV or Excel from any discovery tool. Columns are matched by name: application or name, domain, users, owner, MFA, file sharing, uploads, breaches.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <input ref={input} type="file" accept=".csv,.xlsx" className="hidden" aria-label="Discovery export"
          onChange={(e) => { const f = e.target.files?.[0] || null; setFile(f); setPreview(null); if (f) check.mutate(f); e.target.value = ''; }} />
        <button type="button" onClick={() => input.current?.click()} className="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-600 hover:bg-slate-50">
          {check.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5 text-slate-400" />}
          {file ? file.name : 'Choose a file'}
        </button>
        {preview && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p><b>{preview.new}</b> new app{preview.new === 1 ? '' : 's'} and <b>{preview.updated}</b> to refresh, from {preview.rows} row{preview.rows === 1 ? '' : 's'}.
              {preview.skipped > 0 && ` ${preview.skipped} row${preview.skipped === 1 ? '' : 's'} named no app and will be skipped.`}</p>
            {preview.suppliers.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">Already suppliers, so left out: {preview.suppliers.slice(0, 8).map((s) => s.name).join(', ')}{preview.suppliers.length > 8 ? ` and ${preview.suppliers.length - 8} more` : ''}.</p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-rose-700">{errText(error, 'The file could not be imported')}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3.5 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="button" onClick={() => run.mutate()} disabled={!preview || run.isPending || (preview.new + preview.updated === 0)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {run.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Import
          </button>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value?: number; tone?: 'red' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold', tone === 'red' ? 'text-rose-700' : 'text-slate-900')}>{value ?? '—'}</p>
    </div>
  );
}
