'use client';

/**
 * Asset-record shell (Redesign kit): breadcrumb top bar + 300px sticky rail
 * (identity / security snapshot / ownership / quick actions) + main column
 * (mint-teal tab bar + the active tab's content as children). Data comes from
 * the page: `asset` + `overviewData` (buildOverviewData) — no new fetches.
 */

import Link from 'next/link';
import '../inventory-redesign.css'; // .inv2 tokens (Poppins, mint-teal)

type Sig = { label?: string; value?: string; text?: string; tone?: string };

const toneColor = (t?: string) =>
  t === 'ok' || t === 'good' || t === 'green' ? '#1F7A54'
  : t === 'warn' || t === 'amber' ? '#9A6410'
  : t === 'bad' || t === 'crit' || t === 'red' || t === 'danger' ? '#B23A3A'
  : '#0F1F2B';

const CHIP = (bg: string, fg: string): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 600, background: bg, color: fg });
const CARD: React.CSSProperties = { background: '#fff', border: '1px solid #E8ECEE', borderRadius: 15, boxShadow: '0 1px 2px rgba(16,24,40,.04)' };
const CHEAD: React.CSSProperties = { display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #F0F3F5' };
const KV: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 11.5, padding: '5px 0', borderBottom: '1px solid #F4F6F7' };
const RAILLINK: React.CSSProperties = { textAlign: 'left', background: 'none', border: 0, color: '#3A4653', fontSize: 11.5, fontWeight: 500, padding: '4px 4px', cursor: 'pointer', borderRadius: 6 };

// Globe — the identity avatar for an external (EASM / domain) asset, in place of
// the internal type/device icon.
const GLOBE = (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
);

export default function AssetRecordShell({
  asset, overviewData, displayName, sections, activeTab, onTab, tabCounts,
  canEdit, canDelete, getIcon, onAssessRisk, assessing, onEdit, onLifecycle,
  onCisScans, onRiskPosture, onDelete, children,
}: any) {
  const signals: Sig[] = Array.isArray(overviewData?.security?.signals) ? overviewData.security.signals : [];
  // External (EASM / domain) asset: warm brown/amber identity + globe, an
  // "External posture" rail, a "Rescan domain" primary. Internal assets are
  // untouched. Single source of truth = the mapper's isOutsideOnly flag.
  const external = !!overviewData?.external;
  const typeLabel = (asset?.asset_type || '').toString();
  const status = (asset?.status || 'active').toString();
  const crit = (asset?.criticality || '').toString();
  const idline = overviewData?.header?.idline || asset?.description || asset?.ip_address || '';

  return (
    <div className="inv2" style={{ margin: '-16px', background: '#F4F6F7', minHeight: '100vh' }}>
      {/* slim back link — the global top bar now carries the breadcrumb, so no second bar */}
      <div style={{ padding: '10px 18px 0' }}>
        <Link href="/assets" style={{ fontSize: 11.5, color: '#8A95A1', display: 'inline-flex', alignItems: 'center', gap: 4 }}>‹ Back to register</Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px minmax(0,1fr)', gap: 16, padding: '10px 18px 14px', alignItems: 'start' }}>
        {/* ── LEFT RAIL ── */}
        <aside style={{ position: 'sticky', top: 14, display: 'flex', flexDirection: 'column', gap: 11, minWidth: 0 }}>
          {/* identity */}
          <div style={{ ...CARD, overflow: 'hidden' }}>
            <div style={{ height: 62, background: external ? 'linear-gradient(120deg,#B45309,#8A4A0F)' : 'linear-gradient(120deg,#17B898,#12A085)' }} />
            <div style={{ padding: '0 14px 14px', marginTop: -24 }}>
              <div style={{ width: 46, height: 46, borderRadius: 12, background: '#fff', border: '3px solid #fff', boxShadow: '0 3px 8px rgba(16,24,40,.12)', display: 'grid', placeItems: 'center', color: external ? '#9A6410' : '#2E63A8' }}>{external ? GLOBE : (getIcon ? getIcon(asset?.asset_type) : null)}</div>
              <div style={{ fontSize: 15.5, fontWeight: 600, marginTop: 8, letterSpacing: '-.01em', color: '#0F1F2B', wordBreak: 'break-word' }}>{displayName}</div>
              {idline && <div style={{ fontSize: 10.5, color: '#8A95A1', marginTop: 3 }}>{idline}</div>}
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 9 }}>
                {external ? (
                  <>
                    {crit && <span style={CHIP('#FBF2DF', '#9A6410')}>{crit}</span>}
                    <span style={CHIP('#E7F5EE', '#1F7A54')}>{status}</span>
                    <span style={CHIP('#E9F1FB', '#2E63A8')}>External · EASM</span>
                    {typeLabel === 'third_party' && <span style={CHIP('#F1F4F6', '#6B7787')}>Third-Party</span>}
                    {asset?.internet_facing && <span style={CHIP('#FBEAEA', '#B23A3A')}>Internet-facing</span>}
                  </>
                ) : (
                  <>
                    {typeLabel && <span style={CHIP('#E9F1FB', '#2E63A8')}>{typeLabel}</span>}
                    <span style={CHIP('#E7F5EE', '#1F7A54')}>{status}</span>
                    {crit && <span style={CHIP('#FBF2DF', '#9A6410')}>{crit}</span>}
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button type="button" onClick={onAssessRisk} disabled={assessing} style={{ flex: 1, height: 30, borderRadius: 9, border: '1px solid #17B898', background: '#17B898', color: '#06342B', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', opacity: assessing ? 0.6 : 1 }}>{assessing ? (external ? 'Rescanning…' : 'Assessing…') : (external ? 'Rescan domain' : 'Assess risk')}</button>
                {canEdit && <button type="button" onClick={onEdit} style={{ height: 30, padding: '0 12px', borderRadius: 9, border: '1px solid #E8ECEE', background: '#fff', color: '#3A4653', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Edit</button>}
              </div>
            </div>
          </div>

          {/* security snapshot / external posture (from real overview signals) */}
          {signals.length > 0 && (
            <div style={CARD}>
              <div style={CHEAD}><h4 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>{external ? 'External posture' : 'Security snapshot'}</h4></div>
              <div style={{ padding: '5px 14px 10px' }}>
                {signals.map((s, i) => (
                  <div key={i} style={KV}><span style={{ color: '#8A95A1' }}>{s.label}</span><b style={{ fontWeight: 600, textAlign: 'right', color: toneColor(s.tone) }}>{s.value ?? s.text ?? ''}</b></div>
                ))}
              </div>
            </div>
          )}

          {/* ownership (real asset fields only) */}
          <div style={CARD}>
            <div style={CHEAD}><h4 style={{ fontSize: 12, fontWeight: 600, margin: 0 }}>Ownership</h4></div>
            <div style={{ padding: '5px 14px 10px' }}>
              <div style={KV}><span style={{ color: '#8A95A1' }}>Owner</span><b style={{ fontWeight: 600, color: asset?.owner_name ? '#0F1F2B' : '#AEB8C2' }}>{asset?.owner_name || 'Not set'}</b></div>
              {asset?.ip_address && <div style={KV}><span style={{ color: '#8A95A1' }}>IP address</span><b style={{ fontWeight: 600, fontFamily: 'ui-monospace,Consolas,monospace' }}>{asset.ip_address}</b></div>}
              <div style={KV}><span style={{ color: '#8A95A1' }}>Criticality</span><b style={{ fontWeight: 600 }}>{crit || '—'}</b></div>
              {asset?.lifecycle_state && <div style={{ ...KV, borderBottom: 0 }}><span style={{ color: '#8A95A1' }}>Lifecycle</span><b style={{ fontWeight: 600 }}>{asset.lifecycle_state}</b></div>}
            </div>
          </div>

          {/* quick actions */}
          <div style={CARD}>
            <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <button type="button" onClick={onCisScans} style={RAILLINK}>CIS scans →</button>
              <button type="button" onClick={onRiskPosture} style={RAILLINK}>Risk posture →</button>
              {canEdit && <button type="button" onClick={onLifecycle} style={RAILLINK}>Change lifecycle →</button>}
              {canDelete && <button type="button" onClick={onDelete} style={{ ...RAILLINK, color: '#B23A3A' }}>Delete asset</button>}
            </div>
          </div>
        </aside>

        {/* ── MAIN ── */}
        <div style={{ minWidth: 0 }}>
          <div style={{ ...CARD, display: 'flex', gap: 2, padding: '0 8px', overflowX: 'auto', marginBottom: 12 }}>
            {(sections || []).map((s: any) => {
              const active = activeTab === s.id;
              const count = tabCounts?.[s.id];
              const urgent = s.id === 'vulnerabilities' || s.id === 'alerts';
              return (
                <button key={s.id} type="button" onClick={() => onTab(s.id)} style={{ flex: 'none', height: 40, padding: '0 11px', border: 0, background: 'none', fontSize: 12, fontWeight: active ? 600 : 500, color: active ? '#12A085' : '#6B7787', borderBottom: active ? '2px solid #17B898' : '2px solid transparent', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', cursor: 'pointer', marginBottom: -1 }}>
                  {s.label}
                  {count != null && count > 0 && <span style={{ fontSize: 9.5, fontWeight: 700, background: urgent ? '#FBEAEA' : '#EEF1F3', color: urgent ? '#B23A3A' : '#6B7787', borderRadius: 999, padding: '1px 6px' }}>{count}</span>}
                </button>
              );
            })}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
