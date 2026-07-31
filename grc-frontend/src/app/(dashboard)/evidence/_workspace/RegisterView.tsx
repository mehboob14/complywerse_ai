'use client';

/**
 * RegisterView — L3 Dense Evidence Register.
 *
 * A compact, exportable grid of every evidence item. Clicking a row toggles an
 * INLINE detail panel (no navigation, no eye-icon detour) that lazily loads the
 * item's AI assessment, linked controls (by framework) and cross-module links,
 * then surfaces applicable frameworks, the quality breakdown and quick actions.
 *
 * Charter: single teal brand (primary-*), category tints only as status/type
 * markers, hairline borders, dense rows, cards rounded-xl.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, ExternalLink, CheckCircle2, FileText, Loader2, Link2 } from 'lucide-react';

import { DataTable, type ColumnDef } from '@/components/ui';
import {
  fetchAssessment,
  fetchControls,
  fetchAllLinks,
} from './api';
import {
  type EvidenceItem,
  StatusPill,
  StalePill,
  OwnerChip,
  ownerOf,
  typeLabel,
  EvidenceLetterTile,
  ExpiryStatus,
  normPct,
  qualityBarColor,
  qualityTextColor,
  deriveApplicableFrameworks,
  FrameworkTagPill,
  type FrameworkTag,
} from './lib';

export interface RegisterViewProps {
  items: EvidenceItem[];
  onOpenFull: (id: number) => void;
  onApprove: (id: number) => void;
  onOpenFile: (id: number) => void;
  canReview?: boolean;
}

// ── quality breakdown sub-metric bar ─────────────────────────────────────────
function MetricBar({ label, pct }: { label: string; pct: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs text-slate-500">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <span
          className={`block h-full rounded-full ${qualityBarColor(pct)}`}
          style={{ width: `${Math.max(0, Math.min(100, pct ?? 0))}%` }}
        />
      </span>
      <span className={`w-9 shrink-0 text-right text-xs font-semibold ${qualityTextColor(pct)}`}>
        {pct == null ? '—' : `${pct}%`}
      </span>
    </div>
  );
}

// ── linked-module count chip ─────────────────────────────────────────────────
function LinkStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white px-3 py-2">
      <span className="text-base font-semibold text-slate-900">{count}</span>
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
    </div>
  );
}

// ── inline expanded detail panel ─────────────────────────────────────────────
function ExpandedPanel({
  item,
  onClose,
  onOpenFull,
  onApprove,
  onOpenFile,
  canReview,
}: {
  item: EvidenceItem;
  onClose: () => void;
  onOpenFull: (id: number) => void;
  onApprove: (id: number) => void;
  onOpenFile: (id: number) => void;
  canReview: boolean;
}) {
  const id = item.id;

  const assessmentQ = useQuery({
    queryKey: ['evidence', id, 'assessment'],
    queryFn: () => fetchAssessment(id),
    staleTime: 60_000,
  });
  const controlsQ = useQuery({
    queryKey: ['evidence', id, 'controls'],
    queryFn: () => fetchControls(id),
    staleTime: 60_000,
  });
  const linksQ = useQuery({
    queryKey: ['evidence', id, 'all-links'],
    queryFn: () => fetchAllLinks(id),
    staleTime: 60_000,
  });

  const loading = assessmentQ.isLoading || controlsQ.isLoading || linksQ.isLoading;

  const assessment = (assessmentQ.data ?? null) as Record<string, unknown> | null;
  const controls = (controlsQ.data ?? {}) as Record<string, unknown>;
  const links = (linksQ.data ?? {}) as Record<string, unknown>;

  // Applicable frameworks (Linked from controls + Suggested from AI free-text).
  const frameworks: FrameworkTag[] = useMemo(() => {
    const byFramework = (controls.by_framework as Array<{ framework_name: string; controls?: unknown[] }>) ?? [];
    const clauseMappings = (assessment?.clause_mappings as Array<{ framework_name?: string }> | undefined) ?? [];
    const clauseNames = clauseMappings.map((c) => c?.framework_name || '').filter(Boolean);
    const aiFrameworks = (assessment?.compliance_frameworks as string[] | undefined) ?? [];
    return deriveApplicableFrameworks(byFramework, clauseNames, aiFrameworks);
  }, [controls.by_framework, assessment]);

  // Quality sub-metrics from the assessment (normalise 0-1 or 0-100).
  const relevance = normPct(assessment?.relevance_score as number | null | undefined);
  const adequacy = normPct(assessment?.adequacy_score as number | null | undefined);
  const confidence = normPct(assessment?.confidence_score as number | null | undefined);
  const auditReady = normPct(assessment?.audit_readiness as number | null | undefined);

  const linkCount = (k: string) => Number((links[k] as { total?: number } | undefined)?.total ?? 0);
  const controlsCount = Number(
    (controls.total_mappings as number | undefined) ?? item.control_mappings_count ?? 0,
  );

  const canApprove = canReview && item.status !== 'approved';

  return (
    <div className="mb-4 overflow-hidden rounded-xl border border-primary-100 bg-primary-50">
      {/* header */}
      <div className="flex items-start gap-3 border-b border-primary-100 bg-white px-4 py-3">
        <EvidenceLetterTile name={item.name} evidenceType={item.evidence_type} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">{item.name}</h3>
            <StatusPill status={item.status} />
            {item.is_stale && <StalePill />}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {typeLabel(item.evidence_type)} · {ownerOf(item) || 'Unassigned'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          aria-label="Close detail"
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" strokeWidth={1.75} />
          Loading assessment…
        </div>
      ) : (
        <div className="grid gap-5 px-4 py-4 lg:grid-cols-3">
          {/* Applicable frameworks */}
          <section className="lg:col-span-2">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Applicable frameworks
            </h4>
            {frameworks.length ? (
              <div className="flex flex-wrap gap-1.5">
                {frameworks.map((tag, i) => (
                  <FrameworkTagPill key={`${tag.name}-${i}`} tag={tag} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">No mapped or suggested frameworks yet.</p>
            )}

            {/* Quality breakdown */}
            <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Quality breakdown
            </h4>
            {relevance == null && adequacy == null && confidence == null && auditReady == null ? (
              <p className="text-sm text-slate-400">No AI assessment available.</p>
            ) : (
              <div className="space-y-2">
                <MetricBar label="Relevance" pct={relevance} />
                <MetricBar label="Adequacy" pct={adequacy} />
                <MetricBar label="Confidence" pct={confidence} />
                <MetricBar label="Audit readiness" pct={auditReady} />
              </div>
            )}
          </section>

          {/* Linked across modules */}
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Linked across modules
            </h4>
            <div className="grid grid-cols-2 gap-2">
              <LinkStat label="Controls" count={controlsCount} />
              <LinkStat label="Risks" count={linkCount('risks')} />
              <LinkStat label="Assets" count={linkCount('assets')} />
              <LinkStat label="Incidents" count={linkCount('incidents')} />
              <LinkStat label="Policies" count={linkCount('policy_statements')} />
              <LinkStat label="Assessments" count={linkCount('assessments')} />
            </div>
          </section>
        </div>
      )}

      {/* actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-primary-100 bg-white px-4 py-3">
        <button
          onClick={() => onOpenFull(id)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-primary-700"
        >
          <ExternalLink size={15} strokeWidth={1.75} />
          Open full record
        </button>
        <button
          onClick={() => onOpenFile(id)}
          disabled={!item.file_path}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileText size={15} strokeWidth={1.75} />
          Open file
        </button>
        {canApprove && (
          <button
            onClick={() => onApprove(id)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100"
          >
            <CheckCircle2 size={15} strokeWidth={1.75} />
            Approve
          </button>
        )}
      </div>
    </div>
  );
}

export function RegisterView({
  items,
  onOpenFull,
  onApprove,
  onOpenFile,
  canReview = false,
}: RegisterViewProps) {
  const rows = items ?? [];
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const expandedItem = useMemo(
    () => (expandedId == null ? null : rows.find((r) => r.id === expandedId) ?? null),
    [rows, expandedId],
  );

  const columns: ColumnDef<EvidenceItem>[] = useMemo(
    () => [
      {
        id: 'evidence',
        header: 'Evidence',
        accessor: (row) => row.name,
        sortable: true,
        minWidth: '240px',
        render: (row) => (
          <div className="flex items-center gap-3">
            <EvidenceLetterTile name={row.name} evidenceType={row.evidence_type} size="sm" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-900">{row.name}</div>
              <div className="truncate text-xs text-slate-400">{typeLabel(row.evidence_type)}</div>
            </div>
          </div>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessor: (row) => row.status,
        sortable: true,
        render: (row) => (
          <span className="inline-flex items-center gap-1">
            <StatusPill status={row.status} />
            {row.is_stale && <StalePill />}
          </span>
        ),
      },
      {
        id: 'owner',
        header: 'Owner',
        accessor: (row) => ownerOf(row) ?? '',
        sortable: true,
        render: (row) => <OwnerChip name={ownerOf(row)} />,
      },
      {
        id: 'frameworks',
        header: 'Frameworks',
        accessor: (row) => row.control_mappings_count ?? 0,
        sortable: true,
        render: (row) => {
          const n = row.control_mappings_count ?? 0;
          return n > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
              <Link2 size={14} strokeWidth={1.75} className="text-slate-400" />
              {n} control{n === 1 ? '' : 's'}
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          );
        },
      },
      {
        id: 'quality',
        header: 'Quality',
        accessor: (row) => normPct(row.quality_score) ?? -1,
        sortable: true,
        render: (row) => {
          const p = normPct(row.quality_score);
          return p == null
            ? <span className="text-slate-300">—</span>
            : <span className={`text-sm font-semibold ${qualityTextColor(p)}`}>{p}%</span>;
        },
      },
      {
        id: 'expiry',
        header: 'Expiry',
        accessor: (row) => row.expiry_date ?? '',
        sortable: true,
        render: (row) => <ExpiryStatus expiry={row.expiry_date} />,
      },
    ],
    [],
  );

  return (
    <div>
      {/* header */}
      <div className="mb-3 flex items-end justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Evidence Library</h2>
          <p className="text-xs text-slate-400">{rows.length} items</p>
        </div>
      </div>

      {/* inline expanded detail (no navigation) */}
      {expandedItem && (
        <ExpandedPanel
          key={expandedItem.id}
          item={expandedItem}
          onClose={() => setExpandedId(null)}
          onOpenFull={onOpenFull}
          onApprove={onApprove}
          onOpenFile={onOpenFile}
          canReview={canReview}
        />
      )}

      <DataTable<EvidenceItem>
        data={rows}
        columns={columns}
        searchable={false}
        exportable
        exportFilename="evidence-register"
        pageSize={15}
        stickyHeader
        emptyMessage="No evidence items."
        emptyIcon={FileText}
        onRowClick={(row) => setExpandedId((cur) => (cur === row.id ? null : row.id))}
      />
    </div>
  );
}

export default RegisterView;
