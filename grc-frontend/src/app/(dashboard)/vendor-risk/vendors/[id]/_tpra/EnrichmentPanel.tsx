'use client';

// CLEAR due-diligence enrichment (Thomson Reuters). Search → the analyst confirms
// the right record → report snapshot with red flags mapped to risk domains. Flags
// are ADVISORY: "Raise finding" promotes one into the TPRA findings register.
// GLB + DPPA permissible purposes are mandatory for every CLEAR request.

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSearch, Loader2, Search } from 'lucide-react';
import { trDataApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import { DOMAIN_LABELS, sevBadgeCls } from '../../../_lib/tprmShared';
import { fmtDate } from './constants';
import { SimBadge, errMsg, type KeyPerson } from './ScreeningPanel';

interface Flag { key: string; label: string; severity: string; domain: string; detail?: string; count?: number; finding_id?: number }
interface Report {
  id: number; person_id: number | null; entity_name: string | null; external_report_id: string | null;
  permissible_purpose: { glb?: string; dppa?: string }; risk_score: number | null; flags: Flag[];
  summary: Record<string, string>; fetched_at: string; simulated: boolean;
}
interface EnrichmentView {
  connection: { configured: boolean; active: boolean; mode: string | null; status: string;
    default_glb_purpose?: string | null; default_dppa_purpose?: string | null };
  reports: Report[];
}
interface Candidate { id: string; name: string; address?: string | null }

const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

export default function EnrichmentPanel({ vendorId, people }: { vendorId: number; people: KeyPerson[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasAnyPermission } = usePermissions();
  const canView = hasAnyPermission(['vendor_risk:enrichment:view', 'vendor_risk:enrichment:run', 'erm:risks:edit']);
  const canRun = hasAnyPermission(['vendor_risk:enrichment:run', 'erm:risks:edit']);
  const canRaise = hasAnyPermission(['vendor_risk:findings:create', 'erm:risks:edit']);

  const [subject, setSubject] = useState<string>('vendor');
  const [name, setName] = useState('');
  const [glb, setGlb] = useState('');
  const [dppa, setDppa] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);

  const view = useQuery({
    queryKey: ['tr-enrichment', vendorId],
    queryFn: async () => (await trDataApi.vendorEnrichment(vendorId)).data as EnrichmentView,
    enabled: canView,
  });
  const conn = view.data?.connection;
  const personId = subject === 'vendor' ? undefined : Number(subject);
  const purpose = () => ({ glb_purpose: glb || conn?.default_glb_purpose || undefined, dppa_purpose: dppa || conn?.default_dppa_purpose || undefined });

  const search = useMutation({
    mutationFn: () => trDataApi.clearSearch(vendorId, { person_id: personId, name: name || undefined, ...purpose() }),
    onSuccess: (res) => {
      const c = (res.data as { candidates: Candidate[] }).candidates;
      setCandidates(c);
      if (c.length === 0) toast({ type: 'info', title: 'No CLEAR records found' });
    },
    onError: (e) => toast({ type: 'error', title: 'CLEAR search failed', message: errMsg(e, 'Try again.') }),
  });
  const report = useMutation({
    mutationFn: (c: Candidate) => trDataApi.clearReport(vendorId, { candidate_id: c.id, person_id: personId, entity_name: c.name, ...purpose() }),
    onSuccess: () => {
      setCandidates(null);
      qc.invalidateQueries({ queryKey: ['tr-enrichment', vendorId] });
      toast({ type: 'success', title: 'CLEAR report retrieved' });
    },
    onError: (e) => toast({ type: 'error', title: 'Report failed', message: errMsg(e, 'Try again.') }),
  });
  const raise = useMutation({
    mutationFn: ({ reportId, key }: { reportId: number; key: string }) => trDataApi.raiseFlagFinding(reportId, key),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tr-enrichment', vendorId] });
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      toast({ type: 'success', title: `Finding #${(res.data as { finding_id: number }).finding_id} raised` });
    },
    onError: (e) => toast({ type: 'error', title: 'Could not raise finding', message: errMsg(e, 'Try again.') }),
  });

  if (!canView) return null;
  const needsPurpose = !(glb || conn?.default_glb_purpose) || !(dppa || conn?.default_dppa_purpose);

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileSearch className="h-4 w-4 text-primary-600" /> Due-diligence enrichment
          <span className="font-normal text-gray-500">· CLEAR (Thomson Reuters)</span>
        </h3>
        {conn?.mode === 'simulated' && <SimBadge />}
      </div>
      <div className="space-y-4 px-4 py-3">
        {view.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : !conn?.configured || !conn.active ? (
          <p className="text-xs text-gray-500">
            CLEAR is not set up for your organisation.{' '}
            <Link href="/vendor-risk/settings#data-providers" className="font-medium text-primary-600 hover:underline">Set up data providers →</Link>
          </p>
        ) : canRun && (
          <form className="grid grid-cols-1 gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); search.mutate(); }}>
            <div>
              <label htmlFor="clr-subject" className="mb-1 block text-xs font-medium text-gray-700">Look up</label>
              <select id="clr-subject" className={inputCls} value={subject} onChange={(e) => { setSubject(e.target.value); setCandidates(null); }}>
                <option value="vendor">The vendor (business)</option>
                {people.map((p) => <option key={p.id} value={String(p.id)}>{p.full_name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="clr-name" className="mb-1 block text-xs font-medium text-gray-700">Name override</label>
              <input id="clr-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the record name" />
            </div>
            <div>
              <label htmlFor="clr-glb" className="mb-1 block text-xs font-medium text-gray-700">GLB purpose *</label>
              <input id="clr-glb" className={inputCls} value={glb} onChange={(e) => setGlb(e.target.value)} placeholder={conn.default_glb_purpose || 'Required'} />
            </div>
            <div>
              <label htmlFor="clr-dppa" className="mb-1 block text-xs font-medium text-gray-700">DPPA purpose *</label>
              <input id="clr-dppa" className={inputCls} value={dppa} onChange={(e) => setDppa(e.target.value)} placeholder={conn.default_dppa_purpose || 'Required'} />
            </div>
            <div className="sm:col-span-4 flex items-center justify-between gap-2">
              <p className="text-[11px] text-gray-500">A permissible purpose is legally required for every CLEAR search and is recorded on the report.</p>
              <button type="submit" disabled={search.isPending || needsPurpose}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {search.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Search CLEAR
              </button>
            </div>
          </form>
        )}

        {candidates && candidates.length > 0 && (
          <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3">
            <p className="mb-2 text-xs font-medium text-slate-800">Which record is the right entity?</p>
            <ul className="space-y-1.5">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm">
                  <span><span className="font-medium text-slate-800">{c.name}</span>{c.address && <span className="ml-2 text-xs text-gray-500">{c.address}</span>}</span>
                  <button onClick={() => report.mutate(c)} disabled={report.isPending}
                    className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                    {report.isPending && report.variables?.id === c.id ? 'Retrieving…' : 'Get report'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(view.data?.reports || []).length === 0 ? (
          conn?.configured && <p className="text-xs text-gray-500">No CLEAR reports yet.</p>
        ) : (
          <div className="space-y-3">
            {(view.data?.reports || []).map((r) => (
              <article key={r.id} className="rounded-lg border border-gray-200 p-3">
                <header className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">{r.summary.name || r.entity_name}</span>
                  {r.summary.status && <span className="text-xs text-gray-500">· {r.summary.status}</span>}
                  <span className="ml-auto text-xs text-gray-500">Risk score <b className="text-slate-800">{r.risk_score ?? '—'}</b> · {fmtDate(r.fetched_at)}</span>
                  {r.simulated && <SimBadge />}
                </header>
                <p className="mt-0.5 text-[11px] text-gray-400">
                  Record {r.external_report_id}{r.summary.registration_number ? ` · Reg. ${r.summary.registration_number}` : ''} · GLB {r.permissible_purpose.glb} / DPPA {r.permissible_purpose.dppa}
                </p>
                {r.flags.length === 0 ? (
                  <p className="mt-2 text-xs text-emerald-700">No red flags in this report.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {r.flags.map((f) => (
                      <li key={f.key} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${sevBadgeCls(f.severity)}`}>{f.severity}</span>
                        <span className="text-slate-800">{f.label}</span>
                        <span className="text-xs text-gray-500">{DOMAIN_LABELS[f.domain] || f.domain}{f.count ? ` · ${f.count} record(s)` : ''}</span>
                        <span className="ml-auto">
                          {f.finding_id ? (
                            <span className="text-xs text-gray-500">Finding #{f.finding_id}</span>
                          ) : canRaise && (
                            <button onClick={() => raise.mutate({ reportId: r.id, key: f.key })} disabled={raise.isPending}
                              className="rounded-lg border border-gray-300 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                              Raise finding
                            </button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
