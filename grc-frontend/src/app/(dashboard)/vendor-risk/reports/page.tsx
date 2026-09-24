'use client';

// Reports — the committee pack, the register of functions and obligations, and a
// vendor's evidence file, generated from the programme's own records. A kept
// report is frozen; once approved it can be shared with an examiner through a
// link that needs no login, expires, and can be withdrawn.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Eye, FileText, Link2, Loader2, Trash2 } from 'lucide-react';
import { tpraApi, vendorRiskApi, type ReportRequest } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import ReportView, { fmtDay, type ReportContent } from '@/components/vendor-risk/ReportView';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

interface Measure { key: string; label: string; median_days: number | null; count: number }
interface Measures {
  coverage: { active: number; in_date: number; overdue: number; never: number; coverage_pct: number | null; overdue_pct: number | null };
  measures: Measure[];
  trends: Record<string, Array<{ date: string; value: number }>>;
}
interface Report {
  id: number; kind: string; kind_label: string; title: string; generated_at: string | null; generated_by: string | null;
  approved_at: string | null; approved_by: string | null; content_hash: string;
  share: { active: boolean; expires_at: string | null; views: number; last_viewed_at: string | null };
}

const pad = (n: number) => String(n).padStart(2, '0');

function quarters(today = new Date()) {
  const out: Array<{ label: string; start: string; end: string }> = [];
  const y0 = today.getFullYear();
  const q0 = Math.floor(today.getMonth() / 3);
  for (let i = 0; i < 5; i += 1) {
    const q = (((q0 - i) % 4) + 4) % 4;
    const y = y0 - Math.ceil(Math.max(0, i - q0) / 4);
    const end = new Date(y, q * 3 + 3, 0);
    out.push({
      label: i === 0 ? `Q${q + 1} ${y} to date` : `Q${q + 1} ${y}`,
      start: `${y}-${pad(q * 3 + 1)}-01`,
      end: i === 0 ? `${y0}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}` : `${y}-${pad(q * 3 + 3)}-${pad(end.getDate())}`,
    });
  }
  return out;
}

function Spark({ points }: { points?: Array<{ date: string; value: number }> }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const line = points.map((p, i) => `${(i / (points.length - 1)) * 100},${hi === lo ? 10 : 18 - ((p.value - lo) / (hi - lo)) * 16}`).join(' ');
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="mt-1 h-5 w-full text-primary-500" aria-hidden="true">
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const detail = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not work.';

export default function ReportsPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canGenerate = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const canApprove = hasPermission('vendor_risk:approvals:approve');
  const canShare = hasPermission('vendor_risk:config:edit');
  const periods = useMemo(() => quarters(), []);
  const [kind, setKind] = useState<ReportRequest['kind']>('committee_pack');
  const [period, setPeriod] = useState(1);
  const [vendorId, setVendorId] = useState<number | ''>('');
  const [preview, setPreview] = useState<ReportContent | null>(null);
  const [shareDays, setShareDays] = useState<Record<number, number>>({});
  const [fresh, setFresh] = useState<{ id: number; link: string; expires: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: m } = useQuery({
    queryKey: ['tprm-report-measures'],
    queryFn: async () => (await tpraApi.reportMeasures(365)).data as Measures,
    ...TPRM_QUERY_OPTS,
  });
  const { data: reports, isLoading } = useQuery({
    queryKey: ['tprm-reports'],
    queryFn: async () => ((await tpraApi.listReports()).data?.items || []) as Report[],
    ...TPRM_QUERY_OPTS,
  });
  const { data: vendors } = useQuery({
    queryKey: ['tprm-report-vendors'],
    enabled: kind === 'vendor_file',
    queryFn: async () => {
      const d = (await vendorRiskApi.getVendors({ limit: 500 })).data;
      return ((Array.isArray(d) ? d : d?.items || d?.vendors || []) as Array<{ id: number; name: string }>)
        .slice().sort((a, b) => a.name.localeCompare(b.name));
    },
    ...TPRM_QUERY_OPTS,
  });

  const request = (): ReportRequest => (kind === 'committee_pack'
    ? { kind, period_start: periods[period].start, period_end: periods[period].end }
    : kind === 'vendor_file' ? { kind, vendor_id: Number(vendorId) } : { kind });
  const ready = kind !== 'vendor_file' || vendorId !== '';
  const refresh = () => qc.invalidateQueries({ queryKey: ['tprm-reports'] });
  const onError = (e: unknown) => setError(detail(e));

  const previewIt = useMutation({
    mutationFn: async () => (await tpraApi.previewReport(request())).data as ReportContent,
    onSuccess: (c) => { setError(null); setPreview(c); }, onError,
  });
  const keep = useMutation({
    mutationFn: async () => (await tpraApi.createReport(request())).data as Report,
    onSuccess: (r) => { refresh(); router.push(`/vendor-risk/reports/${r.id}`); }, onError,
  });
  const approve = useMutation({ mutationFn: async (id: number) => tpraApi.approveReport(id), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: async (id: number) => tpraApi.deleteReport(id), onSuccess: refresh, onError });
  const revoke = useMutation({
    mutationFn: async (id: number) => tpraApi.revokeReportShare(id),
    onSuccess: (_r, id) => { if (fresh?.id === id) setFresh(null); refresh(); }, onError,
  });
  const share = useMutation({
    mutationFn: async (id: number) => (await tpraApi.shareReport(id, shareDays[id] || 14)).data as Report & { token: string; url: string | null },
    onSuccess: (r) => {
      setCopied(false);
      setFresh({ id: r.id, link: r.url || `${window.location.origin}/vendor-risk/examiner/${r.token}`, expires: r.share.expires_at });
      refresh();
    },
    onError,
  });

  const cov = m?.coverage;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><FileText className="h-5 w-5 text-slate-500" /> Reports</h1>
        <p className="max-w-3xl text-sm text-gray-500">
          The committee pack, the register of critical functions and contract obligations, and a vendor&apos;s evidence file,
          generated from the programme&apos;s own records. A kept report does not change afterwards.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">How the programme is running</h2>
        <p className="mb-3 text-xs text-gray-500">Coverage as of today; the times are medians over the last 90 days. The lines show the daily record.</p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <div className="rounded-lg border border-gray-100 p-3">
            <p className="text-[11px] text-gray-500">Assessed and in date</p>
            <p className="text-lg font-semibold text-slate-900">{cov?.coverage_pct != null ? `${cov.coverage_pct}%` : '—'}</p>
            <p className="text-[11px] text-gray-500">{cov ? `${cov.in_date} of ${cov.active} vendors` : ''}</p>
            <Spark points={m?.trends.tprm_coverage_pct} />
          </div>
          <div className="rounded-lg border border-gray-100 p-3">
            <p className="text-[11px] text-gray-500">Reassessments overdue</p>
            <p className="text-lg font-semibold text-slate-900">{cov?.overdue_pct != null ? `${cov.overdue_pct}%` : '—'}</p>
            <p className="text-[11px] text-gray-500">{cov ? `${cov.overdue} vendors, ${cov.never} never approved` : ''}</p>
            <Spark points={m?.trends.tprm_overdue_pct} />
          </div>
          {(m?.measures || []).map((x) => (
            <div key={x.key} className="rounded-lg border border-gray-100 p-3">
              <p className="text-[11px] text-gray-500">{x.label}</p>
              <p className="text-lg font-semibold text-slate-900">{x.median_days != null ? `${x.median_days} days` : '—'}</p>
              <p className="text-[11px] text-gray-500">{x.count} case{x.count === 1 ? '' : 's'}</p>
              <Spark points={m?.trends[`tprm_${x.key}_days`]} />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Generate a report</h2>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (ready) keep.mutate(); }}>
          <label className="text-xs text-gray-600">Report
            <select className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" value={kind}
              onChange={(e) => { setKind(e.target.value as ReportRequest['kind']); setPreview(null); }}>
              <option value="committee_pack">Committee pack</option>
              <option value="register">Register of functions and obligations</option>
              <option value="vendor_file">Vendor evidence file</option>
            </select>
          </label>
          {kind === 'committee_pack' && (
            <label className="text-xs text-gray-600">Period
              <select className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" value={period}
                onChange={(e) => { setPeriod(Number(e.target.value)); setPreview(null); }}>
                {periods.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
            </label>
          )}
          {kind === 'vendor_file' && (
            <label className="text-xs text-gray-600">Vendor
              <select className="mt-0.5 block w-64 rounded-lg border border-gray-300 px-2 py-1 text-sm" value={vendorId}
                onChange={(e) => { setVendorId(e.target.value ? Number(e.target.value) : ''); setPreview(null); }}>
                <option value="">Choose a vendor</option>
                {(vendors || []).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" disabled={!ready || previewIt.isPending} onClick={() => previewIt.mutate()}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60">
            {previewIt.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview
          </button>
          {canGenerate && (
            <button type="submit" disabled={!ready || keep.isPending}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {keep.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Generate and keep
            </button>
          )}
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Kept reports</h2>
        <p className="mb-2 text-xs text-gray-500">
          Approve a report before sharing it. An examiner&apos;s link needs no login, lasts up to 30 days, and every view is logged.
        </p>
        {isLoading ? <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
          : (reports || []).length === 0 ? <p className="text-sm text-gray-500">None kept yet.</p> : (
            <ul className="divide-y divide-gray-100">
              {reports!.map((r) => (
                <li key={r.id} className="space-y-1.5 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <Link href={`/vendor-risk/reports/${r.id}`} className="text-sm font-medium text-primary-700 hover:underline">{r.title}</Link>
                      <p className="text-[11px] text-gray-500">
                        {r.kind_label} · generated {fmtDay(r.generated_at)}{r.generated_by ? ` by ${r.generated_by}` : ''}
                        {r.approved_at ? ` · approved ${fmtDay(r.approved_at)}${r.approved_by ? ` by ${r.approved_by}` : ''}` : ' · draft'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      {!r.approved_at && canApprove && (
                        <button type="button" onClick={() => approve.mutate(r.id)} disabled={approve.isPending}
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 px-2 py-1 font-medium text-emerald-700">
                          <Check className="h-3 w-3" /> Approve
                        </button>
                      )}
                      {r.approved_at && canShare && !r.share.active && (
                        <>
                          <select aria-label="Link lasts" className="rounded-md border border-gray-300 px-1.5 py-1" value={shareDays[r.id] || 14}
                            onChange={(e) => setShareDays({ ...shareDays, [r.id]: Number(e.target.value) })}>
                            {[7, 14, 30].map((d) => <option key={d} value={d}>{d} days</option>)}
                          </select>
                          <button type="button" onClick={() => share.mutate(r.id)} disabled={share.isPending}
                            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 font-medium text-slate-700">
                            <Link2 className="h-3 w-3" /> Share with an examiner
                          </button>
                        </>
                      )}
                      {r.share.active && (
                        <span className="text-gray-600">
                          Shared until {fmtDay(r.share.expires_at)} · {r.share.views} view{r.share.views === 1 ? '' : 's'}
                          {canShare && (
                            <button type="button" onClick={() => revoke.mutate(r.id)} className="ml-2 font-medium text-red-600 hover:underline">Withdraw</button>
                          )}
                        </span>
                      )}
                      {!r.approved_at && canGenerate && (
                        <button type="button" onClick={() => remove.mutate(r.id)} aria-label={`Discard ${r.title}`} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {fresh?.id === r.id && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                      <p className="mb-1">Copy this link now; it is not shown again. Anyone with it can read this report until {fmtDay(fresh.expires)}.</p>
                      <div className="flex items-center gap-2">
                        <input readOnly value={fresh.link} className="w-full rounded border border-amber-200 bg-white px-2 py-1 font-mono text-[11px]"
                          onFocus={(e) => e.target.select()} aria-label="Examiner link" />
                        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-2 py-1 font-medium"
                          onClick={() => { navigator.clipboard?.writeText(fresh.link).then(() => setCopied(true)).catch(() => undefined); }}>
                          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
      </section>

      {preview && (
        <section aria-label="Preview" className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">Preview, not kept</p>
          <ReportView content={preview} />
        </section>
      )}
    </div>
  );
}
