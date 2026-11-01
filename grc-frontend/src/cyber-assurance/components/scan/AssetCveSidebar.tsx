'use client';

/**
 * AssetCveSidebar — an in-page left rail (distinct from the app nav) listing assets and
 * their CVEs. Shared by the Vulnerability Register scan screen (pick an asset to plan+scan)
 * and the AI-Pentest exploit page (pick an asset to gate+exploit). Presentational: all data
 * and selection arrive as props. `headerExtra` lets a page mount an ad-hoc-target input above
 * the list (register) or leave it out (exploit page).
 */
import { useMemo, useState } from 'react';
import { Server, Globe, Search, ChevronDown, ChevronRight } from 'lucide-react';

export interface SidebarAsset {
  id: number;
  label: string;
  sub?: string | null;          // ip / type / host
  findingCount?: number;
  cves?: string[];              // distinct CVE ids on this asset (first few shown)
  adhoc?: boolean;
}

const AC = '#005B96', ACSOFT = '#EFF5FA', BORDER = '#E8ECEE', INK = '#0F1F2B', MUTED = '#8A95A1', FAINT = '#AEB8C2';

// Two-label public suffixes (co.uk, edu.pk, com.au…) so a subdomain groups under its real
// registrable name, not the suffix. shortcut: the common second-level labels, not the full PSL —
// add one here if a real suffix is missed.
const SLD = new Set(['co', 'com', 'net', 'org', 'edu', 'gov', 'gob', 'ac', 'go', 'or', 'ne', 'mil', 'sch']);

// Registrable apex for grouping EASM subdomains under one parent (www/smtp/pop… → liztek.ca,
// www.superior.edu.pk → superior.edu.pk). IPv4 and single-label hostnames (DESKTOP-xxx) → null (ungrouped).
function apexOf(host?: string | null): string | null {
  const h = (host || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0].split(':')[0];
  if (!h || /^\d+(\.\d+){3}$/.test(h)) return null;
  const parts = h.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // Keep 3 labels when the last two form a known two-label suffix (edu.pk, co.uk…), else 2.
  const take = (parts.length >= 3 && SLD.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) ? 3 : 2;
  return parts.slice(-take).join('.');
}

export function AssetCveSidebar({
  assets, selectedId, onSelect, title = 'Assets', emptyText = 'No assets.', headerExtra, loading = false,
  groupByDomain = false,
}: {
  assets: SidebarAsset[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  title?: string;
  emptyText?: string;
  headerExtra?: React.ReactNode;
  loading?: boolean;
  groupByDomain?: boolean;   // roll subdomains up under their registrable apex (collapsible)
}) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return assets;
    return assets.filter((a) => `${a.label} ${a.sub || ''} ${(a.cves || []).join(' ')}`.toLowerCase().includes(t));
  }, [assets, q]);

  // Apex rollup (opt-in): subdomains sharing a registrable domain (www/smtp/pop… → liztek.ca) collapse
  // under one parent header; IPs, single hostnames and lone domains stay standalone. Leaves stay
  // individually selectable, so the per-asset scan flow is unchanged.
  const { groups, singles } = useMemo(() => {
    if (!groupByDomain) return { groups: [] as [string, SidebarAsset[]][], singles: list };
    const by = new Map<string, SidebarAsset[]>();
    const solo: SidebarAsset[] = [];
    for (const a of list) {
      const apex = apexOf(a.label) || apexOf(a.sub);
      if (apex) { const arr = by.get(apex); if (arr) arr.push(a); else by.set(apex, [a]); }
      else solo.push(a);
    }
    const grp: [string, SidebarAsset[]][] = [];
    for (const [apex, arr] of by) { if (arr.length >= 2) grp.push([apex, arr]); else solo.push(...arr); }
    const sumFind = (arr: SidebarAsset[]) => arr.reduce((s, x) => s + (x.findingCount ?? 0), 0);
    grp.sort((a, b) => sumFind(b[1]) - sumFind(a[1]));
    return { groups: grp, singles: solo.sort((a, b) => (b.findingCount ?? 0) - (a.findingCount ?? 0)) };
  }, [groupByDomain, list]);

  const Row = (a: SidebarAsset, indent = false) => {
    const sel = a.id === selectedId;
    const Icon = a.adhoc ? Globe : Server;
    return (
      <button key={a.id} onClick={() => onSelect(a.id)}
        style={{ display: 'flex', flexDirection: 'column', gap: 5, width: '100%', textAlign: 'left', border: `1px solid ${sel ? '#9cc3de' : 'transparent'}`, background: sel ? ACSOFT : 'transparent', borderRadius: 10, padding: '8px 9px', paddingLeft: indent ? 22 : 9, marginBottom: 2, cursor: 'pointer', fontFamily: 'inherit' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ display: 'grid', placeItems: 'center', height: 24, width: 24, borderRadius: 6, background: sel ? AC : ACSOFT, color: sel ? '#fff' : AC, flexShrink: 0 }}><Icon size={13} /></span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</span>
            {a.sub && <span style={{ display: 'block', fontSize: 9.5, color: FAINT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'ui-monospace,Consolas,monospace' }}>{a.sub}</span>}
          </span>
          {a.adhoc && <span style={{ fontSize: 8.5, fontWeight: 700, color: MUTED, background: '#EEF1F3', borderRadius: 5, padding: '2px 5px', flexShrink: 0 }}>AD-HOC</span>}
          {a.findingCount != null && <span style={{ fontSize: 11, fontWeight: 700, color: a.findingCount ? AC : FAINT, flexShrink: 0 }}>{a.findingCount}</span>}
        </span>
        {a.cves && a.cves.length > 0 && (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingLeft: 32 }}>
            {a.cves.slice(0, 4).map((c) => <span key={c} style={{ fontSize: 9, fontFamily: 'ui-monospace,Consolas,monospace', color: '#2E63A8', background: '#EEF4FB', borderRadius: 4, padding: '1px 5px' }}>{c}</span>)}
            {a.cves.length > 4 && <span style={{ fontSize: 9, color: FAINT }}>+{a.cves.length - 4}</span>}
          </span>
        )}
      </button>
    );
  };

  const isEmpty = groupByDomain ? (groups.length === 0 && singles.length === 0) : list.length === 0;

  return (
    <aside style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '11px 13px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{title}</span>
          <span style={{ fontSize: 11, color: FAINT }}>{assets.length}</span>
        </div>
        <div style={{ position: 'relative' }}>
          <Search size={14} style={{ position: 'absolute', left: 9, top: 9, color: FAINT }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search asset or CVE…"
            style={{ width: '100%', height: 32, border: `1px solid ${BORDER}`, borderRadius: 8, padding: '0 10px 0 28px', fontSize: 12, outline: 'none', color: INK }} />
        </div>
        {headerExtra && <div style={{ marginTop: 9 }}>{headerExtra}</div>}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 7 }}>
        {loading ? (
          <div style={{ padding: 22, textAlign: 'center', fontSize: 12, color: FAINT }}>Loading…</div>
        ) : isEmpty ? (
          <div style={{ padding: 22, textAlign: 'center', fontSize: 12, color: FAINT }}>{emptyText}</div>
        ) : (
          <>
            {groups.map(([apex, arr]) => {
              const open = !collapsed.has(apex);
              const total = arr.reduce((s, x) => s + (x.findingCount ?? 0), 0);
              const Chevron = open ? ChevronDown : ChevronRight;
              return (
                <div key={apex} style={{ marginBottom: 2 }}>
                  <button onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(apex) ? n.delete(apex) : n.add(apex); return n; })}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left', border: '1px solid transparent', background: '#F6F8FA', borderRadius: 9, padding: '7px 9px', cursor: 'pointer', fontFamily: 'inherit' }}>
                    <Chevron size={14} color={MUTED} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: INK, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{apex}</span>
                    <span style={{ fontSize: 9.5, color: FAINT }}>{arr.length}</span>
                    {total > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: AC }}>{total}</span>}
                  </button>
                  {open && <div style={{ marginTop: 2 }}>{arr.map((a) => Row(a, true))}</div>}
                </div>
              );
            })}
            {singles.map((a) => Row(a))}
          </>
        )}
      </div>
    </aside>
  );
}

export default AssetCveSidebar;
