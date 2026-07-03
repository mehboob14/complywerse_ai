'use client';

/**
 * DetailPreview — the right-hand split of the Workbench master-detail workbench.
 * Given a selected evidence id it loads detail + assessment + clause mappings +
 * cross-links + controls (each its own query key), then renders a dense preview:
 * header + quality/OCR/validity tiles + applicable frameworks + cross-module counts
 * + footer actions. No page hop — this is the "keep context" preview.
 */

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, FileText, RefreshCw, CheckCircle2, ScanText } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import {
  StatusPill,
  ExpiryStatus,
  QualityBar,
  FrameworkTagPill,
  deriveApplicableFrameworks,
  normPct,
  fmtDate,
  ownerOf,
  type EvidenceItem,
} from './lib';
import {
  fetchDetail,
  fetchAssessment,
  fetchClauseMappings,
  fetchAllLinks,
  fetchControls,
} from './api';

// ─── local shapes (defensive; backend returns loose records) ────────────────
type Detail = Partial<EvidenceItem> & Record<string, unknown>;
interface ByFramework {
  framework_name: string;
  controls?: unknown[];
}
interface ControlsResp {
  total_mappings?: number;
  by_framework?: ByFramework[];
}
interface LinkGroup {
  total?: number;
}
interface AllLinks {
  risks?: LinkGroup;
  assets?: LinkGroup;
  incidents?: LinkGroup;
  policy_statements?: LinkGroup;
}
interface ClauseMapping {
  framework_name?: string;
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

// ─── small sub-components ───────────────────────────────────────────────────
function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1.5 text-sm text-slate-900">{children}</div>
    </div>
  );
}

function Stat({ count, label }: { count: number; label: string }) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-slate-200 bg-white px-2 py-2">
      <span className="text-base font-semibold text-slate-900">{count}</span>
      <span className="text-[11px] text-slate-500">{label}</span>
    </div>
  );
}

export function DetailPreview({
  evidenceId,
  onOpenFull,
  onApprove,
  onReassess,
  onOpenFile,
  canReview,
}: {
  evidenceId: number | null;
  onOpenFull: (id: number) => void;
  onApprove: (id: number) => void;
  onReassess: (id: number) => void;
  onOpenFile: (id: number) => void;
  canReview?: boolean;
}) {
  const enabled = evidenceId != null;

  const detailQ = useQuery({
    queryKey: ['evidence-detail', evidenceId],
    queryFn: () => fetchDetail(evidenceId as number),
    enabled,
  });
  const assessmentQ = useQuery({
    queryKey: ['evidence-assessment', evidenceId],
    queryFn: () => fetchAssessment(evidenceId as number),
    enabled,
  });
  const clausesQ = useQuery({
    queryKey: ['evidence-clauses', evidenceId],
    queryFn: () => fetchClauseMappings(evidenceId as number),
    enabled,
  });
  const linksQ = useQuery({
    queryKey: ['evidence-all-links', evidenceId],
    queryFn: () => fetchAllLinks(evidenceId as number),
    enabled,
  });
  const controlsQ = useQuery({
    queryKey: ['evidence-controls', evidenceId],
    queryFn: () => fetchControls(evidenceId as number),
    enabled,
  });

  if (evidenceId == null) {
    return (
      <div className="card flex min-h-[24rem] items-center justify-center text-sm text-slate-400">
        Select an item to preview
      </div>
    );
  }

  if (detailQ.isLoading) {
    return (
      <div className="card flex min-h-[24rem] items-center justify-center">
        <PageLoader label="Loading evidence…" />
      </div>
    );
  }

  const detail = (detailQ.data ?? {}) as Detail;
  const assessment = (assessmentQ.data ?? null) as Record<string, unknown> | null;
  const clauses = (clausesQ.data ?? []) as ClauseMapping[];
  const links = (linksQ.data ?? {}) as AllLinks;
  const controls = (controlsQ.data ?? {}) as ControlsResp;

  const name = str(detail.name) ?? 'Untitled evidence';
  const status = str(detail.status) ?? 'draft';
  const fileName = str(detail.file_name);
  const version = num(detail.version);
  const committee = str(detail.committee_name);
  const owner = ownerOf({
    owner_name: (detail.owner_name as string | null) ?? null,
    uploader_name: (detail.uploader_name as string | null) ?? null,
  });

  const metaParts = [
    fileName,
    version != null ? `v${version}` : null,
    committee || '—',
    owner,
  ].filter(Boolean) as string[];

  const qualityPct =
    normPct(num(detail.quality_score)) ??
    normPct(num(assessment?.audit_readiness));

  const ocrStatus = str(detail.ocr_status) ?? 'Not processed';
  const collection = str(detail.collection_date);
  const expiry = str(detail.expiry_date);

  const byFramework = controls.by_framework ?? [];
  const frameworks = deriveApplicableFrameworks(
    byFramework,
    clauses.map((c) => c.framework_name).filter(Boolean) as string[],
    (assessment?.compliance_frameworks as string[] | undefined) ?? [],
  );

  const controlCount = controls.total_mappings ?? 0;
  const frameworkCount = byFramework.length;
  const riskCount = links.risks?.total ?? 0;
  const assetCount = links.assets?.total ?? 0;
  const incidentCount = links.incidents?.total ?? 0;
  const policyCount = links.policy_statements?.total ?? 0;

  return (
    <div className="card p-0">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-slate-900">{name}</h3>
          <p className="mt-0.5 truncate text-xs text-slate-500">{metaParts.join(' · ')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={status} />
          {canReview && status === 'pending_review' && (
            <button
              type="button"
              onClick={() => onApprove(evidenceId)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-700"
            >
              <CheckCircle2 strokeWidth={1.75} className="h-4 w-4" />
              Approve
            </button>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 py-4">
        {/* Quality / OCR / Validity tiles */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Tile label="Quality score">
            <QualityBar pct={qualityPct} width="w-20" />
          </Tile>
          <Tile label="OCR">
            <span className="inline-flex items-center gap-1.5">
              <ScanText strokeWidth={1.75} className="h-4 w-4 text-slate-400" />
              <span className="capitalize">{ocrStatus.replace(/_/g, ' ')}</span>
            </span>
          </Tile>
          <Tile label="Validity">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-slate-600">
                {fmtDate(collection)} → {fmtDate(expiry)}
              </span>
              <ExpiryStatus expiry={expiry} />
            </div>
          </Tile>
        </div>

        {/* Applicable compliance frameworks */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Applicable compliance frameworks
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {frameworks.length ? (
              frameworks.map((tag, i) => <FrameworkTagPill key={`${tag.name}-${i}`} tag={tag} />)
            ) : (
              <span className="text-sm text-slate-400">None mapped yet</span>
            )}
          </div>
        </div>

        {/* Cross-module counts */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Linked across modules
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Stat count={controlCount} label="Controls" />
            <Stat count={frameworkCount} label="Frameworks" />
            <Stat count={riskCount} label="Risks" />
            <Stat count={assetCount} label="Assets" />
            <Stat count={incidentCount} label={incidentCount === 1 ? 'Incident' : 'Incidents'} />
            <Stat count={policyCount} label="Policies" />
          </div>
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 px-4 py-3">
        {canReview && status === 'pending_review' && (
          <button
            type="button"
            onClick={() => onApprove(evidenceId)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-700"
          >
            <CheckCircle2 strokeWidth={1.75} className="h-4 w-4" />
            Approve
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenFile(evidenceId)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <FileText strokeWidth={1.75} className="h-4 w-4" />
          Open file
        </button>
        <button
          type="button"
          onClick={() => onReassess(evidenceId)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <RefreshCw strokeWidth={1.75} className="h-4 w-4" />
          Re-assess
        </button>
        <button
          type="button"
          onClick={() => onOpenFull(evidenceId)}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-primary-700 transition-colors hover:bg-primary-50"
        >
          Full record
          <ExternalLink strokeWidth={1.75} className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
