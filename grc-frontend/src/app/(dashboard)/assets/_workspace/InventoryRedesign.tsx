'use client';

/**
 * IT Asset Inventory register — redesign (Redesign project kickoff).
 * Faithful reproduction of "IT Asset Inventory.dc.html" in the real stack:
 * insight ribbon (3-col) + smart-view rail + Register/Insights tabs, with the
 * design's own clean table (real assets + selection + row actions) so there is
 * no DataTable chrome mismatch. Score/counts from GET /assets/inventory-overview
 * and the live assets array. No new libraries (per CLAUDE.md).
 */

import { useMemo, useState } from 'react';
import { registrableDomain } from '@/lib/domains';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import InventoryScorecard from '@/components/dashboard/InventoryScorecard';
import { RowActionsMenu } from './RowActionsMenu';
import type { ITAsset } from '@/types';
import { Search, Download, Plus, AlertTriangle, Eye, Pencil, Trash2, Plug } from 'lucide-react';
import '../inventory-redesign.css';

interface Props {
  assets: ITAsset[];
  loading?: boolean;
  canCreate?: boolean; canEdit?: boolean; canDelete?: boolean;
  onView: (a: ITAsset) => void;
  onEdit: (a: ITAsset) => void;
  onDelete: (a: ITAsset) => void;
  onConnect: (a: ITAsset) => void;
  onBulkConnect?: (ids: number[]) => void;
  onBulkDelete?: (ids: number[]) => void;
  onBulkUpdate?: (ids: number[], patch: Record<string, unknown>) => void;
  onAdd?: () => void;
  /** Parent renders the common title+toggle header; skip the local one. */
  hideHead?: boolean;
}

const isExt = (a: ITAsset) => !!(a.internet_facing || a.origin_source === 'easm' || a.last_seen_source === 'external');
const hasCia = (a: ITAsset) => !!(a.confidentiality_rating && a.integrity_rating && a.availability_rating);
const isStale = (a: ITAsset) => (a.last_seen_at ? (Date.now() - new Date(a.last_seen_at).getTime()) / 864e5 > 30 : false);
const critOf = (a: ITAsset) => (a.criticality || '').toLowerCase();
const typeKey = (a: ITAsset) => (a.asset_type || '').toLowerCase().replace(/[ _-]/g, '');
const canConnect = (a: ITAsset) => !!a.host_name && a.discovery_state !== 'unmanaged';

const TILE: Record<string, { bg: string; fg: string }> = {
  application: { bg: '#DBE8FA', fg: '#28578F' }, infrastructure: { bg: '#CFF2E7', fg: '#12A085' },
  data: { bg: '#F6E7C2', fg: '#8A5A0C' }, cloud: { bg: '#E0DAF6', fg: '#5A45B5' }, thirdparty: { bg: '#F6E7C2', fg: '#8A5A0C' },
};
const CRIT: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#F7D8D8', fg: '#A32B2B' }, high: { bg: '#F6E7C2', fg: '#8A5A0C' },
  medium: { bg: '#E4E9ED', fg: '#55606D' }, low: { bg: '#D3EEE1', fg: '#186A49' },
};
const CRIT_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const td: React.CSSProperties = { padding: '11px 12px', borderBottom: '1px solid #F0F3F5', color: '#3A4653' };
const th: React.CSSProperties = { textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid #E8ECEE', fontSize: 9.5, textTransform: 'uppercase', letterSpacing: '.05em', color: '#8A95A1', fontWeight: 600, position: 'sticky', top: 0, background: '#FAFBFC', zIndex: 1, whiteSpace: 'nowrap' };

// ── EASM subdomain roll-up ──────────────────────────────────────────────────
// registrableDomain (apex) is the full Public Suffix List, imported from @/lib/domains.
const dnsName = (a: any) => (a.fqdn || a.host_name || a.name || '').toLowerCase().replace(/\.$/, '').trim();
const isExternalRow = (a: any) => !!(a.internet_facing || a.origin_source === 'easm' || a.last_seen_source === 'external');

export default function InventoryRedesign(p: Props) {
  const assets = p.assets || [];
  const [view, setView] = useState('all');
  const [tab, setTab] = useState<'reg' | 'ins'>('reg');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('crit');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [openApex, setOpenApex] = useState<Set<string>>(new Set());

  const ov = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.assets],
    queryFn: async () => { try { return (await apiClient.get('/assets/inventory-overview')).data as any; } catch { return null; } },
  });
  const score: number | null = ov.data?.performance?.score ?? null;
  const grade: string | null = ov.data?.performance?.grade ?? null;
  const openVulns: number = ov.data?.counts?.open_vulnerabilities ?? 0;

  const c = useMemo(() => {
    const total = assets.length;
    const external = assets.filter(isExt).length;
    return {
      total, external, internal: total - external,
      critical: assets.filter((a) => critOf(a) === 'critical').length,
      cde: assets.filter((a) => a.cde_environment).length,
      internet: assets.filter((a) => a.internet_facing).length,
      unowned: assets.filter((a) => !a.owner_name).length,
      needcia: assets.filter((a) => !hasCia(a)).length,
      stale: assets.filter(isStale).length,
      scanned: assets.filter((a) => a.last_seen_at).length,
      byType: (k: string) => assets.filter((a) => typeKey(a) === k).length,
      mix: { critical: assets.filter((a) => critOf(a) === 'critical').length, high: assets.filter((a) => critOf(a) === 'high').length, medium: assets.filter((a) => critOf(a) === 'medium').length, low: assets.filter((a) => critOf(a) === 'low').length },
    };
  }, [assets]);

  const match = (a: ITAsset) => {
    switch (view) {
      case 'all': return true;
      case 'critical': return critOf(a) === 'critical';
      case 'needcia': return !hasCia(a);
      case 'unowned': return !a.owner_name;
      case 'stale': return isStale(a);
      case 'internet': return !!a.internet_facing;
      case 'cde': return !!a.cde_environment;
      case 'internal': return !isExt(a);
      case 'external': return isExt(a);
      default: return typeKey(a) === view;
    }
  };
  const rows = useMemo(() => {
    const r = assets.filter((a) => match(a) && (!q || (a.name || '').toLowerCase().includes(q.toLowerCase())));
    const s = [...r];
    if (sort === 'crit') s.sort((a, b) => (CRIT_ORDER[critOf(b)] || 0) - (CRIT_ORDER[critOf(a)] || 0));
    else if (sort === 'scan') s.sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime());
    else if (sort === 'value') s.sort((a, b) => (b.valuation || b.purchase_cost || 0) - (a.valuation || a.purchase_cost || 0));
    else if (sort === 'name') s.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return s;
  }, [assets, view, q, sort]);

  // Nest external subdomains under their apex. Apex rows get a ▸ toggle + "N subs"
  // badge; children are inserted right after the apex only when it's expanded.
  const { orderedRows, subCount, childApexOf } = useMemo(() => {
    const present = new Map<string, any>();
    for (const a of rows) { const n = dnsName(a); if (n && isExternalRow(a)) present.set(n, a); }
    const kids = new Map<string, any[]>();
    const childOf = new Map<number, string>();
    for (const a of rows) {
      if (!isExternalRow(a)) continue;
      const name = dnsName(a); const apex = registrableDomain(name);
      if (!apex || name === apex || !present.has(apex)) continue;
      const arr = kids.get(apex) ?? []; arr.push(a); kids.set(apex, arr); childOf.set(a.id, apex);
    }
    const counts = new Map<string, number>();
    kids.forEach((arr, apex) => counts.set(apex, arr.length));
    const display: any[] = [];
    for (const a of rows) {
      if (childOf.has(a.id)) continue;
      display.push(a);
      const nm = dnsName(a);
      if (openApex.has(nm) && kids.has(nm)) for (const k of kids.get(nm)!) display.push(k);
    }
    return { orderedRows: display, subCount: counts, childApexOf: childOf };
  }, [rows, openApex]);

  const sColor = score == null ? '#78838F' : score >= 80 ? '#186A49' : score >= 55 ? '#8A5A0C' : '#A32B2B';
  const sBg = score == null ? '#E4E9ED' : score >= 80 ? '#D3EEE1' : score >= 55 ? '#F6E7C2' : '#F7D8D8';
  // Bar fill grades with the score (bold, saturated), instead of one fixed
  // mustard for every grade — a "poor" score reads red, "fair" amber, "strong" green.
  const sGrad = score == null ? 'linear-gradient(90deg,#C3CBD3,#D3DAE0)'
    : score >= 80 ? 'linear-gradient(90deg,#1B6E4B,#26A56E)'
    : score >= 55 ? 'linear-gradient(90deg,#B77712,#E8A21C)'
    : 'linear-gradient(90deg,#A32B2B,#DB4A4A)';
  const gradeLbl = grade || (score == null ? '—' : score >= 80 ? 'STRONG' : score >= 55 ? 'FAIR' : 'WEAK');
  const scorePct = score == null ? 0 : Math.round(score);
  const attnTotal = openVulns + c.unowned + c.needcia + c.stale;

  const toggle = (id: number) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selIds = Array.from(sel);

  const railBtn = (id: string, label: string, count: number, dot?: string) => (
    <button key={id} className={'rbtn' + (view === id ? ' on' : '')} onClick={() => { setView(id); setTab('reg'); }}>
      <span className="bar" />{dot ? <span className="dot" style={{ background: dot }} /> : null}{label}<span className="cnt num">{count}</span>
    </button>
  );

  const lastScan = (a: ITAsset) => {
    if (!a.last_seen_at) return <span className="mono" style={{ color: '#A32B2B', fontWeight: 600 }}>Never</span>;
    const d = Math.floor((Date.now() - new Date(a.last_seen_at).getTime()) / 864e5);
    const l = d <= 0 ? 'today' : d < 365 ? `${d}d ago` : `${Math.floor(d / 365)}y ago`;
    return <span className="mono" style={{ color: d > 30 ? '#A32B2B' : '#3A4653' }}>{l}</span>;
  };
  const val = (a: ITAsset) => {
    const v = a.valuation || a.purchase_cost;
    if (!v) return <span style={{ color: '#B4BDC6' }}>—</span>;
    return <span className="num">{v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`}</span>;
  };

  return (
    <div className="inv2 fade" style={{ fontSize: 13.5 }}>
      {/* PAGE HEAD — parent now renders the common title + toggle header, so this
          is skipped when embedded (hideHead) to avoid a duplicate heading. */}
      {!p.hideHead && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 19, letterSpacing: '-.025em' }}>IT Asset Inventory</h1>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--ac)' }} />Authoritative ownership, valuation &amp; assurance coverage · {c.total} assets</div>
          </div>
          <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="sel"><option>Last 30 days</option><option>Last 7 days</option><option>This quarter</option></select>
            <button className="btn"><Download size={15} />Export</button>
            {p.canCreate && <button className="btn btn-pri" onClick={p.onAdd}><Plus size={15} />Add asset</button>}
          </div>
        </div>
      )}

      {/* INSIGHT RIBBON — 3-column grid */}
      <section className="card ribbon">
        <div className="rib-score">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}><span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Inventory score</span><b className="num" style={{ fontSize: 15, fontWeight: 600 }}>{score == null ? '—' : scorePct}</b><span style={{ fontSize: 10.5, color: '#8A95A1' }}>/ 100</span><span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.09em', padding: '2px 9px', borderRadius: 999, background: sBg, color: sColor }}>{gradeLbl}</span></div>
          <div style={{ position: 'relative', height: 9, borderRadius: 999, background: '#EAEEF1' }}><i className="grow" style={{ display: 'block', height: '100%', width: scorePct + '%', borderRadius: 999, background: sGrad }} /><span style={{ position: 'absolute', top: -4, left: '85%', width: 2, height: 17, background: '#0F1F2B', borderRadius: 2 }} /></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--faint)', marginTop: 6 }}><span>Weighted across 7 dimensions</span><span>target 85</span></div>
        </div>
        <div className="rib-tot">
          <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>Total assets</div><div style={{ margin: '3px 0' }}><b className="num" style={{ fontSize: 17, fontWeight: 600 }}>{c.total}</b></div><div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{c.internal} internal · {c.external} external</div></div>
          <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>Critical</div><div style={{ margin: '3px 0' }}><b className="num" style={{ fontSize: 17, fontWeight: 600, color: '#A32B2B' }}>{c.critical}</b></div><div style={{ fontSize: 10.5, color: 'var(--faint)' }}>highest tier</div></div>
          <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>CDE / PCI</div><div style={{ margin: '3px 0' }}><b className="num" style={{ fontSize: 17, fontWeight: 600, color: '#28578F' }}>{c.cde}</b></div><div style={{ fontSize: 10.5, color: 'var(--faint)' }}>cardholder env</div></div>
        </div>
        <div className="rib-att">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} style={{ color: '#8A5A0C' }} /><span style={{ fontSize: 12, color: '#7A4E0A', fontWeight: 500 }}>Needs attention</span><b className="num" style={{ marginLeft: 'auto', fontSize: 15, color: '#8A5A0C' }}>{attnTotal}</b></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <button className="att" onClick={() => { setView('critical'); setTab('reg'); }}>{openVulns} open vulns</button>
            <button className="att" onClick={() => { setView('unowned'); setTab('reg'); }}>{c.unowned} unowned</button>
            <button className="att" onClick={() => { setView('needcia'); setTab('reg'); }}>{c.needcia} unassessed</button>
            <button className="att" onClick={() => { setView('stale'); setTab('reg'); }}>{c.stale} stale</button>
          </div>
        </div>
      </section>

      {/* WORKSPACE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,224px) minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
        <aside className="rail card" style={{ padding: '9px 9px', display: 'flex', flexDirection: 'column', gap: 3 }}>
          <div className="railcap">Views</div>
          {railBtn('all', 'All assets', c.total)}
          {railBtn('critical', 'Critical', c.critical, '#C2453F')}
          {railBtn('needcia', 'Needs CIA', c.needcia, '#5A45B5')}
          {railBtn('unowned', 'Unowned', c.unowned, '#8A5A0C')}
          {railBtn('stale', 'Stale > 30d', c.stale, '#8A95A1')}
          {railBtn('internet', 'Internet-facing', c.internet, '#28578F')}
          {railBtn('cde', 'CDE / PCI', c.cde, '#12A085')}
          <div className="railcap" style={{ paddingTop: 14 }}>By origin</div>
          {railBtn('internal', 'Internal', c.internal)}
          {railBtn('external', 'External', c.external)}
          <div className="railcap" style={{ paddingTop: 14 }}>By type</div>
          {[['application', 'Applications', '#28578F'], ['infrastructure', 'Infrastructure', '#12A085'], ['data', 'Data', '#8A5A0C'], ['cloud', 'Cloud', '#5A45B5'], ['thirdparty', 'Third-party', '#DB7B45']].map(([id, label, sw]) => (
            <button key={id} className={'rbtn' + (view === id ? ' on' : '')} onClick={() => { setView(id); setTab('reg'); }}>
              <span className="bar" /><span style={{ width: 8, height: 8, borderRadius: 2, background: sw, flex: 'none' }} />{label}<span className="cnt num">{c.byType(id)}</span>
            </button>
          ))}
          <div style={{ marginTop: 12, background: '#F7F9FA', borderRadius: 10, padding: '11px 12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', fontWeight: 500 }}><span>Scan coverage</span><b className="num" style={{ color: 'var(--ink)' }}>{c.scanned} / {c.total}</b></div>
            <div className="track" style={{ marginTop: 8, height: 6 }}><i className="grow" style={{ width: (c.total ? Math.round((c.scanned / c.total) * 100) : 0) + '%', background: 'var(--ac)' }} /></div>
          </div>
        </aside>

        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="segwrap">
              <button className={'seg' + (tab === 'reg' ? ' on' : '')} onClick={() => setTab('reg')}>Register</button>
              <button className={'seg' + (tab === 'ins' ? ' on' : '')} onClick={() => setTab('ins')}>Insights</button>
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
              <Search size={16} style={{ position: 'absolute', left: 11, top: 11, color: '#78838F' }} />
              <input className="search" placeholder="Search this view…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select className="sel" value={sort} onChange={(e) => setSort(e.target.value)}><option value="crit">Sort: Criticality</option><option value="scan">Sort: Recently scanned</option><option value="value">Sort: Value</option><option value="name">Sort: Name</option></select>
          </div>

          {tab === 'reg' ? (
            <div className="card fade" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {selIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#22303B', color: '#fff', fontSize: 12 }}>
                  <b style={{ marginRight: 6 }}>{selIds.length} selected</b>
                  {p.onBulkConnect && <button className="bulkb" onClick={() => p.onBulkConnect!(rows.filter((r) => sel.has(r.id) && canConnect(r)).map((r) => r.id))}>Connect</button>}
                  {p.onBulkUpdate && p.canEdit && (['critical', 'high', 'medium', 'low'] as const).map((k) => <button key={k} className="bulkb" onClick={() => p.onBulkUpdate!(selIds, { criticality: k })}>Set {k[0].toUpperCase() + k.slice(1)}</button>)}
                  {p.onBulkDelete && p.canDelete && <button className="bulkb danger" onClick={() => { if (confirm(`Delete ${selIds.length} asset(s)? This can't be undone.`)) p.onBulkDelete!(selIds); }}>Delete</button>}
                  <span style={{ flex: 1 }} /><button className="bulkb" onClick={() => setSel(new Set())}>Deselect all</button>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: '1px solid var(--bd2)' }}>
                <h3 style={{ fontSize: 13.5 }}>Asset Register</h3>
                <span style={{ fontSize: 11.5, color: 'var(--muted2)' }}><b className="num" style={{ color: 'var(--sec)' }}>{rows.length}</b> shown · {c.total} total</span>
              </div>
              <div style={{ overflow: 'auto', maxHeight: '58vh' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
                  <thead><tr>
                    <th style={{ ...th, width: 38 }}><input type="checkbox" checked={allChecked} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} style={{ accentColor: '#12A085', width: 15, height: 15 }} /></th>
                    {['Asset', 'Type', 'Owner', 'Criticality', 'CIA', 'Last scan', 'Value', 'Status'].map((h) => <th key={h} style={th}>{h}</th>)}
                    <th style={{ ...th, width: 36 }}></th>
                  </tr></thead>
                  <tbody>
                    {p.loading ? (
                      <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#78838F', padding: 26 }}>Loading…</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={10} style={{ ...td, textAlign: 'center', color: '#78838F', padding: 26 }}>No assets match this view.</td></tr>
                    ) : orderedRows.map((a) => {
                      const tl = TILE[typeKey(a)] || { bg: '#E4E9ED', fg: '#78838F' };
                      const ck = CRIT[critOf(a)];
                      const st = (a.status || '').toLowerCase();
                      const stMap: Record<string, { c: string; l: string }> = { active: { c: '#17B898', l: 'Active' }, inactive: { c: '#AEB6BF', l: 'Inactive' }, decommissioned: { c: '#C2542E', l: 'Decommissioned' } };
                      const nSubs = subCount.get(dnsName(a)) || 0;
                      const isChild = childApexOf.has(a.id);
                      const apexOpen = openApex.has(dnsName(a));
                      return (
                        <tr key={a.id} style={{ cursor: 'pointer' }} className="rrow" onClick={() => p.onView(a)}>
                          <td style={td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} style={{ accentColor: '#12A085', width: 15, height: 15 }} /></td>
                          <td style={td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingLeft: isChild ? 24 : 0 }}>
                              {nSubs > 0 ? (
                                <button type="button" title={(apexOpen ? 'Collapse' : 'Expand') + ' subdomains'}
                                  onClick={(e) => { e.stopPropagation(); setOpenApex((s) => { const n = new Set(s); const k = dnsName(a); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }}
                                  style={{ width: 18, height: 18, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', color: '#78838F', fontSize: 12, lineHeight: 1, transform: apexOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▸</button>
                              ) : isChild ? <span style={{ width: 18, flex: 'none', color: '#C4CCD3', textAlign: 'center' }}>└</span> : null}
                              <span style={{ width: 32, height: 32, borderRadius: 9, background: tl.bg, color: tl.fg, display: 'grid', placeItems: 'center', fontWeight: 600, flex: 'none' }}>{(a.name || '?').match(/[a-z0-9]/i)?.[0]?.toUpperCase() || '?'}</span>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontWeight: 600, color: '#0F1F2B' }}>{a.name}</span>
                                <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6, verticalAlign: 'middle' }}>
                                  {nSubs > 0 ? <span style={{ background: '#E4EDF6', color: '#3A5A80', borderRadius: 999, padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>{nSubs} sub{nSubs > 1 ? 's' : ''}</span> : null}
                                  {a.internet_facing ? <span style={{ background: '#DBE8FA', color: '#28578F', borderRadius: 999, padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>Internet-facing</span> : null}
                                  {a.cde_environment ? <span style={{ background: '#F7D8D8', color: '#A32B2B', borderRadius: 999, padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>CDE</span> : null}
                                  {(a.open_findings ?? 0) > 0 ? <span style={{ background: '#F2D3C6', color: '#6B2412', borderRadius: 999, padding: '1px 7px', fontSize: 9, fontWeight: 600 }}>{a.open_findings} vuln{(a.open_findings ?? 0) > 1 ? 's' : ''}</span> : null}
                                </span>
                                {a.environment ? <span style={{ display: 'block', fontSize: 10.5, color: '#78838F', textTransform: 'capitalize' }}>{a.environment}</span> : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ ...td, textTransform: 'capitalize' }}>{(a.asset_type || '').replace(/_/g, ' ') || '—'}</td>
                          <td style={td}>{a.owner_name ? a.owner_name : <span style={{ color: '#A32B2B', fontWeight: 600 }}>Unassigned</span>}</td>
                          <td style={td}>{ck ? <span style={{ background: ck.bg, color: ck.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{a.criticality}</span> : <span style={{ color: '#B4BDC6' }}>—</span>}</td>
                          <td style={td}>{hasCia(a) ? <span className="mono">{a.confidentiality_rating}·{a.integrity_rating}·{a.availability_rating}</span> : <span style={{ color: '#8A5A0C' }}>— assess</span>}</td>
                          <td style={td}>{lastScan(a)}</td>
                          <td style={td}>{val(a)}</td>
                          <td style={td}>{st && stMap[st] ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#3A4653' }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: stMap[st].c }} />{stMap[st].l}</span> : <span style={{ color: '#B4BDC6' }}>—</span>}</td>
                          <td style={{ ...td, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                            <RowActionsMenu actions={[
                              { key: 'view', label: 'View', icon: Eye, onClick: () => p.onView(a) },
                              { key: 'connect', label: 'Connect', icon: Plug, onClick: () => p.onConnect(a), hidden: !canConnect(a) },
                              { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => p.onEdit(a), hidden: !p.canEdit },
                              { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => p.onDelete(a), variant: 'danger', hidden: !p.canDelete },
                            ]} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 16px', fontSize: 11.5, color: 'var(--muted2)', borderTop: '1px solid var(--bd2)' }}>Empty cells are honest — <b style={{ color: '#55606D' }}>Unassigned</b>, <b style={{ color: '#55606D' }}>—</b> and <b style={{ color: '#55606D' }}>Never</b> mean the fact isn't set.</div>
            </div>
          ) : (
            <div className="fade" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <article className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid var(--bd2)' }}><div><h3 style={{ fontSize: 14 }}>Criticality mix</h3><span style={{ display: 'block', fontSize: 11, color: 'var(--muted2)', marginTop: 2 }}>assets by criticality · {c.total} total</span></div></div>
                <div style={{ padding: '20px 18px' }}>
                  <div style={{ height: 12, borderRadius: 999, overflow: 'hidden', display: 'flex', background: '#EAEEF1' }}>
                    {([['critical', '#C2453F'], ['high', '#DB7B45'], ['medium', '#E0AF33'], ['low', '#17B898']] as const).map(([k, col]) => <i key={k} className="grow" style={{ height: '100%', width: (c.total ? (c.mix[k] / c.total) * 100 : 0) + '%', background: col }} />)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 20, fontSize: 12, color: 'var(--muted)' }}>
                    {([['Critical', 'critical', '#C2453F'], ['High', 'high', '#DB7B45'], ['Medium', 'medium', '#E0AF33'], ['Low', 'low', '#17B898']] as const).map(([lbl, k, col]) => <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: col }} />{lbl}<b className="num" style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{c.mix[k]}</b></span>)}
                  </div>
                </div>
              </article>
              <InventoryScorecard />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
