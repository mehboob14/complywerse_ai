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
import { useSearchParams } from 'next/navigation';
import { registrableDomain, rollupCounts, rollupAssets, isExternalAsset } from '@/cyber-assurance/lib/domains';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/cyber-assurance/lib/api';
import { SCORECARD_QUERY_KEYS } from '@/cyber-assurance/components/dashboard/scorecard-query-keys';
import InventoryScorecard from '@/cyber-assurance/components/dashboard/InventoryScorecard';
import { RowActionsMenu } from './RowActionsMenu';
import { FilterSelect } from './FilterSelect';
import type { ITAsset } from '@/cyber-assurance/types';
import { Search, Download, Plus, AlertTriangle, Eye, Pencil, Trash2, Plug, X } from 'lucide-react';
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

const isExt = (a: ITAsset) => isExternalAsset(a);  // single source of truth (@/lib/domains)
const hasCia = (a: ITAsset) => !!(a.confidentiality_rating && a.integrity_rating && a.availability_rating);
const isStale = (a: ITAsset) => (a.last_seen_at ? (Date.now() - new Date(a.last_seen_at).getTime()) / 864e5 > 30 : false);
const critOf = (a: ITAsset) => (a.criticality || '').toLowerCase();
const typeKey = (a: ITAsset) => (a.asset_type || '').toLowerCase().replace(/[ _-]/g, '');
// Lane-aware type — the stored asset_type is unreliable (web domains saved as
// "infrastructure"), so derive the scan-lane from real signals instead. Lanes
// mirror the New-scan modal: External/Web · Host · Database · Active Directory ·
// Cloud · Code/Repo · Container.
const REPO_RE = /(github\.com|gitlab\.com|bitbucket\.org)|\.git(\/|$)/i;
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const laneOf = (a: ITAsset): string => {
  const t = (a.asset_type || '').toLowerCase();
  const name = a.name || ''; const host = a.host_name || '';
  const ports = a.open_ports || [];
  if (t === 'repository' || REPO_RE.test(name) || REPO_RE.test(host)) return 'repo';
  if (t === 'container' || t === 'kubernetes' || t === 'k8s') return 'container';
  if (t === 'cloud') return 'cloud';
  if (t === 'database' || ports.some((p) => [1433, 1521, 3306, 5432, 6379, 27017].includes(p))) return 'database';
  if (ports.some((p) => [88, 389, 636].includes(p))) return 'ad';
  if (t === 'web' || a.scan_mode === 'easm' || (!!a.internet_facing && DOMAIN_RE.test(name) && !IP_RE.test(name))) return 'web';
  return 'host';
};
const LANE_LABEL: Record<string, string> = { web: 'External / Web', host: 'Host', database: 'Database', ad: 'Active Directory', cloud: 'Cloud', repo: 'Code / Repo', container: 'Container / K8s' };
const laneLabel = (a: ITAsset): string => {
  const l = laneOf(a);
  if (l !== 'host') return LANE_LABEL[l];
  if (a.origin_source === 'agent') return 'Host · Windows';
  if (a.platform_kind === 'server') return 'Host · Server';
  return 'Host';
};
const canConnect = (a: ITAsset) => !!a.host_name && a.discovery_state !== 'unmanaged';
// 3-mode inventory bucket (pentest discovery contract): EASM (domain/website from
// EASM), Uncredential (credential-free network sweep), Credential (full depth —
// credentialed scan OR manual/import; scan_mode null folds into Credential).
const modeOf = (a: ITAsset): 'easm' | 'credential' | 'uncredential' =>
  a.scan_mode === 'easm' ? 'easm' : a.scan_mode === 'uncredential' ? 'uncredential' : 'credential';
// Agent-managed = born from an installed Complyverse agent. origin_source is provenance
// (a host discovered first and given an agent later keeps its origin), which is
// accurate for how agents are deployed here; upgrade to a server agent_managed
// flag if a mid-life agent install must reclassify the row.
const agentManaged = (a: ITAsset) => (a as any).origin_source === 'agent';
const MODE_LABEL: Record<'all' | 'easm' | 'credential' | 'uncredential' | 'agent' | 'pci', string> = { all: 'All', easm: 'EASM', credential: 'Credential', uncredential: 'Uncredential', agent: 'Agent', pci: 'PCI' };

const TILE: Record<string, { bg: string; fg: string }> = {
  application: { bg: '#DBE8FA', fg: '#28578F' }, infrastructure: { bg: '#CFF2E7', fg: '#014A81' },
  data: { bg: '#F6E7C2', fg: '#8A5A0C' }, cloud: { bg: '#E0DAF6', fg: '#5A45B5' }, thirdparty: { bg: '#F6E7C2', fg: '#8A5A0C' },
  repository: { bg: '#D9E7E3', fg: '#0B6B4F' },
};
const CRIT: Record<string, { bg: string; fg: string }> = {
  critical: { bg: '#F7D8D8', fg: '#A32B2B' }, high: { bg: '#F6E7C2', fg: '#8A5A0C' },
  medium: { bg: '#E4E9ED', fg: '#55606D' }, low: { bg: '#D3EEE1', fg: '#186A49' },
};
const CRIT_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

// Uniform pill — nowrap + flex:none so a row's tag line never wraps and every
// row stays the same height (was: verbose tags wrapping unevenly).
const chip = (bg: string, fg: string): React.CSSProperties => ({ background: bg, color: fg, borderRadius: 999, padding: '1px 7px', fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap', flex: 'none' });
const td: React.CSSProperties = { padding: '9px 10px', borderBottom: '1px solid #F0F3F5', color: '#3A4653' };
// Prominent header bar — brand blue, bold white (owner ask). Sticky over the body.
const th: React.CSSProperties = { textAlign: 'left', padding: '9px 10px', borderBottom: '1px solid #0A4C84', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: '#fff', fontWeight: 700, position: 'sticky', top: 0, background: '#005B96', zIndex: 1, whiteSpace: 'nowrap' };
// Clamp wide free-text cells so all columns fit one view without a right-scroll.
const clip: React.CSSProperties = { maxWidth: 128, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
// Sortable columns — click a header to sort by it (replaces the old Sort select).
const HEADS: { key: string; label: string; sortable: boolean }[] = [
  { key: 'name', label: 'Asset', sortable: true },
  { key: 'type', label: 'Type', sortable: true },
  { key: 'owner', label: 'Owner', sortable: true },
  { key: 'department', label: 'Department', sortable: true },
  { key: 'dataclass', label: 'Data Class', sortable: true },
  { key: 'bizfn', label: 'Business Function', sortable: true },
  { key: 'crit', label: 'Criticality', sortable: true },
  { key: 'cia', label: 'CIA', sortable: false },
  { key: 'scan', label: 'Last scan', sortable: true },
  { key: 'value', label: 'Value', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
];
const SORTERS: Record<string, (a: ITAsset, b: ITAsset) => number> = {
  name: (a, b) => (a.name || '').localeCompare(b.name || ''),
  type: (a, b) => laneLabel(a).localeCompare(laneLabel(b)),
  owner: (a, b) => (a.owner_name || '').localeCompare(b.owner_name || ''),
  department: (a, b) => (a.department || '').localeCompare(b.department || ''),
  dataclass: (a, b) => (a.data_classification || '').localeCompare(b.data_classification || ''),
  bizfn: (a, b) => (a.business_function || '').localeCompare(b.business_function || ''),
  crit: (a, b) => (CRIT_ORDER[critOf(a)] || 0) - (CRIT_ORDER[critOf(b)] || 0),
  scan: (a, b) => new Date(a.last_seen_at || 0).getTime() - new Date(b.last_seen_at || 0).getTime(),
  value: (a, b) => (a.valuation || a.purchase_cost || 0) - (b.valuation || b.purchase_cost || 0),
  status: (a, b) => (a.status || '').localeCompare(b.status || ''),
};
const TEXT_SORTS = new Set(['name', 'type', 'owner', 'department', 'dataclass', 'bizfn', 'status']);

// ── EASM subdomain roll-up ──────────────────────────────────────────────────
// registrableDomain (apex) is the full Public Suffix List, imported from @/cyber-assurance/lib/domains.
const dnsName = (a: any) => (a.fqdn || a.host_name || a.name || '').toLowerCase().replace(/\.$/, '').trim();
const isExternalRow = (a: any) => !!(a.internet_facing || a.origin_source === 'easm' || a.last_seen_source === 'external');

export default function InventoryRedesign(p: Props) {
  const assets = p.assets || [];
  // ?view=external|internal|unowned|stale… and ?scan_depth=surface|credentialed — deep links land pre-filtered.
  const sp = useSearchParams();
  const initialView = sp?.get('view') || '';
  const initialMode = sp?.get('scan_mode') || '';
  const [tab, setTab] = useState<'reg' | 'ins'>('reg');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('crit');
  const [dir, setDir] = useState<1 | -1>(-1); // -1 = desc (critical / newest / highest first)
  // Independent filter axes, AND-combined — each its own clearly-labeled top-bar
  // control (was one lumped "Views" select). fFlag is single-select across the
  // non-column flags. shortcut: one flag at a time; add per-flag toggles if a
  // user needs e.g. Internet AND PCI together.
  const [fType, setFType] = useState(['web', 'host', 'database', 'ad', 'cloud', 'repo', 'container'].includes(initialView) ? initialView : '');
  const [fCrit, setFCrit] = useState(['critical', 'high', 'medium', 'low'].includes(initialView) ? initialView : '');
  const [fStatus, setFStatus] = useState('');
  const [fFlag, setFFlag] = useState(['internet', 'cde', 'unowned', 'needcia', 'stale', 'vulns'].includes(initialView) ? initialView : '');
  // Scan-posture axis — EASM / Credentialed / Agentless / Agent (scan_mode from
  // the discovery backend; null folds into Credential via modeOf).
  const [mode, setMode] = useState<'all' | 'easm' | 'credential' | 'uncredential' | 'agent'>(
    ['easm', 'credential', 'uncredential', 'agent'].includes(initialMode) ? (initialMode as any) : 'all');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [openApex, setOpenApex] = useState<Set<string>>(new Set());

  const ov = useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.assets],
    queryFn: async () => { try { return (await apiClient.get('/assets/inventory-overview')).data as any; } catch { return null; } },
  });
  const score: number | null = ov.data?.performance?.score ?? null;
  const grade: string | null = ov.data?.performance?.grade ?? null;
  const openVulns: number = ov.data?.counts?.open_vulnerabilities ?? 0;

  // Advisory exposure — assets matched to a security advisory CVE (verdict=affected).
  // Read-only: no scanning, just the durable applicability rows. [[ava backend owns the data]]
  const adv = useQuery({
    queryKey: ['advisories', 'affected-assets'],
    queryFn: async () => { try { return (await apiClient.get('/advisories/affected-assets')).data as any; } catch { return null; } },
  });
  const affected = useMemo(() => {
    const m = new Map<number, number>();
    for (const g of (adv.data?.assets || [])) m.set(g.asset_id, (g.items || []).length);
    return m;
  }, [adv.data]);
  const advAssetCount: number = adv.data?.total ?? 0;

  const c = useMemo(() => {
    // Canonical roll-up: one registrable (apex) domain = ONE external asset
    // (subdomains folded in), internal assets flat — the shared rule every
    // dashboard uses, so these headline counts reconcile with them. `total` is
    // the rolled-up estate size; the flat per-row count still drives the table.
    const roll = rollupCounts(assets, isExt, dnsName);
    const total = roll.total;
    const external = roll.external;
    // Count every chip over the SAME rolled-up logical set as `total`, not the
    // raw array — otherwise a chip ("Infrastructure 12") exceeds the folded
    // total ("6") because subdomains are counted per-row while total folds them.
    // `logical` = one row per logical asset, so each facet <= total and the chip
    // count matches the rows the table shows when that filter is applied.
    const logical = rollupAssets(assets, isExt, dnsName);
    return {
      total, external, internal: roll.internal,
      critical: logical.filter((a) => critOf(a) === 'critical').length,
      cde: logical.filter((a) => a.cde_environment).length,
      internet: logical.filter((a) => a.internet_facing).length,
      unowned: logical.filter((a) => !a.owner_name).length,
      needcia: logical.filter((a) => !hasCia(a)).length,
      stale: logical.filter(isStale).length,
      scanned: logical.filter((a) => a.last_seen_at).length,
      easmN: logical.filter((a) => modeOf(a) === 'easm').length,
      credN: logical.filter((a) => modeOf(a) === 'credential').length,
      uncredN: logical.filter((a) => modeOf(a) === 'uncredential').length,
      agentN: logical.filter(agentManaged).length,
      byType: (k: string) => logical.filter((a) => typeKey(a) === k).length,
      byLane: (k: string) => logical.filter((a) => laneOf(a) === k).length,
      withVulns: logical.filter((a) => (a.open_findings || 0) > 0).length,
      mix: { critical: logical.filter((a) => critOf(a) === 'critical').length, high: logical.filter((a) => critOf(a) === 'high').length, medium: logical.filter((a) => critOf(a) === 'medium').length, low: logical.filter((a) => critOf(a) === 'low').length },
    };
  }, [assets]);

  const flagOk = (a: ITAsset) =>
    !fFlag
    || (fFlag === 'internet' ? !!a.internet_facing
      : fFlag === 'cde' ? !!a.cde_environment
      : fFlag === 'unowned' ? !a.owner_name
      : fFlag === 'needcia' ? !hasCia(a)
      : fFlag === 'stale' ? isStale(a)
      : fFlag === 'vulns' ? (a.open_findings ?? 0) > 0
      : fFlag === 'advisory' ? affected.has(a.id)
      : true);
  const rows = useMemo(() => {
    const r = assets.filter((a) =>
      (!q || (a.name || '').toLowerCase().includes(q.toLowerCase())) &&
      (!fType || laneOf(a) === fType) &&
      (!fCrit || critOf(a) === fCrit) &&
      (!fStatus || (a.status || '').toLowerCase() === fStatus) &&
      (mode === 'all' ? true : mode === 'agent' ? agentManaged(a) : modeOf(a) === mode) &&
      flagOk(a));
    const cmp = SORTERS[sort] || SORTERS.crit;
    return [...r].sort((a, b) => cmp(a, b) * dir);
  }, [assets, q, sort, dir, fType, fCrit, fStatus, mode, fFlag]);
  // Click a header: same column flips direction, a new column sorts text A→Z and
  // metrics high→low by default.
  const sortBy = (k: string) => { if (sort === k) setDir((d) => (d === 1 ? -1 : 1)); else { setSort(k); setDir(TEXT_SORTS.has(k) ? 1 : -1); } };

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

  const toggle = (id: number) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const selIds = Array.from(sel);


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

  // zoom 0.8 matches the Vulnerability Register's house-compact scale.
  return (
    <div className="inv2 fade" style={{ fontSize: 13.5, zoom: 0.8 }}>
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
          <div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>PCI scope</div><div style={{ margin: '3px 0' }}><b className="num" style={{ fontSize: 17, fontWeight: 600, color: '#28578F' }}>{c.cde}</b></div><div style={{ fontSize: 10.5, color: 'var(--faint)' }}>marked PCI</div></div>
        </div>
        <div className="rib-att">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><AlertTriangle size={16} style={{ color: '#8A5A0C' }} /><span style={{ fontSize: 12, color: '#7A4E0A', fontWeight: 500 }}>Needs attention</span></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            <button className="att" title="Assets with at least one open linked vulnerability" onClick={() => { setFFlag('vulns'); setTab('reg'); }}>{c.withVulns} with vulns</button>
            <button className="att" onClick={() => { setFFlag('unowned'); setTab('reg'); }}>{c.unowned} unowned</button>
            <button className="att" onClick={() => { setFFlag('needcia'); setTab('reg'); }}>{c.needcia} unassessed</button>
            <button className="att" onClick={() => { setFFlag('stale'); setTab('reg'); }}>{c.stale} stale</button>
            <button className="att" title="Assets matched to a published security advisory CVE" style={advAssetCount > 0 ? { background: '#FBD5D5', borderColor: '#E7A3A3', color: '#B42318' } : undefined} onClick={() => { setFFlag('advisory'); setTab('reg'); }}>{advAssetCount} advisory-affected</button>
          </div>
        </div>
      </section>

      {/* WORKSPACE */}
      {/* Sidebar removed — its View/Type filters moved to the top bar dropdown
          below so the register gets the full width. */}
      <div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <div className="segwrap">
              <button className={'seg' + (tab === 'reg' ? ' on' : '')} onClick={() => setTab('reg')}>Register</button>
              <button className={'seg' + (tab === 'ins' ? ' on' : '')} onClick={() => setTab('ins')}>Insights</button>
            </div>
            <div style={{ position: 'relative', flex: 1, minWidth: 170 }}>
              <Search size={16} style={{ position: 'absolute', left: 11, top: 11, color: '#78838F' }} />
              <input className="search" placeholder="Search assets…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {/* One named control per filter dimension — no lumped "Views" grab-bag.
                Column-backed filters (Type/Criticality/Status) sit beside the
                non-column ones (Scan posture, and the Internet/PCI flag chips). */}
            <FilterSelect title="Filter by type (scan lane)" value={fType} onChange={(v) => { setFType(v); setTab('reg'); }}
              options={[
                { value: '', label: `All types (${c.total})` },
                { value: 'web', label: `External / Web (${c.byLane('web')})` },
                { value: 'host', label: `Host (${c.byLane('host')})` },
                { value: 'database', label: `Database (${c.byLane('database')})` },
                { value: 'ad', label: `Active Directory (${c.byLane('ad')})` },
                { value: 'cloud', label: `Cloud (${c.byLane('cloud')})` },
                { value: 'repo', label: `Code / Repo (${c.byLane('repo')})` },
                { value: 'container', label: `Container / K8s (${c.byLane('container')})` },
              ]} />
            <FilterSelect title="Filter by criticality" value={fCrit} onChange={(v) => { setFCrit(v); setTab('reg'); }}
              options={[
                { value: '', label: 'All criticality' },
                { value: 'critical', label: `Critical (${c.mix.critical})` },
                { value: 'high', label: `High (${c.mix.high})` },
                { value: 'medium', label: `Medium (${c.mix.medium})` },
                { value: 'low', label: `Low (${c.mix.low})` },
              ]} />
            <FilterSelect title="Filter by status" value={fStatus} onChange={(v) => { setFStatus(v); setTab('reg'); }}
              options={[
                { value: '', label: 'All status' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'decommissioned', label: 'Decommissioned' },
              ]} />
            <FilterSelect title="Filter by scan posture" value={mode} onChange={(v) => { setMode(v as any); setSel(new Set()); setTab('reg'); }}
              options={[
                { value: 'all', label: `All scans (${c.total})` },
                { value: 'easm', label: `EASM · external (${c.easmN})` },
                { value: 'credential', label: `Credentialed (${c.credN})` },
                { value: 'uncredential', label: `Agentless (${c.uncredN})` },
                { value: 'agent', label: `Agent (${c.agentN})` },
              ]} />
            <button type="button" className={'fchip' + (fFlag === 'internet' ? ' on' : '')} onClick={() => { setFFlag(fFlag === 'internet' ? '' : 'internet'); setTab('reg'); }} title="Internet-facing only">Internet-facing ({c.internet})</button>
            <button type="button" className={'fchip' + (fFlag === 'cde' ? ' on' : '')} onClick={() => { setFFlag(fFlag === 'cde' ? '' : 'cde'); setTab('reg'); }} title="PCI scope only">PCI scope ({c.cde})</button>
            {(fType || fCrit || fStatus || mode !== 'all' || fFlag) && (
              <button type="button" className="fchip" onClick={() => { setFType(''); setFCrit(''); setFStatus(''); setMode('all'); setFFlag(''); }} title="Clear all filters">Clear</button>
            )}
          </div>

          {tab === 'reg' ? (
            <div className="card fade" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {selIds.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#22303B', color: '#fff', fontSize: 12 }}>
                  <b style={{ marginRight: 6 }}>{selIds.length} selected</b>
                  {p.onBulkConnect && <button className="bulkb" onClick={() => p.onBulkConnect!(rows.filter((r) => sel.has(r.id) && canConnect(r)).map((r) => r.id))}>Connect</button>}
                  {p.onBulkUpdate && p.canEdit && (['critical', 'high', 'medium', 'low'] as const).map((k) => <button key={k} className="bulkb" onClick={() => p.onBulkUpdate!(selIds, { criticality: k })}>Set {k[0].toUpperCase() + k.slice(1)}</button>)}
                  {p.onBulkUpdate && p.canEdit && <button className="bulkb" onClick={() => p.onBulkUpdate!(selIds, { cde_environment: true })}>Mark PCI</button>}
                  {p.onBulkUpdate && p.canEdit && <button className="bulkb" onClick={() => p.onBulkUpdate!(selIds, { cde_environment: false })}>Remove PCI</button>}
                  {p.onBulkDelete && p.canDelete && <button className="bulkb danger" onClick={() => { if (confirm(`Delete ${selIds.length} asset(s)? This can't be undone.`)) p.onBulkDelete!(selIds); }}>Delete</button>}
                  <span style={{ flex: 1 }} /><button className="bulkb" onClick={() => setSel(new Set())}>Deselect all</button>
                </div>
              )}
              <div style={{ overflowY: 'auto', overflowX: 'auto', maxHeight: '58vh' }}>
                {mode === 'uncredential' ? (
                  <UncredentialView rows={rows} onOpen={p.onView} />
                ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, tableLayout: 'auto' }}>
                  <thead><tr>
                    <th style={{ ...th, width: 34 }}><input type="checkbox" checked={allChecked} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} style={{ accentColor: '#fff', width: 15, height: 15 }} /></th>
                    {HEADS.map((h) => (
                      <th key={h.key} style={{ ...th, cursor: h.sortable ? 'pointer' : 'default', userSelect: 'none' }}
                        onClick={h.sortable ? () => sortBy(h.key) : undefined}
                        title={h.sortable ? `Sort by ${h.label}` : undefined}>
                        {h.label}{sort === h.key ? <span style={{ marginLeft: 4 }}>{dir === -1 ? '▾' : '▴'}</span> : null}
                      </th>
                    ))}
                    <th style={{ ...th, width: 34 }}>PCI</th>
                    <th style={{ ...th, width: 34 }}></th>
                  </tr></thead>
                  <tbody>
                    {p.loading ? (
                      <tr><td colSpan={14} style={{ ...td, textAlign: 'center', color: '#78838F', padding: 26 }}>Loading…</td></tr>
                    ) : rows.length === 0 ? (
                      <tr><td colSpan={14} style={{ ...td, textAlign: 'center', color: '#78838F', padding: 26 }}>No assets match this view.</td></tr>
                    ) : orderedRows.map((a) => {
                      const tl = TILE[typeKey(a)] || { bg: '#E4E9ED', fg: '#78838F' };
                      const ck = CRIT[critOf(a)];
                      const st = (a.status || '').toLowerCase();
                      const stMap: Record<string, { c: string; l: string }> = { active: { c: '#005B96', l: 'Active' }, inactive: { c: '#AEB6BF', l: 'Inactive' }, decommissioned: { c: '#C2542E', l: 'Decommissioned' } };
                      const nSubs = subCount.get(dnsName(a)) || 0;
                      const isChild = childApexOf.has(a.id);
                      const apexOpen = openApex.has(dnsName(a));
                      return (
                        <tr key={a.id} style={{ cursor: 'pointer' }} className="rrow" onClick={() => p.onView(a)}>
                          <td style={td} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(a.id)} onChange={() => toggle(a.id)} style={{ accentColor: '#014A81', width: 15, height: 15 }} /></td>
                          <td style={td}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 11, paddingLeft: isChild ? 24 : 0 }}>
                              {nSubs > 0 ? (
                                <button type="button" title={(apexOpen ? 'Collapse' : 'Expand') + ' subdomains'}
                                  onClick={(e) => { e.stopPropagation(); setOpenApex((s) => { const n = new Set(s); const k = dnsName(a); if (n.has(k)) n.delete(k); else n.add(k); return n; }); }}
                                  style={{ width: 18, height: 18, flex: 'none', border: 'none', background: 'transparent', cursor: 'pointer', color: '#78838F', fontSize: 12, lineHeight: 1, transform: apexOpen ? 'rotate(90deg)' : 'none', transition: 'transform .12s' }}>▸</button>
                              ) : isChild ? <span style={{ width: 18, flex: 'none', color: '#C4CCD3', textAlign: 'center' }}>└</span> : null}
                              <span style={{ width: 26, height: 26, borderRadius: 7, fontSize: 12, background: tl.bg, color: tl.fg, display: 'grid', placeItems: 'center', fontWeight: 600, flex: 'none' }}>{(a.name || '?').match(/[a-z0-9]/i)?.[0]?.toUpperCase() || '?'}</span>
                              <div style={{ minWidth: 0 }}>
                                <span style={{ fontWeight: 600, color: '#0F1F2B' }}>{a.name}</span>
                                <span style={{ display: 'flex', flexWrap: 'nowrap', gap: 4, marginTop: 3 }}>
                                  {agentManaged(a)
                                    ? <span title="Managed by an installed Complyverse agent (local collector)" style={chip('#CFF2E7', '#0B6B4F')}>Agent</span>
                                    : (a.scan_depth ?? 'credentialed') === 'surface'
                                      ? <span title="Discovered by an agentless sweep — no credentials" style={chip('#EEF1F3', '#6B7787')}>Agentless</span>
                                      : <span title="Credentialed remote scan (deep)" style={chip('#E7F0F8', '#28578F')}>Credentialed</span>}
                                  {nSubs > 0 ? <span style={chip('#E4EDF6', '#3A5A80')}>{nSubs} sub{nSubs > 1 ? 's' : ''}</span> : null}
                                  {a.internet_facing ? <span title="Internet-facing" style={chip('#DBE8FA', '#28578F')}>Internet</span> : null}
                                  {a.cde_environment ? <span title="In PCI scope" style={chip('#F7D8D8', '#A32B2B')}>PCI</span> : null}
                                  {(a.open_findings ?? 0) > 0 ? <span style={chip('#F2D3C6', '#6B2412')}>{a.open_findings} vuln{(a.open_findings ?? 0) > 1 ? 's' : ''}</span> : null}
                                  {affected.has(a.id) ? <span title="Affected by a published security advisory (advisory CVE matches this asset)" style={chip('#FBD5D5', '#B42318')}>{affected.get(a.id)} advisor{(affected.get(a.id) || 0) > 1 ? 'ies' : 'y'}</span> : null}
                                </span>
                                {a.environment ? <span style={{ display: 'block', fontSize: 10.5, color: '#78838F', textTransform: 'capitalize' }}>{a.environment}</span> : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ ...td, ...clip }} title={laneLabel(a)}>{laneLabel(a)}</td>
                          <td style={{ ...td, ...clip }} title={a.owner_name || ''}>{a.owner_name ? a.owner_name : <span style={{ color: '#A32B2B', fontWeight: 600 }}>Unassigned</span>}</td>
                          <td style={{ ...td, ...clip }} title={a.department || ''}>{a.department || <span style={{ color: '#C4CCD3' }}>—</span>}</td>
                          <td style={{ ...td, ...clip, textTransform: 'capitalize' }} title={a.data_classification || ''}>{a.data_classification || <span style={{ color: '#C4CCD3' }}>—</span>}</td>
                          <td style={{ ...td, ...clip }} title={a.business_function || ''}>{a.business_function || <span style={{ color: '#C4CCD3' }}>—</span>}</td>
                          <td style={td}>{ck ? <span style={{ background: ck.bg, color: ck.fg, borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{a.criticality}</span> : <span style={{ color: '#B4BDC6' }}>—</span>}</td>
                          <td style={td}>{hasCia(a) ? <span className="mono">{a.confidentiality_rating}·{a.integrity_rating}·{a.availability_rating}</span> : <span style={{ color: '#8A5A0C' }}>— assess</span>}</td>
                          <td style={td}>{lastScan(a)}</td>
                          <td style={td}>{val(a)}</td>
                          <td style={td}>{st && stMap[st] ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#3A4653' }}><i style={{ width: 7, height: 7, borderRadius: '50%', background: stMap[st].c }} />{stMap[st].l}</span> : <span style={{ color: '#B4BDC6' }}>—</span>}</td>
                          <td style={{ ...td, textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                            {p.onBulkUpdate && p.canEdit ? (
                              <input type="checkbox" checked={!!a.cde_environment}
                                onChange={() => p.onBulkUpdate!([a.id], { cde_environment: !a.cde_environment })}
                                title={a.cde_environment ? 'In PCI scope — click to remove' : 'Mark this asset in PCI scope'}
                                style={{ accentColor: '#A32B2B', width: 15, height: 15, cursor: 'pointer' }} />
                            ) : (
                              <span title={a.cde_environment ? 'In PCI scope' : 'Not in PCI scope'} style={{ color: a.cde_environment ? '#A32B2B' : '#C4CCD3' }}>{a.cde_environment ? '✓' : '—'}</span>
                            )}
                          </td>
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
                )}
              </div>
              <div style={{ padding: '12px 16px', fontSize: 11.5, color: 'var(--muted2)', borderTop: '1px solid var(--bd2)' }}>{mode === 'uncredential' ? 'Credential-free sweep view — click a device for the captured detail; Apply credentials to pull full richness.' : <>Empty cells are honest — <b style={{ color: '#55606D' }}>Unassigned</b>, <b style={{ color: '#55606D' }}>—</b> and <b style={{ color: '#55606D' }}>Never</b> mean the fact isn&rsquo;t set.</>}</div>
            </div>
          ) : (
            <div className="fade" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <article className="card">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 18px', borderBottom: '1px solid var(--bd2)' }}><div><h3 style={{ fontSize: 14 }}>Criticality mix</h3><span style={{ display: 'block', fontSize: 11, color: 'var(--muted2)', marginTop: 2 }}>assets by criticality · {c.total} total</span></div></div>
                <div style={{ padding: '20px 18px' }}>
                  <div style={{ height: 12, borderRadius: 999, overflow: 'hidden', display: 'flex', background: '#EAEEF1' }}>
                    {([['critical', '#C2453F'], ['high', '#DB7B45'], ['medium', '#E0AF33'], ['low', '#005B96']] as const).map(([k, col]) => <i key={k} className="grow" style={{ height: '100%', width: (c.total ? (c.mix[k] / c.total) * 100 : 0) + '%', background: col }} />)}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 16px', marginTop: 20, fontSize: 12, color: 'var(--muted)' }}>
                    {([['Critical', 'critical', '#C2453F'], ['High', 'high', '#DB7B45'], ['Medium', 'medium', '#E0AF33'], ['Low', 'low', '#005B96']] as const).map(([lbl, k, col]) => <span key={k} style={{ display: 'flex', alignItems: 'center', gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 3, background: col }} />{lbl}<b className="num" style={{ marginLeft: 'auto', color: 'var(--ink)' }}>{c.mix[k]}</b></span>)}
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

// ── Uncredential mode — swept hosts grouped by the CIDR they were discovered on.
// Credential-free: we show only what the sweep captured; clicking a device opens
// the detail pop-up. Promotion to full richness happens via the Connect Wizard.
function UncredentialView({ rows, onOpen }: { rows: ITAsset[]; onOpen: (a: ITAsset) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, ITAsset[]>();
    for (const a of rows) { const k = a.network_segment || 'Unknown subnet'; const arr = m.get(k) ?? []; arr.push(a); m.set(k, arr); }
    return Array.from(m.entries()).sort((x, y) => x[0].localeCompare(y[0], undefined, { numeric: true }));
  }, [rows]);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  if (rows.length === 0) {
    return <div style={{ padding: 28, textAlign: 'center', color: '#78838F', fontSize: 12.5 }}>No uncredentialed assets yet. Run a network sweep from Asset Discovery — discovered hosts land here automatically, no credentials needed.</div>;
  }
  return (
    <div>
      {groups.map(([cidr, devs]) => {
        const isClosed = closed.has(cidr);
        return (
          <div key={cidr} style={{ borderBottom: '1px solid #F0F3F5' }}>
            <button type="button"
              onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(cidr)) n.delete(cidr); else n.add(cidr); return n; })}
              style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: '#F7F9FA', padding: '9px 16px', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ color: '#78838F', fontSize: 12, display: 'inline-block', transform: isClosed ? 'none' : 'rotate(90deg)', transition: 'transform .12s' }}>&#9656;</span>
              <span className="mono" style={{ fontWeight: 700, color: '#0F1F2B', fontSize: 12.5 }}>{cidr}</span>
              <span style={{ fontSize: 11, color: '#78838F' }}>swept subnet</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#78838F' }}><b className="num" style={{ color: '#005B96' }}>{devs.length}</b> device{devs.length > 1 ? 's' : ''}</span>
            </button>
            {!isClosed && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <tbody>
                  {devs.map((a) => (
                    <tr key={a.id} className="rrow" style={{ cursor: 'pointer' }} onClick={() => onOpen(a)}>
                      <td style={{ ...td, paddingLeft: 42 }}>
                        <span style={{ fontWeight: 600, color: '#0F1F2B' }}>{a.host_name || a.name || a.ip_address || 'Unknown host'}</span>
                        {a.device_type ? <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 600, color: '#55606D', background: '#EEF1F3', borderRadius: 999, padding: '1px 7px', textTransform: 'capitalize' }}>{a.device_type}</span> : null}
                      </td>
                      <td style={{ ...td, width: 150 }}><span className="mono" style={{ color: '#3A4653' }}>{a.ip_address || '—'}</span></td>
                      <td style={td}>
                        {a.open_ports && a.open_ports.length ? (
                          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                            {a.open_ports.slice(0, 8).map((pt) => <span key={pt} className="mono" style={{ fontSize: 10, color: '#28578F', background: '#E7F0F8', borderRadius: 4, padding: '1px 5px' }}>{pt}</span>)}
                            {a.open_ports.length > 8 ? <span style={{ fontSize: 10, color: '#78838F' }}>+{a.open_ports.length - 8}</span> : null}
                          </span>
                        ) : <span style={{ color: '#B4BDC6' }}>no open ports</span>}
                      </td>
                      <td style={{ ...td, width: 86, textAlign: 'right', color: '#78838F', fontSize: 11 }}>details &rarr;</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Detail pop-up for an uncredential (sweep) device — only the fields the sweep
// captured. "Apply credentials" routes to the Connect Wizard (contract: credit
// via Connect, NOT the old promote-from-unclaimed flow).
function UncredPopup({ asset, onClose, onConnect }: { asset: ITAsset; onClose: () => void; onConnect: (a: ITAsset) => void }) {
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid #F0F3F5', fontSize: 12.5 }}>
      <span style={{ color: '#78838F' }}>{k}</span><span style={{ color: '#0F1F2B', fontWeight: 500, textAlign: 'right', maxWidth: '62%' }}>{v}</span>
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,31,43,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: '#fff', borderRadius: 14, boxShadow: '0 18px 50px rgba(16,24,40,.22)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid #EEF1F3' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 14, color: '#0F1F2B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{asset.host_name || asset.name || asset.ip_address || 'Swept device'}</h3>
            <span style={{ fontSize: 11, color: '#78838F' }}>What the credential-free sweep captured</span>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#78838F', flex: 'none' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '6px 18px 14px' }}>
          <Row k="IP address" v={<span className="mono">{asset.ip_address || '—'}</span>} />
          <Row k="Hostname" v={asset.host_name || '—'} />
          <Row k="Device type" v={<span style={{ textTransform: 'capitalize' }}>{asset.device_type || asset.platform_kind || '—'}</span>} />
          <Row k="Subnet (CIDR)" v={<span className="mono">{asset.network_segment || '—'}</span>} />
          <Row k="Open ports" v={asset.open_ports && asset.open_ports.length ? <span className="mono">{asset.open_ports.join(', ')}</span> : 'none detected'} />
          <Row k="Scan mode" v="Uncredential (sweep)" />
          <Row k="Depth" v={asset.scan_depth === 'credentialed' ? 'Credentialed' : 'Surface / agentless'} />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 18px', borderTop: '1px solid #EEF1F3', background: '#FAFBFC', borderRadius: '0 0 14px 14px' }}>
          <button onClick={onClose} style={{ border: '1px solid #D7DDE2', background: '#fff', borderRadius: 9, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, color: '#3A4653', cursor: 'pointer' }}>Close</button>
          {canConnect(asset) && <button onClick={() => { onConnect(asset); onClose(); }} style={{ border: 'none', background: '#005B96', color: '#fff', borderRadius: 9, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}><Plug size={14} />Apply credentials</button>}
        </div>
      </div>
    </div>
  );
}
