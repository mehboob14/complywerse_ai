'use client';

/**
 * Register TABLE view for the Assets workspace. Dense, presentational table
 * built on the shipped DataTable<ITAsset>. Columns: Asset · Type · Owner ·
 * Criticality · CIA · Status · Lifecycle · Last seen · Actions. The shell owns
 * filtering / data / handlers. Owner, criticality, CIA, status, lifecycle and
 * staleness are all visible without expanding a row (Snapshot Test: pass).
 */

import { useMemo, useState } from 'react';
import { Eye, Pencil, Trash2, Plug, Server, ChevronRight, ChevronDown } from 'lucide-react';
import {
  DataTable,
  type ColumnDef,
  type BulkAction,
} from '@/components/ui';
import type { ITAsset } from '@/types';
import {
  AssetTypePill,
  CriticalityPill,
  AssetStatusPill,
  CiaMeter,
  OwnerCell,
  LifecycleDots,
  AssetLetterTile,
  LastSeenCell,
  assetDisplayName,
} from './lib';
import { RowActionsMenu } from './RowActionsMenu';

// A row is connectable only when we have a host to reach AND it isn't an
// unmanaged, evidence-only asset (e.g. an external EASM finding you can't log
// into from outside). Mirrors the Connect gate on the asset-detail page.
const canConnect = (a: ITAsset): boolean => !!a.host_name && a.discovery_state !== 'unmanaged';

// ── Subdomain nesting ───────────────────────────────────────────────────────
// Render EASM subdomains directly under their apex domain ("show the subnames
// under the main domain" — owner). Visual only: ordering + indent, nothing is
// hidden. Apex = registrable domain; a minimal ccTLD second-level set covers the
// co.uk / com.pk shapes we actually see (not the full Public Suffix List).
const TWO_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'co.pk', 'com.pk', 'org.pk', 'net.pk',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.in', 'co.za', 'com.br',
]);
function registrableDomain(host: string): string {
  const h = (host || '').toLowerCase().replace(/\.$/, '').trim();
  if (!h || !h.includes('.') || h.includes(':') || /^[\d.]+$/.test(h)) return '';
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  return TWO_LABEL_SUFFIXES.has(parts.slice(-2).join('.'))
    ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}
const dnsName = (a: ITAsset) =>
  (a.fqdn || a.host_name || a.name || '').toLowerCase().replace(/\.$/, '').trim();
const isExternalRow = (a: ITAsset) =>
  !!(a.internet_facing || a.origin_source === 'easm' || a.last_seen_source === 'external');

export interface RegisterViewProps {
  rows: ITAsset[];
  loading?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
  canCreate?: boolean;
  onView: (asset: ITAsset) => void;
  onEdit: (asset: ITAsset) => void;
  onDelete: (asset: ITAsset) => void;
  onConnect: (asset: ITAsset) => void;
  /** Bulk-connect — passed the selected asset ids; wired to the page's handler. */
  onBulkConnect?: (ids: number[]) => void;
  /** Bulk delete / field-update — selected ids (+ patch) → page handlers. */
  onBulkDelete?: (ids: number[]) => void;
  onBulkUpdate?: (ids: number[], patch: Record<string, unknown>) => void;
}

export function RegisterView({
  rows,
  loading = false,
  canEdit = false,
  canDelete = false,
  canCreate = false,
  onView,
  onEdit,
  onDelete,
  onConnect,
  onBulkConnect,
  onBulkDelete,
  onBulkUpdate,
}: RegisterViewProps) {
  void canCreate;
  const list = rows ?? [];
  const [openApex, setOpenApex] = useState<Set<string>>(() => new Set());
  // Two-category lens: internal hosts (Ubuntu/Windows/…) vs external /
  // internet-facing assets (EASM). Shown only when both kinds are present.
  const [cat, setCat] = useState<'all' | 'internal' | 'external'>('all');

  // Cluster EASM/internet-facing subdomains under their apex. Internal hosts
  // are never grouped (a db.corp.local must not nest under an unrelated apex).
  // Children stay hidden until the apex row is expanded — pagination used to
  // split a flat indent list so subdomains looked "merged away".
  const { childrenByApex, childApex, subCount, apexByName, orderedRows } = useMemo(() => {
    const present = new Map<string, ITAsset>();
    for (const a of list) {
      const n = dnsName(a);
      if (n && isExternalRow(a)) present.set(n, a);
    }
    const kids = new Map<string, ITAsset[]>();
    const childOf = new Map<number, string>();
    const counts = new Map<string, number>();
    for (const a of list) {
      if (!isExternalRow(a)) continue;
      const name = dnsName(a);
      const apex = registrableDomain(name);
      if (!apex || name === apex || !present.has(apex)) continue;
      const arr = kids.get(apex) ?? [];
      arr.push(a);
      kids.set(apex, arr);
      childOf.set(a.id, apex);
    }
    kids.forEach((arr, apex) => {
      arr.sort((x, y) => dnsName(x).localeCompare(dnsName(y)));
      counts.set(apex, arr.length);
    });
    const display: ITAsset[] = [];
    const seen = new Set<number>();
    for (const a of list) {
      if (childOf.has(a.id)) continue;
      display.push(a);
      seen.add(a.id);
      const apexName = dnsName(a);
      if (openApex.has(apexName) && kids.has(apexName)) {
        for (const k of kids.get(apexName)!) {
          display.push(k);
          seen.add(k.id);
        }
      }
    }
    for (const a of list) if (!seen.has(a.id) && !childOf.has(a.id)) display.push(a);
    return { childrenByApex: kids, childApex: childOf, subCount: counts, apexByName: present, orderedRows: display };
  }, [list, openApex]);

  const columns: ColumnDef<ITAsset>[] = [
    {
      id: 'asset',
      header: 'Asset',
      accessor: (a) => assetDisplayName(a),
      sortable: childrenByApex.size === 0,
      minWidth: '200px',
      render: (a) => {
        const name = assetDisplayName(a);
        const TT: Record<string, { bg: string; fg: string }> = { application: { bg: '#E7ECF4', fg: '#2E5EAA' }, data: { bg: '#F6E8D4', fg: '#8A4A0F' }, infrastructure: { bg: '#EDECEA', fg: '#55606B' }, cloud: { bg: '#EDE7F4', fg: '#7A5CA8' }, third_party: { bg: '#F6E8D4', fg: '#C2542E' } };
        const tt = TT[(a.asset_type || '').toLowerCase()] || { bg: '#EDECEA', fg: '#55606B' };
        const n = a.open_findings ?? 0;
        const apexOf = childApex.get(a.id);
        const kids = subCount.get(dnsName(a)) ?? 0;
        const expanded = openApex.has(dnsName(a));
        const parent = apexOf ? apexByName.get(apexOf) : undefined;
        const sameIp = !!(apexOf && a.ip_address && parent?.ip_address && a.ip_address === parent.ip_address);
        return (
          <div className="flex items-center gap-3" style={apexOf ? { paddingLeft: 28 } : undefined}>
            {kids > 0 && (
              <button
                type="button"
                aria-label={expanded ? 'Collapse subdomains' : 'Show subdomains'}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenApex((prev) => {
                    const next = new Set(prev);
                    const key = dnsName(a);
                    if (next.has(key)) next.delete(key); else next.add(key);
                    return next;
                  });
                }}
                style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 18, height: 18, border: 0, background: 'transparent', color: '#2E5EAA', padding: 0, cursor: 'pointer' }}
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            )}
            {apexOf && <span title={`Subdomain of ${apexOf}`} style={{ flex: 'none', color: 'var(--as-faint)', fontSize: 14, marginLeft: kids ? 0 : -8, marginRight: -2 }}>↳</span>}
            <span style={{ width: 30, height: 30, borderRadius: 8, background: tt.bg, color: tt.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flex: 'none' }}>{(name.match(/[a-z0-9]/i)?.[0] || '?').toUpperCase()}</span>
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate" style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-ink)' }}>{name}</span>
                {kids > 0 ? <span title={`${kids} subdomain${kids > 1 ? 's' : ''} under this domain — click the arrow to ${expanded ? 'hide' : 'list'} them`} style={{ flex: 'none', fontSize: 9, fontWeight: 700, color: '#2E5EAA', background: '#E7ECF4', borderRadius: 4, padding: '2px 5px' }}>{kids} sub{kids > 1 ? 's' : ''}</span> : null}
                {sameIp ? <span title={`Shares IP ${a.ip_address} with ${apexOf}`} style={{ flex: 'none', fontSize: 9, fontWeight: 700, color: '#5C4A1A', background: '#F4ECD2', borderRadius: 4, padding: '2px 5px' }}>same IP</span> : null}
                {n > 0 && <span style={{ flex: 'none', fontSize: 10, fontWeight: 700, color: '#7A2D17', background: '#F7E4DC', borderRadius: 99, padding: '2px 7px' }}>{n} vuln{n > 1 ? 's' : ''}</span>}
                {a.cde_environment && <span style={{ flex: 'none', fontSize: 9, fontWeight: 700, color: '#7A2D17', background: '#F7E4DC', borderRadius: 4, padding: '2px 5px' }}>CDE</span>}
                {a.internet_facing && <span style={{ flex: 'none', fontSize: 9, fontWeight: 700, color: '#8A4A0F', background: '#F6E8D4', borderRadius: 4, padding: '2px 5px' }} title="Exposed to the public internet">Internet-facing</span>}
              </div>
              {apexOf
                ? <div style={{ fontSize: 11, color: 'var(--as-muted)' }}>under {apexOf}{a.ip_address ? ` · ${a.ip_address}` : ''}</div>
                : (a.environment && <div className="capitalize" style={{ fontSize: 11.5, color: 'var(--as-muted)' }}>{a.environment}</div>)}
            </div>
          </div>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      accessor: 'asset_type',
      minWidth: '90px',
      render: (a) => <span className="capitalize" style={{ fontSize: 12.5, color: 'var(--as-primary)' }}>{(a.asset_type || '').replace('_', ' ')}</span>,
    },
    {
      id: 'owner',
      header: 'Owner',
      accessor: 'owner_name',
      minWidth: '110px',
      render: (a) => a.owner_name
        ? <span style={{ fontSize: 12.5, color: 'var(--as-primary)' }}>{a.owner_name}</span>
        : <span style={{ fontSize: 12.5, color: '#C2542E' }}>Unassigned</span>,
    },
    {
      id: 'criticality',
      header: 'Criticality',
      accessor: 'criticality',
      sortable: childrenByApex.size === 0,
      minWidth: '92px',
      render: (a) => {
        const k = (a.criticality || '').toLowerCase();
        const col = k === 'critical' ? { fg: '#7A2D17', bg: '#F7E4DC' } : k === 'high' ? { fg: '#8A4A0F', bg: '#F6E8D4' } : k === 'medium' ? { fg: '#8A4A0F', bg: '#F4ECD2' } : { fg: '#0E5A46', bg: '#E2EDE8' };
        return <span className="capitalize" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, color: col.fg, background: col.bg, borderRadius: 99, padding: '3px 10px' }}>{a.criticality || '—'}</span>;
      },
    },
    {
      id: 'cia',
      header: 'CIA',
      minWidth: '64px',
      render: (a) => {
        const c = a.confidentiality_rating, i = a.integrity_rating, v = a.availability_rating;
        return (c && i && v)
          ? <span className="as-mono" style={{ fontSize: 12, color: 'var(--as-primary)' }}>{c}·{i}·{v}</span>
          : <span style={{ fontSize: 11.5, color: '#B08420' }}>— assess</span>;
      },
    },
    {
      id: 'lifecycle',
      header: 'Lifecycle',
      minWidth: '74px',
      render: (a) => {
        // Same defect: an unset lifecycle_state defaulted to 'active' and lit
        // 2 of 4 segments, so every asset looked like it had progressed
        // halfway through a lifecycle nobody had recorded.
        const k = (a.lifecycle_state || '').toLowerCase();
        if (!k) {
          return <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }} title="Lifecycle stage not set">—</span>;
        }
        const st = k === 'planned' ? { n: 1, c: '#0E5A46' } : (k === 'maintenance' || k === 'aging') ? { n: 3, c: '#B08420' } : (k === 'decommissioned' || k === 'retired' || k === 'retiring') ? { n: 4, c: '#C2542E' } : { n: 2, c: '#0E5A46' };
        return <span style={{ display: 'flex', gap: 3, alignItems: 'center' }}>{[1, 2, 3, 4].map((seg) => <span key={seg} style={{ width: 11, height: 5, borderRadius: 3, background: seg <= st.n ? st.c : 'var(--as-track)' }} />)}</span>;
      },
    },
    {
      id: 'scan',
      header: 'Scan',
      accessor: 'last_seen_at',
      sortable: childrenByApex.size === 0,
      minWidth: '72px',
      render: (a) => {
        if (!a.last_seen_at) return <span className="as-mono" style={{ fontSize: 12, color: '#C2542E' }}>Never</span>;
        const days = Math.floor((Date.now() - new Date(a.last_seen_at).getTime()) / 864e5);
        const label = days <= 0 ? 'today' : days < 365 ? `${days}d ago` : `${Math.floor(days / 365)}y ago`;
        return <span className="as-mono" style={{ fontSize: 12, color: days > 30 ? '#C2542E' : 'var(--as-secondary)' }}>{label}</span>;
      },
    },
    {
      id: 'value',
      header: 'Value',
      accessor: 'valuation',
      sortable: childrenByApex.size === 0,
      minWidth: '66px',
      render: (a) => {
        // Only a REAL figure. The previous version fell back to a hardcoded
        // table (critical 500k / high 200k / medium 75k / low 20k) so the
        // column was "never blank" — which meant an asset nobody had valued
        // printed a dollar amount derived purely from its criticality bucket.
        // A promoted application inherited that bucket too, so one laptop
        // showed as $200K twice. A currency figure in a register gets copied
        // into board packs; it must come from finance, not from a lookup.
        const explicit = a.valuation || a.purchase_cost;
        if (!explicit) {
          return (
            <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }}
              title="No valuation or purchase cost recorded. Set one on the asset.">—</span>
          );
        }
        const v = explicit;
        const m = v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}K` : `$${Math.round(v)}`;
        return (
          <span className="as-mono" style={{ fontSize: 12.5, color: 'var(--as-primary)' }}>{m}</span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      accessor: 'status',
      minWidth: '92px',
      render: (a) => {
        // `|| 'active'` used to paint a green "Active" dot on every row whose
        // status column was simply never set — the creation default. It read
        // as a live observation of the machine; it was the absence of one.
        const m: Record<string, { c: string; label: string }> = { active: { c: '#0E5A46', label: 'Active' }, inactive: { c: '#55606B', label: 'Inactive' }, decommissioned: { c: '#C2542E', label: 'Decommissioned' } };
        const raw = (a.status || '').toLowerCase();
        if (!raw) {
          return <span style={{ fontSize: 11.5, color: 'var(--as-faint)' }} title="Lifecycle status not set">—</span>;
        }
        const s = m[raw] || m.active;
        return <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600, color: s.c }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: s.c }} />{s.label}</span>;
      },
    },
    // Extra columns — hidden by default (available via the Columns toggle) so
    // the register matches the handoff's clean 10-column default.
    {
      id: 'environment',
      header: 'Environment',
      accessor: 'environment',
      hidden: true,
      minWidth: '100px',
      render: (a) => a.environment
        ? <span className="capitalize" style={{ fontSize: 12, color: 'var(--as-secondary)' }}>{a.environment}</span>
        : <span style={{ color: 'var(--as-disabled)' }}>—</span>,
    },
    {
      id: 'department',
      header: 'Department',
      accessor: 'department',
      hidden: true,
      minWidth: '120px',
      render: (a) => <span style={{ fontSize: 12, color: 'var(--as-secondary)' }}>{a.department || '—'}</span>,
    },
    {
      id: 'risk',
      header: 'Risk',
      accessor: 'criticality_score',
      hidden: true,
      sortable: childrenByApex.size === 0,
      minWidth: '70px',
      render: (a) => a.criticality_score != null
        ? <span className="as-mono" style={{ fontSize: 12, fontWeight: 600, color: a.criticality_score >= 7.5 ? '#C2542E' : a.criticality_score >= 5 ? '#B08420' : '#0E5A46' }}>{a.criticality_score.toFixed(1)}</span>
        : <span style={{ color: 'var(--as-disabled)' }}>—</span>,
    },
    {
      id: 'actions',
      header: '',
      minWidth: '60px',
      render: (a) => (
        <div onClick={(e) => e.stopPropagation()}>
          <RowActionsMenu
            actions={[
              { key: 'view', label: 'View', icon: Eye, onClick: () => onView(a) },
              { key: 'connect', label: 'Connect', icon: Plug, onClick: () => onConnect(a), hidden: !canConnect(a) },
              { key: 'edit', label: 'Edit', icon: Pencil, onClick: () => onEdit(a), hidden: !canEdit },
              { key: 'delete', label: 'Delete', icon: Trash2, onClick: () => onDelete(a), variant: 'danger', hidden: !canDelete },
            ]}
          />
        </div>
      ),
    },
  ];

  // Bulk-connect — only connectable assets are sent. Unmanaged/evidence-only
  // rows (e.g. external EASM findings) are dropped here so a sweep never tries a
  // login that can't succeed. We hand the page's existing bulk-connect handler
  // the filtered id set (it already resolves platform + filters by host).
  const bulkActions: BulkAction<ITAsset>[] = [];
  if (onBulkConnect) {
    bulkActions.push({
      id: 'connect', label: 'Connect', icon: Plug,
      onClick: (selected) => onBulkConnect(selected.filter(canConnect).map((a) => a.id)),
    });
  }
  if (onBulkUpdate && canEdit) {
    (['critical', 'high', 'medium', 'low'] as const).forEach((c) => {
      bulkActions.push({
        id: 'set-crit-' + c,
        label: 'Set ' + c[0].toUpperCase() + c.slice(1),
        onClick: (selected) => onBulkUpdate(selected.map((a) => a.id), { criticality: c }),
      });
    });
  }
  if (onBulkDelete && canDelete) {
    bulkActions.push({
      id: 'delete', label: 'Delete', icon: Trash2,
      onClick: (selected) => {
        if (window.confirm(`Delete ${selected.length} asset(s)? This can't be undone.`)) {
          onBulkDelete(selected.map((a) => a.id));
        }
      },
    });
  }

  const extCount = list.filter(isExternalRow).length;
  const intCount = list.length - extCount;
  const bothKinds = extCount > 0 && intCount > 0;
  const visibleRows = cat === 'all' || !bothKinds
    ? orderedRows
    : orderedRows.filter((a) => (cat === 'external') === isExternalRow(a));

  const seg = (id: 'all' | 'internal' | 'external', label: string, n: number) => {
    const active = cat === id;
    return (
      <button
        key={id}
        type="button"
        onClick={() => setCat(id)}
        style={{
          fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 8, whiteSpace: 'nowrap',
          border: '1px solid ' + (active ? '#0d5c48' : 'var(--as-border)'),
          background: active ? '#0d5c48' : '#fff', color: active ? '#fff' : 'var(--as-ink)', cursor: 'pointer',
        }}
      >
        {label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span>
      </button>
    );
  };

  return (
    <div>
      {bothKinds && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {seg('all', 'All assets', list.length)}
          {seg('internal', 'Internal', intCount)}
          {seg('external', 'External · internet-facing', extCount)}
        </div>
      )}
      <DataTable<ITAsset>
        data={visibleRows}
        columns={columns}
        loading={loading}
        selectable={bulkActions.length > 0}
        bulkActions={bulkActions}
        bulkBarVariant="dark"
        exportable
        exportFilename="asset-inventory"
        searchable={false}
        pageSize={50}
        stickyHeader
        onRowClick={(a) => onView(a)}
        emptyMessage="No assets match the current filters."
        emptyIcon={Server}
      />
    </div>
  );
}

export default RegisterView;
