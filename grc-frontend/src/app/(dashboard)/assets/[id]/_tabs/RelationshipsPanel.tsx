'use client';

/**
 * RelationshipsPanel — asset-detail "Relationships" tab, restyled to match
 * the approved mock (asset-record-mocks/Relationships.html — mint-teal
 * design language). Reproduces the mock's two content pieces: the inline-SVG
 * hub relationship graph and the relationships table with its add-form. The
 * graph is driven by the real relationship list (not the mock's hardcoded
 * nodes) via a small generic box-docking helper, so it works for any count.
 *
 * The co-located-assets and topology-pointers sections aren't in this mock
 * but carry real data the app already surfaces, so they're kept and given
 * the same mint-teal treatment rather than dropped.
 *
 * PRESENTATION ONLY — every data source/behavior is unchanged from before:
 *   • react-query keys  ['asset-relationships', assetId],
 *                       ['asset-relationship-types'],
 *                       ['all-assets-for-relationships']
 *   • mutations         entityExtrasApi.createRelationship / deleteRelationship
 *   • cache invalidation ['asset-relationships', id] + ['asset-detail', id]
 *   • derived neighbours from the `ipPeers` prop (co-located assets)
 *   • legacy scalar pointers off the `asset` prop
 *   • all six GuideMarkers, both empty-states, the add form and the remove action.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, X, ExternalLink } from 'lucide-react';
import { assetsApi, entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

/* ─── scoped styles — mint-teal tokens ported from the Relationships mock,
       trimmed to the content column (no topbar/rail/tabbar). ──────────────── */
const STYLE = `
.relpanel{
  --ac:#17B898; --ac-strong:#12A085; --ac-soft:#E4F8F2;
  --blue:#2E63A8; --blue-bg:#E9F1FB; --violet:#6A54C9; --violet-bg:#EEEBFA;
  --red:#B23A3A; --red-bg:#FBEAEA; --amber:#9A6410; --amber-bg:#FBF2DF;
  --green:#1F7A54; --green-bg:#E7F5EE;
  --ink:#0F1F2B; --sec:#3A4653; --muted:#8A95A1; --faint:#AEB8C2;
  --bg:#F4F6F7; --card:#fff; --border:#E8ECEE; --border2:#F0F3F5;
  font-family:'Poppins',system-ui,-apple-system,'Segoe UI',sans-serif;
  font-size:13.5px; line-height:1.5; color:var(--ink);
  display:flex; flex-direction:column; gap:14px;
}
.relpanel *{box-sizing:border-box}
.relpanel a{color:var(--ac-strong);text-decoration:none}
.relpanel .card{background:var(--card);border:1px solid var(--border);border-radius:15px;box-shadow:0 1px 2px rgba(16,24,40,.04)}
.relpanel .ch{display:flex;align-items:center;gap:9px;padding:13px 16px;border-bottom:1px solid var(--border2)}
.relpanel .ch h4{font-size:12.5px;flex:1;font-weight:600;margin:0}
.relpanel .chip{display:inline-flex;align-items:center;gap:5px;border-radius:6px;padding:2px 8px;font-size:10.5px;font-weight:600;white-space:nowrap}
.relpanel .mono{font-family:ui-monospace,Consolas,monospace}
.relpanel .btn{height:32px;padding:0 13px;border-radius:9px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid transparent;display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.relpanel .btn-primary{background:var(--ac);border-color:var(--ac);color:#06342B}
.relpanel .btn-primary:hover{background:var(--ac-strong);border-color:var(--ac-strong)}
.relpanel .btn-primary[disabled]{opacity:.45;cursor:not-allowed}
.relpanel .btn-secondary{background:#fff;border-color:var(--border);color:var(--sec)}
.relpanel .btn-secondary:hover{border-color:#CFD6DC}
.relpanel .graphcard svg text{font-family:'Poppins',system-ui,sans-serif}
.relpanel .node-box{fill:#fff;stroke:var(--border);stroke-width:1}
.relpanel .node-box.center{fill:var(--ac-soft);stroke:var(--ac);stroke-width:2}
.relpanel .icon-tile{fill:#F1F4F6}
.relpanel .icon-tile.center{fill:#fff}
.relpanel .node-title{font-size:12px;font-weight:600;fill:var(--ink)}
.relpanel .node-title.center{font-size:11px;font-weight:700}
.relpanel .node-sub{font-size:9.5px;fill:var(--muted)}
.relpanel .node-sub.center{font-size:8.5px;font-weight:700;letter-spacing:.05em;fill:var(--ac-strong)}
.relpanel .edge-blue{stroke:var(--blue)}
.relpanel .edge-violet{stroke:var(--violet)}
.relpanel .edge-green{stroke:var(--green)}
.relpanel .edge-amber{stroke:var(--amber)}
.relpanel .edge-red{stroke:var(--red)}
.relpanel .arrow-blue{fill:var(--blue)}
.relpanel .arrow-violet{fill:var(--violet)}
.relpanel .arrow-green{fill:var(--green)}
.relpanel .arrow-amber{fill:var(--amber)}
.relpanel .arrow-red{fill:var(--red)}
.relpanel .pill-blue{fill:#fff;stroke:var(--blue)}
.relpanel .pill-violet{fill:#fff;stroke:var(--violet)}
.relpanel .pill-green{fill:#fff;stroke:var(--green)}
.relpanel .pill-amber{fill:#fff;stroke:var(--amber)}
.relpanel .pill-red{fill:#fff;stroke:var(--red)}
.relpanel .label-blue{fill:var(--blue)}
.relpanel .label-violet{fill:var(--violet)}
.relpanel .label-green{fill:var(--green)}
.relpanel .label-amber{fill:var(--amber)}
.relpanel .label-red{fill:var(--red)}
.relpanel .edge-label{font-size:9px;font-weight:700;letter-spacing:.03em;text-transform:uppercase}
.relpanel .addform{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:12px;border:1px solid var(--border);border-radius:10px;background:#FAFBFC;margin-bottom:14px}
.relpanel .sel{height:32px;border:1px solid var(--border);border-radius:8px;padding:0 9px;font-size:12px;background:#fff}
.relpanel .reltable{width:100%;border-collapse:collapse}
.relpanel .reltable th{text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);padding:0 10px 8px}
.relpanel .reltable td{padding:11px 10px;font-size:12px;border-top:1px solid var(--border2);vertical-align:middle}
.relpanel .rmbtn{width:24px;height:24px;border:1px solid var(--border);border-radius:7px;background:#fff;color:var(--faint);cursor:pointer;display:grid;place-items:center;line-height:1}
.relpanel .rmbtn:hover{border-color:var(--red);color:var(--red)}
`;

/* ─── direction-aware relationship phrasing (verbatim from before) ─────────── */

const REL_LABEL: Record<string, [string, string]> = {
  depends_on:    ['depends on', 'is depended on by'],
  hosts:         ['hosts', 'is hosted by'],
  runs_on:       ['runs on', 'runs'],
  connects_to:   ['connects to', 'is connected to by'],
  backs_up:      ['backs up', 'is backed up by'],
  replicates_to: ['replicates to', 'receives replication from'],
  member_of:     ['is a member of', 'has member'],
  subdomain_of:  ['is a subdomain of', 'has subdomain'],
};
const relPhrase = (type: string, dir: 'outgoing' | 'incoming') => {
  const pair = REL_LABEL[type] ?? [type.replace(/_/g, ' '), `is ${type.replace(/_/g, ' ')} by`];
  return dir === 'outgoing' ? pair[0] : pair[1];
};

/* ─── relationship type / criticality → accent color, keyed off real fields ── */

type Tone = 'blue' | 'violet' | 'green' | 'amber' | 'red';
const REL_TONE: Record<string, Tone> = {
  depends_on: 'blue', runs_on: 'blue',
  connects_to: 'violet', member_of: 'violet', subdomain_of: 'violet',
  hosts: 'green',
  backs_up: 'amber', replicates_to: 'amber',
};
const CRIT_TONE: Record<string, Tone> = { critical: 'red', high: 'amber', medium: 'blue', low: 'green' };
const MARKER: Record<Tone, string> = { blue: 'arrB', violet: 'arrV', green: 'arrG', amber: 'arrA', red: 'arrR' };
const TONES: Tone[] = ['blue', 'violet', 'green', 'amber', 'red'];
const tone = (t: Tone) => ({ background: `var(--${t}-bg)`, color: `var(--${t})` });
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* ─── hub-graph geometry: dock a line onto an axis-aligned box's border,
       pointed at another point — generic so it works for any relationship
       count, not just the mock's fixed 3. ──────────────────────────────── */

function dockPoint(cx: number, cy: number, w: number, h: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx, dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(dx ? Math.abs(w / 2 / dx) : Infinity, dy ? Math.abs(h / 2 / dy) : Infinity);
  return [cx + dx * s, cy + dy * s];
}
function nodeLayout(x: number, y: number, w: number, h: number, tile: number) {
  const tileX = x + 10, tileY = y + (h - tile) / 2, textX = tileX + tile + 8;
  return { tileX, tileY, textX, titleY: y + h / 2 - 4, subY: y + h / 2 + 10, letterX: tileX + tile / 2, letterY: tileY + tile / 2 + 4 };
}

const CENTER = { x: 320, y: 101, w: 160, h: 58 };
const NODE_W = 150, NODE_H = 56;
// Fill order reproduces the mock's own 3-node layout (top-left, top-right,
// bottom-center) for the common case, then grows to a symmetric 6-node ring.
const SLOTS: Array<[number, number]> = [[50, 16], [600, 16], [325, 188], [50, 188], [600, 188], [325, 16]];

/* ─── small presentational primitives ───────────────────────────────────── */

function Card({ children }: { children: React.ReactNode }) {
  return <div className="card">{children}</div>;
}
function Head({ title, right }: { title: string; right?: React.ReactNode }) {
  return <div className="ch"><h4>{title}</h4>{right}</div>;
}
function Count({ n }: { n: number }) {
  return <span className="chip" style={{ background: '#EEF1F3', color: '#6B7787' }}>{n}</span>;
}
function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '22px 16px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--bg)' }}>
      <div style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className={mono && !empty ? 'mono' : ''} style={{ marginTop: 4, fontSize: 12.5, fontWeight: 500, color: empty ? 'var(--faint)' : 'var(--ink)', overflowWrap: 'anywhere' }}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}
function LinkRow({ href, children, right }: { href: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Link href={href} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--border2)', borderRadius: 10, background: 'var(--bg)', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
      {children}
      {right && <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</span>}
    </Link>
  );
}

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
  const subdomains = items.filter((r: any) => r.relationship_type === 'subdomain_of' && r.direction === 'incoming');
  const parentDomain = items.find((r: any) => r.relationship_type === 'subdomain_of' && r.direction === 'outgoing');
  const candidates: any[] = ((Array.isArray(allAssets.data) ? allAssets.data : allAssets.data?.items ?? []) as any[])
    .filter((a: any) => a.id !== assetId)
    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));
  const graphItems = items.slice(0, 6);

  return (
    <div className="relpanel">
      <style>{STYLE}</style>

      {(subdomains.length > 0 || parentDomain) && (
        <Card>
          <Head title="DNS subdomains" />
          <div style={{ padding: '12px 16px 16px' }}>
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '-2px 0 12px' }}>
              {parentDomain ? `This name sits under ${parentDomain.other_asset_name || 'its apex'}.` : 'Names discovered under this apex — each is its own asset. Shared IP is noted in the inventory.'}
            </p>
            {parentDomain && (
              <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 8 }}>
                Subdomain of <b style={{ fontWeight: 600, color: 'var(--ink)' }}>{parentDomain.other_asset_name || 'apex'}</b>
              </div>
            )}
            {subdomains.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {subdomains.map((r: any) => (
                  <LinkRow key={r.id} href={`/assets/${r.other_asset_id}`}>↳ {r.other_asset_name || `Asset #${r.other_asset_id}`}</LinkRow>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ===== relationship graph ===== */}
      {graphItems.length > 0 && (
        <Card>
          <div className="graphcard">
            <Head title="Relationship graph" />
            <div style={{ padding: '16px 18px 18px' }}>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '-2px 0 12px' }}>
                What this asset connects to, depends on, or hosts — and what connects to, depends on, or hosts it. Arrow direction shows which way each relationship runs.
              </p>
              <svg viewBox="0 0 800 260" style={{ width: '100%', height: 'auto', display: 'block' }} xmlns="http://www.w3.org/2000/svg">
                <defs>
                  {TONES.map((t) => (
                    <marker key={t} id={MARKER[t]} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path className={`arrow-${t}`} d="M0,0 L8,4 L0,8 Z" />
                    </marker>
                  ))}
                </defs>

                {graphItems.map((r: any, i: number) => {
                  const [bx, by] = SLOTS[i];
                  const outgoing = r.direction !== 'incoming';
                  const nx = bx + NODE_W / 2, ny = by + NODE_H / 2;
                  const ccx = CENTER.x + CENTER.w / 2, ccy = CENTER.y + CENTER.h / 2;
                  const a = dockPoint(ccx, ccy, CENTER.w, CENTER.h, nx, ny);
                  const b = dockPoint(nx, ny, NODE_W, NODE_H, ccx, ccy);
                  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
                  const pull = 6 / len;
                  const arrowEnd: [number, number] = outgoing ? [b[0] - dx * pull, b[1] - dy * pull] : [a[0] + dx * pull, a[1] + dy * pull];
                  const arrowStart: [number, number] = outgoing ? a : b;
                  const rt = REL_TONE[r.relationship_type] ?? 'blue';
                  const label = relPhrase(r.relationship_type, r.direction);
                  const midX = (arrowStart[0] + arrowEnd[0]) / 2, midY = (arrowStart[1] + arrowEnd[1]) / 2;
                  const pillW = Math.max(46, 16 + label.length * 6.2);
                  return (
                    <g key={r.id}>
                      <line x1={arrowStart[0]} y1={arrowStart[1]} x2={arrowEnd[0]} y2={arrowEnd[1]} className={`edge-${rt}`} strokeWidth={1.75} markerEnd={`url(#${MARKER[rt]})`} />
                      <rect className={`pill-${rt}`} x={midX - pillW / 2} y={midY - 10} width={pillW} height={20} rx={10} />
                      <text className={`edge-label label-${rt}`} x={midX} y={midY + 4} textAnchor="middle">{label}</text>
                    </g>
                  );
                })}

                {(() => {
                  const c = nodeLayout(CENTER.x, CENTER.y, CENTER.w, CENTER.h, 30);
                  const initial = (asset.name || 'A').charAt(0).toUpperCase();
                  return (
                    <g>
                      <rect className="node-box center" x={CENTER.x} y={CENTER.y} width={CENTER.w} height={CENTER.h} rx={14} />
                      <rect className="icon-tile center" x={c.tileX} y={c.tileY} width={30} height={30} rx={9} />
                      <text x={c.letterX} y={c.letterY} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--ac-strong)' }}>{initial}</text>
                      <text className="node-title center" x={c.textX} y={c.titleY}>{asset.name}</text>
                      <text className="node-sub center" x={c.textX} y={c.subY}>THIS ASSET</text>
                    </g>
                  );
                })()}

                {graphItems.map((r: any, i: number) => {
                  const [bx, by] = SLOTS[i];
                  const n = nodeLayout(bx, by, NODE_W, NODE_H, 28);
                  const name = r.other_asset_name || `Asset #${r.other_asset_id}`;
                  const sub = r.other_asset_criticality ? `${cap(r.other_asset_criticality)} criticality` : (r.direction === 'incoming' ? 'Inbound' : 'Outbound');
                  return (
                    <g key={r.id}>
                      <rect className="node-box" x={bx} y={by} width={NODE_W} height={NODE_H} rx={12} />
                      <rect className="icon-tile" x={n.tileX} y={n.tileY} width={28} height={28} rx={8} />
                      <text x={n.letterX} y={n.letterY} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700, fill: 'var(--sec)' }}>{name.charAt(0).toUpperCase()}</text>
                      <text className="node-title" x={n.textX} y={n.titleY}>{name}</text>
                      <text className="node-sub" x={n.textX} y={n.subY}>{sub}</text>
                    </g>
                  );
                })}
              </svg>
              {items.length > graphItems.length && (
                <p style={{ fontSize: 11, color: 'var(--faint)', margin: '10px 0 0' }}>+{items.length - graphItems.length} more in the table below.</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ===== relationships table ===== */}
      <Card>
        <Head
          title="All relationships"
          right={<>
            <Count n={items.length} />
            <GuideMarker id="asset.relWhy" n={1} />
            {canEdit && (
              <button className="btn btn-primary" onClick={() => setAdding(!adding)}>
                <Plus size={11} strokeWidth={2.5} />Add relationship
              </button>
            )}
          </>}
        />
        <div style={{ padding: '14px 16px 16px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '-2px 0 12px' }}>
            Typed dependencies between this asset and others — what it needs, and what needs it.
          </p>

          {adding && (
            <div className="addform">
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{asset.name}</span>
              <select className="sel" value={relType} onChange={(e) => setRelType(e.target.value)}>
                {(types.data ?? ['depends_on']).map((t) => (
                  <option key={t} value={t}>{relPhrase(t, 'outgoing')}</option>
                ))}
              </select>
              <GuideMarker id="asset.relTypes" n={2} />
              <select className="sel" style={{ minWidth: 190 }} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                <option value="">Select target asset…</option>
                {candidates.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button className="btn btn-primary" disabled={!targetId || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? 'Adding…' : 'Add'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setAdding(false); setTargetId(''); }}>Cancel</button>
              {create.isError && <span style={{ fontSize: 12, color: 'var(--red)' }}>Could not add — it may already exist.</span>}
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
            <>
              {guideEnabled && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <GuideMarker id="asset.relFeedsBlastRadius" n={3} />
                  <GuideMarker id="asset.relFeedsLateralMovement" n={4} />
                </div>
              )}
              <div style={{ overflowX: 'auto' }}>
                <table className="reltable">
                  <colgroup><col style={{ width: '32%' }} /><col style={{ width: '18%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: 40 }} /></colgroup>
                  <thead>
                    <tr><th>Target asset</th><th>Type</th><th>Direction</th><th>Criticality</th><th /></tr>
                  </thead>
                  <tbody>
                    {items.map((r: any) => (
                      <tr key={r.id}>
                        <td>
                          <Link href={`/assets/${r.other_asset_id}`} style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.other_asset_name ?? `Asset #${r.other_asset_id}`}</Link>
                          <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>#{r.other_asset_id}</div>
                        </td>
                        <td><span className="chip" style={tone(REL_TONE[r.relationship_type] ?? 'blue')}>{relPhrase(r.relationship_type, r.direction)}</span></td>
                        <td style={{ color: 'var(--muted)' }}>{r.direction === 'incoming' ? 'Inbound ↙' : 'Outbound ↗'}</td>
                        <td>{r.other_asset_criticality ? <span className="chip" style={tone(CRIT_TONE[r.other_asset_criticality.toLowerCase()] ?? 'blue')}>{cap(r.other_asset_criticality)}</span> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                        <td style={{ textAlign: 'right' }}>
                          {canEdit && (
                            <button className="rmbtn" title="Remove relationship" onClick={() => remove.mutate(r.id)}>
                              <X size={12} />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ===== co-located assets (inferred from shared IP) ===== */}
      <Card>
        <Head title="Co-located assets" right={<><Count n={peers.length} /><GuideMarker id="asset.relLoopbackExcluded" n={5} /></>} />
        <div style={{ padding: '14px 16px 16px' }}>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '-2px 0 12px' }}>Inferred from a shared IP address — not a declared relationship.</p>
          {peers.length === 0 ? (
            <Empty text="No co-located assets." hint="Nothing else in the register shares this asset's IP address." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {peers.map((p: any) => (
                <LinkRow key={p.id} href={`/assets/${p.id}`} right={<>
                  {p.score != null && <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: p.score >= 80 ? 'var(--green)' : p.score >= 55 ? 'var(--amber)' : 'var(--red)' }}>{p.score.toFixed(1)}%</span>}
                  <ExternalLink size={12} style={{ color: 'var(--faint)' }} />
                </>}>
                  {p.name ?? `Asset #${p.id}`}
                </LinkRow>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* ===== legacy scalar pointers ===== */}
      <Card>
        <Head title="Topology pointers" />
        <div style={{ padding: '14px 16px 18px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px 18px' }}>
          <Field label="Parent asset" value={asset.parent_asset_id ? `#${asset.parent_asset_id}` : null} mono />
          <Field label="Replacement asset" value={asset.replacement_asset_name ?? (asset.replacement_asset_id ? `#${asset.replacement_asset_id}` : null)} />
          <Field label="Network segment" value={asset.network_segment} />
        </div>
      </Card>

    </div>
  );
}
