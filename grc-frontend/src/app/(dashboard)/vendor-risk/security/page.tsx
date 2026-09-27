'use client';

// Every supplier's websites and domains as the internet sees them: grade, score,
// how it moved, what is open and what is waived, beside any provider ratings.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { FileText, Loader2, Search } from 'lucide-react';
import { vendorSecurityApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { TIER_CLS } from '../_lib/intake/types';
import { GradeBadge, type Portfolio } from '../_lib/security/ui';

const GRADES = ['A', 'B', 'C', 'D', 'F'] as const;
const TIERS = ['critical', 'high', 'medium', 'low'];

export default function SecurityRatingsPage() {
  const router = useRouter();
  const [grade, setGrade] = useState<string>('');
  const [tier, setTier] = useState('');
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useQuery<Portfolio>({
    queryKey: ['tprm-outside-in-portfolio'],
    queryFn: async () => (await vendorSecurityApi.portfolio()).data,
    ...TPRM_QUERY_OPTS,
  });

  const providers = useMemo(() => Array.from(new Set((data?.items || []).flatMap((r) => Object.keys(r.ratings)))).sort(), [data]);
  const needle = search.trim().toLowerCase();
  const rows = (data?.items || [])
    .filter((r) => (!grade || r.grade === grade) && (!tier || (r.vendor.tier || '').toLowerCase() === tier)
      && (!needle || r.vendor.name.toLowerCase().includes(needle) || r.domains.some((d) => d.includes(needle))))
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.vendor.name.localeCompare(b.vendor.name));
  const poor = data ? (data.grades.D || 0) + (data.grades.F || 0) : undefined;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Security ratings</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
            How each supplier&apos;s websites and domains look from outside: certificates, web hardening, email spoofing
            protection and, with a Shodan key, exposed services and known vulnerabilities. Critical suppliers are scanned
            weekly, high monthly, others quarterly or twice a year.
          </p>
        </div>
        <Link href="/vendor-risk/reports" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
          <FileText className="h-4 w-4" /> Quarterly report
        </Link>
      </div>

      {data && !data.enabled && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          Scheduled scans are off. Turn them on in <Link href="/vendor-risk/settings" className="font-medium underline">Settings</Link>;
          until then a supplier is scanned only when someone asks from its Outside-in tab.
        </p>
      )}
      {data && !data.shodan && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
          Add a Shodan key under <Link href="/admin/connectors" className="font-medium text-primary-700 hover:underline">Admin → Connectors</Link> to
          include exposed services and known vulnerabilities. UpGuard, SecurityScorecard and BitSight connect there too.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Average score" value={data?.average ?? undefined} note="Across suppliers scanned" />
        <Kpi label="Graded D or F" value={poor} tone={poor ? 'red' : undefined} note="Weakest first in the table" />
        <Kpi label="Not scanned yet" value={data?.unscanned} note={data?.no_domain ? `${data.no_domain} with no domain on record` : 'Every supplier has a domain'} />
        <Kpi label="Waivers ending in 30 days" value={data?.expiring_waivers.length} tone={data?.expiring_waivers.length ? 'amber' : undefined}
          note="Each finding counts again when its waiver ends" />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by grade">
        {GRADES.map((g) => (
          <button key={g} type="button" onClick={() => setGrade(grade === g ? '' : g)} aria-pressed={grade === g}
            className={clsx('flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left transition-shadow hover:shadow-sm',
              grade === g ? 'border-primary-400 ring-2 ring-primary-100' : 'border-slate-200')}>
            <GradeBadge grade={g} />
            <span className="text-lg font-semibold text-slate-900">{data?.grades[g] ?? '—'}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <select aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700">
          <option value="">Every tier</option>
          {TIERS.map((t) => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
        <label className="relative block w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search supplier or domain"
            className="w-full rounded-lg border border-slate-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </label>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <p className="text-sm text-rose-700">Could not load security ratings.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">No supplier matches.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Grade</th>
                <th className="px-4 py-2.5 text-right font-medium">Score</th>
                <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Change</th>
                <th className="hidden px-4 py-2.5 font-medium md:table-cell">Scanned</th>
                <th className="px-4 py-2.5 text-right font-medium">High or critical</th>
                <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">Waived</th>
                {providers.map((p) => <th key={p} className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">{p}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.vendor.id} className="cursor-pointer hover:bg-slate-50"
                  onClick={() => router.push(`/vendor-risk/vendors/${r.vendor.id}?tab=outside-in`)}>
                  <td className="px-4 py-3">
                    <Link href={`/vendor-risk/vendors/${r.vendor.id}?tab=outside-in`} onClick={(e) => e.stopPropagation()}
                      className="font-medium text-slate-900 hover:text-primary-700 hover:underline">{r.vendor.name}</Link>
                    <p className="flex items-center gap-1.5 text-xs text-slate-500">
                      {r.vendor.tier && <span className={clsx('inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[r.vendor.tier])}>{r.vendor.tier}</span>}
                      {r.domains[0] || <span className="text-amber-700">No domain</span>}
                    </p>
                  </td>
                  <td className="px-4 py-3"><GradeBadge grade={r.grade} /></td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-800">{r.score ?? '—'}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums md:table-cell">
                    {r.change ? <span className={r.change > 0 ? 'text-emerald-700' : 'text-rose-700'}>{r.change > 0 ? '▲' : '▼'} {Math.abs(r.change)}</span> : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">{r.scanned_at ? fmtDate(r.scanned_at) : 'Never'}</td>
                  <td className={clsx('px-4 py-3 text-right tabular-nums', r.serious ? 'font-medium text-rose-700' : 'text-slate-500')}>{r.score === null ? '—' : r.serious}</td>
                  <td className="hidden px-4 py-3 text-right tabular-nums text-slate-600 lg:table-cell">{r.waived || '—'}</td>
                  {providers.map((p) => (
                    <td key={p} className="hidden px-4 py-3 text-right tabular-nums text-slate-600 lg:table-cell">{r.ratings[p]?.score ?? '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!!data?.expiring_waivers.length && (
        <section className="rounded-xl border border-slate-200 bg-white p-4" aria-labelledby="sec-waivers">
          <h2 id="sec-waivers" className="mb-2 text-sm font-semibold text-slate-900">Waivers ending in the next 30 days</h2>
          <ul className="divide-y divide-slate-100">
            {data.expiring_waivers.map((w) => (
              <li key={w.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>
                  <Link href={`/vendor-risk/vendors/${w.vendor.id}?tab=outside-in`} className="font-medium text-slate-900 hover:underline">{w.vendor.name}</Link>
                  <span className="text-slate-600"> · {w.finding_key}{w.host ? ` on ${w.host}` : ''}</span>
                </span>
                <span className="text-xs text-slate-500">ends {fmtDate(w.expires_on)} ({w.days_left} day{w.days_left === 1 ? '' : 's'})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
