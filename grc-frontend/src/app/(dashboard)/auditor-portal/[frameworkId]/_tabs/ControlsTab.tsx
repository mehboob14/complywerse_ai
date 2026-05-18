'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, Search, X,
  FileText, Sparkles, Paperclip, ExternalLink,
} from 'lucide-react';
import { SECTION_ROOT, TabLoader, TabError, TabEmpty, StatusPill } from './shared';

interface ControlRow {
  id: number;
  control_id: string;
  original_reference?: string | null;
  title: string;
  description?: string | null;
  domain?: string | null;
  category?: string | null;
  priority?: string | null;
  is_critical?: boolean | null;
  is_mandatory?: boolean | null;
  can_auto_approve?: boolean;
  applicability: {
    state: 'in_scope' | 'out_of_scope' | 'pending' | 'untouched';
    is_applicable: boolean | null;
    status: string | null;
    justification: string | null;
    review_comment: string | null;
    reviewed_at: string | null;
    applicability_id: number | null;
  };
  implementation: {
    id: number | null;
    status: string | null;
    implementation_notes: string | null;
  };
  evidence_counts: { total: number; pending: number; approved: number; rejected: number };
}

interface ControlDetail extends ControlRow {
  full_text?: string | null;
  section_number?: string | null;
  parent_section?: string | null;
  criticality_reason?: string | null;
  evidence_requirements?: string[];
  evidence: Array<{
    id: number;
    evidence_id: number | null;
    file_name: string | null;
    file_size: number | null;
    review_status: string | null;
    ai_confidence_score: number | null;
    uploaded_at: string | null;
    uploader_name: string | null;
    implementation_id: number | null;
  }>;
}

interface Props {
  frameworkId: string;
}

/**
 * Per-control evidence indicator. Shows a compact stacked progress
 * bar (proportions of approved/pending/rejected) + the total count
 * to the left. Hover reveals the exact breakdown. Replaces the
 * previous "0 pending 0 ok 0 rej" inline text that was hard to scan.
 */
function EvidenceCell({ counts }: { counts: ControlRow['evidence_counts'] }) {
  const { total, pending, approved, rejected } = counts;
  if (total === 0) {
    return <span className="text-xs text-slate-400">No evidence</span>;
  }
  const approvedPct = (approved / total) * 100;
  const pendingPct = (pending / total) * 100;
  const rejectedPct = (rejected / total) * 100;
  const tip = `${approved} approved • ${pending} pending • ${rejected} rejected`;
  return (
    <div className="flex items-center gap-2" title={tip}>
      <span className="text-xs font-semibold text-slate-900 tabular-nums w-5 text-right">{total}</span>
      <div className="h-2 w-20 rounded-full overflow-hidden bg-slate-100 flex">
        {approvedPct > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${approvedPct}%` }} />}
        {pendingPct > 0 && <div className="bg-amber-500 h-full" style={{ width: `${pendingPct}%` }} />}
        {rejectedPct > 0 && <div className="bg-rose-500 h-full" style={{ width: `${rejectedPct}%` }} />}
      </div>
      {pending > 0 && (
        <span className="text-[10px] font-semibold text-amber-700">{pending} pending</span>
      )}
    </div>
  );
}

export default function ControlsTab({ frameworkId }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [applicabilityFilter, setApplicabilityFilter] = useState<string>('all');
  const [implementationFilter, setImplementationFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [showCriticalOnly, setShowCriticalOnly] = useState(false);
  const [activeReview, setActiveReview] = useState<{ row: ControlRow; action: 'approved' | 'rejected' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [detailControlId, setDetailControlId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<{ controls: ControlRow[]; total: number }>({
    queryKey: ['auditor-controls', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/controls`);
      return res.data;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (payload: { artifact_id: number; action: 'approved' | 'rejected'; remarks: string }) => {
      const res = await apiClient.post(`${SECTION_ROOT}/reviews`, {
        artifact_type: 'applicability',
        artifact_id: payload.artifact_id,
        action: payload.action,
        remarks: payload.remarks,
      });
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auditor-controls', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-overview', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-audit-trail', frameworkId] });
      setActiveReview(null);
      setRemarks('');
    },
  });

  // One-click auto-approve for non-critical, untouched controls. Backend
  // creates an `is_applicable=True, status='approved'` ClauseApplicability
  // and propagates to ControlImplementation in a single call.
  const autoApproveMutation = useMutation({
    mutationFn: async (controlId: number) => {
      const res = await apiClient.post(
        `${SECTION_ROOT}/${frameworkId}/controls/${controlId}/auto-approve`,
      );
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auditor-controls', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-overview', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-audit-trail', frameworkId] });
      qc.invalidateQueries({ queryKey: ['auditor-control-detail', frameworkId] });
    },
  });

  const all = data?.controls || [];

  // Discover the distinct domains / implementation statuses present in
  // this framework, so the filter dropdowns only show real values.
  const domains = useMemo(() => {
    const set = new Set<string>();
    all.forEach((c) => { if (c.domain) set.add(c.domain); });
    return Array.from(set).sort();
  }, [all]);

  const implementationStatuses = useMemo(() => {
    const set = new Set<string>();
    all.forEach((c) => { if (c.implementation.status) set.add(c.implementation.status); });
    return Array.from(set).sort();
  }, [all]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      if (applicabilityFilter !== 'all' && r.applicability.state !== applicabilityFilter) return false;
      if (implementationFilter !== 'all' && (r.implementation.status || '') !== implementationFilter) return false;
      if (domainFilter !== 'all' && (r.domain || '') !== domainFilter) return false;
      if (priorityFilter !== 'all' && (r.priority || '').toLowerCase() !== priorityFilter) return false;
      if (showCriticalOnly && !r.is_critical) return false;
      if (term) {
        const haystack = `${r.control_id} ${r.original_reference || ''} ${r.title} ${r.domain || ''} ${r.category || ''}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [all, search, applicabilityFilter, implementationFilter, domainFilter, priorityFilter, showCriticalOnly]);

  if (isLoading) return <TabLoader />;
  if (error) return <TabError />;

  const anyFilterActive = !!search || applicabilityFilter !== 'all' || implementationFilter !== 'all' || domainFilter !== 'all' || priorityFilter !== 'all' || showCriticalOnly;

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by control ID, reference, title, domain, or category…"
          className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Filter chips row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mr-1">Applicability:</span>
        {['all', 'in_scope', 'out_of_scope', 'pending', 'untouched'].map((f) => (
          <button
            key={f}
            onClick={() => setApplicabilityFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              applicabilityFilter === f
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {f === 'all' ? 'All' : f.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {domains.length > 0 && (
          <select
            value={domainFilter}
            onChange={(e) => setDomainFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="all">All domains</option>
            {domains.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        )}
        {implementationStatuses.length > 0 && (
          <select
            value={implementationFilter}
            onChange={(e) => setImplementationFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
          >
            <option value="all">All implementation states</option>
            {implementationStatuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        )}
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
        >
          <option value="all">All priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none">
          <input
            type="checkbox"
            checked={showCriticalOnly}
            onChange={(e) => setShowCriticalOnly(e.target.checked)}
            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          Critical only
        </label>
        {anyFilterActive && (
          <button
            onClick={() => {
              setSearch('');
              setApplicabilityFilter('all');
              setImplementationFilter('all');
              setDomainFilter('all');
              setPriorityFilter('all');
              setShowCriticalOnly(false);
            }}
            className="ml-auto text-xs text-slate-500 hover:text-slate-900 underline"
          >
            Clear filters
          </button>
        )}
        <div className={`text-xs text-slate-500 ${anyFilterActive ? '' : 'ml-auto'}`}>
          {rows.length} of {all.length} controls
        </div>
      </div>

      {rows.length === 0 ? (
        <TabEmpty
          title={anyFilterActive ? "No controls match these filters" : "No controls in this framework"}
          hint={anyFilterActive ? "Try widening your search or clearing filters." : undefined}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-2 text-left">Ref</th>
                <th className="px-4 py-2 text-left">Title</th>
                <th className="px-4 py-2 text-left">Applicability</th>
                <th className="px-4 py-2 text-left">Implementation</th>
                <th className="px-4 py-2 text-left">Evidence</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-slate-100 hover:bg-blue-50/40 cursor-pointer transition-colors"
                  onClick={() => setDetailControlId(r.id)}
                >
                  <td className="px-4 py-2 align-top whitespace-nowrap">
                    <span className="font-mono text-xs text-slate-700">{r.original_reference || r.control_id}</span>
                    {r.is_critical && (
                      <span className="ml-1 inline-flex items-center text-rose-600" title="Critical control">
                        <AlertCircle className="h-3 w-3" />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <p className="text-slate-900 font-medium line-clamp-2 hover:text-blue-700">{r.title}</p>
                    {r.description && (
                      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{r.description}</p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      {r.domain && <span className="text-[11px] text-slate-500">{r.domain}</span>}
                      {r.priority && (
                        <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                          r.priority === 'high' ? 'text-rose-600' :
                          r.priority === 'medium' ? 'text-amber-600' : 'text-slate-500'
                        }`}>{r.priority}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2 align-top">
                    <StatusPill value={r.applicability.state} />
                    {r.applicability.justification && (
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{r.applicability.justification}</p>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top">
                    <StatusPill value={r.implementation.status} />
                  </td>
                  <td className="px-4 py-2 align-top">
                    <EvidenceCell counts={r.evidence_counts} />
                  </td>
                  <td
                    className="px-4 py-2 align-top text-right whitespace-nowrap"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {r.applicability.applicability_id ? (
                      r.applicability.state === 'pending' ? (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => { setActiveReview({ row: r, action: 'approved' }); setRemarks(r.applicability.review_comment || ''); }}
                            className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-1 text-xs font-medium"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => { setActiveReview({ row: r, action: 'rejected' }); setRemarks(r.applicability.review_comment || ''); }}
                            className="rounded-md bg-rose-600 hover:bg-rose-700 text-white px-2 py-1 text-xs font-medium"
                          >
                            Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">
                          {r.applicability.state === 'in_scope' ? 'In scope' : r.applicability.state === 'out_of_scope' ? 'Out of scope' : 'Reviewed'}
                        </span>
                      )
                    ) : r.can_auto_approve ? (
                      <button
                        onClick={() => autoApproveMutation.mutate(r.id)}
                        disabled={autoApproveMutation.isPending && autoApproveMutation.variables === r.id}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 text-xs font-medium disabled:opacity-50"
                        title="Mark as in-scope and approved in one click"
                      >
                        {autoApproveMutation.isPending && autoApproveMutation.variables === r.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Sparkles className="h-3 w-3" />
                        )}
                        Auto-approve
                      </button>
                    ) : (
                      <span
                        className="text-xs text-rose-500 italic"
                        title="Critical controls require a manual applicability decision"
                      >
                        Manual review required
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Review modal */}
      {activeReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-slate-900">
              {activeReview.action === 'approved' ? 'Approve' : 'Reject'} applicability
            </h3>
            <p className="text-sm text-slate-600 mt-1">
              {activeReview.row.control_id} — {activeReview.row.title}
            </p>
            <label className="block text-sm font-medium text-slate-700 mt-4">
              Remarks {activeReview.action === 'rejected' && <span className="text-rose-600">*</span>}
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder={activeReview.action === 'rejected' ? 'Explain why this applicability decision is being rejected…' : 'Optional comment for the audit trail…'}
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setActiveReview(null); setRemarks(''); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={reviewMutation.isPending}
              >
                Cancel
              </button>
              <button
                onClick={() => activeReview && reviewMutation.mutate({
                  artifact_id: activeReview.row.applicability.applicability_id!,
                  action: activeReview.action,
                  remarks,
                })}
                disabled={
                  reviewMutation.isPending
                  || (activeReview.action === 'rejected' && !remarks.trim())
                }
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white inline-flex items-center gap-2 ${
                  activeReview.action === 'approved' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                } disabled:opacity-50`}
              >
                {reviewMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : activeReview.action === 'approved' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                Confirm {activeReview.action === 'approved' ? 'approval' : 'rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control detail modal — opens when a control row is clicked.
          Shows full framework requirement text, every uploaded
          evidence file, and the auto-approve action in one place. */}
      {detailControlId !== null && (
        <ControlDetailModal
          frameworkId={frameworkId}
          controlId={detailControlId}
          onClose={() => setDetailControlId(null)}
          onAutoApprove={(id) => autoApproveMutation.mutate(id)}
          autoApprovePending={autoApproveMutation.isPending}
          onReview={(row, action) => {
            setActiveReview({ row, action });
            setRemarks(row.applicability.review_comment || '');
            setDetailControlId(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Control detail modal ─────────────────────────────────────────
// Loaded lazily via `auditor-control-detail` query. Shows the full
// `ParsedFrameworkControl.full_text` (or description fallback), every
// uploaded ImplementationEvidence file linked through any journey for
// the control, and the same actions available in the list row.

interface ControlDetailModalProps {
  frameworkId: string;
  controlId: number;
  onClose: () => void;
  onAutoApprove: (id: number) => void;
  autoApprovePending: boolean;
  onReview: (row: ControlRow, action: 'approved' | 'rejected') => void;
}

function ControlDetailModal({
  frameworkId,
  controlId,
  onClose,
  onAutoApprove,
  autoApprovePending,
  onReview,
}: ControlDetailModalProps) {
  const { data, isLoading, error } = useQuery<ControlDetail>({
    queryKey: ['auditor-control-detail', frameworkId, controlId],
    queryFn: async () => {
      const res = await apiClient.get(
        `${SECTION_ROOT}/${frameworkId}/controls/${controlId}`,
      );
      return res.data;
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs font-semibold text-slate-700">
                {data?.original_reference || data?.control_id || '…'}
              </span>
              {data?.is_critical && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-semibold text-rose-700 uppercase">
                  <AlertCircle className="h-3 w-3" /> Critical
                </span>
              )}
              {data?.is_mandatory && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 uppercase">
                  Mandatory
                </span>
              )}
              {data?.priority && (
                <span className={`text-[10px] font-semibold uppercase tracking-wide ${
                  data.priority === 'high' ? 'text-rose-600' :
                  data.priority === 'medium' ? 'text-amber-600' : 'text-slate-500'
                }`}>{data.priority} priority</span>
              )}
            </div>
            <h3 className="text-base font-semibold text-slate-900 mt-1">{data?.title || (isLoading ? 'Loading…' : 'Control')}</h3>
            {data?.domain && (
              <p className="text-xs text-slate-500 mt-0.5">{data.domain}{data.category ? ` • ${data.category}` : ''}</p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {isLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading control detail…
            </div>
          )}
          {error && (
            <p className="text-sm text-rose-600">Failed to load control detail.</p>
          )}

          {data && (
            <>
              {/* Framework requirement text — the headline reason for opening this modal. */}
              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" />
                  Framework requirement
                </h4>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800 whitespace-pre-wrap">
                  {data.full_text || data.description || (
                    <span className="text-slate-400 italic">No requirement text parsed for this control.</span>
                  )}
                </div>
                {data.criticality_reason && (
                  <p className="text-xs text-rose-700 mt-2 italic">
                    Critical because: {data.criticality_reason}
                  </p>
                )}
              </section>

              {/* Applicability + implementation rollup */}
              <section className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Applicability</p>
                  {data.applicability.applicability_id ? (
                    <>
                      <StatusPill value={data.applicability.status === 'approved' && data.applicability.is_applicable ? 'in_scope' : data.applicability.status === 'approved' ? 'out_of_scope' : 'pending'} />
                      {data.applicability.justification && (
                        <p className="text-xs text-slate-600 mt-2">{data.applicability.justification}</p>
                      )}
                      {data.applicability.review_comment && (
                        <p className="text-xs text-slate-500 mt-1 italic">Review: {data.applicability.review_comment}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No applicability decision yet</p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Implementation</p>
                  {data.implementation?.id ? (
                    <>
                      <StatusPill value={data.implementation.status} />
                      {data.implementation.implementation_notes && (
                        <p className="text-xs text-slate-600 mt-2 whitespace-pre-wrap">{data.implementation.implementation_notes}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-slate-400 italic">No implementation row yet</p>
                  )}
                </div>
              </section>

              {/* Evidence list */}
              <section>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" />
                  Evidence ({data.evidence?.length || 0})
                </h4>
                {(!data.evidence || data.evidence.length === 0) ? (
                  <p className="text-sm text-slate-400 italic">No evidence uploaded for this control yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.evidence.map((ev) => (
                      <li key={ev.id} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                        <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 truncate">{ev.file_name || '(unnamed file)'}</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {ev.uploader_name || 'Unknown'}
                            {ev.uploaded_at ? ` • ${new Date(ev.uploaded_at).toLocaleString()}` : ''}
                            {ev.file_size ? ` • ${formatBytes(ev.file_size)}` : ''}
                          </p>
                        </div>
                        {ev.review_status && <StatusPill value={ev.review_status} />}
                        {ev.evidence_id && (
                          <a
                            href={`/evidence/${ev.evidence_id}`}
                            className="text-slate-400 hover:text-blue-600"
                            title="Open evidence"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Expected evidence types — what the framework asks for. */}
              {data.evidence_requirements && data.evidence_requirements.length > 0 && (
                <section>
                  <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Expected evidence types</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {data.evidence_requirements.map((er, i) => (
                      <span key={i} className="rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-[11px]">
                        {er}
                      </span>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {data && (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            {data.applicability.applicability_id ? (
              data.applicability.status === 'pending' ? (
                <>
                  <button
                    onClick={() => onReview(data as ControlRow, 'rejected')}
                    className="rounded-md bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                  <button
                    onClick={() => onReview(data as ControlRow, 'approved')}
                    className="rounded-md bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </button>
                </>
              ) : (
                <span className="text-xs text-slate-500 italic">
                  Reviewed {data.applicability.reviewed_at ? `on ${new Date(data.applicability.reviewed_at).toLocaleDateString()}` : ''}
                </span>
              )
            ) : data.can_auto_approve ? (
              <button
                onClick={() => onAutoApprove(data.id)}
                disabled={autoApprovePending}
                className="rounded-md bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                {autoApprovePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Auto-approve as in-scope
              </button>
            ) : (
              <span className="text-xs text-rose-600 italic">
                Critical controls require a manual applicability decision.
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
