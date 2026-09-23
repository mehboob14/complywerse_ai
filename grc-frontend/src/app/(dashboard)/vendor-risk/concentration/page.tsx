'use client';

// Concentration — the platforms several of our vendors depend on, and the
// known-exploited vulnerabilities that hit more than one vendor at once. Built
// from the fourth-party register and the product watchlist; names are folded
// through an alias map so one platform's many spellings count once.

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, Layers, Loader2, Plus, Trash2 } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';

interface Platform {
  platform: string; vendor_count: number; critical_count: number; direct_vendor_id: number | null;
  vendors: Array<{ id: number; name: string; tier: string | null; via: string[]; critical_dependency: boolean }>;
}
interface SharedVuln {
  cve: string; title: string | null; severity: string; occurred_at: string | null;
  vendors: Array<{ id: number; name: string; tier: string | null; signal_id: number; acknowledged: boolean }>;
}
interface Alias { id: number; alias: string; platform: string | null; excluded: boolean }

export default function ConcentrationPage() {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:config:edit') || hasPermission('erm:risks:edit');
  const [alias, setAlias] = useState({ alias: '', platform: '', excluded: false });
  const [error, setError] = useState<string | null>(null);

  const { data: platforms, isLoading } = useQuery({
    queryKey: ['tprm-concentration'],
    queryFn: async () => ((await tpraApi.concentration(2)).data?.platforms || []) as Platform[],
    ...TPRM_QUERY_OPTS,
  });
  const { data: vulns } = useQuery({
    queryKey: ['tprm-shared-vulns'],
    queryFn: async () => ((await tpraApi.sharedVulnerabilities(90)).data?.vulnerabilities || []) as SharedVuln[],
    ...TPRM_QUERY_OPTS,
  });
  const { data: aliases } = useQuery({
    queryKey: ['tprm-platform-aliases'],
    queryFn: async () => ((await tpraApi.platformAliases()).data?.items || []) as Alias[],
    ...TPRM_QUERY_OPTS,
  });
  const refresh = () => {
    setError(null);
    ['tprm-concentration', 'tprm-platform-aliases'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const onError = (e: unknown) =>
    setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not save.');
  const addAlias = useMutation({
    mutationFn: async () => tpraApi.addPlatformAlias({ alias: alias.alias, platform: alias.platform || undefined, excluded: alias.excluded }),
    onSuccess: () => { setAlias({ alias: '', platform: '', excluded: false }); refresh(); }, onError,
  });
  const removeAlias = useMutation({ mutationFn: async (id: number) => tpraApi.removePlatformAlias(id), onSuccess: refresh, onError });

  const shared = (vulns || []).filter((v) => v.vendors.length > 1);
  const single = (vulns || []).filter((v) => v.vendors.length === 1);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-900"><Layers className="h-5 w-5 text-slate-500" /> Concentration</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Where several of our vendors depend on the same platform, one failure there is several failures for us. Built
          from each vendor&apos;s fourth parties; add them on a vendor&apos;s Dependencies tab.
        </p>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Shared platforms</h2>
        {isLoading ? <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Counting…</p>
          : (platforms || []).length === 0 ? (
            <p className="text-sm text-gray-500">No platform is shared by two or more vendors yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {platforms!.map((p) => (
                <li key={p.platform} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {p.platform}
                      {p.direct_vendor_id && (
                        <Link href={`/vendor-risk/vendors/${p.direct_vendor_id}`} className="ml-2 text-[11px] font-normal text-primary-700 hover:underline">
                          also a direct vendor
                        </Link>
                      )}
                    </p>
                    <p className="text-xs text-gray-600">
                      {p.vendor_count} vendors{p.critical_count ? <span className="text-red-600"> · {p.critical_count} critical</span> : null}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-600">
                    {p.vendors.map((v, i) => (
                      <span key={v.id}>
                        {i > 0 && ', '}
                        <Link href={`/vendor-risk/vendors/${v.id}?tab=dependencies`} className={`hover:underline ${v.critical_dependency ? 'font-medium text-red-700' : ''}`}
                          title={v.via.join('; ')}>{v.name}</Link>
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900"><Bug className="h-4 w-4 text-red-600" /> Known-exploited vulnerabilities across vendors</h2>
        <p className="mb-2 text-xs text-gray-500">From the products watched on each vendor&apos;s Dependencies tab, over the last 90 days.</p>
        {(vulns || []).length === 0 ? <p className="text-sm text-gray-500">None in the last 90 days.</p> : (
          <ul className="divide-y divide-gray-100">
            {[...shared, ...single].map((v) => (
              <li key={v.cve} className="py-2 text-xs">
                <p className="text-sm font-medium text-slate-900">
                  {v.title || v.cve}
                  <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] ${v.severity === 'high' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>{v.severity}</span>
                </p>
                <p className="mt-0.5 text-gray-600">
                  Affects {v.vendors.length} vendor{v.vendors.length === 1 ? '' : 's'}:{' '}
                  {v.vendors.map((x, i) => (
                    <span key={x.id}>{i > 0 && ', '}<Link href={`/vendor-risk/vendors/${x.id}?stage=monitoring`} className="hover:underline">{x.name}</Link></span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Platform names</h2>
        <p className="mb-2 text-xs text-gray-500">
          Common spellings are folded already (&ldquo;Amazon Web Services&rdquo;, &ldquo;AWS&rdquo; and &ldquo;amazon aws&rdquo; are one
          platform). Add your own, or exclude a generic name so it never counts.
        </p>
        {(aliases || []).length > 0 && (
          <ul className="mb-2 space-y-1">
            {aliases!.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                <span><span className="font-mono">{a.alias}</span> {a.excluded ? <span className="text-gray-500">is excluded</span> : <>means <b>{a.platform}</b></>}</span>
                {canEdit && <button type="button" onClick={() => removeAlias.mutate(a.id)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${a.alias}`}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (alias.alias.trim()) addAlias.mutate(); }}>
            <input className="w-48 rounded-lg border border-gray-300 px-2 py-1 text-xs" placeholder="Name as written" value={alias.alias}
              onChange={(e) => setAlias({ ...alias, alias: e.target.value })} aria-label="Name as written" />
            {!alias.excluded && (
              <input className="w-40 rounded-lg border border-gray-300 px-2 py-1 text-xs" placeholder="Platform it means" value={alias.platform}
                onChange={(e) => setAlias({ ...alias, platform: e.target.value })} aria-label="Platform it means" />
            )}
            <label className="flex items-center gap-1 text-[11px] text-gray-600">
              <input type="checkbox" checked={alias.excluded} onChange={(e) => setAlias({ ...alias, excluded: e.target.checked })} /> exclude it
            </label>
            <button type="submit" disabled={addAlias.isPending || !alias.alias.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-60">
              <Plus className="h-3 w-3" /> Add
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
