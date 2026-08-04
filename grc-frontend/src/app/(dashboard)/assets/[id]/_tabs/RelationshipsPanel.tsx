'use client';

/**
 * RelationshipsPanel — asset-detail "Relationships" tab, restyled to the
 * delivered AssetOverview design language (see ../_overview-design.tsx and the
 * DField / SpecTile / OverviewCard primitives in ../page.tsx).
 *
 * PRESENTATION ONLY. Every data source and capability is carried over verbatim
 * from the previous implementation in ../_components/AssetWorkTabs.tsx:
 *   • react-query keys  ['asset-relationships', assetId],
 *                       ['asset-relationship-types'],
 *                       ['all-assets-for-relationships']
 *   • mutations         entityExtrasApi.createRelationship / deleteRelationship
 *   • cache invalidation ['asset-relationships', id] + ['asset-detail', id]
 *   • derived neighbours from the `ipPeers` prop (co-located assets)
 *   • legacy scalar pointers off the `asset` prop
 *   • all five GuideMarkers, both empty-states, the add form and the remove action.
 * Nothing here fetches or mutates differently — only the markup/tokens changed.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Network, GitBranch, Plus, X, ExternalLink } from 'lucide-react';
import { assetsApi, entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

/* ─── local primitives, replicated from ../page.tsx (DField/OverviewCard) and
       ../_components/AssetWorkTabs.tsx (Empty). Those are module-local there,
       so they are mirrored here rather than imported. ─────────────────────── */

const GRID3: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: '16px 20px',
};

/** Card shell — matches OverviewCard: white surface, 1px border, 12px radius. */
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="as-card" style={{ padding: '20px 22px', ...style }}>
      {children}
    </div>
  );
}

/** Card header: green icon + stacked title/subtitle on the left, actions right. */
function CardHead({ icon: Icon, title, note, right }: { icon: any; title: string; note?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 9, minWidth: 0 }}>
        <Icon className="h-[18px] w-[18px]" strokeWidth={2} style={{ color: 'var(--as-green)', marginTop: 1, flex: 'none' }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-ink)' }}>{title}</div>
          {note && <div style={{ fontSize: 12, color: 'var(--as-faint)', marginTop: 2 }}>{note}</div>}
        </div>
      </div>
      {right && <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>{right}</div>}
    </div>
  );
}

/** Count pill, matching the original neutral track/muted pill. */
function CountPill({ n }: { n: number }) {
  return <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)' }}>{n}</span>;
}

/** DField — label over value; empty renders '—' in the disabled tone. */
function DField({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--as-muted)' }}>{label}</div>
      <div
        className={mono && !empty ? 'as-mono' : ''}
        style={{
          marginTop: 4, fontSize: mono ? 13 : 15, fontWeight: 500,
          color: empty ? 'var(--as-disabled)' : 'var(--as-primary)',
          minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word',
        }}
      >
        {empty ? '—' : value}
      </div>
    </div>
  );
}

/** SpecTile-style numeric tile: big mono number over a tiny uppercase label. */
function Tile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: 0, borderRadius: 10, border: '1px solid var(--as-border)', background: 'var(--as-subtle)', padding: '12px 8px', textAlign: 'center' }}>
      <div className="as-mono" style={{ fontSize: 20, fontWeight: 600, color: 'var(--as-ink)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--as-faint)', marginTop: 5 }}>{label}</div>
    </div>
  );
}

/** Dashed empty-state, matching AssetWorkTabs' Empty. */
function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '26px 18px', textAlign: 'center', border: '1px dashed var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)' }}>
      <div style={{ fontSize: 13.5, color: 'var(--as-muted)', fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 12.3, color: 'var(--as-faint)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

/* ─── direction-aware relationship phrasing (verbatim from AssetWorkTabs) ──── */

const REL_LABEL: Record<string, [string, string]> = {
  depends_on:    ['depends on', 'is depended on by'],
  hosts:         ['hosts', 'is hosted by'],
  runs_on:       ['runs on', 'runs'],
  connects_to:   ['connects to', 'is connected to by'],
  backs_up:      ['backs up', 'is backed up by'],
  replicates_to: ['replicates to', 'receives replication from'],
  member_of:     ['is a member of', 'has member'],
};
const relPhrase = (type: string, dir: 'outgoing' | 'incoming') => {
  const pair = REL_LABEL[type] ?? [type.replace(/_/g, ' '), `is ${type.replace(/_/g, ' ')} by`];
  return dir === 'outgoing' ? pair[0] : pair[1];
};

/* ─── props: identical to what the tab passes today ────────────────────────── */

export interface RelationshipsPanelProps {
  asset: any;
  assetId: number;
  ipPeers?: any;
  canEdit?: boolean;
}

export default function RelationshipsPanel({ asset, assetId, ipPeers, canEdit }: RelationshipsPanelProps) {
  const qc = useQueryClient();
  const { enabled: guideEnabled } = useGuide();
  const peers: any[] = (ipPeers?.group ?? []).filter((g: any) => !g.is_self);
  const [adding, setAdding] = useState(false);
  const [relType, setRelType] = useState('depends_on');
  const [targetId, setTargetId] = useState('');

  const rels = useQuery({
    queryKey: ['asset-relationships', assetId],
    queryFn: async () => (await entityExtrasApi.listRelationships(assetId)).data,
  });
  const types = useQuery({
    queryKey: ['asset-relationship-types'],
    queryFn: async () => (await entityExtrasApi.relationshipTypes()).data,
    staleTime: 60 * 60 * 1000,
  });
  const allAssets = useQuery({
    queryKey: ['all-assets-for-relationships'],
    queryFn: async () => (await assetsApi.getAll()).data as any,
    enabled: adding,
  });

  const done = () => {
    qc.invalidateQueries({ queryKey: ['asset-relationships', assetId] });
    qc.invalidateQueries({ queryKey: ['asset-detail', assetId] });
  };
  const create = useMutation({
    mutationFn: () => entityExtrasApi.createRelationship(assetId, {
      target_asset_id: Number(targetId), relationship_type: relType,
    }),
    onSuccess: () => { done(); setAdding(false); setTargetId(''); },
  });
  const remove = useMutation({
    mutationFn: (relId: number) => entityExtrasApi.deleteRelationship(assetId, relId),
    onSuccess: done,
  });

  const items = rels.data ?? [];
  const inbound = items.filter((r: any) => r.direction === 'incoming').length;
  const outbound = items.length - inbound;
  const candidates: any[] = ((Array.isArray(allAssets.data) ? allAssets.data : allAssets.data?.items ?? []) as any[])
    .filter((a: any) => a.id !== assetId)
    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Declared relationships ─────────────────────────────────────── */}
      <Card>
        <CardHead
          icon={Network}
          title="Relationships"
          note="Typed dependencies between this asset and others — what it needs, and what needs it."
          right={<>
            <CountPill n={items.length} />
            <GuideMarker id="asset.relWhy" n={1} />
            {canEdit && (
              <button className="as-btn as-btn-primary" onClick={() => setAdding(!adding)}>
                <Plus className="h-3 w-3" style={{ display: 'inline', verticalAlign: -1, marginRight: 4 }} />
                Add relationship
              </button>
            )}
          </>}
        />

        {adding && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, border: '1px solid var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)', marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-ink)' }}>{asset.name}</span>
            <select className="as-select" value={relType} onChange={(e) => setRelType(e.target.value)}>
              {(types.data ?? ['depends_on']).map((t) => (
                <option key={t} value={t}>{relPhrase(t, 'outgoing')}</option>
              ))}
            </select>
            <GuideMarker id="asset.relTypes" n={2} />
            <select className="as-select" value={targetId} onChange={(e) => setTargetId(e.target.value)} style={{ minWidth: 200 }}>
              <option value="">Select target asset…</option>
              {candidates.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button className="as-btn as-btn-primary" disabled={!targetId || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Adding…' : 'Add'}
            </button>
            <button className="as-btn as-btn-secondary" onClick={() => { setAdding(false); setTargetId(''); }}>Cancel</button>
            {create.isError && <span style={{ fontSize: 12, color: 'var(--as-danger)' }}>Could not add — it may already exist.</span>}
          </div>
        )}

        {/* Derived tiles — counts of the list above, not new data. */}
        {items.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <Tile label="Total" value={items.length} />
            <Tile label="Outbound" value={outbound} />
            <Tile label="Inbound" value={inbound} />
          </div>
        )}

        {rels.isLoading ? (
          <Empty text="Loading relationships…" />
        ) : items.length === 0 ? (
          <>
            <Empty text="No relationships mapped." hint="Add one to record what this asset depends on — it drives the blast radius on the finding's Exploit Test tab." />
            {guideEnabled && <div style={{ marginTop: 8 }}><GuideMarker id="asset.relEmptyState" n={3} /></div>}
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <GuideMarker id="asset.relFeedsBlastRadius" n={3} className="mb-1" />
            <GuideMarker id="asset.relFeedsLateralMovement" n={4} className="mb-1" />
            {items.map((r: any) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', border: '1px solid var(--as-divider)', borderRadius: 'var(--as-r-inner)', background: 'var(--as-subtle)' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--as-muted)', minWidth: 140 }}>{relPhrase(r.relationship_type, r.direction)}</span>
                <Link href={`/assets/${r.other_asset_id}`} style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--as-ink)', textDecoration: 'none' }}>
                  {r.other_asset_name ?? `Asset #${r.other_asset_id}`}
                </Link>
                {r.other_asset_criticality && (
                  <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)', textTransform: 'capitalize' }}>{r.other_asset_criticality}</span>
                )}
                {r.direction === 'incoming' && (
                  <span className="as-pill" style={{ background: 'var(--as-blue-bg)', color: 'var(--as-blue)' }}>inbound</span>
                )}
                {canEdit && (
                  <button onClick={() => remove.mutate(r.id)} title="Remove relationship"
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--as-faint)', padding: 4 }}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Co-located assets (inferred from shared IP) ─────────────────── */}
      <Card>
        <CardHead
          icon={Network}
          title="Co-located assets"
          note="Inferred from a shared IP address — not a declared relationship."
          right={<>
            <CountPill n={peers.length} />
            <GuideMarker id="asset.relLoopbackExcluded" n={5} />
          </>}
        />
        {peers.length === 0 ? (
          <Empty text="No co-located assets." hint="Nothing else in the register shares this asset's IP address." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {peers.map((p: any) => (
              <Link key={p.id} href={`/assets/${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', border: '1px solid var(--as-divider)', borderRadius: 'var(--as-r-inner)', background: 'var(--as-subtle)', textDecoration: 'none' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--as-ink)' }}>{p.name ?? `Asset #${p.id}`}</span>
                {p.score != null && (
                  <span className="as-mono" style={{ marginLeft: 'auto', fontSize: 12, color: p.score >= 80 ? 'var(--as-good)' : p.score >= 55 ? 'var(--as-warn)' : 'var(--as-danger)', fontWeight: 600 }}>{p.score.toFixed(1)}%</span>
                )}
                <ExternalLink className="h-3.5 w-3.5" style={{ color: 'var(--as-faint)', flex: 'none', marginLeft: p.score != null ? 0 : 'auto' }} />
              </Link>
            ))}
          </div>
        )}
      </Card>

      {/* ── Legacy scalar pointers ──────────────────────────────────────── */}
      <Card>
        <CardHead
          icon={GitBranch}
          title="Topology pointers"
          note="Single-value links recorded directly on the asset row."
        />
        <div style={GRID3}>
          <DField label="Parent asset" value={asset.parent_asset_id ? `#${asset.parent_asset_id}` : null} mono />
          <DField label="Replacement asset" value={asset.replacement_asset_name ?? (asset.replacement_asset_id ? `#${asset.replacement_asset_id}` : null)} />
          <DField label="Network segment" value={asset.network_segment} />
        </div>
      </Card>

    </div>
  );
}
