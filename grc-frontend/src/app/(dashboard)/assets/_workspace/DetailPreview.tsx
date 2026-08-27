'use client';

/**
 * DetailPreview — the right-hand split of the Workbench master-detail. Given a
 * selected asset id it loads the detail record (+ coverage analysis), then
 * renders a dense preview: header + a tiles grid (CIA, criticality score,
 * coverage %, CIS, risk, last seen) + an ownership section + a cross-module
 * related-records count grid + footer actions. No page hop — this is the
 * "keep context" preview. Mirrors evidence/_workspace/DetailPreview.
 */

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, ShieldCheck, ScanLine } from 'lucide-react';
import { assetsApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import {
  AssetLetterTile,
  CriticalityPill,
  AssetStatusPill,
  AssetTypePill,
  CiaMeter,
  InitialsAvatar,
  fmtLastSeen,
  assetDisplayName,
} from './lib';

// ─── local shapes (defensive; backend returns loose records) ────────────────
type Detail = Record<string, unknown> & {
  id?: number;
  name?: string;
  ip_address?: string;
  host_name?: string;
  location?: string;
  description?: string;
  asset_type?: string;
  criticality?: string;
  status?: string;
  cde_environment?: boolean;
  ephi_environment?: boolean;
  internet_facing?: boolean;
  network_segment?: string | null;
  data_classification?: string | null;
  confidentiality_rating?: number;
  integrity_rating?: number;
  availability_rating?: number;
  criticality_score?: number | null;
  coverage_percentage?: number;
  last_seen_at?: string | null;
  last_seen_source?: string | null;
  primary_owner_name?: string | null;
  owner_name?: string | null;
  owning_team?: string | null;
  owning_team_name?: string | null;
  business_owner_name?: string | null;
  linked_controls?: unknown[];
  linked_internal_controls?: unknown[];
  linked_framework_controls?: unknown[];
  linked_risks?: unknown[];
  linked_evidence?: unknown[];
  linked_vulnerabilities?: unknown[];
  risk_assessments?: Array<{ assessment_date: string; risk_score: number }>;
};

function num(v: unknown): number | null {
  return typeof v === 'number' && !Number.isNaN(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v : null;
}
function len(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

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

function OwnershipRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-b-0">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium text-slate-800">{v}</span>
    </div>
  );
}

export function DetailPreview({
  selectedId,
  onOpenFull,
  onAssessRisk,
  onScan,
}: {
  selectedId: number | null;
  onOpenFull: (id: number) => void;
  onAssessRisk?: (id: number) => void;
  onScan?: (id: number) => void;
}) {
  const enabled = selectedId != null;

  const detailQ = useQuery({
    queryKey: ['asset-detail', selectedId],
    queryFn: () => assetsApi.getDetail(selectedId as number).then((r) => r.data),
    enabled,
  });
  const coverageQ = useQuery({
    queryKey: ['asset-coverage', selectedId],
    queryFn: () => assetsApi.getCoverageAnalysis(selectedId as number).then((r) => r.data),
    enabled,
  });

  if (selectedId == null) {
    return (
      <div className="card flex min-h-[24rem] items-center justify-center text-sm text-slate-400">
        Select an asset
      </div>
    );
  }

  if (detailQ.isLoading) {
    return (
      <div className="card flex min-h-[24rem] items-center justify-center">
        <PageLoader label="Loading asset…" />
      </div>
    );
  }

  const detail = (detailQ.data ?? {}) as Detail;
  const coverage = (coverageQ.data ?? {}) as { coverage_percentage?: number; cis_score?: number } & Record<string, unknown>;

  const name = assetDisplayName({
    name: str(detail.name) ?? 'Untitled asset',
    ip_address: detail.ip_address,
    host_name: detail.host_name,
    location: detail.location,
  });
  const assetType = str(detail.asset_type);
  const criticality = str(detail.criticality);
  const status = str(detail.status);
  const description = str(detail.description);

  // Meta line — description · network segment · internet-facing.
  const metaParts = [
    description,
    str(detail.network_segment),
    detail.internet_facing != null ? `internet-facing: ${detail.internet_facing ? 'yes' : 'no'}` : null,
  ].filter(Boolean) as string[];

  // Tiles — omit any whose underlying field is absent (don't invent data).
  const cv = num(detail.confidentiality_rating) ?? 0;
  const iv = num(detail.integrity_rating) ?? 0;
  const av = num(detail.availability_rating) ?? 0;
  const hasCia = cv > 0 || iv > 0 || av > 0;

  const critScore = num(detail.criticality_score);
  const coveragePct = num(coverage.coverage_percentage) ?? num(detail.coverage_percentage);
  const cisScore = num(coverage.cis_score);

  const assessments = detail.risk_assessments ?? [];
  const latestAssessment = assessments.length
    ? [...assessments].sort((a, b) => new Date(b.assessment_date).getTime() - new Date(a.assessment_date).getTime())[0]
    : null;
  const riskScore = latestAssessment ? num(latestAssessment.risk_score) : null;

  const lastSeen = fmtLastSeen(detail.last_seen_at);
  const lastSeenSource = str(detail.last_seen_source);

  const critScoreTone =
    critScore == null ? 'text-slate-900'
    : critScore >= 8 ? 'text-rose-600'
    : critScore >= 6 ? 'text-orange-700'
    : critScore >= 4 ? 'text-amber-700'
    : 'text-slate-900';
  const riskTone =
    riskScore == null ? 'text-slate-900'
    : riskScore >= 7 ? 'text-rose-600'
    : riskScore >= 4 ? 'text-amber-700'
    : 'text-emerald-700';

  // Ownership
  const primaryOwner = str(detail.primary_owner_name) ?? str(detail.owner_name);
  const owningTeam = str(detail.owning_team_name) ?? str(detail.owning_team);
  const businessOwner = str(detail.business_owner_name);
  const dataClass = str(detail.data_classification);

  // Related records — cross-module counts from the detail payload.
  const vulnCount = len(detail.linked_vulnerabilities);
  const riskCount = len(detail.linked_risks);
  const controlCount =
    len(detail.linked_controls) + len(detail.linked_internal_controls) + len(detail.linked_framework_controls);
  const evidenceCount = len(detail.linked_evidence);
  const assessmentCount = len(detail.risk_assessments);

  return (
    <div className="card p-0">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
        <AssetLetterTile name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">{name}</h3>
            {detail.cde_environment && (
              <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-rose-700">CDE</span>
            )}
            {detail.ephi_environment && (
              <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-indigo-700">ePHI</span>
            )}
          </div>
          {metaParts.length > 0 && (
            <p className="mt-0.5 truncate text-xs text-slate-500">{metaParts.join(' · ')}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {criticality && <CriticalityPill criticality={criticality} />}
            {status && <AssetStatusPill status={status} />}
            {assetType && <AssetTypePill type={assetType} />}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {/* Tiles grid */}
        <div className="grid grid-cols-3 gap-2.5">
          {hasCia && (
            <Tile label="CIA" sub={`${cv} / ${iv} / ${av}`}>
              <CiaMeter c={cv} i={iv} a={av} />
            </Tile>
          )}
          {critScore != null && (
            <Tile label="Criticality" sub="ISO 27005 score">
              <span className={`text-lg font-bold ${critScoreTone}`}>{critScore}</span>
            </Tile>
          )}
          {coveragePct != null && (
            <Tile label="Coverage">
              <span className="text-lg font-bold text-slate-900">{Math.round(coveragePct)}%</span>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-primary-500" style={{ width: `${Math.min(100, Math.max(0, coveragePct))}%` }} />
              </div>
            </Tile>
          )}
          {cisScore != null && (
            <Tile label="CIS score" sub="weakest link">
              <span className="text-lg font-bold text-amber-700">{Math.round(cisScore)}</span>
            </Tile>
          )}
          {riskScore != null && (
            <Tile label="Risk score" sub={latestAssessment ? 'last assessed' : undefined}>
              <span className={`text-lg font-bold ${riskTone}`}>{riskScore.toFixed(1)}</span>
            </Tile>
          )}
          <Tile label="Last seen" sub={lastSeenSource || undefined}>
            <span className={`text-sm font-semibold ${lastSeen.stale ? 'text-rose-600' : 'text-slate-900'}`}>{lastSeen.label}</span>
          </Tile>
        </div>

        {/* Ownership */}
        {(primaryOwner || owningTeam || businessOwner || dataClass) && (
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Ownership</div>
            {primaryOwner && (
              <OwnershipRow
                k="Primary owner"
                v={<span className="inline-flex items-center gap-1.5"><InitialsAvatar name={primaryOwner} size="sm" /> {primaryOwner}</span>}
              />
            )}
            {owningTeam && <OwnershipRow k="Owning team" v={owningTeam} />}
            {businessOwner && <OwnershipRow k="Business owner" v={businessOwner} />}
            {dataClass && <OwnershipRow k="Data classification" v={<span className="capitalize">{dataClass}</span>} />}
          </div>
        )}

        {/* Related records */}
        <div>
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Related records</div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <Stat count={vulnCount} label="Vulns" tone={vulnCount > 0 ? 'text-rose-600' : undefined} />
            <Stat count={riskCount} label="Risks" />
            <Stat count={controlCount} label="Controls" />
            <Stat count={evidenceCount} label="Evidence" />
            <Stat count={assessmentCount} label="Assess." />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
        {onAssessRisk && (
          <button
            type="button"
            onClick={() => onAssessRisk(selectedId)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ShieldCheck strokeWidth={1.75} className="h-4 w-4" />
            Assess risk
          </button>
        )}
        {onScan && (
          <button
            type="button"
            onClick={() => onScan(selectedId)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            <ScanLine strokeWidth={1.75} className="h-4 w-4" />
            Scan
          </button>
        )}
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
