'use client';

// Breach alerts: news of a breach, adverse media and known-exploited flaws that
// may touch a supplier, worked like cases — new, investigating, confirmed or not
// relevant, closed — with the AI's reading of the sources behind each one.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { ExternalLink, Loader2, Sparkles, X } from 'lucide-react';
import { vendorAlertsApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate, sevBadgeCls } from '../_lib/tprmShared';
import { TIER_CLS, errText } from '../_lib/intake/types';
import OwnLeaks from './_OwnLeaks';

type Status = 'new' | 'investigating' | 'confirmed' | 'not_relevant' | 'closed';
interface Row {
  id: number; vendor: { id: number; name: string; tier: string | null }; type: string; severity: string | null;
  title: string | null; source: string | null; occurred_at: string | null; status: Status;
  owner: { id: number; name: string | null } | null; verified: boolean; sources: number; researched: boolean;
  finding_id: number | null;
}
interface Research {
  summary: string; about_this_supplier: 'yes' | 'no' | 'unclear'; what_happened: string; when: string | null;
  data_involved: string[]; affects_us: 'likely' | 'possible' | 'unlikely' | 'unknown'; why: string;
  suggested_status: Status; actions: string[]; questions_for_supplier: string[]; sources_read: string[];
  at: string; by: string | null;
}
interface Detail extends Row {
  detail: string | null; source_list: Array<{ url?: string; title?: string; domain?: string; seendate?: string }>;
  verification: { verified?: boolean; checks?: Record<string, unknown> } | null; research: Research | null;
  supplier: { description: string | null; services: string[]; data_access_level: string | null; data_types: string[] };
  moves: Status[]; history: Array<{ action: string; from: string | null; to: string | null; note: string | null; by: string | null; at: string }>;
  triggered_assessment_id: number | null;
}

const STATUS: Record<Status, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'border-rose-200 bg-rose-50 text-rose-700' },
  investigating: { label: 'Investigating', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  confirmed: { label: 'Confirmed', cls: 'border-rose-600 bg-rose-600 text-white' },
  not_relevant: { label: 'Not relevant', cls: 'border-slate-200 bg-slate-50 text-slate-600' },
  closed: { label: 'Closed', cls: 'border-slate-200 bg-slate-100 text-slate-500' },
};
const TYPES: Record<string, string> = { breach: 'Breach', adverse_media: 'Adverse media', vulnerability: 'Vulnerability' };
const MOVE_LABEL: Record<Status, string> = {
  new: 'Back to new', investigating: 'Investigate', confirmed: 'Confirm', not_relevant: 'Not relevant', closed: 'Close',
};
const NEEDS_NOTE: Status[] = ['confirmed', 'not_relevant', 'closed'];
const AFFECTS: Record<Research['affects_us'], string> = {
  likely: 'Our data is likely involved', possible: 'Our data may be involved', unlikely: 'Our data is unlikely to be involved',
  unknown: 'Whether our data is involved is not stated',
};

export default function BreachAlertsPage() {
  const params = useSearchParams();
  const [status, setStatus] = useState<Status | ''>('new');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const { data, isLoading, isError } = useQuery<{ items: Row[]; counts: Record<Status, number> }>({
    queryKey: ['tprm-alerts', status, type],
    queryFn: async () => (await vendorAlertsApi.board({ status: status || undefined, type: type || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });
  useEffect(() => {
    const id = Number(params?.get('alert'));
    if (id) { setOpen(id); setStatus(''); }
  }, [params]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Breach alerts</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          Reports that a supplier may have been breached, bad press, and newly exploited flaws in software seen on a
          supplier&apos;s estate. Work each one to a decision; the AI can read its sources and say what they mean for us.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(Object.keys(STATUS) as Status[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(status === s ? '' : s)} aria-pressed={status === s}
            className={clsx('rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-sm',
              status === s ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200')}>
            <p className="text-xs text-slate-500">{STATUS[s].label}</p>
            <p className={clsx('mt-1 text-2xl font-semibold', s === 'new' && data?.counts.new ? 'text-rose-700' : 'text-slate-900')}>
              {data?.counts[s] ?? '—'}
            </p>
          </button>
        ))}
      </div>

      <OwnLeaks />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by kind">
        {[['', 'Every kind'], ...Object.entries(TYPES)].map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setType(k)} aria-pressed={type === k}
            className={clsx('rounded-full border px-3 py-1 text-xs font-medium', type === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load alerts.</p>
      ) : !data?.items.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
          {status === 'new' ? 'No new alerts.' : 'Nothing in this view.'} News monitoring and outside-in scans are turned on in
          {' '}<Link href="/vendor-risk/settings" className="text-primary-700 hover:underline">Settings</Link>.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {data.items.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => setOpen(a.id)} className="flex w-full flex-wrap items-start gap-3 px-4 py-3 text-left hover:bg-slate-50">
                <span className={clsx('mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize', sevBadgeCls(a.severity))}>{a.severity || 'medium'}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{a.title || TYPES[a.type]}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    <span className="text-slate-700">{a.vendor.name}</span>
                    {a.vendor.tier && <span className={clsx('inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[a.vendor.tier])}>{a.vendor.tier}</span>}
                    · {TYPES[a.type]} · {a.source || 'entered by hand'} · {fmtDate(a.occurred_at)}
                    {!a.verified && <span className="rounded-full border border-slate-200 px-1.5 text-[11px]">unverified</span>}
                    {a.researched && <span className="inline-flex items-center gap-0.5 rounded-full border border-violet-200 bg-violet-50 px-1.5 text-[11px] text-violet-800"><Sparkles className="h-3 w-3" /> researched</span>}
                  </p>
                </div>
                <div className="text-right">
                  <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', STATUS[a.status].cls)}>{STATUS[a.status].label}</span>
                  {a.owner?.name && <p className="mt-0.5 text-[11px] text-slate-400">{a.owner.name}</p>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open !== null && <AlertDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function AlertDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:monitoring:edit') || hasPermission('erm:risks:edit');
  const canRaise = hasPermission('vendor_risk:findings:create') || hasPermission('erm:risks:edit');
  const [target, setTarget] = useState<Status | null>(null);
  const [note, setNote] = useState('');
  const [raise, setRaise] = useState(false);
  const { data, isLoading } = useQuery<Detail>({
    queryKey: ['tprm-alert', id],
    queryFn: async () => (await vendorAlertsApi.get(id)).data,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tprm-alerts'] });
    qc.invalidateQueries({ queryKey: ['tprm-alert', id] });
    qc.invalidateQueries({ queryKey: ['tprm-attention'] });
  };
  const move = useMutation({
    mutationFn: (s: Status) => vendorAlertsApi.move(id, { status: s, note: note.trim() || undefined, raise_finding: s === 'confirmed' && raise }),
    onSuccess: (_r, s) => { refresh(); setTarget(null); setNote(''); setRaise(false); toast({ type: 'success', title: `Alert ${STATUS[s].label.toLowerCase()}` }); },
    onError: (e) => toast({ type: 'error', title: 'Not moved', message: errText(e, 'Try again.') }),
  });
  const research = useMutation({
    mutationFn: () => vendorAlertsApi.research(id),
    onSuccess: () => refresh(),
    onError: (e) => toast({ type: 'error', title: 'The AI could not research it', message: errText(e, 'Try again.') }),
  });
  const choose = (s: Status) => (NEEDS_NOTE.includes(s) ? setTarget(s) : move.mutate(s));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label="Alert"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{data?.title || 'Alert'}</h2>
            {data && (
              <p className="mt-0.5 text-xs text-slate-500">
                <Link href={`/vendor-risk/vendors/${data.vendor.id}`} className="text-primary-700 hover:underline">{data.vendor.name}</Link>
                {' '}· {TYPES[data.type]} · {data.source || 'entered by hand'} · {fmtDate(data.occurred_at)}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        {isLoading || !data ? <Loader2 className="m-5 h-4 w-4 animate-spin text-slate-400" /> : (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-xs font-medium', STATUS[data.status].cls)}>{STATUS[data.status].label}</span>
              {data.owner?.name && <span className="text-xs text-slate-500">with {data.owner.name}</span>}
              {data.finding_id && <Link href={`/vendor-risk/vendors/${data.vendor.id}?stage=findings&finding=${data.finding_id}`} className="text-xs text-primary-700 hover:underline">Finding raised</Link>}
              <div className="ml-auto flex flex-wrap gap-1.5">
                {canEdit && data.moves.map((s) => (
                  <button key={s} type="button" onClick={() => choose(s)} disabled={move.isPending}
                    className={clsx('rounded-lg px-3 py-1.5 text-xs font-medium',
                      s === 'confirmed' ? 'bg-rose-600 text-white hover:bg-rose-700' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50')}>
                    {MOVE_LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            {target && (
              <form className="space-y-2 rounded-xl border border-slate-200 p-3" onSubmit={(e) => { e.preventDefault(); move.mutate(target); }}>
                <label htmlFor="alert-note" className="block text-xs font-medium text-slate-700">
                  {target === 'confirmed' ? 'What confirms it?' : target === 'not_relevant' ? 'Why is it not relevant?' : 'What was done?'}
                </label>
                <textarea id="alert-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                {target === 'not_relevant' && <p className="text-[11px] text-slate-400">Its articles are remembered, so the same reports are not raised again.</p>}
                {target === 'confirmed' && canRaise && !data.finding_id && (
                  <label className="flex items-center gap-2 text-xs text-slate-700">
                    <input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} /> Raise it as a finding on the supplier
                  </label>
                )}
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setTarget(null)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700">Cancel</button>
                  <button type="submit" disabled={note.trim().length < 5 || move.isPending}
                    className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                    {MOVE_LABEL[target]}
                  </button>
                </div>
              </form>
            )}

            {data.detail && <p className="whitespace-pre-line text-sm text-slate-700">{data.detail}</p>}

            <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4" aria-labelledby="alert-ai">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id="alert-ai" className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-violet-600" /> What the sources say</h3>
                {canEdit && (
                  <button type="button" onClick={() => research.mutate()} disabled={research.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-60">
                    {research.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    {research.isPending ? 'Reading the sources…' : data.research ? 'Research again' : 'Research with AI'}
                  </button>
                )}
              </div>
              {data.research ? <ResearchView r={data.research} /> : (
                <p className="text-xs text-slate-500">The AI reads the articles behind this alert with what {data.vendor.name} does for us, and says what happened and whether our data is likely involved. It uses only those sources.</p>
              )}
            </section>

            <section aria-labelledby="alert-sources">
              <h3 id="alert-sources" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sources</h3>
              {data.source_list.length === 0 ? <p className="text-sm text-slate-500">None attached.</p> : (
                <ul className="space-y-1.5">
                  {data.source_list.map((s, i) => (
                    <li key={s.url || i} className="text-sm">
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline">
                          {s.title || s.url} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : <span className="text-slate-700">{s.title}</span>}
                      <span className="ml-1 text-xs text-slate-400">{s.domain}{s.seendate ? ` · ${String(s.seendate).slice(0, 8)}` : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!data.verified && <p className="mt-1.5 text-xs text-amber-700">Unverified: only one source so far, or a match that could not be confirmed from outside.</p>}
            </section>

            <section className="rounded-xl border border-slate-200 p-4" aria-labelledby="alert-supplier">
              <h3 id="alert-supplier" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">What {data.vendor.name} does for us</h3>
              <dl className="space-y-1 text-sm text-slate-700">
                {data.supplier.description && <div><dt className="inline text-slate-500">Role: </dt><dd className="inline">{data.supplier.description}</dd></div>}
                <div><dt className="inline text-slate-500">Access to our data: </dt><dd className="inline capitalize">{data.supplier.data_access_level || 'not recorded'}</dd></div>
                {data.supplier.data_types.length > 0 && <div><dt className="inline text-slate-500">Data it holds: </dt><dd className="inline">{data.supplier.data_types.join(', ')}</dd></div>}
              </dl>
            </section>

            {data.history.length > 0 && (
              <section aria-labelledby="alert-history">
                <h3 id="alert-history" className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">History</h3>
                <ol className="space-y-1.5 text-sm">
                  {data.history.map((h, i) => (
                    <li key={i}>
                      <span className="text-slate-800">
                        {h.action === 'triage' ? `${STATUS[(h.from || 'new') as Status]?.label || h.from} → ${STATUS[(h.to || 'new') as Status]?.label || h.to}`
                          : h.action === 'research' ? 'Researched by AI' : h.action.replace('_', ' ')}
                      </span>
                      <span className="text-xs text-slate-400"> · {h.by || 'System'} · {fmtDate(h.at)}</span>
                      {h.note && <p className="text-xs text-slate-600">“{h.note}”</p>}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ResearchView({ r }: { r: Research }) {
  const about = r.about_this_supplier === 'no' ? 'The sources appear to be about a different organisation.'
    : r.about_this_supplier === 'unclear' ? 'It is not clear the sources are about this supplier.' : null;
  return (
    <div className="space-y-2 text-sm text-slate-700">
      <p>{r.summary}</p>
      {about && <p className="font-medium text-amber-800">{about}</p>}
      <p><span className="font-medium text-slate-900">{AFFECTS[r.affects_us]}.</span> {r.why}</p>
      {r.data_involved.length > 0 && <p><span className="text-slate-500">Data involved:</span> {r.data_involved.join(', ')}</p>}
      {r.when && <p><span className="text-slate-500">When:</span> {fmtDate(r.when)}</p>}
      {r.actions.length > 0 && (
        <div><p className="text-slate-500">Next steps</p><ul className="ml-4 list-disc">{r.actions.map((a) => <li key={a}>{a}</li>)}</ul></div>
      )}
      {r.questions_for_supplier.length > 0 && (
        <div><p className="text-slate-500">Ask the supplier</p><ul className="ml-4 list-disc">{r.questions_for_supplier.map((q) => <li key={q}>{q}</li>)}</ul></div>
      )}
      <p className="text-[11px] text-slate-400">
        Suggests: {STATUS[r.suggested_status]?.label || r.suggested_status} · read {r.sources_read.length} source{r.sources_read.length === 1 ? '' : 's'} in full
        · {r.by ? `asked by ${r.by}, ` : ''}{fmtDate(r.at)}. Check it before acting on it.
      </p>
    </div>
  );
}
