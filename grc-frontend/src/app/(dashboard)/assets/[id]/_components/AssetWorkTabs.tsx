'use client';

/**
 * Asset-detail work tabs — Software, Relationships, Discovery, Lifecycle,
 * Assignments and Activity.
 *
 * These close the gap against the reference ITAM product's asset tab bar.
 * Every panel here reads an endpoint that ALREADY exists — nothing is
 * mocked. Where the backend genuinely has no storage (e.g. lifecycle
 * transition history), the panel says so explicitly rather than inventing
 * a timeline.
 *
 * Kept out of page.tsx deliberately: that file is already ~3.4k lines.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Package, Network, Radar, GitBranch, Users, Activity as ActivityIcon,
  ExternalLink, RefreshCw, AlertCircle, Plus, X, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { assetsApi, softwareIdentifiersApi, compliancePluginsApi, entityExtrasApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';

/* ─── shared bits ──────────────────────────────────────────────────── */

function PanelHead({ icon: Icon, title, note, right }: { icon: any; title: string; note?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <Icon className="h-4 w-4" strokeWidth={1.75} style={{ color: 'var(--as-green)', marginTop: 2, flex: 'none' }} />
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--as-ink)' }}>{title}</div>
          {note && <div style={{ fontSize: 12.5, color: 'var(--as-faint)', marginTop: 2 }}>{note}</div>}
        </div>
      </div>
      {right}
    </div>
  );
}

/** Endpoint security posture derived from the installed-software inventory:
    is there antivirus? an EDR? what categories of software run here? This is the
    answer to "we collected the software — where does the antivirus show". */
function SecurityPostureCard({ posture }: { posture: any }) {
  if (!posture) return null;
  const CAT_LABELS: Record<string, string> = {
    antivirus: 'Antivirus', edr: 'EDR / XDR', database: 'Databases',
    web_server: 'Web servers', backup: 'Backup', remote_access: 'Remote access',
    vpn: 'VPN', container: 'Containers', monitoring: 'Monitoring', application: 'Other apps',
  };
  const protectedHost = !!posture.endpoint_protected;
  const av: string[] = posture.antivirus_products ?? [];
  const edr: string[] = posture.edr_products ?? [];
  const cats: Record<string, number> = posture.categories ?? {};
  const catEntries = Object.entries(cats).sort((a, b) => (b[1] as number) - (a[1] as number));

  const Stat = ({ present, label, products }: { present: boolean; label: string; products: string[] }) => (
    <div style={{ flex: 1, minWidth: 160, padding: '12px 14px', border: '1px solid var(--as-border)', borderRadius: 10,
      background: present ? 'var(--as-good-bg)' : 'var(--as-warn-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        {present
          ? <ShieldCheck className="h-4 w-4" strokeWidth={2} style={{ color: '#0E5A46' }} />
          : <ShieldAlert className="h-4 w-4" strokeWidth={2} style={{ color: '#8A5A00' }} />}
        <span style={{ fontSize: 12.5, fontWeight: 700, color: present ? '#0E5A46' : '#6E5410' }}>
          {label}: {present ? 'Present' : 'Not detected'}
        </span>
      </div>
      {products.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--as-secondary)' }}>{products.join(', ')}</div>
      )}
    </div>
  );

  return (
    <div style={{ marginBottom: 20, padding: '16px 18px', border: '1px solid var(--as-border)', borderRadius: 12, background: 'var(--as-card)' }}>
      <PanelHead icon={protectedHost ? ShieldCheck : ShieldAlert} title="Security posture"
        note="Antivirus and EDR presence, inferred from the installed-software inventory." />
      {!protectedHost && (
        <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 8, background: 'var(--as-warn-bg)',
          color: '#6E5410', fontSize: 12.5, fontWeight: 600 }}>
          No antivirus or EDR detected on this host.
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Stat present={!!posture.has_antivirus} label="Antivirus" products={av} />
        <Stat present={!!posture.has_edr} label="EDR / XDR" products={edr} />
      </div>
      {catEntries.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--as-muted)', fontWeight: 600, marginBottom: 7 }}>
            What runs here
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {catEntries.map(([cat, n]) => (
              <span key={cat} className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-secondary)' }}>
                {CAT_LABELS[cat] ?? cat} · {n as number}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '26px 18px', textAlign: 'center', border: '1px dashed var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)' }}>
      <div style={{ fontSize: 13.5, color: 'var(--as-muted)', fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 12.3, color: 'var(--as-faint)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

/** Honest banner for things the backend cannot yet store. */
function NotStored({ what, why }: { what: string; why: string }) {
  return (
    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--as-warn-bg)', border: '1px solid #E4D3A0', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: '#6E5410', marginTop: 12 }}>
      <AlertCircle className="h-3.5 w-3.5" style={{ flex: 'none', marginTop: 1 }} />
      <span><b>{what}</b> {why}</span>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: React.ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === '' ;
  return (
    <div>
      <div className="as-label">{label}</div>
      <div className={mono && !empty ? 'as-mono' : ''} style={{ fontSize: 13.5, color: empty ? 'var(--as-disabled)' : 'var(--as-ink)', marginTop: 3 }}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}

const GRID3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '16px 20px' };

/* ─── 1. Software ──────────────────────────────────────────────────── */

export function SoftwarePanel({ assetId, canEdit, peers }: { assetId: number; canEdit?: boolean; peers?: any[] }) {
  const qc = useQueryClient();
  const { enabled: guideEnabled } = useGuide();
  const detected = useQuery({
    queryKey: ['asset-detected-software', assetId],
    queryFn: async () => (await assetsApi.getDetectedSoftware(assetId)).data as any,
  });
  const identifiers = useQuery({
    queryKey: ['asset-software-identifiers', assetId],
    queryFn: async () => (await softwareIdentifiersApi.list(assetId)).data,
  });

  // The endpoint returns { asset_id, inventory: [...] }. We were only looking
  // for `software`/`items`, so this tab reported "0 detected" on every asset
  // that actually had software. Real bug, not cosmetic.
  const items: any[] = Array.isArray(detected.data)
    ? detected.data
    : (detected.data?.inventory ?? detected.data?.software ?? detected.data?.items ?? []);
  const posture = Array.isArray(detected.data) ? null : (detected.data?.security_posture ?? null);
  const ids = identifiers.data ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['asset-software-identifiers', assetId] });
    qc.invalidateQueries({ queryKey: ['asset-detected-software', assetId] });
  };
  // Promote turns a detected service into its OWN asset (the "room and chair"
  // model: the host is the room, each service a chair). It does NOT create a
  // CPE identifier — that is a separate concept shown further down.
  const promote = useMutation({
    mutationFn: (key: string) => assetsApi.promoteSoftware(assetId, [key]),
    onSuccess: refresh,
  });
  const removeId = useMutation({
    mutationFn: (identifierId: number) => softwareIdentifiersApi.delete(assetId, identifierId),
    onSuccess: refresh,
  });

  /** Already promoted to its own asset? Detected by matching a co-located
      asset whose name carries this service name. */
  const promoted = (s: any) => {
    const name = String(s.name ?? s.product ?? '').toLowerCase();
    if (!name) return false;
    return (peers ?? []).some((p: any) => String(p.name ?? '').toLowerCase().includes(name));
  };

  return (
    <div>
      <PanelHead
        icon={Package}
        title="Installed software"
        note="Services found on this machine by the agent or agentless scan. Nothing is installed or changed — promoting only creates a separate asset record."
        right={<>
          <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)' }}>{items.length} detected</span>
          <GuideMarker id="asset.swIntro" n={1} />
        </>}
      />

      <SecurityPostureCard posture={posture} />

      {detected.isLoading ? <Empty text="Loading…" /> : items.length === 0 ? (
        <Empty text="No software recorded for this asset yet." hint="Software is captured during a CIS scan or an agent heartbeat. Run a scan from the Compliance tab to populate this." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Name', 'Version', 'Publisher', 'Source', 'Tracked separately', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '9px 12px', fontSize: 10.5, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--as-muted)', fontWeight: 600, background: 'var(--as-subtle)', borderBottom: '1px solid var(--as-border)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 200).map((s: any, i: number) => {
                const ok = promoted(s);
                const key = s.software_key ?? s.key ?? s.name ?? s.product;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid var(--as-row)' }}>
                    <td style={{ padding: '9px 12px', fontWeight: 600, color: 'var(--as-ink)' }}>{s.name ?? s.product ?? '—'}</td>
                    <td className="as-mono" style={{ padding: '9px 12px', fontSize: 12, color: 'var(--as-secondary)' }}>{s.version ?? '—'}</td>
                    <td style={{ padding: '9px 12px', color: 'var(--as-secondary)' }}>{s.publisher ?? s.vendor ?? '—'}</td>
                    <td style={{ padding: '9px 12px', color: 'var(--as-faint)', fontSize: 12.3 }}>{s.source ?? 'scan'}</td>
                    <td style={{ padding: '9px 12px' }}>
                      <span className="as-pill" style={ok
                        ? { background: 'var(--as-good-bg)', color: '#0E5A46' }
                        : { background: 'var(--as-warn-bg)', color: '#6E5410' }}>
                        {ok ? 'Own asset' : 'Part of host'}
                      </span>
                    </td>
                    <td style={{ padding: '9px 12px' }}>
                      {canEdit && !ok && key && (
                        <button
                          className="as-btn as-btn-secondary"
                          style={{ padding: '4px 9px', fontSize: 11.5 }}
                          disabled={promote.isPending}
                          onClick={() => promote.mutate(String(key))}
                          title="Create a separate asset for this service so it can be scanned and benchmarked on its own"
                        >
                          {promote.isPending ? 'Working…' : 'Promote to asset'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p style={{ marginTop: 10, fontSize: 11.5, color: 'var(--as-faint)' }}>
            "Part of host" means the service is inventoried against this machine. Promoting it creates a separate
            asset so it can carry its own benchmark and score. We do not track end-of-life dates per package, so no
            EOL flag is shown — that would be a guess.
            <GuideMarker id="asset.swPromote" n={2} className="ml-1.5" />
          </p>
        </div>
      )}

      {/* CPE/PURL identifiers — what vulnerability matching keys off */}
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--as-divider)' }}>
        <PanelHead
          icon={Package}
          title="Software identifiers"
          note="The CPE / PURL strings used to match this asset against vulnerability feeds."
          right={<GuideMarker id="asset.swCpe" n={3} />}
        />
        {ids.length === 0 ? (
          <Empty text="No identifiers recorded." hint="Promote a detected package to an identifier to make it vulnerability-matchable." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ids.map((x: any) => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--as-border)', borderRadius: 9, background: 'var(--as-card)' }}>
                <span className="as-pill" style={{ background: 'var(--as-blue-bg)', color: '#2E5EAA', textTransform: 'uppercase' }}>{x.identifier_type}</span>
                <span className="as-mono" style={{ fontSize: 12, color: 'var(--as-ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{x.identifier}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--as-faint)' }}>{x.source ?? '—'}</span>
                {canEdit && (
                  <button
                    onClick={() => removeId.mutate(x.id)}
                    title="Remove identifier — this package will stop being CVE-matchable"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--as-faint)', padding: 2 }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {guideEnabled && (
          <div style={{ marginTop: 10, display: 'flex', gap: 10, fontSize: 11.5, color: 'var(--as-faint)' }}>
            <span>How a CVE gets linked automatically: <GuideMarker id="asset.swMatching" n={4} className="mx-1" /> and why a precise version matters: <GuideMarker id="asset.swVersion" n={5} className="ml-1" /></span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 2. Relationships ─────────────────────────────────────────────── */

/** Direction-aware phrasing: "depends on X" vs "is depended on by X". */
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

export function RelationshipsPanel({ asset, assetId, ipPeers, canEdit }: {
  asset: any; assetId: number; ipPeers?: any; canEdit?: boolean;
}) {
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
  const candidates: any[] = ((Array.isArray(allAssets.data) ? allAssets.data : allAssets.data?.items ?? []) as any[])
    .filter((a: any) => a.id !== assetId)
    .sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''));

  return (
    <div>
      <PanelHead
        icon={Network}
        title="Relationships"
        note="Typed dependencies between this asset and others — what it needs, and what needs it."
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)' }}>{items.length}</span>
            <GuideMarker id="asset.relWhy" n={1} />
            {canEdit && (
              <button className="as-btn as-btn-primary" onClick={() => setAdding(!adding)}>
                <Plus className="h-3 w-3" style={{ display: 'inline', verticalAlign: -1, marginRight: 4 }} />
                Add relationship
              </button>
            )}
          </div>
        }
      />

      {adding && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, border: '1px solid var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)', marginBottom: 12 }}>
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

      {rels.isLoading ? (
        <Empty text="Loading relationships…" />
      ) : items.length === 0 ? (
        <>
          <Empty text="No relationships mapped." hint="Add one to record what this asset depends on — it drives the blast radius on the finding's Exploit Test tab." />
          {guideEnabled && <div style={{ marginTop: 8 }}><GuideMarker id="asset.relEmptyState" n={3} /></div>}
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <GuideMarker id="asset.relFeedsBlastRadius" n={3} className="mb-1" />
          <GuideMarker id="asset.relFeedsLateralMovement" n={4} className="mb-1" />
          {items.map((r) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', border: '1px solid var(--as-border)', borderRadius: 9, background: 'var(--as-card)' }}>
              <span style={{ fontSize: 12, color: 'var(--as-faint)', minWidth: 140 }}>{relPhrase(r.relationship_type, r.direction)}</span>
              <Link href={`/assets/${r.other_asset_id}`} style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-ink)', textDecoration: 'none' }}>
                {r.other_asset_name ?? `Asset #${r.other_asset_id}`}
              </Link>
              {r.other_asset_criticality && (
                <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)', textTransform: 'capitalize' }}>{r.other_asset_criticality}</span>
              )}
              {r.direction === 'incoming' && (
                <span className="as-pill" style={{ background: 'var(--as-blue-bg)', color: '#2E5EAA' }}>inbound</span>
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

      {/* Derived neighbours stay, clearly separated from the declared graph. */}
      <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--as-divider)' }}>
        <PanelHead
          icon={Network}
          title="Co-located assets"
          note="Inferred from a shared IP address — not a declared relationship."
          right={<>
            <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)' }}>{peers.length}</span>
            <GuideMarker id="asset.relLoopbackExcluded" n={5} />
          </>}
        />
        {peers.length === 0 ? (
          <Empty text="No co-located assets." hint="Nothing else in the register shares this asset's IP address." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {peers.map((p: any) => (
              <Link key={p.id} href={`/assets/${p.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 13px', border: '1px solid var(--as-border)', borderRadius: 9, background: 'var(--as-card)', textDecoration: 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-ink)' }}>{p.name ?? `Asset #${p.id}`}</span>
                {p.score != null && (
                  <span className="as-mono" style={{ marginLeft: 'auto', fontSize: 12, color: p.score >= 80 ? '#0E5A46' : p.score >= 55 ? '#B08420' : '#A33B1F', fontWeight: 600 }}>{p.score.toFixed(1)}%</span>
                )}
                <ExternalLink className="h-3.5 w-3.5" style={{ color: 'var(--as-faint)' }} />
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Legacy scalar pointers, kept for completeness. */}
      <div style={{ ...GRID3, marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--as-divider)' }}>
        <Field label="Parent asset" value={asset.parent_asset_id ? `#${asset.parent_asset_id}` : null} />
        <Field label="Replacement asset" value={asset.replacement_asset_name ?? (asset.replacement_asset_id ? `#${asset.replacement_asset_id}` : null)} />
        <Field label="Network segment" value={asset.network_segment} />
      </div>
    </div>
  );
}

/* ─── 3. Discovery ─────────────────────────────────────────────────── */

export function DiscoveryPanel({ asset, onRedetect, redetecting }: { asset: any; onRedetect?: () => void; redetecting?: boolean }) {
  const stale = asset.last_seen_at ? (Date.now() - new Date(asset.last_seen_at).getTime()) / 86400000 : null;

  return (
    <div>
      <PanelHead
        icon={Radar}
        title="Last observed"
        note="When and how the platform last saw this asset."
        right={onRedetect && (
          <button className="as-btn as-btn-secondary" onClick={onRedetect} disabled={redetecting}>
            <RefreshCw className="h-3 w-3" style={{ display: 'inline', verticalAlign: -1, marginRight: 6 }} />
            {redetecting ? 'Detecting…' : 'Re-detect OS'}
          </button>
        )}
      />

      <div style={GRID3}>
        <Field
          label="Last seen"
          value={asset.last_seen_at ? (
            <span style={{ color: stale != null && stale > 30 ? '#A33B1F' : 'var(--as-ink)' }}>
              {new Date(asset.last_seen_at).toLocaleString()}
              {stale != null && stale > 30 && <span style={{ fontSize: 12, marginLeft: 6 }}>({Math.floor(stale)}d ago)</span>}
            </span>
          ) : null}
        />
        <Field label="Seen by" value={asset.last_seen_source} />
        <Field label="Agent version" value={asset.agent_version} mono />
      </div>

      {/* IP address, Host name, OS family, OS version and Serial number were
          removed from this panel — they duplicated fields already shown in
          the "Network & Platform" card higher up the same Overview tab. This
          panel used to be its own "Discovery" tab; when that tab was folded
          into Overview, its whole panel was merged in rather than just the
          content that was actually unique to it. The normalised OS key below
          is the one field here that appears nowhere else on the page. */}
      <div style={{ ...GRID3, marginTop: 20, paddingTop: 18, borderTop: '1px solid var(--as-divider)' }}>
        <Field label="Normalised OS key" value={asset.os_normalized} mono />
      </div>

      <div style={{ marginTop: 18, fontSize: 12.5, color: 'var(--as-faint)' }}>
        The normalised OS key is what routes this asset to the right CIS benchmark. If it is blank, no benchmark can match.
      </div>

      <NotStored
        what="There is no discovery history for this asset."
        why="Only the latest observation is stored on the asset row — every earlier sighting is overwritten. The IT Asset Discovery module adds the persistent record that makes a history possible."
      />
    </div>
  );
}

/* ─── 4. Lifecycle ─────────────────────────────────────────────────── */

const LIFECYCLE_ORDER = ['planned', 'procured', 'deployed', 'active', 'maintenance', 'decommissioned', 'disposed'];

export function LifecyclePanel({ asset, onTransition }: { asset: any; onTransition?: () => void }) {
  const { enabled: guideEnabled } = useGuide();
  const current = (asset.lifecycle_state || asset.status || '').toLowerCase();
  const idx = LIFECYCLE_ORDER.indexOf(current);

  return (
    <div>
      <PanelHead
        icon={GitBranch}
        title="Lifecycle"
        note="Where this asset sits in its life, and how it got there."
        right={<>
          <GuideMarker id="asset.lifecycleWhy" n={1} />
          {onTransition && <button className="as-btn as-btn-primary" onClick={onTransition}>Change state</button>}
          {onTransition && <GuideMarker id="asset.lifecycleTransition" n={2} />}
        </>}
      />

      {/* state rail */}
      {guideEnabled && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
          <GuideMarker id="asset.lifecycleStates" n={3} />
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 20 }}>
        {LIFECYCLE_ORDER.map((s, i) => {
          const done = idx >= 0 && i <= idx;
          const isNow = i === idx;
          return (
            <div
              key={s}
              style={{
                flex: '1 1 88px', padding: '9px 8px', borderRadius: 8, textAlign: 'center',
                fontSize: 11.5, fontWeight: isNow ? 700 : 600, textTransform: 'capitalize',
                background: isNow ? 'var(--as-green)' : done ? 'var(--as-green-bg)' : 'var(--as-track)',
                color: isNow ? '#fff' : done ? 'var(--as-green)' : 'var(--as-disabled)',
              }}
            >
              {s}
            </div>
          );
        })}
      </div>

      <div style={GRID3}>
        <Field label="Current state" value={current ? current.charAt(0).toUpperCase() + current.slice(1) : null} />
        <Field label="Environment" value={asset.environment} />
        <Field label="Decommissioned at" value={asset.decommissioned_at ? new Date(asset.decommissioned_at).toLocaleDateString() : null} />
        <Field label="Retirement reason" value={asset.retirement_reason} />
        <Field label="Replaced by" value={asset.replacement_asset_name ?? (asset.replacement_asset_id ? `#${asset.replacement_asset_id}` : null)} />
        <div>
          <div className="as-label">
            End of life <GuideMarker id="asset.lifecycleEol" n={4} />
          </div>
          <div style={{ fontSize: 13.5, color: asset.eol_date ? 'var(--as-ink)' : 'var(--as-disabled)', marginTop: 3 }}>
            {asset.eol_date ? new Date(asset.eol_date).toLocaleDateString() : '—'}
          </div>
        </div>
      </div>

      {/* A "Transition history" heading stood here above a hardcoded empty
          state. There is no transition table, so it could never render anything
          but "none" — a permanent placeholder for a feature that does not exist,
          which reads as broken rather than absent. The NotStored note below
          already says the same thing honestly and in one place. */}
      <NotStored
        what="Lifecycle changes are not journalled."
        why="The transition endpoint moves the asset to its new state but writes no history row, so there is no record of who changed it, when, or from what. A transition table is needed before this timeline can be real."
      />
      {guideEnabled && (
        <div style={{ marginTop: 8 }}>
          <GuideMarker id="asset.lifecycleReplacement" n={5} />
        </div>
      )}
    </div>
  );
}

/* ─── 5. Assignments ───────────────────────────────────────────────── */

export function AssignmentsPanel({ asset, onEdit }: { asset: any; onEdit?: () => void }) {
  const rows = [
    { role: 'Technical owner', who: asset.owner_name, note: 'Day-to-day responsibility for the machine' },
    { role: 'Primary owner', who: asset.primary_owner_name, note: 'Accountable owner of record' },
    { role: 'Secondary owner', who: asset.secondary_owner_name, note: 'Backup when the primary is unavailable' },
    { role: 'Business owner', who: asset.business_owner_name, note: 'Owns the business service this supports' },
    { role: 'Custodian', who: asset.custodian, note: 'Holds and operates the asset' },
    { role: 'Owning team', who: asset.owning_team_name ?? asset.owning_team, note: 'Team the asset belongs to' },
    { role: 'Escalation contact', who: asset.escalation_contact_name, note: 'Who to call when it breaks' },
    { role: 'Assigned user', who: asset.assigned_user, note: 'The person actually using it' },
    { role: 'Department', who: asset.department, note: 'Cost and reporting line' },
  ];
  const filled = rows.filter((r) => r.who).length;

  return (
    <div>
      <PanelHead
        icon={Users}
        title="Assignments & ownership"
        note="Every role attached to this asset. Unfilled roles are the ones an auditor will ask about."
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="as-pill" style={{ background: filled === rows.length ? 'var(--as-good-bg)' : 'var(--as-warn-bg)', color: filled === rows.length ? '#0E5A46' : '#6E5410' }}>
              {filled} of {rows.length} filled
            </span>
            {onEdit && <button className="as-btn as-btn-secondary" onClick={onEdit}>Edit</button>}
          </div>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div key={r.role} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 2px', borderBottom: i < rows.length - 1 ? '1px solid var(--as-divider)' : 'none' }}>
            <div style={{ width: 170, flex: 'none' }}>
              <div style={{ fontSize: 13.2, fontWeight: 600, color: 'var(--as-ink)' }}>{r.role}</div>
              <div style={{ fontSize: 11.8, color: 'var(--as-faint)', marginTop: 1 }}>{r.note}</div>
            </div>
            <div style={{ fontSize: 13.3, color: r.who ? 'var(--as-ink)' : 'var(--as-rust)', fontWeight: r.who ? 500 : 600 }}>
              {r.who || 'Unassigned'}
            </div>
          </div>
        ))}
      </div>

      <NotStored
        what="Assignments have no history."
        why="These are single fields on the asset — reassigning overwrites the previous holder with no record of the handover."
      />
    </div>
  );
}

/* ─── 6. Activity ──────────────────────────────────────────────────── */

export function ActivityPanel({ assetId }: { assetId: number }) {
  const runs = useQuery({
    queryKey: ['asset-activity-runs', assetId],
    queryFn: async () => (await compliancePluginsApi.listRuns({ asset_id: assetId, limit: 50 })).data as any,
  });

  const items: any[] = Array.isArray(runs.data) ? runs.data : (runs.data?.items ?? runs.data?.runs ?? []);

  return (
    <div>
      <PanelHead
        icon={ActivityIcon}
        title="Activity"
        note="What has actually happened to this asset that the platform recorded."
        right={<span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)' }}>{items.length} events</span>}
      />

      {runs.isLoading ? <Empty text="Loading…" /> : items.length === 0 ? (
        <Empty text="No recorded activity for this asset." hint="Scan runs appear here once a CIS scan has been run against it." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((r: any, i: number) => {
            const ok = (r.status || '').toLowerCase() === 'completed' || (r.status || '').toLowerCase() === 'success';
            return (
              <div key={r.id ?? i} style={{ display: 'flex', gap: 12, padding: '12px 2px', borderBottom: i < items.length - 1 ? '1px solid var(--as-divider)' : 'none' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 6, flex: 'none', background: ok ? '#0E5A46' : '#A33B1F' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.2, fontWeight: 600, color: 'var(--as-ink)' }}>
                    Compliance scan {r.status ? `— ${r.status}` : ''}
                  </div>
                  <div style={{ fontSize: 12.3, color: 'var(--as-muted)', marginTop: 1 }}>
                    {r.benchmark_name ?? r.plugin_name ?? 'CIS benchmark'}
                    {r.passed_count != null && ` · ${r.passed_count} passed`}
                    {r.failed_count != null && ` · ${r.failed_count} failed`}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--as-faint)', whiteSpace: 'nowrap' }}>
                  {r.started_at ? new Date(r.started_at).toLocaleString() : r.created_at ? new Date(r.created_at).toLocaleString() : '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NotStored
        what="This is scan activity only."
        why="Field edits, ownership changes and lifecycle moves are not logged against the asset, so they cannot appear here yet."
      />
    </div>
  );
}
