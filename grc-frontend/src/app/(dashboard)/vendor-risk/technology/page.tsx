'use client';

// What suppliers run, as seen from outside, and who relies on what. Search a
// product or platform to see every supplier using it; search a CVE to see every
// supplier whose latest scan shows it.

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Loader2, Search, X } from 'lucide-react';
import { vendorTechApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { fmtDate } from '../_lib/tprmShared';
import { TIER_CLS } from '../_lib/intake/types';

interface Tech { name: string; category: string; vendors: number; critical: number; versions: string[] }
interface Catalogue { items: Tech[]; categories: string[]; scanned: number; suppliers: number }
interface Who {
  name: string; platform: string | null;
  items: Array<{
    vendor: { id: number; name: string; tier: string | null };
    seen: Array<{ name: string; versions: string[]; hosts: string[]; evidence: string | null; at: string }>;
    fourth_parties: Array<{ name: string; service: string | null; critical: boolean }>;
  }>;
}
interface Shows {
  id: string; scanned: number;
  items: Array<{ vendor: { id: number; name: string; tier: string | null }; hosts: string[]; severity: string; cvss: number | null; waived: boolean; at: string }>;
}

const CVE = /^cve-\d{4}-\d{4,7}$/i;

function Tier({ tier }: { tier: string | null }) {
  return tier ? <span className={clsx('inline-flex rounded-full border px-1.5 text-[11px] capitalize', TIER_CLS[tier])}>{tier}</span> : null;
}

export default function TechnologyPage() {
  const params = useSearchParams();
  const [text, setText] = useState(params?.get('q') || '');
  const [category, setCategory] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const query = text.trim();
  const cve = CVE.test(query) ? query.toUpperCase() : null;

  const { data, isLoading, isError } = useQuery<Catalogue>({
    queryKey: ['tprm-tech', query && !cve ? query : '', category],
    queryFn: async () => (await vendorTechApi.catalogue({ q: (!cve && query) || undefined, category: category || undefined })).data,
    ...TPRM_QUERY_OPTS,
  });
  const shows = useQuery<Shows>({
    queryKey: ['tprm-tech-cve', cve],
    queryFn: async () => (await vendorTechApi.whoShows(cve as string)).data,
    enabled: !!cve,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Technology</h1>
        <p className="mt-0.5 max-w-2xl text-sm text-slate-500">
          What suppliers run, read from their websites, mail and DNS records, and from Shodan where a key is connected.
          Search a product or platform to see every supplier on it, including those that declared it as a fourth party,
          or a CVE to see whose estate shows it.
        </p>
      </div>

      <label className="relative block max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. WordPress, AWS, Microsoft 365 or CVE-2024-3400"
          className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100" />
      </label>

      {cve ? (
        <section className="rounded-xl border border-slate-200 bg-white" aria-labelledby="tech-cve">
          <h2 id="tech-cve" className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">
            Suppliers whose latest scan shows {cve}
          </h2>
          {shows.isLoading ? <Loader2 className="m-4 h-4 w-4 animate-spin text-slate-400" /> : !shows.data?.items.length ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              None of the {shows.data?.scanned ?? 0} scanned suppliers shows it. Vulnerabilities are read from Shodan, so a
              supplier is only covered when a Shodan key is connected.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shows.data.items.map((r) => (
                <li key={r.vendor.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <Link href={`/vendor-risk/vendors/${r.vendor.id}?tab=outside-in`} className="font-medium text-slate-900 hover:underline">{r.vendor.name}</Link>
                  <Tier tier={r.vendor.tier} />
                  <span className="text-xs text-slate-500">{r.hosts.join(', ')} · {r.severity}{r.cvss ? `, CVSS ${r.cvss}` : ''} · scanned {fmtDate(r.at)}</span>
                  {r.waived && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">waived</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {!!data?.categories.length && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by category">
              {['', ...data.categories].map((c) => (
                <button key={c || 'all'} type="button" onClick={() => setCategory(c)} aria-pressed={category === c}
                  className={clsx('rounded-full border px-3 py-1 text-xs font-medium', category === c ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}>
                  {c || 'All'}
                </button>
              ))}
            </div>
          )}
          {isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
          ) : isError ? (
            <p className="text-sm text-rose-700">Could not load technologies.</p>
          ) : !data?.items.length ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center text-sm text-slate-500">
              {data?.scanned ? (query ? `Nothing seen matches “${query}”.` : 'Nothing seen yet.') : (
                <>No supplier has been scanned yet. Turn on outside-in scans in <Link href="/vendor-risk/settings" className="text-primary-700 hover:underline">Settings</Link>, or
                  scan one from its Outside-in tab.</>
              )}
              {query && <button type="button" onClick={() => setPicked(query)} className="ml-1 text-primary-700 hover:underline">Check fourth parties for “{query}”</button>}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <p className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                From the latest scan of {data.scanned} of {data.suppliers} suppliers in use.
              </p>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Technology</th>
                    <th className="px-4 py-2.5 font-medium">Category</th>
                    <th className="px-4 py-2.5 text-right font-medium">Suppliers</th>
                    <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">Critical</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">Versions seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((t) => (
                    <tr key={t.name} className="cursor-pointer hover:bg-slate-50" onClick={() => setPicked(t.name)}>
                      <td className="px-4 py-2.5">
                        <button type="button" className="font-medium text-slate-900 hover:text-primary-700 hover:underline" onClick={(e) => { e.stopPropagation(); setPicked(t.name); }}>
                          {t.name}
                        </button>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{t.category}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-800">{t.vendors}</td>
                      <td className={clsx('hidden px-4 py-2.5 text-right tabular-nums sm:table-cell', t.critical ? 'font-medium text-slate-900' : 'text-slate-400')}>{t.critical}</td>
                      <td className="hidden px-4 py-2.5 md:table-cell">
                        <span className="flex flex-wrap gap-1">
                          {t.versions.map((v) => <span key={v} className="rounded bg-slate-100 px-1.5 text-[11px] tabular-nums text-slate-600">{v}</span>)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {picked && <WhoRuns name={picked} onClose={() => setPicked(null)} />}
    </div>
  );
}

function WhoRuns({ name, onClose }: { name: string; onClose: () => void }) {
  const { data, isLoading } = useQuery<Who>({
    queryKey: ['tprm-tech-who', name],
    queryFn: async () => (await vendorTechApi.whoRuns(name)).data,
  });
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30" role="dialog" aria-modal="true" aria-label={`Who runs ${name}`}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Who runs {name}</h2>
            {data?.platform && data.platform.toLowerCase() !== name.toLowerCase() && (
              <p className="text-xs text-slate-500">Counted as part of {data.platform}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-400 hover:bg-slate-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : !data?.items.length ? (
            <p className="text-sm text-slate-500">No supplier in use is seen running it or has it recorded as a fourth party.</p>
          ) : (
            <ul className="space-y-3">
              {data.items.map((r) => (
                <li key={r.vendor.id} className="rounded-lg border border-slate-200 p-3">
                  <p className="flex items-center gap-2">
                    <Link href={`/vendor-risk/vendors/${r.vendor.id}?tab=outside-in`} className="text-sm font-medium text-slate-900 hover:underline">{r.vendor.name}</Link>
                    <Tier tier={r.vendor.tier} />
                  </p>
                  <ul className="mt-1.5 space-y-1 text-xs text-slate-600">
                    {r.seen.map((s) => (
                      <li key={s.name}>
                        Seen on its estate: {s.name}{s.versions.length ? ` ${s.versions.join(', ')}` : ''}
                        {s.hosts.length ? ` on ${s.hosts.slice(0, 3).join(', ')}${s.hosts.length > 3 ? ` and ${s.hosts.length - 3} more` : ''}` : ''}
                        <span className="text-slate-400"> · {fmtDate(s.at)}</span>
                      </li>
                    ))}
                    {r.fourth_parties.map((f) => (
                      <li key={f.name}>Recorded fourth party: {f.name}{f.service ? ` (${f.service})` : ''}{f.critical ? ' · critical dependency' : ''}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
