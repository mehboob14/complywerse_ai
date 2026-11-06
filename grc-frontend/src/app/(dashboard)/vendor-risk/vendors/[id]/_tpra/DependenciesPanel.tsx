'use client';

// What breaks if this vendor fails: the continuity processes that depend on it (with their recovery times), the assets linked to it or
// naming it, where its software runs on our estate, the controls linked to it or that it provides, and the products we watch for
// known-exploited vulnerabilities. The vendors it relies on (fourth parties) are the Subprocessors table on the Paperwork tab.

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Plus, Trash2, Unlink } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, ErrorState, Panel, Skeleton, StatTile } from '../../../_ui';
import { FIELD } from '../../_components/formStyles';

interface Impact {
  assets: Array<{ id: number; name: string; type: string | null; criticality: string | null; linked: boolean; link_id: number | null; relation: string | null }>;
  assets_running_its_software: number;
  controls: Array<{ code: string; title: string | null; how: string }>;
  processes: Array<{ id: number; process: string; plan: string | null; criticality: string | null; rto_hours: number | null;
    rpo_hours: number | null; mtpd_hours: number | null; linked: boolean; named_as_dependency: boolean; vendor_bcp: string | null; link_id: number | null }>;
  shortest_rto_hours: number | null;
  products: Array<{ id: number; name: string; cpe_vendor: string | null; cpe_product: string | null }>;
}
type Target = 'asset' | 'bia_process';

const TH = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[#64707e]';
const TD = 'px-3 py-2.5 align-top text-[13px] leading-5 text-[#26323d]';
const ICON = 'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#64707e] hover:bg-[#f3f6f8] hover:text-[#b42318] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const CHIP = 'inline-flex h-8 items-center gap-1 rounded-lg border border-[#99d5cf] bg-[#fff] px-2.5 text-sm font-medium text-[#0f766e] hover:bg-[#f0fdfa] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const NONE = 'text-[13px] leading-5 text-[#64707e]';

function errorText(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not save.';
}

/** A block of the panel: a small heading with what is counted, the link or watch action on the right, then the content. */
function Block({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-[#e1e6eb] pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold leading-5 text-[#1f2933]">
          {title}{count != null && <span className="ml-2 text-[13px] font-medium tabular-nums text-[#64707e]">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function LinkPicker({ type, onPick, busy }: { type: Target; onPick: (id: number) => void; busy: boolean }) {
  const [term, setTerm] = useState('');
  const { data } = useQuery({
    queryKey: ['tpra-link-targets', type, term],
    queryFn: async () => ((await tpraApi.linkTargets(type, term)).data?.items || []) as Array<{ id: number; label: string; detail: string | null }>,
  });
  const what = type === 'asset' ? 'assets' : 'continuity processes';
  return (
    <div className="mb-3 space-y-1 rounded-lg border border-[#d5dbe1] p-2">
      <input value={term} onChange={(e) => setTerm(e.target.value)} autoFocus className={FIELD}
        placeholder={`Search ${what} by name`} aria-label={`Search ${what}`} />
      <ul className="max-h-40 overflow-y-auto">
        {(data || []).map((t) => (
          <li key={t.id}>
            <button type="button" disabled={busy} onClick={() => onPick(t.id)}
              className="flex w-full justify-between gap-2 rounded px-2 py-1.5 text-left text-sm text-[#26323d] hover:bg-[#f3f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
              <span className="truncate">{t.label}</span><span className="shrink-0 text-[#64707e]">{t.detail}</span>
            </button>
          </li>
        ))}
        {data && data.length === 0 && <li className="px-2 py-1.5 text-[13px] text-[#64707e]">Nothing found.</li>}
      </ul>
    </div>
  );
}

export default function DependenciesPanel({ vendorId }: { vendorId: number }) {
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const [picking, setPicking] = useState<Target | null>(null);
  const [product, setProduct] = useState({ name: '', cpe_vendor: '', cpe_product: '' });
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['tpra-impact', vendorId],
    queryFn: async () => (await tpraApi.vendorImpact(vendorId)).data as Impact,
  });
  const refresh = () => { setError(null); qc.invalidateQueries({ queryKey: ['tpra-impact', vendorId] }); };
  const onError = (e: unknown) => setError(errorText(e));

  const link = useMutation({ mutationFn: async (v: { type: Target; id: number }) =>
    tpraApi.addVendorLinks(vendorId, { target_type: v.type, target_ids: [v.id] }), onSuccess: refresh, onError });
  const unlink = useMutation({ mutationFn: async (id: number) => tpraApi.removeVendorLink(id), onSuccess: refresh, onError });
  const watch = useMutation({
    mutationFn: async () => tpraApi.watchProduct(vendorId, {
      name: product.name, cpe_vendor: product.cpe_vendor || undefined, cpe_product: product.cpe_product || undefined }),
    onSuccess: () => { setProduct({ name: '', cpe_vendor: '', cpe_product: '' }); refresh(); }, onError,
  });
  const unwatch = useMutation({ mutationFn: async (id: number) => tpraApi.unwatchProduct(id), onSuccess: refresh, onError });

  const toggle = (type: Target) => setPicking(picking === type ? null : type);
  const body = (() => {
    if (isLoading) return <div className="space-y-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>;
    if (isError || !data) return <ErrorState title="Couldn't work out what depends on this vendor" onRetry={() => refetch()} />;
    const linkedAssets = data.assets.filter((a) => a.linked).length;
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Continuity processes" value={data.processes.length} caption={data.shortest_rto_hours != null ? `Shortest RTO ${data.shortest_rto_hours}h` : 'No recovery time set'} />
          <StatTile label="Assets" value={data.assets.length} caption={`${linkedAssets} linked, ${data.assets.length - linkedAssets} named`} />
          <StatTile label="Assets running its software" value={data.assets_running_its_software} caption="From the software inventory" />
          <StatTile label="Controls" value={data.controls.length} caption="Linked or provided" />
        </div>

        {error && <p role="alert" className="text-[13px] leading-5 text-[#c01741]">{error}</p>}

        <Block title="Continuity processes" count={data.processes.length}
          action={canEdit ? <button type="button" className={BTN} onClick={() => toggle('bia_process')}><Plus aria-hidden className="h-4 w-4" /> Link a process</button> : undefined}>
          {picking === 'bia_process' && <LinkPicker type="bia_process" busy={link.isPending} onPick={(id) => { link.mutate({ type: 'bia_process', id }); setPicking(null); }} />}
          {data.processes.length === 0 ? <p className={NONE}>No continuity process names or links this vendor yet.</p> : (
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table of continuity processes">
              <table className="min-w-full">
                <thead><tr className="border-y border-[#e1e6eb] bg-[#f7f9fa]">
                  {['Process', 'Plan', 'RTO / RPO / MTPD', "Vendor's BCP"].map((h) => <th key={h} scope="col" className={TH}>{h}</th>)}<th className={TH}><span className="sr-only">Unlink</span></th>
                </tr></thead>
                <tbody className="divide-y divide-[#e1e6eb]">
                  {data.processes.map((p) => (
                    <tr key={p.id}>
                      <td className={`${TD} font-medium text-[#1f2933]`}>{p.process}{p.criticality ? <span className="ml-1 font-normal text-[#64707e]">({p.criticality})</span> : null}</td>
                      <td className={TD}>{p.plan || '-'}</td>
                      <td className={`${TD} whitespace-nowrap tabular-nums`}>{[p.rto_hours, p.rpo_hours, p.mtpd_hours].map((h) => (h == null ? '?' : `${h}h`)).join(' / ')}</td>
                      <td className={TD}>{p.vendor_bcp || (p.named_as_dependency ? 'Not recorded' : '-')}</td>
                      <td className={`${TD} text-right`}>
                        {p.linked && p.link_id && canEdit
                          ? <button type="button" onClick={() => unlink.mutate(p.link_id!)} className={ICON} aria-label={`Unlink ${p.process}`} title="Unlink"><Unlink aria-hidden className="h-4 w-4" /></button>
                          : !p.linked && <span className="text-[12px] text-[#64707e]">Named in the BIA</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Block>

        <Block title="Assets" count={data.assets.length}
          action={canEdit ? <button type="button" className={BTN} onClick={() => toggle('asset')}><Plus aria-hidden className="h-4 w-4" /> Link an asset</button> : undefined}>
          {picking === 'asset' && <LinkPicker type="asset" busy={link.isPending} onPick={(id) => { link.mutate({ type: 'asset', id }); setPicking(null); }} />}
          {data.assets.length === 0 ? <p className={NONE}>No asset is linked to this vendor or names it as its vendor.</p> : (
            <ul className="space-y-1.5">
              {data.assets.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-[13px] leading-5">
                  <span><span className="font-medium text-[#1f2933]">{a.name}</span> <span className="text-[#64707e]">{a.type}{a.criticality ? ` · ${a.criticality}` : ''}</span></span>
                  {a.linked ? (
                    canEdit && a.link_id && <button type="button" onClick={() => unlink.mutate(a.link_id!)} className={ICON} aria-label={`Unlink ${a.name}`} title="Unlink"><Unlink aria-hidden className="h-4 w-4" /></button>
                  ) : (
                    canEdit && <button type="button" className={CHIP} onClick={() => link.mutate({ type: 'asset', id: a.id })}
                      title="This asset names the vendor in its vendor field. Confirm the link."><Link2 aria-hidden className="h-3.5 w-3.5" /> Confirm link</button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Controls" count={data.controls.length}>
          {data.controls.length === 0 ? <p className={NONE}>No control is linked to this vendor or provided by it. Link one from the control&apos;s page.</p> : (
            <ul className="space-y-1.5">
              {data.controls.map((c) => (
                <li key={c.code} className="text-[13px] leading-5 text-[#26323d]">
                  <Link href={`/automation/soc2-controls/${encodeURIComponent(c.code)}`} className="font-medium text-[#0f766e] hover:underline">{c.code}</Link>
                  {c.title ? <span> {c.title}</span> : null}
                  <span className="text-[#64707e]"> · {c.how}</span>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Watched products" count={data.products.length}>
          {data.products.length > 0 && (
            <ul className="mb-2 space-y-1.5">
              {data.products.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-[13px] leading-5">
                  <span>
                    <span className="font-medium text-[#1f2933]">{p.name}</span>
                    {(p.cpe_vendor || p.cpe_product) && <span className="font-mono text-[11px] text-[#64707e]"> cpe:…:{p.cpe_vendor || '*'}:{p.cpe_product || '*'}</span>}
                  </span>
                  {canEdit && <button type="button" onClick={() => unwatch.mutate(p.id)} className={ICON} aria-label={`Stop watching ${p.name}`} title="Stop watching"><Trash2 aria-hidden className="h-4 w-4" /></button>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (product.name.trim()) watch.mutate(); }}>
              <input className={`${FIELD} w-48`} placeholder="Product, e.g. Exchange Server" value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} aria-label="Product name" />
              <input className={`${FIELD} w-36`} placeholder="CPE vendor" value={product.cpe_vendor} onChange={(e) => setProduct({ ...product, cpe_vendor: e.target.value })} aria-label="CPE vendor" />
              <input className={`${FIELD} w-36`} placeholder="CPE product" value={product.cpe_product} onChange={(e) => setProduct({ ...product, cpe_product: e.target.value })} aria-label="CPE product" />
              <button type="submit" disabled={watch.isPending || !product.name.trim()} className={BTN}><Plus aria-hidden className="h-4 w-4" /> Watch</button>
            </form>
          )}
        </Block>
      </div>
    );
  })();

  return (
    <Panel title="What depends on them"
      info="Watched products are checked daily against the CISA Known Exploited Vulnerabilities catalogue; a match becomes a monitoring signal. The vendors this one relies on are under Paperwork, Subprocessors.">
      {body}
    </Panel>
  );
}
