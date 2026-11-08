'use client';

// Links > Risks, Assets and Other records: what the control mitigates, protects and relies on, across the platform. Linking writes into the other module's own link table, so the record's page
// shows the control back. The pickers search on the server; every write reports; unlinking asks. Who may link follows the route: a risk needs the right to edit risks, an asset the right to
// edit assets (either also accepted with the right to edit controls); for the other kinds the server checks the right of that kind, which the page cannot know, so it offers the action and says
// what the server answers.
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Link2, Plus, Server, Unlink } from 'lucide-react';
import { Button, EmptyState, FormField, IconButton, Select, Sheet, StatusPill, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { automationApi, type ControlRecordLink } from '@/lib/api';
import { statusLabel } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { controlStatus } from '@/lib/statuses/controls';
import { Loaded, Small } from './parts';
import { LinkSheet } from './LinkSheet';
import { useWorkspace } from './workspaceContext';

interface LinkedRisk { link_id: number; risk_id: number; title: string; status: string; inherent_score?: number | null; residual_score?: number | null; owner_name?: string | null }
interface LinkedAsset { link_id: number; asset_id: number; name: string; asset_type?: string | null; check_status?: string | null }
interface InScopeAsset { asset_id: number; name: string; asset_type?: string | null; criticality?: string | null }

const neutral = (status?: string | null) => <StatusPill size="sm" tone="neutral" label={statusLabel(status || 'open')} />;

// ── risks ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function RisksSection() {
  const { code, rights, why, refresh } = useWorkspace();
  const { confirm, confirmDialog } = useConfirm();
  const q = useQuery({ queryKey: ['control-risks', code], queryFn: async () => (await automationApi.listControlRisks(code)).data as { items: LinkedRisk[] } });
  const [picking, setPicking] = useState(false);
  const [raising, setRaising] = useState(false);
  const [title, setTitle] = useState('');
  const [likelihood, setLikelihood] = useState('');
  const [impact, setImpact] = useState('');
  const link = useReportedMutation({ mutationFn: (row: ControlRecordLink) => automationApi.linkControlRisk(code, row.id), success: 'Risk linked', failure: "Couldn't link the risk", onSuccess: () => { void refresh(); } });
  const unlink = useReportedMutation({ mutationFn: (r: LinkedRisk) => automationApi.unlinkControlRisk(code, r.link_id), success: 'Risk unlinked', failure: "Couldn't unlink the risk", onSuccess: () => { void refresh(); } });
  const raise = useReportedMutation({
    mutationFn: () => automationApi.createControlRisk(code, { title: title.trim(), ...(likelihood ? { inherent_likelihood: Number(likelihood) } : {}), ...(impact ? { inherent_impact: Number(impact) } : {}) }),
    success: { title: 'Risk raised and linked', message: 'It is in the risk register now.' }, failure: "Couldn't raise the risk", retryable: false,
    onSuccess: () => { setRaising(false); setTitle(''); setLikelihood(''); setImpact(''); void refresh(); },
  });
  const ask = async (r: LinkedRisk) => { if (await confirm({ title: 'Unlink this risk?', message: `“${r.title}” stays in the risk register; it is only taken off this control.`, confirmLabel: 'Unlink', tone: 'danger' })) unlink.mutate(r); };
  return (
    <Loaded q={q} what="the risks" rows={3}>
      {(data) => {
        const items = data.items ?? [];
        const linked = new Set(items.map((i) => `risk:${i.risk_id}`));
        return (
          <div className="flex flex-col gap-[10px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <Button variant="primary" leftIcon={<Link2 aria-hidden />} disabled={!rights.riskLink} title={why('riskLink')} onClick={() => setPicking(true)}>Link a risk</Button>
              <Button leftIcon={<Plus aria-hidden />} disabled={!rights.riskLink} title={why('riskLink')} onClick={() => setRaising(true)}>Raise a new risk</Button>
            </div>
            {items.length === 0 ? <EmptyState kind="firstUse" bare title="No risks linked yet" description="Link the risks this control mitigates." /> : (
              <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                {items.map((r) => (
                  <li key={r.link_id} className="flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
                    <div className="min-w-0 flex-1 basis-[14rem]">
                      <Link href={`/erm/risks/${r.risk_id}`} className="block text-ds-body font-[600] text-ds-primary-text hover:underline [overflow-wrap:anywhere]">{r.title}</Link>
                      <Small>{`Inherent ${r.inherent_score ?? '—'} · Residual ${r.residual_score ?? '—'}${r.owner_name ? ` · ${r.owner_name}` : ''}`}</Small>
                    </div>
                    {neutral(r.status)}
                    <IconButton label={`Unlink ${r.title}`} disabled={!rights.riskLink} onClick={() => { void ask(r); }}><Unlink aria-hidden strokeWidth={1.75} /></IconButton>
                  </li>
                ))}
              </ul>
            )}
            <Small>Linking a risk does not change its residual score.</Small>
            <LinkSheet open={picking} onClose={() => setPicking(false)} title="Link a risk" types={[{ key: 'risk', label: 'Risks' }]} linkedIds={linked} pendingId={link.isPending && link.variables ? `risk:${link.variables.id}` : null} onPick={(row) => link.mutate(row, { onSuccess: () => setPicking(false) })} />
            <Sheet open={raising} onClose={() => setRaising(false)} title="Raise a new risk" subtitle="It is created in the risk register and linked to this control." width="md" dirty={title.trim() !== ''}>
              <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (title.trim()) raise.mutate(); }}>
                <FormField label="Title" required><TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} /></FormField>
                <div className="grid grid-cols-2 gap-[12px]">
                  <FormField label="Likelihood (1 to 5)" optional><Select value={likelihood} onChange={(e) => setLikelihood(e.target.value)} placeholder="Not rated">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></FormField>
                  <FormField label="Impact (1 to 5)" optional><Select value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="Not rated">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></FormField>
                </div>
                <div className="flex gap-[8px]"><Button type="submit" variant="primary" loading={raise.isPending} disabled={!title.trim()}>Create and link</Button><Button onClick={() => setRaising(false)}>Cancel</Button></div>
              </form>
            </Sheet>
            {confirmDialog}
          </div>
        );
      }}
    </Loaded>
  );
}

// ── assets ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function AssetsSection() {
  const { code, rights, why, refresh } = useWorkspace();
  const { confirm, confirmDialog } = useConfirm();
  const q = useQuery({ queryKey: ['control-assets', code], queryFn: async () => (await automationApi.listControlAssets(code)).data as { items: LinkedAsset[]; in_scope?: InScopeAsset[] } });
  const [picking, setPicking] = useState(false);
  const link = useReportedMutation({ mutationFn: (assetId: number) => automationApi.linkControlAsset(code, assetId), success: 'Asset linked', failure: "Couldn't link the asset", onSuccess: () => { void refresh(); } });
  const unlink = useReportedMutation({ mutationFn: (a: LinkedAsset) => automationApi.unlinkControlAsset(code, a.link_id), success: 'Asset unlinked', failure: "Couldn't unlink the asset", onSuccess: () => { void refresh(); } });
  const ask = async (a: LinkedAsset) => { if (await confirm({ title: 'Unlink this asset?', message: `“${a.name}” stays in the asset inventory; it is only taken off this control.`, confirmLabel: 'Unlink', tone: 'danger' })) unlink.mutate(a); };
  return (
    <Loaded q={q} what="the assets" rows={3}>
      {(data) => {
        const items = data.items ?? [];
        const have = new Set(items.map((i) => i.asset_id));
        const linked = new Set(items.map((i) => `asset:${i.asset_id}`));
        const suggested = (data.in_scope ?? []).filter((a) => !have.has(a.asset_id));
        return (
          <div className="flex flex-col gap-[10px]">
            <div><Button variant="primary" leftIcon={<Server aria-hidden />} disabled={!rights.assetLink} title={why('assetLink')} onClick={() => setPicking(true)}>Link an asset</Button></div>
            {items.length === 0 ? <EmptyState kind="firstUse" bare title="No assets linked yet" description="Link the systems and data this control protects." /> : (
              <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                {items.map((a) => (
                  <li key={a.link_id} className="flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
                    <div className="min-w-0 flex-1 basis-[14rem]">
                      <Link href={`/assets?asset=${a.asset_id}`} className="block text-ds-body font-[600] text-ds-primary-text hover:underline [overflow-wrap:anywhere]">{a.name}</Link>
                      <Small>{a.asset_type ? statusLabel(a.asset_type) : 'Asset'}</Small>
                    </div>
                    <StatusPill size="sm" {...statusPill(controlStatus, a.check_status === 'passed' || a.check_status === 'failed' || a.check_status === 'partial' ? a.check_status : 'not_run')} />
                    <IconButton label={`Unlink ${a.name}`} disabled={!rights.assetLink} onClick={() => { void ask(a); }}><Unlink aria-hidden strokeWidth={1.75} /></IconButton>
                  </li>
                ))}
              </ul>
            )}
            {suggested.length > 0 && (
              <section aria-label="Assets in scope" className="flex flex-col gap-[6px]">
                <p className="text-ds-body font-[600] text-ds-fg">{`In scope and not linked (${suggested.length})`}</p>
                <Small>Assets whose compliance scope overlaps your frameworks, and assets not yet tagged.</Small>
                <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                  {suggested.slice(0, 10).map((a) => (
                    <li key={a.asset_id} className="flex items-center gap-[8px] px-[12px] py-[6px]">
                      <div className="min-w-0 flex-1"><p className="truncate text-ds-body text-ds-fg" title={a.name}>{a.name}</p><Small>{[a.asset_type, a.criticality].filter(Boolean).map((x) => statusLabel(x as string)).join(' · ') || 'Asset'}</Small></div>
                      <Button size="sm" disabled={!rights.assetLink || link.isPending} title={why('assetLink')} onClick={() => link.mutate(a.asset_id)}>Link</Button>
                    </li>
                  ))}
                </ul>
                {suggested.length > 10 && <Small>{`And ${suggested.length - 10} more. Use Link an asset to search them all.`}</Small>}
              </section>
            )}
            <LinkSheet open={picking} onClose={() => setPicking(false)} title="Link an asset" types={[{ key: 'asset', label: 'Assets' }]} linkedIds={linked} pendingId={link.isPending ? `asset:${link.variables}` : null} onPick={(row) => link.mutate(row.id, { onSuccess: () => setPicking(false) })} />
            {confirmDialog}
          </div>
        );
      }}
    </Loaded>
  );
}

// ── other records ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function RecordsSection() {
  const { code, refresh } = useWorkspace();
  const { confirm, confirmDialog } = useConfirm();
  const links = useQuery({ queryKey: ['control-links', code], queryFn: async () => (await automationApi.listControlLinks(code)).data.items });
  const types = useQuery({ queryKey: ['control-link-types'], staleTime: 60 * 60_000, queryFn: async () => (await automationApi.listLinkTypes()).data.types });
  const [picking, setPicking] = useState(false);
  const link = useReportedMutation({ mutationFn: (row: ControlRecordLink) => automationApi.linkControlRecord(code, { type: row.type, record_id: row.id }), success: (_d, row) => `${row.type_label} linked`, failure: "Couldn't save the link", onSuccess: () => { void refresh(); } });
  const unlink = useReportedMutation({ mutationFn: (row: ControlRecordLink) => automationApi.unlinkControlRecord(code, row.type, row.id), success: (_d, row) => `${row.type_label} unlinked`, failure: "Couldn't remove the link", onSuccess: () => { void refresh(); } });
  const own = useMemo(() => (links.data ?? []).filter((r) => r.type !== 'risk' && r.type !== 'asset'), [links.data]);
  const order = (types.data ?? []).map((t) => t.key);
  const groups = useMemo(() => {
    const by = new Map<string, ControlRecordLink[]>();
    own.forEach((r) => by.set(r.type, [...(by.get(r.type) ?? []), r]));
    const keys = Array.from(by.keys()).sort((a, b) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)));
    return keys.map((k) => ({ key: k, label: types.data?.find((t) => t.key === k)?.plural || statusLabel(k), rows: by.get(k) as ControlRecordLink[] }));
  }, [own, order, types.data]);
  const linkTypes = (types.data ?? []).filter((t) => t.key !== 'risk' && t.key !== 'asset').map((t) => ({ key: t.key, label: t.plural }));
  const ask = async (row: ControlRecordLink) => { if (await confirm({ title: 'Remove this link?', message: `“${row.label}” stays where it is; it is only taken off this control.`, confirmLabel: 'Remove the link', tone: 'danger' })) unlink.mutate(row); };
  return (
    <Loaded q={links} what="the linked records" rows={3}>
      {() => (
        <div className="flex flex-col gap-[10px]">
          <div><Button variant="primary" leftIcon={<Link2 aria-hidden />} disabled={linkTypes.length === 0} onClick={() => setPicking(true)}>Link a record</Button></div>
          {groups.length === 0 ? <EmptyState kind="firstUse" bare title="Nothing else linked yet" description="Attach the documents that define this control, the vendors it covers, the issues it failed." /> : groups.map((g) => (
            <section key={g.key} aria-label={g.label} className="flex flex-col gap-[4px]">
              <p className="text-ds-label font-[600] text-ds-fg-muted">{`${g.label} · ${g.rows.length}`}</p>
              <ul className="divide-y divide-ds-border rounded-ds-card border border-ds-border bg-ds-surface">
                {g.rows.map((row) => (
                  <li key={`${row.type}:${row.id}`} className="flex flex-wrap items-center gap-[8px] px-[12px] py-[8px]">
                    <div className="min-w-0 flex-1 basis-[14rem]">
                      <Link href={row.url} className="block text-ds-body font-[600] text-ds-primary-text hover:underline [overflow-wrap:anywhere]">{row.code ? <span className="mr-[6px] font-mono text-ds-label text-ds-fg-muted">{row.code}</span> : null}{row.label}</Link>
                      {row.subtitle && <Small>{statusLabel(row.subtitle)}</Small>}
                    </div>
                    {row.status && neutral(row.status)}
                    <IconButton label={`Unlink ${row.label}`} onClick={() => { void ask(row); }}><Unlink aria-hidden strokeWidth={1.75} /></IconButton>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <LinkSheet open={picking} onClose={() => setPicking(false)} title="Link a record" types={linkTypes} linkedIds={new Set(own.map((r) => `${r.type}:${r.id}`))} pendingId={link.isPending && link.variables ? `${link.variables.type}:${link.variables.id}` : null} onPick={(row) => link.mutate(row)} hint="Search any module and attach what this control relies on." />
          {confirmDialog}
        </div>
      )}
    </Loaded>
  );
}
