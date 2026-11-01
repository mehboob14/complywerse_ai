'use client';

/**
 * AdvisoriesPanel — the asset-detail "Advisories" tab.
 *
 * Shows the published security advisories whose CVEs match THIS asset
 * (applicability verdict = affected). Read-only: the advisory module owns the
 * matching; this tab just lists the durable results and links back to each
 * advisory, closing the round-trip (advisory detail already links to the asset).
 *
 * Data: GET /advisories/by-asset/{assetId} →
 *   { items: [{ advisory_id, advisory_title, advisory_severity, cve_id,
 *               cve_severity, region, url, checked_at }], total }
 * Degrades gracefully to an empty state if the endpoint isn't live yet.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ShieldCheck, ExternalLink, ArrowRight } from 'lucide-react';
import apiClient from '@/cyber-assurance/lib/api';

interface AdvisoryItem {
  advisory_id: number;
  advisory_title: string;
  advisory_severity?: string | null;
  cve_id: string;
  cve_severity?: string | null;
  region?: string | null;
  url?: string | null;
  checked_at?: string | null;
}

const SEV: Record<string, { bg: string; fg: string; label: string }> = {
  critical: { bg: '#FBE2E2', fg: '#B42318', label: 'Critical' },
  high: { bg: '#FCE7D6', fg: '#B54708', label: 'High' },
  medium: { bg: '#FEF7C3', fg: '#854A0E', label: 'Medium' },
  low: { bg: '#E0ECFB', fg: '#175CD3', label: 'Low' },
};

function SevPill({ value }: { value?: string | null }) {
  const s = SEV[(value || '').toLowerCase()];
  if (!s) return <span className="text-xs text-slate-400">—</span>;
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={{ background: s.bg, color: s.fg }}>{s.label}</span>
  );
}

const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

export default function AdvisoriesPanel({ assetId, data }: { assetId: number; data?: { items: AdvisoryItem[]; total: number } }) {
  // The page passes `data` for the tab badge; fall back to our own fetch so the
  // panel also works standalone. Enabled only when we weren't handed data.
  const q = useQuery({
    queryKey: ['advisories-by-asset', assetId],
    queryFn: async () => {
      try { return (await apiClient.get(`/advisories/by-asset/${assetId}`)).data as { items: AdvisoryItem[]; total: number }; }
      catch { return { items: [], total: 0 }; }
    },
    enabled: !data,
  });
  const items: AdvisoryItem[] = (data?.items ?? q.data?.items ?? []);
  const loading = !data && q.isLoading;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg"
          style={{ background: items.length ? '#FBE2E2' : '#E6F4EC', color: items.length ? '#B42318' : '#067647' }}>
          {items.length ? <AlertTriangle className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold text-slate-900">Security advisories</h3>
          <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
            Published advisories whose CVEs match this asset{items.length ? ` · ${items.length} affecting this asset` : ''}.
          </p>
        </div>
        {items.length > 0 && (
          <Link href="/cyber-assurance/advisories"
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-[12.5px] font-medium text-slate-700 no-underline transition-colors hover:bg-slate-50">
            All advisories <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>

      {loading ? (
        <div className="px-5 py-10 text-center text-sm text-slate-400">Loading advisories…</div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
          <ShieldCheck className="h-7 w-7 text-emerald-500" />
          <p className="m-0 text-sm font-medium text-slate-700">No advisories affect this asset</p>
          <p className="m-0 max-w-sm text-[12.5px] text-slate-400">
            No published security advisory currently matches a CVE on this asset. This updates when the Advisories module runs a match.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">CVE</th>
                <th className="px-3 py-2.5 font-semibold">Advisory</th>
                <th className="px-3 py-2.5 font-semibold">Severity</th>
                <th className="px-3 py-2.5 font-semibold">Region</th>
                <th className="px-3 py-2.5 font-semibold">Checked</th>
                <th className="px-5 py-2.5 font-semibold text-right">Source</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.advisory_id}-${it.cve_id}-${i}`} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                  <td className="px-5 py-3 align-middle">
                    <span className="font-mono text-[12.5px] font-medium text-slate-900">{it.cve_id}</span>
                    {it.cve_severity && <span className="ml-2 align-middle"><SevPill value={it.cve_severity} /></span>}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <Link href={`/cyber-assurance/advisories/${it.advisory_id}`}
                      className="font-medium text-slate-800 no-underline hover:text-[#005B96] hover:underline">
                      {it.advisory_title || `Advisory #${it.advisory_id}`}
                    </Link>
                  </td>
                  <td className="px-3 py-3 align-middle"><SevPill value={it.advisory_severity} /></td>
                  <td className="px-3 py-3 align-middle text-slate-600">{it.region || <span className="text-slate-400">—</span>}</td>
                  <td className="px-3 py-3 align-middle text-slate-500">{fmtDate(it.checked_at)}</td>
                  <td className="px-5 py-3 text-right align-middle">
                    {it.url ? (
                      <a href={it.url} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#005B96] no-underline hover:underline">
                        View <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <Link href={`/cyber-assurance/advisories/${it.advisory_id}`}
                        className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[#005B96] no-underline hover:underline">
                        Open <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
