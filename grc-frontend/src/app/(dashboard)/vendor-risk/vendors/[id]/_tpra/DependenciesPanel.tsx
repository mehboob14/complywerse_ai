'use client';

// What breaks if this vendor fails: the continuity processes that depend on it
// (with their recovery times), the assets linked to it or naming it, where its
// software runs on our estate, the controls linked to it or that it provides,
// the fourth parties it relies on, the platforms it shares with other vendors,
// and the products we watch for known-exploited vulnerabilities.

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, Link2, Loader2, Network, Plus, ShieldCheck, Timer, Trash2, Unlink, Workflow } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';

interface Impact {
  assets: Array<{ id: number; name: string; type: string | null; criticality: string | null; linked: boolean; link_id: number | null; relation: string | null }>;
  assets_running_its_software: number;
  controls: Array<{ code: string; title: string | null; how: string }>;
  processes: Array<{ id: number; process: string; plan: string | null; criticality: string | null; rto_hours: number | null;
    rpo_hours: number | null; mtpd_hours: number | null; linked: boolean; named_as_dependency: boolean; vendor_bcp: string | null; link_id: number | null }>;
  shortest_rto_hours: number | null;
  fourth_parties: Array<{ id: number; name: string; platform: string | null; service: string | null; data_shared: string[]; critical: boolean; also_vendor_id: number | null }>;
  shared_platforms: Array<{ platform: string; vendor_count: number }>;
  products: Array<{ id: number; name: string; cpe_vendor: string | null; cpe_product: string | null }>;
}
type Target = 'asset' | 'bia_process';

const card = 'rounded-xl border border-gray-200 bg-white p-3';
const btn = 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium disabled:opacity-60';
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1 text-xs';

function errorText(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not save.';
}

function Heading({ icon: Icon, children }: { icon: typeof Boxes; children: React.ReactNode }) {
  return <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-slate-800"><Icon className="h-3.5 w-3.5 text-primary-600" /> {children}</p>;
}

function LinkPicker({ vendorId, type, onDone }: { vendorId: number; type: Target; onDone: () => void }) {
  const [term, setTerm] = useState('');
  const { data } = useQuery({
    queryKey: ['tpra-link-targets', type, term],
    queryFn: async () => ((await tpraApi.linkTargets(type, term)).data?.items || []) as Array<{ id: number; label: string; detail: string | null }>,
  });
  const add = useMutation({
    mutationFn: async (id: number) => tpraApi.addVendorLinks(vendorId, { target_type: type, target_ids: [id] }),
    onSuccess: onDone,
  });
  return (
    <div className="mt-2 space-y-1 rounded-lg border border-gray-200 p-2">
      <input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus className={`${input} w-full`}
        placeholder={type === 'asset' ? 'Search assets by name' : 'Search continuity processes by name'}
        aria-label={type === 'asset' ? 'Search assets' : 'Search continuity processes'} />
      <ul className="max-h-40 overflow-y-auto">
        {(data || []).map((t) => (
          <li key={t.id}>
            <button type="button" disabled={add.isPending} onClick={() => add.mutate(t.id)}
              className="flex w-full justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-50">
              <span className="truncate">{t.label}</span><span className="shrink-0 text-gray-400">{t.detail}</span>
            </button>
          </li>
        ))}
        {data && data.length === 0 && <li className="px-1.5 py-1 text-xs text-gray-400">Nothing found.</li>}
      </ul>
    </div>
  );
}

export default function DependenciesPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [picking, setPicking] = useState<Target | null>(null);
  const [fp, setFp] = useState({ name: '', service: '', data: '', critical: false });
  const [product, setProduct] = useState({ name: '', cpe_vendor: '', cpe_product: '' });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-impact', vendorId],
    queryFn: async () => (await tpraApi.vendorImpact(vendorId)).data as Impact,
  });
  const refresh = () => { setError(null); qc.invalidateQueries({ queryKey: ['tpra-impact', vendorId] }); };
  const onError = (e: unknown) => setError(errorText(e));

  const link = useMutation({ mutationFn: async (v: { type: Target; id: number }) =>
    tpraApi.addVendorLinks(vendorId, { target_type: v.type, target_ids: [v.id] }), onSuccess: refresh, onError });
  const unlink = useMutation({ mutationFn: async (id: number) => tpraApi.removeVendorLink(id), onSuccess: refresh, onError });
  const addFp = useMutation({
    mutationFn: async () => tpraApi.addFourthParty(vendorId, {
      name: fp.name, service: fp.service || undefined, critical: fp.critical,
      data_shared: fp.data.split(',').map((d) => d.trim()).filter(Boolean),
    }),
    onSuccess: () => { setFp({ name: '', service: '', data: '', critical: false }); refresh(); }, onError,
  });
  const removeFp = useMutation({ mutationFn: async (id: number) => tpraApi.removeFourthParty(id), onSuccess: refresh, onError });
  const watch = useMutation({
    mutationFn: async () => tpraApi.watchProduct(vendorId, {
      name: product.name, cpe_vendor: product.cpe_vendor || undefined, cpe_product: product.cpe_product || undefined }),
    onSuccess: () => { setProduct({ name: '', cpe_vendor: '', cpe_product: '' }); refresh(); }, onError,
  });
  const unwatch = useMutation({ mutationFn: async (id: number) => tpraApi.unwatchProduct(id), onSuccess: refresh, onError });

  if (isLoading || !data) {
    return <div className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Working out what depends on this vendor…</div>;
  }

  const linkedAssets = data.assets.filter((a) => a.linked).length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          { label: 'Continuity processes', value: data.processes.length,
            foot: data.shortest_rto_hours != null ? `shortest RTO ${data.shortest_rto_hours}h` : 'no recovery time set' },
          { label: 'Assets', value: data.assets.length, foot: `${linkedAssets} linked, ${data.assets.length - linkedAssets} named` },
          { label: 'Assets running its software', value: data.assets_running_its_software, foot: 'from software inventory' },
          { label: 'Controls', value: data.controls.length, foot: 'linked or provided' },
        ].map((k) => (
          <div key={k.label} className={card}>
            <p className="text-[11px] text-gray-500">{k.label}</p>
            <p className="text-xl font-semibold text-slate-900">{k.value}</p>
            <p className="text-[11px] text-gray-400">{k.foot}</p>
          </div>
        ))}
      </div>

      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}

      <section className={card}>
        <div className="flex items-center justify-between">
          <Heading icon={Timer}>Continuity processes that depend on it</Heading>
          {canEdit && <button type="button" className={`${btn} border-gray-200 text-gray-600`} onClick={() => setPicking(picking === 'bia_process' ? null : 'bia_process')}><Plus className="h-3 w-3" /> Link a process</button>}
        </div>
        {picking === 'bia_process' && <LinkPicker vendorId={vendorId} type="bia_process" onDone={() => { setPicking(null); refresh(); }} />}
        {data.processes.length === 0 ? <p className="text-xs text-gray-500">No continuity process names or links this vendor yet.</p> : (
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1">Process</th><th>Plan</th><th>RTO / RPO / MTPD</th><th>Vendor&apos;s BCP</th><th /></tr></thead>
            <tbody>
              {data.processes.map((p) => (
                <tr key={p.id} className="border-t border-gray-100">
                  <td className="py-1.5 font-medium text-slate-800">{p.process}{p.criticality ? <span className="ml-1 text-gray-400">({p.criticality})</span> : null}</td>
                  <td className="text-gray-600">{p.plan || '-'}</td>
                  <td className="tabular-nums text-gray-600">{[p.rto_hours, p.rpo_hours, p.mtpd_hours].map((h) => (h == null ? '?' : `${h}h`)).join(' / ')}</td>
                  <td className="text-gray-600">{p.vendor_bcp || (p.named_as_dependency ? 'not recorded' : '-')}</td>
                  <td className="text-right">
                    {p.linked && p.link_id && canEdit
                      ? <button type="button" onClick={() => unlink.mutate(p.link_id!)} className="text-gray-400 hover:text-red-600" aria-label={`Unlink ${p.process}`}><Unlink className="h-3.5 w-3.5" /></button>
                      : !p.linked && <span className="text-[10px] text-gray-400">named in the BIA</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={card}>
        <div className="flex items-center justify-between">
          <Heading icon={Boxes}>Assets</Heading>
          {canEdit && <button type="button" className={`${btn} border-gray-200 text-gray-600`} onClick={() => setPicking(picking === 'asset' ? null : 'asset')}><Plus className="h-3 w-3" /> Link an asset</button>}
        </div>
        {picking === 'asset' && <LinkPicker vendorId={vendorId} type="asset" onDone={() => { setPicking(null); refresh(); }} />}
        {data.assets.length === 0 ? <p className="text-xs text-gray-500">No asset is linked to this vendor or names it as its vendor.</p> : (
          <ul className="space-y-1">
            {data.assets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 text-xs">
                <span><span className="font-medium text-slate-800">{a.name}</span> <span className="text-gray-400">{a.type}{a.criticality ? ` · ${a.criticality}` : ''}</span></span>
                {a.linked ? (
                  canEdit && a.link_id && <button type="button" onClick={() => unlink.mutate(a.link_id!)} className="text-gray-400 hover:text-red-600" aria-label={`Unlink ${a.name}`}><Unlink className="h-3.5 w-3.5" /></button>
                ) : (
                  canEdit && <button type="button" className={`${btn} border-primary-200 text-primary-700`} onClick={() => link.mutate({ type: 'asset', id: a.id })}
                    title="This asset names the vendor in its vendor field. Confirm the link."><Link2 className="h-3 w-3" /> Confirm link</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <Heading icon={ShieldCheck}>Controls</Heading>
        {data.controls.length === 0 ? <p className="text-xs text-gray-500">No control is linked to this vendor or provided by it. Link one from the control&apos;s page.</p> : (
          <ul className="space-y-1">
            {data.controls.map((c) => (
              <li key={c.code} className="text-xs">
                <Link href={`/automation/soc2-controls/${encodeURIComponent(c.code)}`} className="font-medium text-primary-700 hover:underline">{c.code}</Link>
                {c.title ? <span className="text-slate-700"> {c.title}</span> : null}
                <span className="text-gray-400"> · {c.how}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={card}>
        <Heading icon={Network}>Fourth parties it relies on</Heading>
        {data.fourth_parties.length > 0 && (
          <ul className="mb-2 space-y-1">
            {data.fourth_parties.map((f) => (
              <li key={f.id} className="flex items-start justify-between gap-2 text-xs">
                <span>
                  <span className="font-medium text-slate-800">{f.name}</span>
                  {f.critical && <span className="ml-1 rounded bg-red-50 px-1 text-[10px] text-red-700">critical</span>}
                  {f.also_vendor_id && <Link href={`/vendor-risk/vendors/${f.also_vendor_id}`} className="ml-1 text-[10px] text-primary-700 hover:underline">also our vendor</Link>}
                  <span className="text-gray-500">{f.service ? ` · ${f.service}` : ''}{f.data_shared.length ? ` · sees ${f.data_shared.join(', ')}` : ''}</span>
                </span>
                {canEdit && <button type="button" onClick={() => removeFp.mutate(f.id)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${f.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (fp.name.trim()) addFp.mutate(); }}>
            <input className={`${input} w-40`} placeholder="Name, e.g. AWS" value={fp.name} onChange={(e) => setFp({ ...fp, name: e.target.value })} aria-label="Fourth party name" />
            <input className={`${input} w-40`} placeholder="Service it provides" value={fp.service} onChange={(e) => setFp({ ...fp, service: e.target.value })} aria-label="Service" />
            <input className={`${input} w-48`} placeholder="Our data it sees (comma separated)" value={fp.data} onChange={(e) => setFp({ ...fp, data: e.target.value })} aria-label="Data shared" />
            <label className="flex items-center gap-1 text-[11px] text-gray-600"><input type="checkbox" checked={fp.critical} onChange={(e) => setFp({ ...fp, critical: e.target.checked })} /> critical</label>
            <button type="submit" disabled={addFp.isPending || !fp.name.trim()} className={`${btn} border-primary-600 bg-primary-600 text-white`}><Plus className="h-3 w-3" /> Add</button>
          </form>
        )}
        {data.shared_platforms.length > 0 && (
          <p className="mt-2 text-[11px] text-amber-800">
            Shares {data.shared_platforms.map((s) => `${s.platform} with ${s.vendor_count - 1} other vendor${s.vendor_count - 1 === 1 ? '' : 's'}`).join('; ')}.{' '}
            <Link href="/vendor-risk/concentration" className="underline">See concentration</Link>
          </p>
        )}
      </section>

      <section className={card}>
        <Heading icon={Workflow}>Products watched for known-exploited vulnerabilities</Heading>
        {data.products.length > 0 && (
          <ul className="mb-2 space-y-1">
            {data.products.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                <span><span className="font-medium text-slate-800">{p.name}</span>
                  {(p.cpe_vendor || p.cpe_product) && <span className="font-mono text-[10px] text-gray-400"> cpe:…:{p.cpe_vendor || '*'}:{p.cpe_product || '*'}</span>}</span>
                {canEdit && <button type="button" onClick={() => unwatch.mutate(p.id)} className="text-gray-400 hover:text-red-600" aria-label={`Stop watching ${p.name}`}><Trash2 className="h-3.5 w-3.5" /></button>}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (product.name.trim()) watch.mutate(); }}>
            <input className={`${input} w-40`} placeholder="Product, e.g. Exchange Server" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} aria-label="Product name" />
            <input className={`${input} w-32`} placeholder="CPE vendor" value={product.cpe_vendor} onChange={(e) => setProduct({ ...product, cpe_vendor: e.target.value })} aria-label="CPE vendor" />
            <input className={`${input} w-32`} placeholder="CPE product" value={product.cpe_product} onChange={(e) => setProduct({ ...product, cpe_product: e.target.value })} aria-label="CPE product" />
            <button type="submit" disabled={watch.isPending || !product.name.trim()} className={`${btn} border-primary-600 bg-primary-600 text-white`}><Plus className="h-3 w-3" /> Watch</button>
          </form>
        )}
        <p className="mt-1 text-[11px] text-gray-400">Checked daily against the CISA Known Exploited Vulnerabilities catalogue; a match becomes a monitoring signal.</p>
      </section>
    </div>
  );
}
