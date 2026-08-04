'use client';

/*
 * VulnerabilitiesPanel — the asset-detail "Vulnerabilities" tab (activeTab === 'vulnerabilities'),
 * restyled into the asset-suite design language (--as-* tokens + as-card / as-mono / as-pill,
 * mirroring the DField / SpecTile / OverviewCard primitives in page.tsx and the delivered
 * _overview-design.tsx cards).
 *
 * PRESENTATION ONLY. This is a drop-in for the JSX that page.tsx renders under
 * `activeTab === 'vulnerabilities'` (AlertsPanel + the inline VulnerabilitiesTab). Every data
 * source, action, table, and empty-state is preserved verbatim — the component only changes how
 * the same props are painted. It fetches nothing and mutates nothing itself; the parent still
 * owns the react-query keys and the link/unlink mutations and passes them in as props.
 *
 * AlertsPanel is a SHARED component (used across entities) that fetches its own data from its
 * assetId/canEdit props — it is rendered unchanged, exactly as the tab does today.
 */

import React from 'react';
import Link from 'next/link';
import { Bug, X } from 'lucide-react';
import { InlineLinkPicker } from '@/components/ui';
import { AlertsPanel } from '@/components/shared/EntityExtras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Statuses that mean a finding is no longer an open item on this asset — the same closed-set
 *  page.tsx uses (register / alerts agree), duplicated here only to count "open" for the header. */
const CLOSED_VULN_STATUSES = new Set([
  'remediated', 'verified', 'closed', 'resolved', 'accepted', 'false_positive', 'auto_closed_decommissioned',
]);
const isOpenVuln = (v: { status?: string | null }) =>
  !CLOSED_VULN_STATUSES.has((v.status || '').toLowerCase());

export interface LinkedVulnerabilityRow {
  link_id?: number;
  vulnerability_id: number;
  vuln_id?: string | null;
  title?: string | null;
  severity?: string | null;
  status?: string | null;
  link_source?: string | null;
  auto_linked?: boolean | null;
}

export interface VulnerabilitiesPanelProps {
  /** For the shared AlertsPanel (self-fetching) at the top of the tab. */
  assetId: number;
  canEdit: boolean;
  /** The asset — only linked_vulnerabilities is read here. */
  asset: { linked_vulnerabilities?: LinkedVulnerabilityRow[] };
  /** The full vulnerability catalogue for the "Link" picker. */
  allVulnerabilities: Array<{ id: number; vuln_id?: string; title?: string; severity?: string; status?: string }>;
  vulnsLoading: boolean;
  onLinkVulnerability: (vulnId: number) => void;
  isLinking: boolean;
  onUnlinkVulnerability: (vulnId: number) => void;
  isUnlinking: boolean;
}

// Severity → warm token pill. Mirrors the register/overview colour ramp: critical→danger,
// high→rust, medium→gold/warn, low→green, info/unknown→slate.
const SEVERITY_PILL: Record<string, { color: string; bg: string }> = {
  critical: { color: 'var(--as-danger-text)', bg: 'var(--as-danger-bg)' },
  high: { color: 'var(--as-rust-text)', bg: 'var(--as-rust-bg)' },
  medium: { color: 'var(--as-warn-text)', bg: 'var(--as-warn-bg)' },
  low: { color: 'var(--as-green)', bg: 'var(--as-green-bg)' },
  info: { color: 'var(--as-slate)', bg: 'var(--as-slate-bg)' },
};
const STATUS_PILL: Record<string, { color: string; bg: string }> = {
  open: { color: 'var(--as-blue)', bg: 'var(--as-blue-bg)' },
  in_progress: { color: 'var(--as-violet)', bg: 'var(--as-violet-bg)' },
  resolved: { color: 'var(--as-green)', bg: 'var(--as-green-bg)' },
  accepted: { color: 'var(--as-slate)', bg: 'var(--as-slate-bg)' },
  false_positive: { color: 'var(--as-slate)', bg: 'var(--as-slate-bg)' },
};
const NEUTRAL_PILL = { color: 'var(--as-slate)', bg: 'var(--as-slate-bg)' };

const LABEL: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: 'var(--as-muted)',
};
const TH: React.CSSProperties = {
  ...LABEL, textAlign: 'left', padding: '10px 16px', background: 'var(--as-subtle)',
  borderBottom: '1px solid var(--as-border)', position: 'sticky', top: 0, whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = {
  padding: '11px 16px', borderBottom: '1px solid var(--as-divider)', verticalAlign: 'middle', minWidth: 0,
};

function Pill({ text, tone }: { text: string; tone: { color: string; bg: string } }) {
  return (
    <span className="as-pill" style={{ color: tone.color, background: tone.bg, fontWeight: 600, letterSpacing: 0.2 }}>
      {text}
    </span>
  );
}

function Tile({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--as-border)', background: 'var(--as-subtle)', padding: '12px 8px', textAlign: 'center', minWidth: 0 }}>
      <div className="as-mono" style={{ fontSize: 22, fontWeight: 600, lineHeight: 1, color: accent && value > 0 ? 'var(--as-danger)' : 'var(--as-ink)' }}>{value}</div>
      <div style={{ fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: 'var(--as-faint)', marginTop: 6 }}>{label}</div>
    </div>
  );
}

export default function VulnerabilitiesPanel({
  assetId,
  canEdit,
  asset,
  allVulnerabilities,
  vulnsLoading,
  onLinkVulnerability,
  isLinking,
  onUnlinkVulnerability,
  isUnlinking,
}: VulnerabilitiesPanelProps) {
  const linked = asset.linked_vulnerabilities ?? [];
  const linkedVulnIds = linked.map((v) => v.vulnerability_id);

  // Picker items — same shape/derivation as the tab today (exclude already-linked).
  const vulnPickerItems = allVulnerabilities
    .filter((v) => !linkedVulnIds.includes(v.id))
    .map((v) => {
      const code = v.vuln_id || `VULN-${v.id}`;
      const title = v.title || 'Untitled vulnerability';
      const sev = v.severity ? ` · ${v.severity}` : '';
      return {
        value: String(v.id),
        label: `${code} — ${title}`,
        subLabel: `${(v.status || '').replace(/_/g, ' ')}${sev}`.trim() || undefined,
      };
    });

  const openCount = linked.filter(isOpenVuln).length;
  const totalCount = linked.length;
  const sevCount = (s: string) => linked.filter((v) => (v.severity || '').toLowerCase() === s).length;

  const picker = (label: string) => (
    <InlineLinkPicker
      triggerLabel={label}
      triggerClassName="as-btn as-btn-primary"
      items={vulnPickerItems}
      isLoading={vulnsLoading || isLinking}
      emptyText="No vulnerabilities available"
      searchPlaceholder="Search vulnerabilities"
      onSelect={(value: string) => onLinkVulnerability(Number(value))}
      popoverWidth={380}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Alerts sit on top — the severity ranking of the very list below, built from the same
          VulnerabilityAssetLink join. Shared component, self-fetching, rendered unchanged. */}
      <AlertsPanel assetId={assetId} canEdit={canEdit} />

      {/* LINKED VULNERABILITIES */}
      <div className="as-card" style={{ overflow: 'hidden' }}>
        {/* header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--as-divider)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
            <Bug className="h-[18px] w-[18px]" style={{ color: 'var(--as-green)', flex: 'none' }} strokeWidth={2} />
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-ink)' }}>Linked Vulnerabilities</span>
            <span style={{ fontSize: 12, color: 'var(--as-faint)', whiteSpace: 'nowrap' }}>
              {openCount} open{totalCount !== openCount ? ` · ${totalCount} total` : ''}
            </span>
          </div>
          {picker('Link Vulnerability')}
        </div>

        {totalCount > 0 ? (
          <>
            {/* summary tiles — derived from the linked list already in props */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10, padding: '16px 20px', borderBottom: '1px solid var(--as-divider)' }}>
              <Tile label="Open" value={openCount} accent />
              <Tile label="Total" value={totalCount} />
              <Tile label="Critical" value={sevCount('critical')} accent />
              <Tile label="High" value={sevCount('high')} accent />
              <Tile label="Medium" value={sevCount('medium')} />
              <Tile label="Low" value={sevCount('low')} />
            </div>

            {/* table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={TH}>ID</th>
                    <th style={TH}>Title</th>
                    <th style={TH}>Severity</th>
                    <th style={TH}>Status</th>
                    <th style={TH}>Source</th>
                    <th style={{ ...TH, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((vuln) => {
                    const sevKey = (vuln.severity || '').toLowerCase();
                    const stKey = (vuln.status || '').toLowerCase();
                    return (
                      <tr key={`${vuln.vulnerability_id}-${vuln.link_id || 'link'}`}>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <span className="as-mono" style={{ fontSize: 12, color: 'var(--as-faint)' }}>
                            {vuln.vuln_id || `VULN-${vuln.vulnerability_id}`}
                          </span>
                        </td>
                        <td style={TD}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500, color: 'var(--as-primary)', minWidth: 0, overflowWrap: 'anywhere' }}>
                            <Bug className="h-4 w-4" style={{ color: 'var(--as-rust)', flex: 'none' }} strokeWidth={2} />
                            {vuln.title || `Vulnerability #${vuln.vulnerability_id}`}
                          </span>
                        </td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <Pill text={vuln.severity || 'unknown'} tone={SEVERITY_PILL[sevKey] || NEUTRAL_PILL} />
                        </td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          <Pill text={(vuln.status || 'unknown').replace(/_/g, ' ')} tone={STATUS_PILL[stKey] || NEUTRAL_PILL} />
                        </td>
                        <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                          {vuln.auto_linked ? (
                            <span
                              className="as-pill"
                              title="Linked automatically by scanner / sync / matcher — review for accuracy"
                              style={{ color: 'var(--as-green)', background: 'var(--as-green-bg)', fontWeight: 600, fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase' }}
                            >
                              Auto
                            </span>
                          ) : vuln.link_source && vuln.link_source !== 'manual' ? (
                            <span style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--as-faint)' }}>
                              {vuln.link_source.replace(/_/g, ' ')}
                            </span>
                          ) : (
                            <span style={{ fontSize: 12, color: 'var(--as-disabled)' }}>manual</span>
                          )}
                        </td>
                        <td style={{ ...TD, whiteSpace: 'nowrap', textAlign: 'right' }}>
                          <Link
                            href={`/vulnerabilities/${vuln.vulnerability_id}`}
                            style={{ fontSize: 13, fontWeight: 600, color: 'var(--as-green)' }}
                          >
                            View
                          </Link>
                          <button
                            onClick={() => onUnlinkVulnerability(vuln.vulnerability_id)}
                            disabled={isUnlinking}
                            title="Unlink Vulnerability"
                            style={{ marginLeft: 12, verticalAlign: 'middle', padding: 4, borderRadius: 6, background: 'transparent', border: 'none', color: 'var(--as-faint)', cursor: isUnlinking ? 'default' : 'pointer', opacity: isUnlinking ? 0.5 : 1 }}
                          >
                            <X className="inline h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          // empty-state — same copy + picker as the tab today
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '48px 20px' }}>
            <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--as-subtle)', border: '1px solid var(--as-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Bug className="h-7 w-7" style={{ color: 'var(--as-disabled)' }} strokeWidth={2} />
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--as-ink)' }}>No Vulnerabilities Linked</div>
            <div style={{ fontSize: 13, color: 'var(--as-faint)', marginTop: 4 }}>Link vulnerabilities to track asset exposure</div>
            <div style={{ marginTop: 16 }}>{picker('Link First Vulnerability')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
