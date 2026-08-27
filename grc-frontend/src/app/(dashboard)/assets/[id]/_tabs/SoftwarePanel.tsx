'use client';

/*
 * SoftwarePanel — asset-detail "Software" tab, restyled to the delivered
 * AssetOverview design language (see ../_overview-design.tsx and the card /
 * field / tile / table primitives in ../page.tsx).
 *
 * PRESENTATION ONLY. This is a like-for-like re-skin of the existing
 * SoftwarePanel in ../_components/AssetWorkTabs.tsx — the exact same data
 * fetching (react-query keys), the exact same mutation, the exact same
 * capabilities (row → SoftwareSetupDrawer, identifier remove, guide markers,
 * loading/empty states). Nothing about what is fetched or mutated changed;
 * only the markup and tokens did.
 *
 * All colours come from the app-wide `--as-*` custom properties (defined in
 * ../../_suite/asset-suite.css, scoped under `.asset-suite`, which wraps the
 * asset-detail page) and the `as-card` / `as-mono` / `as-label` / `as-pill`
 * utility classes. No colour or spacing is invented here.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package, ChevronRight, X, ShieldCheck, ShieldAlert,
} from 'lucide-react';
import { assetsApi, softwareIdentifiersApi } from '@/lib/api';
import { GuideMarker, useGuide } from '@/components/guide';
import {
  SoftwareSetupDrawer,
  type SoftwareSetupEntry,
} from '@/components/assets/SoftwareSetupDrawer';

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ─── design primitives (mirror ../_overview-design.tsx + ../page.tsx) ──── */

/** A card: rounded --as-border container on --as-card, an icon + title header
 *  over a hairline divider, an optional subtitle and right-aligned node, then a
 *  padded body. Matches the "Software & Security Posture" card in the handoff. */
function Card({
  icon: Icon, title, subtitle, right, children, bodyStyle,
}: {
  icon: any; title: string; subtitle?: string; right?: React.ReactNode;
  children: React.ReactNode; bodyStyle?: React.CSSProperties;
}) {
  return (
    <div className="as-card" style={{ overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 12, padding: '15px 20px', borderBottom: '1px solid var(--as-divider)',
      }}>
        <div style={{ display: 'flex', gap: 10, minWidth: 0 }}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={2}
            style={{ color: 'var(--as-green)', marginTop: 1, flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-ink)' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: 'var(--as-faint)', marginTop: 2 }}>{subtitle}</div>}
          </div>
        </div>
        {right != null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 'none' }}>{right}</div>
        )}
      </div>
      <div style={{ padding: '18px 20px', ...bodyStyle }}>{children}</div>
    </div>
  );
}

/** Centred empty / loading state on a dashed --as-border tile. */
function Empty({ text, hint }: { text: string; hint?: string }) {
  return (
    <div style={{ padding: '26px 18px', textAlign: 'center', border: '1px dashed var(--as-border)', borderRadius: 10, background: 'var(--as-subtle)' }}>
      <div style={{ fontSize: 13.5, color: 'var(--as-muted)', fontWeight: 500 }}>{text}</div>
      {hint && <div style={{ fontSize: 12.3, color: 'var(--as-faint)', marginTop: 5 }}>{hint}</div>}
    </div>
  );
}

const TH: React.CSSProperties = {
  textAlign: 'left', padding: '9px 14px', fontSize: 10.5, letterSpacing: 0.5,
  textTransform: 'uppercase', color: 'var(--as-muted)', fontWeight: 600,
  background: 'var(--as-subtle)', borderBottom: '1px solid var(--as-border)',
  position: 'sticky', top: 0, whiteSpace: 'nowrap',
};

/* ─── security posture (derived from installed-software inventory) ──────── */

/** One posture signal, rendered as a bordered tile: present reads neutral,
 *  absent reads as a danger signal (matching the handoff's "bad" signal tiles). */
function PostureSignal({ present, label, products }: { present: boolean; label: string; products: string[] }) {
  return (
    <div style={{
      flex: 1, minWidth: 160, padding: '12px 14px', borderRadius: 12,
      border: '1px solid ' + (present ? 'var(--as-border)' : 'var(--as-danger-border)'),
      background: present ? 'var(--as-card)' : 'var(--as-danger-bg)',
    }}>
      <div className="as-label" style={{ color: 'var(--as-muted)' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        {present
          ? <ShieldCheck className="h-4 w-4" strokeWidth={2} style={{ color: 'var(--as-good)', flex: 'none' }} />
          : <ShieldAlert className="h-4 w-4" strokeWidth={2} style={{ color: 'var(--as-danger)', flex: 'none' }} />}
        <span style={{ fontSize: 14, fontWeight: 700, color: present ? 'var(--as-ink)' : 'var(--as-danger)' }}>
          {present ? 'Present' : 'Not detected'}
        </span>
      </div>
      {products.length > 0 && (
        <div style={{ marginTop: 7, fontSize: 12, color: 'var(--as-secondary)' }}>{products.join(', ')}</div>
      )}
    </div>
  );
}

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

  return (
    <Card
      icon={protectedHost ? ShieldCheck : ShieldAlert}
      title="Security posture"
      subtitle="Antivirus and EDR presence, inferred from the installed-software inventory."
      right={
        <span className="as-pill" style={protectedHost
          ? { background: 'var(--as-good-bg)', color: 'var(--as-good)' }
          : { background: 'var(--as-danger-bg)', color: 'var(--as-danger)' }}>
          {protectedHost ? 'Protected' : 'Unprotected'}
        </span>
      }
    >
      {!protectedHost && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14,
          padding: '10px 13px', borderRadius: 10, background: 'var(--as-danger-bg)',
          border: '1px solid var(--as-danger-border)', color: 'var(--as-danger-text)',
          fontSize: 12.5, fontWeight: 600,
        }}>
          <ShieldAlert className="h-4 w-4" strokeWidth={2} style={{ flex: 'none' }} />
          No antivirus or EDR detected on this host.
        </div>
      )}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <PostureSignal present={!!posture.has_antivirus} label="Antivirus" products={av} />
        <PostureSignal present={!!posture.has_edr} label="EDR / XDR" products={edr} />
      </div>
      {catEntries.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="as-label" style={{ marginBottom: 8 }}>What runs here</div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {catEntries.map(([cat, n]) => (
              <span key={cat} className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-secondary)' }}>
                {CAT_LABELS[cat] ?? cat} · {n as number}
              </span>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

/* ─── panel ────────────────────────────────────────────────────────────── */

export default function SoftwarePanel({
  assetId,
  canEdit,
  peers,
  hostName,
  hostIp,
}: {
  assetId: number;
  canEdit?: boolean;
  peers?: any[];
  hostName?: string;
  hostIp?: string;
}) {
  const qc = useQueryClient();
  const { enabled: guideEnabled } = useGuide();
  const [setupEntry, setSetupEntry] = useState<SoftwareSetupEntry | null>(null);

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
    qc.invalidateQueries({ queryKey: ['assets', assetId, 'detected-software'] });
    qc.invalidateQueries({ queryKey: ['assets', assetId, 'ip-peers'] });
    qc.invalidateQueries({ queryKey: ['asset-detail', assetId] });
  };
  const removeId = useMutation({
    mutationFn: (identifierId: number) => softwareIdentifiersApi.delete(assetId, identifierId),
    onSuccess: refresh,
  });

  /** Already promoted to its own asset? Prefer the inventory's promoted_asset_id;
      fall back to matching a co-located peer by name. */
  const promoted = (s: any) => {
    if (s.promoted_asset_id) return true;
    const name = String(s.name ?? s.product ?? '').toLowerCase();
    if (!name) return false;
    return (peers ?? []).some((p: any) => String(p.name ?? '').toLowerCase().includes(name));
  };

  const openSetup = (s: any) => {
    const key = s.software_key ?? s.key;
    if (!key) return;
    setSetupEntry({
      software_key: String(key),
      name: s.name ?? s.product ?? String(key),
      version: s.version,
      publisher: s.publisher ?? s.vendor,
      benchmark_available: !!s.benchmark_available,
      benchmark_name: s.benchmark_name,
      rule_count: s.rule_count,
      promoted_asset_id: s.promoted_asset_id ?? null,
    });
  };

  const shown = Math.min(items.length, 200);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      <SecurityPostureCard posture={posture} />

      {/* Installed software */}
      <Card
        icon={Package}
        title="Installed software"
        subtitle="Software detected on this asset. Click a row to set it up as its own asset (credentials when needed)."
        right={<>
          <span className="as-pill" style={{ background: 'var(--as-track)', color: 'var(--as-muted)' }}>{items.length} detected</span>
          <GuideMarker id="asset.swIntro" n={1} />
        </>}
        bodyStyle={{ padding: 0 }}
      >
        {detected.isLoading ? (
          <div style={{ padding: '18px 20px' }}><Empty text="Loading…" /></div>
        ) : items.length === 0 ? (
          <div style={{ padding: '18px 20px' }}>
            <Empty text="No software recorded for this asset yet." hint="Software is captured during a CIS scan or an agent heartbeat. Run a scan from the Compliance tab to populate this." />
          </div>
        ) : (
          <>
            <div style={{ borderBottom: '1px solid var(--as-divider)', maxHeight: 360, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    {['Name', 'Version', 'Publisher', 'Source', 'Tracked separately', ''].map((h, i) => (
                      <th key={h || i} style={TH}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {items.slice(0, 200).map((s: any, i: number) => {
                    const ok = promoted(s);
                    const key = s.software_key ?? s.key;
                    const clickable = Boolean(key);
                    return (
                      <tr
                        key={i}
                        onClick={clickable ? () => openSetup(s) : undefined}
                        style={{ borderBottom: '1px solid var(--as-row)', cursor: clickable ? 'pointer' : undefined }}
                        className={clickable ? 'hover:bg-[var(--as-subtle)]' : undefined}
                      >
                        <td style={{ padding: '9px 14px', fontWeight: 600, color: 'var(--as-ink)' }}>{s.name ?? s.product ?? '—'}</td>
                        <td className="as-mono" style={{ padding: '9px 14px', fontSize: 12, color: 'var(--as-secondary)' }}>{s.version ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: 'var(--as-secondary)' }}>{s.publisher ?? s.vendor ?? '—'}</td>
                        <td style={{ padding: '9px 14px', color: 'var(--as-faint)', fontSize: 12.3 }}>{s.source ?? 'scan'}</td>
                        <td style={{ padding: '9px 14px' }}>
                          <span className="as-pill" style={ok
                            ? { background: 'var(--as-good-bg)', color: 'var(--as-good)' }
                            : { background: 'var(--as-warn-bg)', color: 'var(--as-warn-text)' }}>
                            {ok ? (s.promoted_asset_id ? `Asset #${s.promoted_asset_id}` : 'Own asset') : 'Part of host'}
                          </span>
                        </td>
                        <td style={{ padding: '9px 14px', color: 'var(--as-faint)', textAlign: 'right' }}>
                          {clickable && <ChevronRight className="h-3.5 w-3.5" style={{ display: 'inline' }} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ margin: 0, padding: '12px 20px', fontSize: 11.5, color: 'var(--as-faint)', lineHeight: 1.55 }}>
              {items.length > shown && <><b>Showing first {shown} of {items.length}.</b>{' '}</>}
              &ldquo;Part of host&rdquo; means the service is inventoried against this machine. Opening a row lets you
              set it up as a separate asset (with credentials when the benchmark needs them). We do not
              track end-of-life dates per package, so no EOL flag is shown — that would be a guess.
              <GuideMarker id="asset.swPromote" n={2} className="ml-1.5" />
            </p>
          </>
        )}
      </Card>

      {setupEntry && (
        <SoftwareSetupDrawer
          open
          onClose={() => setSetupEntry(null)}
          hostAssetId={assetId}
          hostName={hostName}
          hostIp={hostIp}
          entry={setupEntry}
          onComplete={refresh}
        />
      )}

      {/* CPE/PURL identifiers — what vulnerability matching keys off */}
      <Card
        icon={Package}
        title="Software identifiers"
        subtitle="The CPE / PURL strings used to match this asset against vulnerability feeds."
        right={<GuideMarker id="asset.swCpe" n={3} />}
      >
        {ids.length === 0 ? (
          <Empty text="No identifiers recorded." hint="Promote a detected package to an identifier to make it vulnerability-matchable." />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {ids.map((x: any) => (
              <div key={x.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--as-border)', borderRadius: 9, background: 'var(--as-subtle)' }}>
                <span className="as-pill" style={{ background: 'var(--as-blue-bg)', color: 'var(--as-blue)', textTransform: 'uppercase' }}>{x.identifier_type}</span>
                <span className="as-mono" style={{ fontSize: 12, color: 'var(--as-ink)', overflow: 'hidden', textOverflow: 'ellipsis', overflowWrap: 'anywhere', minWidth: 0 }}>{x.identifier}</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--as-faint)', flex: 'none' }}>{x.source ?? '—'}</span>
                {canEdit && (
                  <button
                    onClick={() => removeId.mutate(x.id)}
                    title="Remove identifier — this package will stop being CVE-matchable"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--as-faint)', padding: 2, flex: 'none' }}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {guideEnabled && (
          <div style={{ marginTop: 12, display: 'flex', gap: 10, fontSize: 11.5, color: 'var(--as-faint)' }}>
            <span>How a CVE gets linked automatically: <GuideMarker id="asset.swMatching" n={4} className="mx-1" /> and why a precise version matters: <GuideMarker id="asset.swVersion" n={5} className="ml-1" /></span>
          </div>
        )}
      </Card>
    </div>
  );
}
