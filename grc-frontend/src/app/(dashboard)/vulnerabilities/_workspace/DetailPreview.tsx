'use client';

/**
 * DetailPreview — the right-hand split of the Vulnerabilities Workbench
 * master-detail. Given a selected vuln id it loads the detail record (+ its
 * mitigations) and renders a dense preview: header + a tiles grid (Severity /
 * CVSS / EPSS / Priority / SLA / Status) + a mitigation-progress line +
 * KEV / public-exploit flags + a linked-asset count. Open-full →
 * /vulnerabilities/{id}. No page hop — this is the "keep context" preview.
 * Mirrors assets/_workspace/DetailPreview.
 */

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldAlert, Server } from 'lucide-react';
import { vulnManagementApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import type { Vulnerability } from './lib';
import {
  VulnIdTile,
  SeverityCell,
  StatusPill,
  SlaCell,
  PriorityCell,
  priorityBucket,
  InitialsAvatar,
  KevChip,
} from './lib';

// ─── local shapes (defensive; backend returns loose records) ────────────────
type Detail = Record<string, unknown> & Partial<Vulnerability> & {
  public_exploit_count?: number | null;
};
type Mitigation = { id: number; status?: string };

function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}

const DONE_MITIGATION = new Set(['completed', 'done', 'verified', 'closed']);

// ─── small sub-components ───────────────────────────────────────────────────
function Tile({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 text-slate-900">{children}</div>
      {sub != null && <div className="mt-0.5 text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Stat({ count, label, tone }: { count: number; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white px-2 py-2">
      <span className={`text-base font-semibold ${tone || 'text-slate-900'}`}>{count}</span>
      <span className="text-[10px] text-slate-500">{label}</span>
    </div>
  );
}

export function DetailPreview({
  selectedId,
  onOpenFull,
}: {
  selectedId: number | null;
  onOpenFull: (id: number) => void;
}) {
  const enabled = selectedId != null;

  const detailQ = useQuery({
    queryKey: ['vuln-ws-detail', selectedId],
    queryFn: () => vulnManagementApi.vulnerabilities.getById(selectedId as number).then((r) => r.data),
    enabled,
  });
  const mitigationsQ = useQuery({
    queryKey: ['vuln-ws-mitigations', selectedId],
    queryFn: () => vulnManagementApi.mitigations.list(selectedId as number).then((r) => r.data),
    enabled,
  });

  if (selectedId == null) {
    return (
      <div className="card flex min-h-[24rem] items-center justify-center text-sm text-slate-400">
        Select a vulnerability
      </div>
    );
  }

  if (detailQ.isLoading) {
    return (
      <div className="card flex min-h-[24rem] items-center justify-center">
        <PageLoader label="Loading vulnerability…" />
      </div>
    );
  }

  const detail = (detailQ.data ?? {}) as Detail;
  const mitigations = (mitigationsQ.data ?? []) as Mitigation[];

  const title = str(detail.title) ?? 'Untitled vulnerability';
  const severity = str(detail.severity) ?? 'info';
  const status = str(detail.status) ?? 'open';
  const cvss = num(detail.cvss_score);
  const epssPct = num(detail.epss_percentile);
  const priority = num(detail.composite_priority);
  const cve = str(detail.cve_id);
  const cwe = str(detail.cwe_id);
  const owner = str(detail.assignee_name);
  const affectedComponent = str(detail.affected_component);
  const affectedHost = str(detail.affected_host);

  // Meta line — CVE · CWE · affected component.
  const metaParts = [cve, cwe, affectedComponent].filter(Boolean) as string[];

  // Mitigation progress.
  const mitTotal = mitigations.length;
  const mitDone = mitigations.filter((m) => DONE_MITIGATION.has((m.status || '').toLowerCase())).length;
  const mitPct = mitTotal > 0 ? Math.round((mitDone / mitTotal) * 100) : 0;

  // Flags.
  const kev = detail.kev_flag === true;
  const exploitCount = num(detail.public_exploit_count) ?? 0;
  const hasPublicExploit = exploitCount > 0;

  // Linked-asset count.
  const linkedAssets = Array.isArray(detail.linked_assets) ? detail.linked_assets.length : 0;
  const assetSubtotal = linkedAssets + (affectedHost ? 1 : 0);

  // For the SLA + priority tiles we need the same fields SlaCell/PriorityCell use.
  const slaSource: Pick<Vulnerability, 'due_date' | 'severity' | 'status' | 'created_at'> = {
    due_date: str(detail.due_date) ?? undefined,
    severity,
    status,
    created_at: str(detail.created_at) ?? new Date().toISOString(),
  };

  return (
    <div className="card p-0">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
        <VulnIdTile id={selectedId} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">{title}</h3>
            {kev && <KevChip />}
          </div>
          {metaParts.length > 0 && (
            <p className="mt-0.5 truncate font-mono text-xs text-slate-500">{metaParts.join(' · ')}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <SeverityCell severity={severity} cvss={cvss ?? undefined} />
            <StatusPill status={status} />
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {/* Tiles grid */}
        <div className="grid grid-cols-3 gap-2.5">
          <Tile label="CVSS" sub="base score">
            <span className="text-lg font-bold text-slate-900">{cvss != null ? cvss.toFixed(1) : '—'}</span>
          </Tile>
          <Tile label="EPSS" sub={epssPct != null ? 'exploit likelihood' : undefined}>
            <span className="text-lg font-bold text-amber-700">
              {epssPct != null ? `${(epssPct * 100).toFixed(0)}%` : '—'}
            </span>
          </Tile>
          <Tile label="Priority" sub={priority != null ? priorityBucket(priority).label : undefined}>
            {priority != null ? <PriorityCell priority={priority} /> : <span className="text-lg font-bold text-slate-400">—</span>}
          </Tile>
          <Tile label="SLA / Due">
            <SlaCell vuln={slaSource} />
          </Tile>
          <Tile label="Status">
            <StatusPill status={status} />
          </Tile>
          <Tile label="Owner">
            {owner ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-slate-800">
                <InitialsAvatar name={owner} size="sm" /> {owner}
              </span>
            ) : (
              <span className="text-sm text-slate-400">Unassigned</span>
            )}
          </Tile>
        </div>

        {/* Mitigation progress */}
        <div>
          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span>Mitigation progress</span>
            <span className="text-slate-500">{mitDone}/{mitTotal} done</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${mitPct}%` }} />
          </div>
        </div>

        {/* Flags */}
        {(kev || hasPublicExploit) && (
          <div className="flex flex-wrap items-center gap-2">
            {kev && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                Actively exploited (CISA KEV)
              </span>
            )}
            {hasPublicExploit && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.75} />
                {exploitCount} public exploit{exploitCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}

        {/* Related records */}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Related records</div>
          <div className="grid grid-cols-3 gap-2">
            <Stat count={assetSubtotal} label="Assets" tone={assetSubtotal > 0 ? 'text-slate-900' : undefined} />
            <Stat count={mitTotal} label="Mitigations" />
            <Stat count={exploitCount} label="Exploits" tone={exploitCount > 0 ? 'text-rose-600' : undefined} />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
          <Server className="h-3.5 w-3.5" strokeWidth={1.75} />
          {affectedHost || 'No host'}
        </span>
        <button
          type="button"
          onClick={() => onOpenFull(selectedId)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-50"
        >
          Open full record
          <ExternalLink strokeWidth={1.75} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default DetailPreview;
