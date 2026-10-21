'use client';

/**
 * A document's gap analysis: run it against frameworks (in the background), read the coverage per framework and the findings,
 * and work them - owner, target date, status, override, accept the risk - or close a gap with a fix Comply Agent drafts, which
 * goes into the document as its next version (as every change does, the versions before kept). Override takes an applied fix back out of
 * the document, every other change kept. Also: compare the document with another one. Used by the AI Studio's Gap analysis
 * view and the classic page. Readers read; the changes are for the document's editors (`canEdit`; the server checks them too).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown, BarChart3, Calendar, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, Edit3, GitCompare, Loader2, Minus, Play,
  RotateCcw, Search, ShieldAlert, ShieldCheck, Sparkles, User, Wand2, X,
} from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';
import { parseUtc } from '@/lib/serverTime';
import { MultiSelectDropdown, PageLoader } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import NcaCompareModal from '@/components/governance/NcaCompareModal';
import { useLibraryDocuments } from '../_DetailsFields';
import { versionLabel } from '../_view/versionLabel';
import { formatDate } from './_DocumentViewer';
import { frameworkTypeLabel, lastFailedRuns, outdatedRuns } from './_gapAnalysis';
import { gapJustification, sendLabel } from '@/lib/proposals';
import { ProposeNote, useProposalRole, useProposedAnswer } from './_ProposalsView';

const COMPLIANCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  fully_compliant: { bg: 'bg-emerald-50', text: 'text-emerald-800', label: 'Fully compliant' },
  partially_compliant: { bg: 'bg-amber-50', text: 'text-amber-900', label: 'Partially compliant' },
  not_addressed: { bg: 'bg-rose-50', text: 'text-rose-800', label: 'Not addressed' },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Not applicable' },
};
const RISK_SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-800', label: 'Critical' },
  high: { bg: 'bg-orange-50', text: 'text-orange-800', label: 'High' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-900', label: 'Medium' },
  low: { bg: 'bg-emerald-50', text: 'text-emerald-800', label: 'Low' },
};
const REMEDIATION_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-rose-50', text: 'text-rose-800', label: 'Open' },
  in_progress: { bg: 'bg-amber-50', text: 'text-amber-900', label: 'In progress' },
  closed: { bg: 'bg-emerald-50', text: 'text-emerald-800', label: 'Closed' },
  accepted_risk: { bg: 'bg-[#effaf8]', text: 'text-[#0b4f46]', label: 'Risk accepted' },
};
const UNKNOWN = (label: string) => ({ bg: 'bg-slate-100', text: 'text-slate-700', label });

const FIELD = 'w-full rounded-lg border border-[#b8c4c8] bg-white px-3 py-2 text-sm text-[#1f2933] placeholder:text-[#7b8794] focus:border-[#0f766e] focus:outline-none focus:ring-1 focus:ring-[#0f766e]';
const BTN = 'inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:opacity-50';
const PRIMARY = 'inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const TH = 'px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#586472]';

const dedupeFrameworkOptions = (items: any[] = []) => {
  const statusRank: Record<string, number> = { published: 4, completed: 3, classified: 2, parsed: 1 };
  const deduped = new Map<string, any>();
  items.forEach((framework: any) => {
    const key = String(
      framework?.published_framework_id ||
      `${String(framework?.name || '').trim().toLowerCase()}::${String(framework?.version || framework?.framework_version || '').trim().toLowerCase()}`,
    );
    const existing = deduped.get(key);
    const existingRank = existing ? statusRank[String(existing?.upload_status || '').toLowerCase()] ?? 0 : -1;
    const currentRank = statusRank[String(framework?.upload_status || '').toLowerCase()] ?? 0;
    const existingUpdated = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
    const currentUpdated = framework?.updated_at ? new Date(framework.updated_at).getTime() : 0;
    if (!existing || currentRank > existingRank || (currentRank === existingRank && currentUpdated > existingUpdated)) deduped.set(key, framework);
  });
  return Array.from(deduped.values()).sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
};

function SortHeader({ field, current, order, onSort, children }: { field: string; current: string; order: string; onSort: (f: string) => void; children: React.ReactNode }) {
  const on = current === field;
  return (
    <th className={TH} aria-sort={on ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[#1f2933]">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${on ? 'text-[#0f766e]' : ''}`} aria-hidden />
      </button>
    </th>
  );
}

function ComplianceSummarySection({ summary, loading }: { summary: any; loading: boolean }) {
  if (loading) return <PageLoader size="sm" className="h-32" />;
  const frameworks = summary?.frameworks || summary?.framework_summaries || [];
  if (!Array.isArray(frameworks) || frameworks.length === 0) return null;
  return (
    <section className="space-y-4 rounded-xl border border-[#d5dbe1] bg-white p-5" aria-label="Coverage per framework">
      {frameworks.map((fw: any, idx: number) => {
        const pct = fw.compliance_percentage ?? fw.compliance_score ?? 0;
        const color = pct >= 80 ? 'bg-emerald-600' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-600';
        const textColor = pct >= 80 ? 'text-emerald-800' : pct >= 60 ? 'text-amber-900' : 'text-rose-800';
        return (
          <div key={fw.framework_id || idx}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[#26323d]">{fw.framework_name || fw.name || `Framework ${fw.framework_id}`}</span>
              <span className={`text-sm font-bold ${textColor}`}>{Math.round(pct)}%</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-[#eef1f4]">
              <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-[#586472]">
              {fw.total_clauses != null && <span>{fw.total_clauses} clauses</span>}
              {fw.compliant_count != null && <span className="text-emerald-800">{fw.compliant_count} covered</span>}
              {fw.gaps_count != null && <span className="text-rose-800">{fw.gaps_count} gaps</span>}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export default function GapAnalysisView({ documentId, tenantId, canEdit }: { documentId: number; tenantId?: number; canEdit: boolean }) {
  const id = documentId;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // not the owner or author: a fix (or taking one back out) goes to the owner to accept, with its justification (lib/proposals.ts)
  const { proposes, decider } = useProposalRole(documentId);
  const handledAsProposal = useProposedAnswer();

  const [showGapModal, setShowGapModal] = useState(false);
  const [showNcaCompareModal, setShowNcaCompareModal] = useState(false);
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [gapFrameworkSearch, setGapFrameworkSearch] = useState('');
  const [runError, setRunError] = useState('');           // why the Run dialog's run did not start, shown in the dialog
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editAction, setEditAction] = useState<string | null>(null);
  const [gapFilters, setGapFilters] = useState({
    framework_name: '', compliance_status: '', risk_severity: '', remediation_status: '',
    sort_by: 'clause_reference', sort_order: 'asc' as 'asc' | 'desc', skip: 0, limit: 20,
  });
  const [overrideForm, setOverrideForm] = useState({ status: 'fully_compliant', justification: '' });
  const [acceptRiskForm, setAcceptRiskForm] = useState({ justification: '', expiry_date: '' });
  const [assignOwnerForm, setAssignOwnerForm] = useState<number | null>(null);
  const [targetDateForm, setTargetDateForm] = useState('');
  const [statusUpdateForm, setStatusUpdateForm] = useState('');

  // Address a gap: Comply Agent proposes either REPLACING a block of the document's text (`mode='replace'`: `addressGapOriginal`
  // holds the slice it matched, shown read-only beside the editable replacement) or APPENDING a new clause under a heading.
  const [addressGapFinding, setAddressGapFinding] = useState<any | null>(null);
  const [addressGapMode, setAddressGapMode] = useState<'replace' | 'append'>('append');
  const [addressGapOriginal, setAddressGapOriginal] = useState<string>('');
  const [addressGapDraft, setAddressGapDraft] = useState<string>('');
  const [addressGapHeading, setAddressGapHeading] = useState<string>('');
  const [addressGapReason, setAddressGapReason] = useState<string>('');
  const closeAddressGap = () => {
    setAddressGapFinding(null);
    setAddressGapMode('append');
    setAddressGapOriginal('');
    setAddressGapDraft('');
    setAddressGapHeading('');
    setAddressGapReason('');
  };

  // the documents for the compare popup's "other document" picker (titles only, the cache the details pickers share)
  const { data: allDocumentsForCompare = [] } = useLibraryDocuments(!!id);

  const { data: gapAnalysisRuns } = useQuery({
    queryKey: ['gap-analysis-runs', id],
    queryFn: async () => (await governanceApi.getGapAnalysisRuns(id)).data as any,
    enabled: !!id,
    refetchInterval: (query) => {
      const data = query.state.data;
      const runs = data?.runs || data || [];
      return Array.isArray(runs) && runs.some((r: any) => r.status === 'running') ? 5000 : false;
    },
  });
  const runs: any[] = (() => {
    const r = gapAnalysisRuns?.runs || gapAnalysisRuns || [];
    return Array.isArray(r) ? r : [];
  })();
  const hasRunningAnalysis = runs.some((r: any) => r.status === 'running');

  const { data: complianceSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ['compliance-summary', id],
    queryFn: async () => (await governanceApi.getComplianceSummary(id)).data as any,
    enabled: !!id,
    // polled while a run is in flight so each framework shows as soon as it is done
    refetchInterval: hasRunningAnalysis ? 5000 : false,
  });

  // when every run is done, everything it fed is asked for again at once
  const prevHasRunningRef = useRef(hasRunningAnalysis);
  useEffect(() => {
    if (prevHasRunningRef.current && !hasRunningAnalysis) {
      for (const key of ['compliance-summary', 'document-gap-findings', 'gap-analysis-runs', 'gap-recommended-controls']) queryClient.invalidateQueries({ queryKey: [key, id] });
    }
    prevHasRunningRef.current = hasRunningAnalysis;
  }, [hasRunningAnalysis, id, queryClient]);

  const { data: gapFindings, isLoading: findingsLoading, isError: findingsError } = useQuery({
    queryKey: ['document-gap-findings', id, gapFilters],
    queryFn: async () => {
      const params: Record<string, any> = { skip: gapFilters.skip, limit: gapFilters.limit, sort_by: gapFilters.sort_by, sort_order: gapFilters.sort_order };
      if (gapFilters.framework_name) params.framework_name = gapFilters.framework_name;
      if (gapFilters.compliance_status) params.compliance_status = gapFilters.compliance_status;
      if (gapFilters.risk_severity) params.risk_severity = gapFilters.risk_severity;
      if (gapFilters.remediation_status) params.remediation_status = gapFilters.remediation_status;
      return (await governanceApi.getDocumentGapFindings(id, params)).data as any;
    },
    enabled: !!id,
    refetchInterval: hasRunningAnalysis ? 3000 : false,
    placeholderData: keepPreviousData,
  });

  const { data: uploadedFrameworks } = useQuery({
    queryKey: ['frameworks-list'],
    queryFn: async () => {
      const data = (await apiClient.get('/framework-upload/upload')).data;
      const items = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      return dedupeFrameworkOptions(items.filter((f: any) => f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status)));
    },
    enabled: showGapModal,
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: async () => (await governanceApi.getTenantUsers(tenantId || 1)).data as any[],
    enabled: editAction === 'assign-owner',
  });

  const refreshFindings = () => {
    for (const key of ['document-gap-findings', 'compliance-summary', 'gap-recommended-controls']) queryClient.invalidateQueries({ queryKey: [key, id] });
  };
  // a fix or its take back changed the document: its text, versions and change chain (and the version the runs are compared with)
  const refreshDocument = () => {
    refreshFindings();
    for (const key of ['governance-document', 'document-versions', 'document-view-html', 'document-access', 'document-lifecycle', 'doc-signoff',
      'document-chain', 'document-chain-redline', 'document-policy-statements', 'gap-analysis-runs']) queryClient.invalidateQueries({ queryKey: [key] });
  };

  const runGapAnalysisMutation = useMutation({
    mutationFn: (data: { document_id: number; framework_ids?: number[]; run_all?: boolean }) => governanceApi.runGapAnalysis(data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Gap analysis started', message: 'The findings appear here as each framework is done; you can leave this page.' });
      queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['compliance-summary', id], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['gap-recommended-controls', id] });
      setShowGapModal(false);
      setSelectedFrameworkIds([]);
      setGapFrameworkSearch('');
      setRunError('');
    },
    // a failure is told where the run was asked for: in the Run dialog, or as a toast for Run again (each call says); the runs are
    // asked for again, as the server marks them failed when it could not start them (a 503)
    onError: () => queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id] }),
  });
  const notStarted = (error: unknown) => apiErrorText(error, 'The gap analysis could not be started.');
  const updateFindingMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: Record<string, any> }) => governanceApi.updateGapFinding(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Finding saved' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not saved', message: error?.response?.data?.detail || 'The finding could not be saved.' }),
  });
  const overrideMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { override_status: string; override_justification: string; message?: string } }) =>
      governanceApi.overrideGapFinding(findingId, data),
    onSuccess: (response: any) => {
      setEditingRow(null);
      setEditAction(null);
      setOverrideForm({ status: 'fully_compliant', justification: '' });
      // the override is saved; taking its fix back out of the document waits for the owner
      if (handledAsProposal(response?.data, decider)) { refreshFindings(); return; }
      const back = response?.data?.taken_back_version as string | undefined;
      const left = !!response?.data?.fix_left_in_document;
      toast({ type: 'success', title: 'Override saved', message: back ? `The fix was taken back out of the document (version ${back}); every other change stays.`
        : left ? 'Its clause was changed in the document since, so the document was left as it is. Change it there if it should go.' : undefined });
      if (back) refreshDocument();
      else refreshFindings();
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not overridden', message: error?.response?.data?.detail || 'The override could not be saved.' }),
  });
  const acceptRiskMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { justification: string; expiry_date?: string } }) => governanceApi.acceptGapRisk(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Risk accepted' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
      setAcceptRiskForm({ justification: '', expiry_date: '' });
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not accepted', message: error?.response?.data?.detail || 'The risk could not be accepted.' }),
  });
  // two steps: Comply Agent drafts the clause (kept on the finding), the person edits and applies it
  const generateGapFixMutation = useMutation({
    mutationFn: (findingId: number) => governanceApi.generateGapFix(findingId),
    onSuccess: (response: any) => {
      const data = response?.data || {};
      setAddressGapMode(data.mode === 'replace' || data.mode === 'append' ? data.mode : 'append');
      setAddressGapOriginal(data.current_text || '');
      setAddressGapDraft(data.proposed_text || data.suggested_clause_text || '');
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
    },
    onError: (error: any) => toast({ type: 'error', title: 'No draft', message: error?.response?.data?.detail || 'Comply Agent could not draft a clause. Try again.' }),
  });
  const applyGapFixMutation = useMutation({
    mutationFn: ({ findingId, data }: {
      findingId: number;
      data: { mode: 'replace' | 'append'; proposed_text: string; current_text?: string | null; section_heading?: string; change_reason?: string; message?: string };
    }) => governanceApi.applyGapFix(findingId, data),
    onSuccess: (response: any) => {
      if (handledAsProposal(response?.data, decider)) { refreshFindings(); closeAddressGap(); return; }     // waits for the owner
      const r = response?.data || {};
      const v = r.applied_version_number as string | undefined;
      const st = r.document_status as string | undefined;
      const where = st === 'pending_review' ? ' It is in review again, with its reviewers.'
        : st === 'pending_approval' ? ' It is waiting for its approvers again.'
        : st === 'draft' ? ' Send it for review when it is ready.' : '';
      const saved = v ? `Saved as version ${v}; the version before is kept.` : 'Saved to the document.';
      const notes = Array.isArray(r.notes) && r.notes.length ? ` ${r.notes.join(' ')}` : '';
      toast({ type: 'success', title: 'Fix applied', message: `${saved}${where}${notes}` });
      refreshDocument();
      closeAddressGap();
    },
    onError: (error: any) => toast({ type: 'error', title: 'Not applied', message: error?.response?.data?.detail || 'The fix could not be written into the document.' }),
  });

  const handleExportCSV = async () => {
    try {
      const response = await governanceApi.exportGapFindings(id);
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `gap_findings_${id}.csv`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch {
      toast({ type: 'error', title: 'Not exported', message: 'The findings could not be downloaded.' });
    }
  };
  const handleRunAnalysis = () => {
    setRunError('');
    runGapAnalysisMutation.mutate(selectedFrameworkIds.length === 0 ? { document_id: id, run_all: true } : { document_id: id, framework_ids: selectedFrameworkIds },
      { onError: (e) => setRunError(notStarted(e)) });
  };
  const closeGapModal = () => { setShowGapModal(false); setSelectedFrameworkIds([]); setGapFrameworkSearch(''); setRunError(''); };
  const toggleFramework = (fwId: number) => setSelectedFrameworkIds((prev) => (prev.includes(fwId) ? prev.filter((i) => i !== fwId) : [...prev, fwId]));
  const toggleRowExpand = (rowId: number) => setExpandedRows((prev) => {
    const next = new Set(prev);
    if (next.has(rowId)) next.delete(rowId);
    else next.add(rowId);
    return next;
  });
  const handleGapSort = (field: string) => setGapFilters((prev) => ({
    ...prev, sort_by: field, sort_order: prev.sort_by === field && prev.sort_order === 'asc' ? 'desc' : 'asc', skip: 0,
  }));

  const findings = useMemo(() => {
    const data = gapFindings;
    if (Array.isArray(data)) return data;
    return data?.items || data?.findings || [];
  }, [gapFindings]);
  const totalFindings = gapFindings?.total || findings.length;
  const totalPages = Math.ceil(totalFindings / gapFilters.limit);
  const currentPage = Math.floor(gapFilters.skip / gapFilters.limit);
  const running = runs.filter((r: any) => r.status === 'running' || r.status === 'queued');
  // the frameworks whose last run failed, with the server's reason, until they are run again
  const failed = lastFailedRuns(runs);
  // the results made on an earlier version of the document (never run again by themselves: each run reads the whole document)
  const currentVersion: string | null = gapAnalysisRuns?.current_version ?? null;
  const outdated = outdatedRuns(runs, currentVersion);
  const runAgain = (again: any[]) => {
    const ids = Array.from(new Set(again.map((r: any) => r.uploaded_framework_id).filter((v: any) => v != null))) as number[];
    if (!ids.length) { setShowGapModal(true); return; }
    runGapAnalysisMutation.mutate({ document_id: id, framework_ids: ids },
      { onError: (e) => toast({ type: 'error', title: 'Not started', message: notStarted(e) }) });
  };

  return (
    <div className="space-y-4">
      {/* compare with another document */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#99d5cc] bg-[#effaf8] p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="shrink-0 rounded-lg bg-white p-2"><GitCompare className="h-5 w-5 text-[#0b4f46]" aria-hidden /></span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[#1f2933]">Compare with another document</h3>
            <p className="text-xs text-[#3f4b58]">Another document of the library, or a reference template, side by side with Comply Agent&apos;s gap analysis.</p>
          </div>
        </div>
        <button type="button" onClick={() => setShowNcaCompareModal(true)} className={BTN}><GitCompare className="h-3.5 w-3.5" /> Compare</button>
      </section>

      {/* run */}
      <section className="rounded-xl border border-[#d5dbe1] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="shrink-0 rounded-lg bg-[#eef1f4] p-2"><Wand2 className="h-5 w-5 text-[#26323d]" aria-hidden /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#1f2933]">Gap analysis</h3>
              <p className="text-xs text-[#586472]">Checks this document against frameworks, clause by clause; each clause it does not cover is a finding.</p>
            </div>
          </div>
          {canEdit && (
            <button type="button" onClick={() => setShowGapModal(true)} disabled={runGapAnalysisMutation.isPending} className={PRIMARY}>
              {runGapAnalysisMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Run gap analysis
            </button>
          )}
        </div>
        {(runGapAnalysisMutation.isPending || running.length > 0) && (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2" role="status">
            {runGapAnalysisMutation.isPending && running.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] px-3 py-2 text-xs text-[#3f4b58]">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#0f766e]" /> Starting…
              </div>
            )}
            {running.map((r: any) => {
              const total = Number(r.clauses_total || 0);
              const done = Number(r.clauses_processed || 0);
              const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
              return (
                <div key={r.id} className="rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] px-3 py-2">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-[#1f2933]" title={r.framework_name || 'Framework'}>{r.framework_name || `Run ${r.id}`}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#effaf8] px-1.5 py-0.5 text-[10px] font-medium text-[#0b4f46]">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> {r.status === 'queued' ? 'Waiting' : total > 0 ? `${pct}%` : 'Running'}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-[#e3e8ec]">
                    {total > 0
                      ? <div className="h-full rounded-full bg-[#0f766e] transition-all duration-300" style={{ width: `${Math.max(2, pct)}%` }} />
                      : <div className="h-full w-1/3 animate-[gap-progress_1.4s_ease-in-out_infinite] rounded-full bg-[#0f766e]" />}
                  </div>
                  {total > 0 && <div className="mt-1 text-[10px] text-[#586472]">{done}/{total} clauses</div>}
                </div>
              );
            })}
          </div>
        )}
        {failed.length > 0 && (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5" role="group" aria-label="Runs that did not finish">
            <ul className="min-w-0 flex-1 space-y-1">
              {failed.map((r: any) => (
                <li key={r.id} className="text-xs text-[#7a1616]">
                  <span className="font-semibold">{r.framework_name || `Run ${r.id}`}</span>
                  {r.started_at && <span className="text-[#8a2c2c]"> · {parseUtc(r.started_at)?.toLocaleDateString()}</span>}
                  : {r.error_message || 'The gap analysis did not finish.'}
                </li>
              ))}
            </ul>
            {canEdit && (
              <button type="button" onClick={() => runAgain(failed)} disabled={runGapAnalysisMutation.isPending} className={BTN}>
                {runGapAnalysisMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Run again
              </button>
            )}
          </div>
        )}
      </section>

      {outdated.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-xs text-amber-900">
            Made on {versionLabel(outdated[0].document_version)}. The document is now {versionLabel(currentVersion)}. Run it again to check the new version.
          </p>
          {canEdit && (
            <button type="button" onClick={() => runAgain(outdated)} disabled={runGapAnalysisMutation.isPending} className={BTN}>
              {runGapAnalysisMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Run again
            </button>
          )}
        </div>
      )}

      <ComplianceSummarySection summary={complianceSummary} loading={summaryLoading} />

      {/* findings */}
      <section className="overflow-hidden rounded-xl border border-[#d5dbe1] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d5dbe1] p-4">
          <h3 className="text-base font-semibold text-[#1f2933]">Findings</h3>
          <button type="button" onClick={handleExportCSV} className={BTN}><Download className="h-4 w-4" /> Export CSV</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[#d5dbe1] p-4">
          <MultiSelectDropdown title="Framework" multiSelect={false} autoApply placeholder="All frameworks" size="md"
            items={(complianceSummary?.frameworks || complianceSummary?.framework_summaries || []).map((fw: any) => ({ value: String(fw.framework_name || fw.name), label: String(fw.framework_name || fw.name) }))}
            selectedValues={gapFilters.framework_name ? [gapFilters.framework_name] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, framework_name: v[0] || '', skip: 0 }))} />
          <MultiSelectDropdown title="Coverage" multiSelect={false} autoApply placeholder="Any coverage" size="md"
            items={Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
            selectedValues={gapFilters.compliance_status ? [gapFilters.compliance_status] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, compliance_status: v[0] || '', skip: 0 }))} />
          <MultiSelectDropdown title="Risk" multiSelect={false} autoApply placeholder="Any risk" size="md"
            items={Object.entries(RISK_SEVERITY_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
            selectedValues={gapFilters.risk_severity ? [gapFilters.risk_severity] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, risk_severity: v[0] || '', skip: 0 }))} />
          <MultiSelectDropdown title="Status" multiSelect={false} autoApply placeholder="Any status" size="md"
            items={Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
            selectedValues={gapFilters.remediation_status ? [gapFilters.remediation_status] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, remediation_status: v[0] || '', skip: 0 }))} />
        </div>

        {findingsLoading ? (
          <div className="flex h-48 items-center justify-center" role="status" aria-label="Loading the findings"><Loader2 className="h-7 w-7 animate-spin text-[#0f766e]" /></div>
        ) : findingsError ? (
          <p className="m-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]" role="alert">The findings could not be loaded. Reload the page to try again.</p>
        ) : findings.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 px-4 text-center">
            <BarChart3 className="h-10 w-10 text-[#7b8794]" aria-hidden />
            {gapFilters.framework_name || gapFilters.compliance_status || gapFilters.risk_severity || gapFilters.remediation_status ? (
              <p className="text-sm font-medium text-[#1f2933]">No finding matches these filters</p>
            ) : (
              <>
                <p className="text-sm font-medium text-[#1f2933]">No findings yet</p>
                <p className="text-sm text-[#586472]">{failed.length ? 'The last gap analysis did not finish; the reason is above.'
                  : canEdit ? 'Run a gap analysis to check the document against frameworks.' : 'Its editors run a gap analysis to check it against frameworks.'}</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-white">
                  <tr>
                    <th className="w-8 px-2 py-3"><span className="sr-only">Details</span></th>
                    <SortHeader field="clause_reference" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Clause</SortHeader>
                    <SortHeader field="policy_section_reference" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>In the document</SortHeader>
                    <SortHeader field="compliance_status" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Coverage</SortHeader>
                    <th className={TH}>Gap</th>
                    <SortHeader field="risk_severity" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Risk</SortHeader>
                    <th className={TH}>Recommendation</th>
                    <th className={TH}>Owner</th>
                    <SortHeader field="target_remediation_date" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Target date</SortHeader>
                    <SortHeader field="remediation_status" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Status</SortHeader>
                    <th className={TH}>Evidence</th>
                    <SortHeader field="updated_at" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Updated</SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((finding: any) => (
                    <GapFindingRow
                      key={finding.id}
                      finding={finding}
                      canEdit={canEdit}
                      isExpanded={expandedRows.has(finding.id)}
                      isEditing={editingRow === finding.id}
                      editAction={editAction}
                      cs={COMPLIANCE_STATUS_STYLES[finding.compliance_status] || UNKNOWN(finding.compliance_status)}
                      rs={RISK_SEVERITY_STYLES[finding.risk_severity] || UNKNOWN(finding.risk_severity)}
                      rms={REMEDIATION_STATUS_STYLES[finding.remediation_status] || UNKNOWN(finding.remediation_status)}
                      onToggleExpand={() => toggleRowExpand(finding.id)}
                      onSetEditAction={(action: string | null) => { setEditingRow(action ? finding.id : null); setEditAction(action); }}
                      tenantUsers={tenantUsers}
                      overrideForm={overrideForm} setOverrideForm={setOverrideForm}
                      acceptRiskForm={acceptRiskForm} setAcceptRiskForm={setAcceptRiskForm}
                      assignOwnerForm={assignOwnerForm} setAssignOwnerForm={setAssignOwnerForm}
                      targetDateForm={targetDateForm} setTargetDateForm={setTargetDateForm}
                      statusUpdateForm={statusUpdateForm} setStatusUpdateForm={setStatusUpdateForm}
                      onUpdateFinding={(findingId: number, data: any) => updateFindingMutation.mutate({ findingId, data })}
                      onOverride={(findingId: number, data: any) => overrideMutation.mutate({ findingId, data: { ...data, message: data.override_justification } })}
                      proposeTo={proposes ? decider : null}
                      onAcceptRisk={(findingId: number, data: any) => acceptRiskMutation.mutate({ findingId, data })}
                      onAddressGap={(f: any) => {
                        // what the server already holds for this finding (empty until Comply Agent drafted one)
                        setAddressGapFinding(f);
                        setAddressGapMode(f.replacement_mode === 'replace' || f.replacement_mode === 'append' ? f.replacement_mode : 'append');
                        setAddressGapOriginal(f.original_clause_text || '');
                        setAddressGapDraft(f.suggested_clause_text || '');
                        setAddressGapHeading([f.framework_name, f.clause_reference, f.clause_title].filter(Boolean).join(' — '));
                        // a proposer's message starts as the finding's why (its gap and what is missing), for the owner to read
                        setAddressGapReason(proposes ? gapJustification(f) : '');
                      }}
                      isPending={updateFindingMutation.isPending || overrideMutation.isPending || acceptRiskMutation.isPending}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#d5dbe1] p-4">
                <span className="text-sm text-[#586472]">{gapFilters.skip + 1}–{Math.min(gapFilters.skip + gapFilters.limit, totalFindings)} of {totalFindings}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setGapFilters((prev) => ({ ...prev, skip: Math.max(0, prev.skip - prev.limit) }))} disabled={currentPage === 0}
                    className="rounded-lg border border-[#b8c4c8] p-2 text-[#3f4b58] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="text-sm text-[#26323d]">Page {currentPage + 1} of {totalPages}</span>
                  <button type="button" onClick={() => setGapFilters((prev) => ({ ...prev, skip: prev.skip + prev.limit }))} disabled={currentPage >= totalPages - 1}
                    className="rounded-lg border border-[#b8c4c8] p-2 text-[#3f4b58] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-30" aria-label="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* address a gap: review or edit Comply Agent's clause, then apply it to the document */}
      {addressGapFinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Address the gap"
          onKeyDown={(e) => { if (e.key === 'Escape') closeAddressGap(); }}>
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-xl border border-[#d5dbe1] bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[#e3e8ec] px-5 py-4">
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-[#1f2933]">
                  <Sparkles className="h-4 w-4 text-[#0f766e]" aria-hidden /> Address the gap
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${addressGapMode === 'replace' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
                    {addressGapMode === 'replace' ? 'Replaces a clause' : 'Adds a clause'}
                  </span>
                </h3>
                <p className="mt-0.5 truncate text-xs text-[#586472]">
                  {addressGapFinding.framework_name && <span className="font-medium">{addressGapFinding.framework_name} · </span>}
                  <span className="font-mono text-[#26323d]">{addressGapFinding.clause_reference || '—'}</span>
                  {addressGapFinding.clause_title && <> · {addressGapFinding.clause_title}</>}
                </p>
              </div>
              <button type="button" autoFocus onClick={closeAddressGap} className="shrink-0 rounded-lg p-2 text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933]" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {addressGapFinding.gap_description && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-amber-900">Gap</span>
                  <p className="text-sm text-amber-950">{addressGapFinding.gap_description}</p>
                </div>
              )}
              {addressGapFinding.remediation_recommendation && (
                <div className="rounded-lg border border-[#99d5cc] bg-[#effaf8] p-3">
                  <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#0b4f46]">Recommendation</span>
                  <p className="text-sm text-[#1f2933]">{addressGapFinding.remediation_recommendation}</p>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[#586472]">
                  {addressGapMode === 'replace' ? 'Comply Agent found a clause of the document to replace; check the new wording on the right.' : 'A new clause, added at the end of the document under its own heading.'}
                </p>
                <button type="button" onClick={() => generateGapFixMutation.mutate(addressGapFinding.id)} disabled={generateGapFixMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#99d5cc] bg-white px-2.5 py-1 text-xs font-medium text-[#0b4f46] hover:bg-[#effaf8] disabled:opacity-50">
                  {generateGapFixMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {generateGapFixMutation.isPending ? 'Drafting…' : addressGapDraft ? 'Draft again' : 'Draft with Comply Agent'}
                </button>
              </div>

              {addressGapMode === 'replace' ? (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[#26323d]">In the document now</span>
                    <textarea value={addressGapOriginal} readOnly rows={14} className={`${FIELD} resize-y bg-[#f7f9fa] font-mono`} />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[#26323d]">New wording <span className="text-xs font-normal text-[#586472]">(you can edit it)</span></span>
                    <textarea value={addressGapDraft} onChange={(e) => setAddressGapDraft(e.target.value)} rows={14} className={`${FIELD} resize-y`}
                      placeholder="Draft it with Comply Agent, or write it yourself." />
                  </label>
                </div>
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[#26323d]">New clause <span className="text-xs font-normal text-[#586472]">(you can edit it)</span></span>
                    <textarea value={addressGapDraft} onChange={(e) => setAddressGapDraft(e.target.value)} rows={12} className={`${FIELD} resize-y`}
                      placeholder="Draft it with Comply Agent, or write a clause that closes this gap yourself." />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[#26323d]">Heading <span className="text-xs font-normal text-[#586472]">(optional)</span></span>
                    <input type="text" value={addressGapHeading} onChange={(e) => setAddressGapHeading(e.target.value)} className={FIELD} />
                  </label>
                </>
              )}

              {proposes ? (
                <ProposeNote id={`gap-why-${addressGapFinding.id}`} decider={decider} value={addressGapReason} onChange={setAddressGapReason}
                  placeholder="e.g. Closing the gap before the audit" />
              ) : (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-sm font-medium text-[#26323d]">Why <span className="text-xs font-normal text-[#586472]">(optional, kept in the version history)</span></span>
                    <input type="text" value={addressGapReason} onChange={(e) => setAddressGapReason(e.target.value)} placeholder="e.g. Closing the gap before the audit" className={FIELD} />
                  </label>
                  <p className="text-xs text-[#586472]">
                    The fix is saved as the document&apos;s next version; earlier versions are kept, and Override takes it back out.
                  </p>
                </>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#e3e8ec] px-5 py-3">
              <button type="button" onClick={closeAddressGap} className={BTN}>Cancel</button>
              <button type="button"
                onClick={() => applyGapFixMutation.mutate({
                  findingId: addressGapFinding.id,
                  data: {
                    mode: addressGapMode,
                    proposed_text: addressGapDraft,
                    current_text: addressGapMode === 'replace' ? addressGapOriginal : undefined,
                    section_heading: addressGapMode === 'append' ? (addressGapHeading || undefined) : undefined,
                    change_reason: addressGapReason || undefined,
                    message: addressGapReason.trim() || undefined,
                  },
                })}
                disabled={!addressGapDraft.trim() || applyGapFixMutation.isPending || (addressGapMode === 'replace' && !addressGapOriginal.trim()) || (proposes && !addressGapReason.trim())}
                className={PRIMARY}>
                {applyGapFixMutation.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> {proposes ? 'Sending…' : 'Applying…'}</>
                  : <><Check className="h-4 w-4" /> {proposes ? sendLabel(decider) : addressGapMode === 'replace' ? 'Replace the clause' : 'Add the clause'}</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* the frameworks to run against */}
      {showGapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-label="Run gap analysis"
          onKeyDown={(e) => { if (e.key === 'Escape') closeGapModal(); }}>
          <div className="w-full max-w-lg rounded-xl border border-[#d5dbe1] bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-[#1f2933]">Run gap analysis</h3>
                <p className="text-sm text-[#586472]">Choose the frameworks; none chosen runs them all.</p>
              </div>
              <button type="button" autoFocus onClick={closeGapModal} className="rounded-lg p-2 text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933]" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            {uploadedFrameworks && uploadedFrameworks.length > 0 && (
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7b8794]" aria-hidden />
                <input type="text" value={gapFrameworkSearch} onChange={(e) => setGapFrameworkSearch(e.target.value)} aria-label="Search frameworks"
                  placeholder="Search by name, code or regulator…" className={`${FIELD} pl-9 pr-9`} />
                {gapFrameworkSearch && (
                  <button type="button" onClick={() => setGapFrameworkSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#7b8794] hover:text-[#26323d]" aria-label="Clear the search">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
            <div className="mb-5 max-h-64 space-y-2 overflow-y-auto">
              {!uploadedFrameworks ? (
                <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-[#0f766e]" /></div>
              ) : uploadedFrameworks.length === 0 ? (
                <p className="py-4 text-center text-sm text-[#586472]">No frameworks in the library yet.</p>
              ) : (() => {
                const term = gapFrameworkSearch.trim().toLowerCase();
                const visible = term
                  ? (uploadedFrameworks as any[]).filter((fw) => [fw.name, fw.short_code, fw.framework_type, frameworkTypeLabel(fw.framework_type), fw.regulator, fw.source_organization, fw.version]
                    .filter(Boolean).join(' ').toLowerCase().includes(term))
                  : (uploadedFrameworks as any[]);
                if (visible.length === 0) return <p className="py-4 text-center text-sm text-[#586472]">No framework matches &ldquo;{gapFrameworkSearch}&rdquo;.</p>;
                const visibleIds = visible.map((fw: any) => fw.id);
                const allVisibleSelected = visibleIds.every((vid: number) => selectedFrameworkIds.includes(vid));
                const toggleVisible = () => setSelectedFrameworkIds((prev) => (allVisibleSelected
                  ? prev.filter((pid) => !visibleIds.includes(pid))                  // the ones outside the search stay chosen
                  : Array.from(new Set([...prev, ...visibleIds]))));
                return (
                  <>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d5dbe1] bg-white p-3 hover:bg-[#f7f9fa]">
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} className="h-4 w-4 rounded border-[#b8c4c8] text-[#0f766e]" />
                      <span className="text-sm font-medium text-[#1f2933]">{term ? `All that match (${visible.length})` : `All (${uploadedFrameworks.length})`}</span>
                    </label>
                    {visible.map((fw: any) => (
                      <label key={fw.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#e3e8ec] bg-white p-3 hover:bg-[#f7f9fa]">
                        <input type="checkbox" checked={selectedFrameworkIds.includes(fw.id)} onChange={() => toggleFramework(fw.id)} className="h-4 w-4 rounded border-[#b8c4c8] text-[#0f766e]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-[#1f2933]">{fw.name || `Framework ${fw.id}`}</span>
                            {(fw.short_code || fw.framework_type) && (
                              <span className={`rounded bg-[#eef1f4] px-1.5 py-0.5 text-xs text-[#3f4b58] ${fw.short_code ? 'font-mono' : ''}`}>{fw.short_code || frameworkTypeLabel(fw.framework_type)}</span>
                            )}
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-[#586472]">
                            {fw.version && <span>{versionLabel(fw.version)}</span>}
                            {(fw.control_count != null || fw.parsed_controls_count != null) && <span>{fw.control_count ?? fw.parsed_controls_count} controls</span>}
                            {(fw.regulator || fw.source_organization) && <span>{fw.regulator || fw.source_organization}</span>}
                          </span>
                        </span>
                      </label>
                    ))}
                  </>
                );
              })()}
            </div>
            {runError && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]">{runError}</p>}
            <div className="flex justify-end gap-2 border-t border-[#e3e8ec] pt-4">
              <button type="button" onClick={closeGapModal} className={BTN}>Cancel</button>
              <button type="button" onClick={handleRunAnalysis} disabled={runGapAnalysisMutation.isPending} className={PRIMARY}>
                {runGapAnalysisMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                {selectedFrameworkIds.length === 0 ? 'Run all' : `Run (${selectedFrameworkIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      <NcaCompareModal isOpen={showNcaCompareModal} onClose={() => setShowNcaCompareModal(false)}
        documents={allDocumentsForCompare.map((d) => ({ id: d.id, title: d.title, doc_type: d.doc_type }))} initialDocumentId={id} />
    </div>
  );
}

const ACTION = 'inline-flex items-center gap-1.5 rounded-lg border border-[#b8c4c8] bg-white px-3 py-1.5 text-sm text-[#26323d] hover:bg-[#f3f6f8]';
const SAVE = 'rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58] disabled:opacity-50';
const DETAIL_LABEL = 'mb-1 block text-xs font-medium uppercase tracking-wider text-[#586472]';

function GapFindingRow({
  finding, canEdit, isExpanded, isEditing, editAction, cs, rs, rms,
  onToggleExpand, onSetEditAction,
  tenantUsers, overrideForm, setOverrideForm, acceptRiskForm, setAcceptRiskForm,
  assignOwnerForm, setAssignOwnerForm, targetDateForm, setTargetDateForm,
  statusUpdateForm, setStatusUpdateForm,
  onUpdateFinding, onOverride, onAcceptRisk, onAddressGap, isPending, proposeTo,
}: any) {
  const pill = (s: { bg: string; text: string; label: string }) => <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>{s.label}</span>;
  const toggle = (action: string) => (e: React.MouseEvent) => { e.stopPropagation(); onSetEditAction(editAction === action && isEditing ? null : action); };
  const owner = finding.assigned_owner_name || finding.assigned_owner?.display_name;
  return (
    <>
      <tr className="cursor-pointer border-b border-[#e3e8ec] bg-white hover:bg-[#f7f9fa]" onClick={onToggleExpand}>
        <td className="px-2 py-2">
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggleExpand(); }} aria-expanded={isExpanded} aria-label={isExpanded ? 'Hide the details' : 'Show the details'}
            className="rounded p-0.5 text-[#586472] hover:bg-[#eef1f4]">
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </td>
        <td className="px-3 py-2">
          <div className="font-mono text-xs text-[#26323d]">{finding.clause_reference || '-'}</div>
          {finding.clause_title && <div className="mt-0.5 max-w-[180px] truncate text-xs text-[#586472]">{finding.clause_title}</div>}
        </td>
        <td className="px-3 py-2"><div className="max-w-[140px] truncate text-xs text-[#26323d]">{finding.policy_section_reference || '-'}</div></td>
        <td className="px-3 py-2">
          {pill(cs)}
          {finding.is_overridden && <span className="ml-1 text-xs text-[#586472]" title="Overridden">✓</span>}
        </td>
        <td className="max-w-[160px] truncate px-3 py-2 text-xs text-[#26323d]">{finding.gap_description || '-'}</td>
        <td className="px-3 py-2">{pill(rs)}</td>
        <td className="max-w-[140px] truncate px-3 py-2 text-xs text-[#26323d]">{finding.remediation_recommendation || '-'}</td>
        <td className="px-3 py-2 text-xs">{owner ? <span className="text-[#26323d]">{owner}</span> : <span className="italic text-[#7b8794]">Nobody</span>}</td>
        <td className="px-3 py-2 text-xs text-[#26323d]">{formatDate(finding.target_remediation_date)}</td>
        <td className="px-3 py-2">{pill(rms)}</td>
        <td className="px-3 py-2"><span className="inline-flex items-center justify-center rounded-full bg-[#eef1f4] px-2 py-0.5 text-xs text-[#26323d]">{finding.evidence_count || finding.evidence?.length || 0}</span></td>
        <td className="px-3 py-2 text-xs text-[#586472]">{formatDate(finding.updated_at)}</td>
      </tr>

      {isExpanded && (
        <tr className="border-b border-[#e3e8ec] bg-[#f7f9fa]">
          <td colSpan={12} className="px-4 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                {finding.clause_requirement_text && (
                  <div className="rounded-lg border border-[#99d5cc] bg-[#effaf8] p-3">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-[#0b4f46]">What the clause requires</span>
                    <p className="text-sm text-[#26323d]">{finding.clause_requirement_text}</p>
                  </div>
                )}
                {finding.policy_section_text && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wider text-emerald-800">What the document says</span>
                    <p className="text-sm text-[#26323d]">{finding.policy_section_text}</p>
                  </div>
                )}
                {finding.gap_description && <div><span className={DETAIL_LABEL}>Gap</span><p className="text-sm text-[#26323d]">{finding.gap_description}</p></div>}
                {finding.ai_reasoning && (
                  <div className="rounded-lg border border-[#d5dbe1] bg-white p-3">
                    <span className={DETAIL_LABEL}>Comply Agent&apos;s reasoning</span>
                    <p className="text-sm text-[#26323d]">{finding.ai_reasoning}</p>
                  </div>
                )}
                {finding.confidence_score != null && (
                  <div>
                    <span className={DETAIL_LABEL}>Confidence</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e3e8ec]"><div className="h-full rounded-full bg-[#0f766e]" style={{ width: `${finding.confidence_score * 100}%` }} /></div>
                      <span className="text-sm text-[#26323d]">{Math.round(finding.confidence_score * 100)}%</span>
                    </div>
                  </div>
                )}
                {finding.missing_requirement && <div><span className={DETAIL_LABEL}>What is missing</span><p className="text-sm text-[#26323d]">{finding.missing_requirement}</p></div>}
                {finding.remediation_recommendation && <div><span className={DETAIL_LABEL}>Recommendation</span><p className="text-sm text-[#26323d]">{finding.remediation_recommendation}</p></div>}
                <div>
                  <span className={DETAIL_LABEL}>Impact</span>
                  <div className="flex flex-wrap gap-3">
                    {['regulatory', 'operational', 'financial', 'reputational'].map((impact) => {
                      const isActive = finding[`impact_${impact}`] || finding[`${impact}_impact`] || finding.impact_types?.includes(impact);
                      return (
                        <span key={impact} className="flex items-center gap-1.5">
                          {isActive ? <Check className="h-4 w-4 text-emerald-700" aria-hidden /> : <Minus className="h-4 w-4 text-[#7b8794]" aria-hidden />}
                          <span className={`text-sm capitalize ${isActive ? 'text-[#26323d]' : 'text-[#586472]'}`}>{impact}{isActive ? '' : <span className="sr-only"> (no)</span>}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <span className={DETAIL_LABEL}>Actions</span>
                {finding.applied_at && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800">
                    <Check className="h-3.5 w-3.5" aria-hidden /> Fix applied to the document
                  </span>
                )}
                {!canEdit ? (
                  <p className="text-sm text-[#586472]">The document&apos;s editors work its findings.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(finding.compliance_status === 'not_addressed' || finding.compliance_status === 'partially_compliant') && finding.remediation_status !== 'closed' && !finding.applied_at && (
                        <button type="button" onClick={(e) => { e.stopPropagation(); onAddressGap(finding); }} title="Comply Agent drafts a clause; you check it and apply it to the document"
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[#0f766e] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0b5f58]">
                          <Sparkles className="h-3.5 w-3.5" aria-hidden /> Address the gap
                        </button>
                      )}
                      <button type="button" onClick={toggle('assign-owner')} aria-expanded={isEditing && editAction === 'assign-owner'} className={ACTION}><User className="h-3.5 w-3.5" aria-hidden /> Owner</button>
                      <button type="button" onClick={toggle('set-date')} aria-expanded={isEditing && editAction === 'set-date'} className={ACTION}><Calendar className="h-3.5 w-3.5" aria-hidden /> Target date</button>
                      <button type="button" onClick={toggle('update-status')} aria-expanded={isEditing && editAction === 'update-status'} className={ACTION}><Edit3 className="h-3.5 w-3.5" aria-hidden /> Status</button>
                      <button type="button" onClick={toggle('override')} aria-expanded={isEditing && editAction === 'override'} className={ACTION}><ShieldCheck className="h-3.5 w-3.5 text-[#0f766e]" aria-hidden /> Override</button>
                      {finding.compliance_status !== 'fully_compliant' && finding.compliance_status !== 'not_applicable' && (
                        <button type="button" onClick={toggle('accept-risk')} aria-expanded={isEditing && editAction === 'accept-risk'} className={ACTION}><ShieldAlert className="h-3.5 w-3.5 text-amber-700" aria-hidden /> Accept the risk</button>
                      )}
                    </div>

                    {isEditing && editAction === 'assign-owner' && (
                      <div className="space-y-3 rounded-lg border border-[#d5dbe1] bg-white p-3" onClick={(e) => e.stopPropagation()}>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-[#26323d]">Owner</span>
                          <select value={assignOwnerForm || ''} onChange={(e) => setAssignOwnerForm(e.target.value ? Number(e.target.value) : null)} className={FIELD}>
                            <option value="">Choose a person…</option>
                            {tenantUsers?.map((u: any) => (
                              <option key={u.user_id || u.id} value={u.user_id || u.id}>{u.user?.display_name || u.display_name || u.user?.email || u.email}</option>
                            ))}
                          </select>
                        </label>
                        <button type="button" onClick={() => onUpdateFinding(finding.id, { assigned_owner_id: assignOwnerForm })} disabled={!assignOwnerForm || isPending} className={SAVE}>
                          {isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )}
                    {isEditing && editAction === 'set-date' && (
                      <div className="space-y-3 rounded-lg border border-[#d5dbe1] bg-white p-3" onClick={(e) => e.stopPropagation()}>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-[#26323d]">Target date</span>
                          <input type="date" value={targetDateForm} onChange={(e) => setTargetDateForm(e.target.value)} className={FIELD} />
                        </label>
                        <button type="button" onClick={() => onUpdateFinding(finding.id, { target_remediation_date: targetDateForm })} disabled={!targetDateForm || isPending} className={SAVE}>
                          {isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )}
                    {isEditing && editAction === 'update-status' && (
                      <div className="space-y-3 rounded-lg border border-[#d5dbe1] bg-white p-3" onClick={(e) => e.stopPropagation()}>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-[#26323d]">Status</span>
                          <select value={statusUpdateForm} onChange={(e) => setStatusUpdateForm(e.target.value)} className={FIELD}>
                            <option value="">Choose…</option>
                            {Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => <option key={val} value={val}>{s.label}</option>)}
                          </select>
                        </label>
                        <button type="button" onClick={() => onUpdateFinding(finding.id, { remediation_status: statusUpdateForm })} disabled={!statusUpdateForm || isPending} className={SAVE}>
                          {isPending ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    )}
                    {isEditing && editAction === 'override' && (
                      <div className="space-y-3 rounded-lg border border-[#99d5cc] bg-[#effaf8] p-3" onClick={(e) => e.stopPropagation()}>
                        {finding.applied_at && (
                          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                            Its fix is in the document. Overriding takes that fix back out; every other change to the document stays. If its clause was changed since, the document is left as it is.
                            {proposeTo ? ` Taking it back out goes to ${proposeTo} to accept or reject, with your “Why”; the document does not change until then.` : ''}
                          </p>
                        )}
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-[#26323d]">Coverage</span>
                          <select value={overrideForm.status} onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, status: e.target.value }))} className={FIELD}>
                            {Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => <option key={val} value={val}>{s.label}</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-[#26323d]">Why <span className="font-normal text-[#586472]">(required)</span></span>
                          <textarea value={overrideForm.justification} onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, justification: e.target.value }))} rows={3} className={`${FIELD} resize-none`} />
                        </label>
                        <button type="button" onClick={() => onOverride(finding.id, { override_status: overrideForm.status, override_justification: overrideForm.justification })}
                          disabled={!overrideForm.justification.trim() || isPending} className={SAVE}>
                          {isPending ? 'Saving…' : finding.applied_at ? (proposeTo ? `Override and send the take back to ${proposeTo}` : 'Override and take the fix back') : 'Override'}
                        </button>
                      </div>
                    )}
                    {isEditing && editAction === 'accept-risk' && (
                      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3" onClick={(e) => e.stopPropagation()}>
                        <label className="block">
                          <span className="mb-1 block text-sm font-medium text-[#26323d]">Why the risk is accepted <span className="font-normal text-[#586472]">(required)</span></span>
                          <textarea value={acceptRiskForm.justification} onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, justification: e.target.value }))} rows={3} className={`${FIELD} resize-none`} />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs text-[#3f4b58]">Until <span className="text-[#586472]">(optional)</span></span>
                          <input type="date" value={acceptRiskForm.expiry_date} onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, expiry_date: e.target.value }))} className={FIELD} />
                        </label>
                        <button type="button" disabled={!acceptRiskForm.justification.trim() || isPending}
                          onClick={() => {
                            const data: any = { justification: acceptRiskForm.justification };
                            if (acceptRiskForm.expiry_date) data.expiry_date = acceptRiskForm.expiry_date;
                            onAcceptRisk(finding.id, data);
                          }}
                          className="rounded-lg bg-amber-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-50">
                          {isPending ? 'Saving…' : 'Accept the risk'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
