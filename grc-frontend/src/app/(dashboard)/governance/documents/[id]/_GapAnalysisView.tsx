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
  RotateCcw, Search, ShieldAlert, ShieldCheck, Sparkles, User, X,
} from 'lucide-react';
import apiClient, { governanceApi } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';
import { parseUtc } from '@/lib/serverTime';
import { MultiSelectDropdown } from '@/components/ui';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { InfoTip } from '@/components/ui/InfoTip';
import {
  Button, EmptyState, ErrorState, FormField, IconButton, Select, SkeletonLines, StatusPill, Table, TableFrame, TBody, Td, Textarea, TextInput, THead, Th, Tr,
  useNotify, useReportedMutation, type SortState,
} from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { priority, type Tone } from '@/lib/status';
import NcaCompareModal from '@/components/governance/NcaCompareModal';
import { useLibraryDocuments } from '../_DetailsFields';
import { versionLabel } from '../_view/versionLabel';
import { calendarDay, day } from '../_view/docDates';
import { frameworkTypeLabel, lastFailedRuns, outdatedRuns } from './_gapAnalysis';
import { gapJustification, sendLabel } from '@/lib/proposals';
import { ProposeNote, proposedWords, useProposalRole, useRefreshAfterProposal } from './_ProposalsView';
import { proposedOf } from '@/lib/proposals';

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

// a finding's coverage, risk and remediation as the kit's pill: the words are the page's own (the tables above), the tones the registry's (risk = the priority scale)
const COVERAGE_TONE: Record<string, Tone> = { fully_compliant: 'success', partially_compliant: 'warning', not_addressed: 'danger', not_applicable: 'neutral' };
const REMEDIATION_TONE: Record<string, Tone> = { open: 'danger', in_progress: 'warning', closed: 'success', accepted_risk: 'progress' };

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

function ComplianceSummarySection({ summary, loading, failed, onRetry }: { summary: any; loading: boolean; failed?: string | null; onRetry?: () => void }) {
  if (loading) return <SkeletonLines lines={3} label="Loading the coverage" />;
  // a failed read is not "no coverage yet"
  if (failed && !summary) return <ErrorState compact title="Couldn't load the coverage per framework" message={failed} onRetry={onRetry} />;
  const frameworks = summary?.frameworks || summary?.framework_summaries || [];
  if (!Array.isArray(frameworks) || frameworks.length === 0) return null;
  return (
    <section className="space-y-4 rounded-xl border border-[#d5dbe1] bg-[#fff] p-4" aria-label="Coverage per framework">
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
  const notify = useNotify();
  const queryClient = useQueryClient();
  // not the owner or author: a fix (or taking one back out) goes to the owner to accept, with its justification (lib/proposals.ts)
  const { proposes, decider } = useProposalRole(documentId);
  const refreshAfterProposal = useRefreshAfterProposal();

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

  const { data: complianceSummary, isLoading: summaryLoading, isError: summaryFailed, error: summaryError, refetch: refetchSummary } = useQuery({
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

  const { data: gapFindings, isLoading: findingsLoading, isError: findingsError, error: findingsErr, refetch: refetchFindings } = useQuery({
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

  // starting a run makes run records (and costs a model call per clause): no Retry; a failure is also said in the Run dialog where it was asked for. The runs are asked
  // for again after a failure, as the server marks them failed when it could not start them (a 503)
  const runGapAnalysisMutation = useReportedMutation({
    mutationFn: (data: { document_id: number; framework_ids?: number[]; run_all?: boolean }) => governanceApi.runGapAnalysis(data),
    success: { title: 'Gap analysis started', message: 'The findings appear here as each framework is done; you can leave this page.' },
    failure: 'Not started',
    fallback: 'The gap analysis could not be started.',
    retryable: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['compliance-summary', id], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings'], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['gap-recommended-controls', id] });
      setShowGapModal(false);
      setSelectedFrameworkIds([]);
      setGapFrameworkSearch('');
      setRunError('');
    },
    onError: () => queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id] }),
  });
  const notStarted = (error: unknown) => apiErrorText(error, 'The gap analysis could not be started.');
  const updateFindingMutation = useReportedMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: Record<string, any> }) => governanceApi.updateGapFinding(findingId, data),
    success: 'Finding saved',
    failure: 'Not saved',
    fallback: 'The finding could not be saved.',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
    },
  });
  const overrideMutation = useReportedMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { override_status: string; override_justification: string; message?: string } }) =>
      governanceApi.overrideGapFinding(findingId, data),
    // the override is saved; taking its fix back out of the document waits for the owner (the server's sentence says so)
    success: (response: any) => {
      const said = proposedWords(response?.data, decider);
      if (said) return said;
      const back = response?.data?.taken_back_version as string | undefined;
      const left = !!response?.data?.fix_left_in_document;
      const note = back ? `The fix was taken back out of the document (version ${back}); every other change stays.`
        : left ? 'Its clause was changed in the document since, so the document was left as it is. Change it there if it should go.' : undefined;
      return note ? { title: 'Override saved', message: note } : 'Override saved';
    },
    failure: 'Not overridden',
    fallback: 'The override could not be saved.',
    retryable: false,
    onSuccess: (response: any) => {
      setEditingRow(null);
      setEditAction(null);
      setOverrideForm({ status: 'fully_compliant', justification: '' });
      if (proposedOf(response?.data)) { refreshAfterProposal(); refreshFindings(); return; }
      if (response?.data?.taken_back_version) refreshDocument();
      else refreshFindings();
    },
  });
  const acceptRiskMutation = useReportedMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { justification: string; expiry_date?: string } }) => governanceApi.acceptGapRisk(findingId, data),
    success: 'Risk accepted',
    failure: 'Not accepted',
    fallback: 'The risk could not be accepted.',
    retryable: false,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
      setAcceptRiskForm({ justification: '', expiry_date: '' });
    },
  });
  // two steps: Comply Agent drafts the clause (kept on the finding), the person edits and applies it. The draft is a button the person presses (opt-in): it fills the
  // dialog and says nothing on success; a failure says why and offers Retry (nothing was written)
  const generateGapFixMutation = useMutation({
    mutationFn: (findingId: number) => governanceApi.generateGapFix(findingId),
    onSuccess: (response: any) => {
      const data = response?.data || {};
      setAddressGapMode(data.mode === 'replace' || data.mode === 'append' ? data.mode : 'append');
      setAddressGapOriginal(data.current_text || '');
      setAddressGapDraft(data.proposed_text || data.suggested_clause_text || '');
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
    },
    onError: (error, findingId) => { notify.error(error, { title: 'No draft', fallback: 'Comply Agent could not draft a clause. Try again.', retry: () => generateGapFixMutation.mutate(findingId) }); },
  });
  const applyGapFixMutation = useReportedMutation({
    mutationFn: ({ findingId, data }: {
      findingId: number;
      data: { mode: 'replace' | 'append'; proposed_text: string; current_text?: string | null; section_heading?: string; change_reason?: string; message?: string };
    }) => governanceApi.applyGapFix(findingId, data),
    success: (response: any) => {
      const said = proposedWords(response?.data, decider);
      if (said) return said;
      const r = response?.data || {};
      const v = r.applied_version_number as string | undefined;
      const st = r.document_status as string | undefined;
      const where = st === 'pending_review' ? ' It is in review again, with its reviewers.'
        : st === 'pending_approval' ? ' It is waiting for its approvers again.'
        : st === 'draft' ? ' Send it for review when it is ready.' : '';
      const saved = v ? `Saved as version ${v}; the version before is kept.` : 'Saved to the document.';
      const notes = Array.isArray(r.notes) && r.notes.length ? ` ${r.notes.join(' ')}` : '';
      return { title: 'Fix applied', message: `${saved}${where}${notes}` };
    },
    failure: 'Not applied',
    fallback: 'The fix could not be written into the document.',
    retryable: false,
    onSuccess: (response: any) => {
      if (proposedOf(response?.data)) { refreshAfterProposal(); refreshFindings(); closeAddressGap(); return; }     // waits for the owner
      refreshDocument();
      closeAddressGap();
    },
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
      notify.error('The findings could not be downloaded.', { title: 'Not exported', retry: () => { void handleExportCSV(); } });
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
  // the kit's header buttons: the server sorts, so the state is the filters' own sort and a click asks for the next order of that column (ascending, then descending)
  const gapSort: SortState = { key: gapFilters.sort_by, dir: gapFilters.sort_order };
  const onGapSort = (next: SortState) => { if (next) handleGapSort(next.key); };

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
      { onError: () => undefined });
  };

  return (
    <div className="space-y-4">
      {/* run, and compare with another document */}
      <section className="rounded-xl border border-[#d5dbe1] bg-[#fff] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            <h3 className="text-[15px] font-semibold text-[#1f2933]">Gap analysis</h3>
            <InfoTip label="About the gap analysis"
              text="Checks this document against frameworks, clause by clause; each clause it does not cover is a finding. Compare puts another document of the library, or a reference template, side by side with Comply Agent's gap analysis." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button leftIcon={<GitCompare aria-hidden />} title="Compare with another document" onClick={() => setShowNcaCompareModal(true)}>Compare</Button>
            {canEdit && (
              <Button variant="primary" leftIcon={<Play aria-hidden />} loading={runGapAnalysisMutation.isPending} onClick={() => setShowGapModal(true)}>Run gap analysis</Button>
            )}
          </div>
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
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#effaf8] px-1.5 py-0.5 text-xs font-medium text-[#0b4f46]">
                      <Loader2 className="h-2.5 w-2.5 animate-spin" /> {r.status === 'queued' ? 'Waiting' : total > 0 ? `${pct}%` : 'Running'}
                    </span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-[#e3e8ec]">
                    {total > 0
                      ? <div className="h-full rounded-full bg-[#0f766e] transition-all duration-300" style={{ width: `${Math.max(2, pct)}%` }} />
                      : <div className="h-full w-1/3 animate-[gap-progress_1.4s_ease-in-out_infinite] rounded-full bg-[#0f766e]" />}
                  </div>
                  {total > 0 && <div className="mt-1 text-xs text-[#586472]">{done}/{total} clauses</div>}
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
                  {r.started_at && <span className="text-[#8a2c2c]"> · {day(r.started_at)}</span>}
                  : {r.error_message || 'The gap analysis did not finish.'}
                </li>
              ))}
            </ul>
            {canEdit && (
              <Button leftIcon={<RotateCcw aria-hidden />} loading={runGapAnalysisMutation.isPending} onClick={() => runAgain(failed)}>Run again</Button>
            )}
          </div>
        )}
      </section>

      {outdated.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[13px] text-amber-900">
            Based on {versionLabel(outdated[0].document_version)} · the document is now {versionLabel(currentVersion)}
          </p>
          {canEdit && (
            <Button leftIcon={<RotateCcw aria-hidden />} loading={runGapAnalysisMutation.isPending} onClick={() => runAgain(outdated)}>Run again</Button>
          )}
        </div>
      )}

      <ComplianceSummarySection summary={complianceSummary} loading={summaryLoading} failed={summaryFailed ? errorMessage(summaryError) : null} onRetry={() => { void refetchSummary(); }} />

      {/* findings */}
      <section className="overflow-hidden rounded-xl border border-[#d5dbe1] bg-[#fff]">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e1e6eb] p-3">
          <h3 className="mr-1 text-[15px] font-semibold text-[#1f2933]">Findings</h3>
          <MultiSelectDropdown title="Framework" compact multiSelect={false} autoApply placeholder="All frameworks" size="sm"
            items={(complianceSummary?.frameworks || complianceSummary?.framework_summaries || []).map((fw: any) => ({ value: String(fw.framework_name || fw.name), label: String(fw.framework_name || fw.name) }))}
            selectedValues={gapFilters.framework_name ? [gapFilters.framework_name] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, framework_name: v[0] || '', skip: 0 }))} />
          <MultiSelectDropdown title="Coverage" compact multiSelect={false} autoApply placeholder="Any coverage" size="sm"
            items={Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
            selectedValues={gapFilters.compliance_status ? [gapFilters.compliance_status] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, compliance_status: v[0] || '', skip: 0 }))} />
          <MultiSelectDropdown title="Risk" compact multiSelect={false} autoApply placeholder="Any risk" size="sm"
            items={Object.entries(RISK_SEVERITY_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
            selectedValues={gapFilters.risk_severity ? [gapFilters.risk_severity] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, risk_severity: v[0] || '', skip: 0 }))} />
          <MultiSelectDropdown title="Status" compact multiSelect={false} autoApply placeholder="Any status" size="sm"
            items={Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
            selectedValues={gapFilters.remediation_status ? [gapFilters.remediation_status] : []}
            onApply={(v) => setGapFilters((prev) => ({ ...prev, remediation_status: v[0] || '', skip: 0 }))} />
          <Button className="ml-auto" leftIcon={<Download aria-hidden />} onClick={handleExportCSV}>Export CSV</Button>
        </div>

        {findingsLoading ? (
          <div className="p-4"><SkeletonLines lines={6} label="Loading the findings" /></div>
        ) : findingsError ? (
          // a failed read is not "no findings"
          <div className="p-4"><ErrorState title="Couldn't load the findings" message={errorMessage(findingsErr)} onRetry={() => { void refetchFindings(); }} /></div>
        ) : findings.length === 0 ? (
          gapFilters.framework_name || gapFilters.compliance_status || gapFilters.risk_severity || gapFilters.remediation_status ? (
            <EmptyState bare kind="noMatches" icon={BarChart3} title="No findings match"
              onClearFilters={() => setGapFilters((prev) => ({ ...prev, framework_name: '', compliance_status: '', risk_severity: '', remediation_status: '', skip: 0 }))} />
          ) : (
            <EmptyState bare kind="firstUse" icon={BarChart3} title="No findings yet"
              description={failed.length > 0 ? 'The last run did not finish: see above' : undefined}
              action={canEdit ? <Button leftIcon={<Play aria-hidden />} loading={runGapAnalysisMutation.isPending} onClick={() => setShowGapModal(true)}>Run gap analysis</Button> : undefined} />
          )
        ) : (
          <>
            <TableFrame aria-label="The gap findings" className="rounded-none border-x-0 border-b-0">
              <Table caption="The gap findings of this document, one row per clause. The Clause, In the document, Coverage, Risk, Target date, Status and Updated columns can be sorted.">
                <THead>
                  <tr>
                    <Th className="w-[44px]"><span className="sr-only">Details</span></Th>
                    <Th sortKey="clause_reference" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">Clause</Th>
                    <Th sortKey="policy_section_reference" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">In the document</Th>
                    <Th sortKey="compliance_status" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">Coverage</Th>
                    <Th>Gap</Th>
                    <Th sortKey="risk_severity" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">Risk</Th>
                    <Th>Recommendation</Th>
                    <Th>Owner</Th>
                    <Th sortKey="target_remediation_date" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">Target date</Th>
                    <Th sortKey="remediation_status" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">Status</Th>
                    <Th>Evidence</Th>
                    <Th sortKey="updated_at" sort={gapSort} onSortChange={onGapSort} sortCycle="asc-desc">Updated</Th>
                  </tr>
                </THead>
                <TBody>
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
                </TBody>
              </Table>
            </TableFrame>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e1e6eb] px-4 py-2.5">
                <span className="text-[13px] tabular-nums text-[#586472]">{gapFilters.skip + 1}–{Math.min(gapFilters.skip + gapFilters.limit, totalFindings)} of {totalFindings}</span>
                <div className="flex items-center gap-2">
                  <IconButton label={`Previous page (${currentPage + 1} of ${totalPages})`} variant="secondary" disabled={currentPage === 0}
                    onClick={() => setGapFilters((prev) => ({ ...prev, skip: Math.max(0, prev.skip - prev.limit) }))}><ChevronLeft aria-hidden /></IconButton>
                  <IconButton label={`Next page (${currentPage + 1} of ${totalPages})`} variant="secondary" disabled={currentPage >= totalPages - 1}
                    onClick={() => setGapFilters((prev) => ({ ...prev, skip: prev.skip + prev.limit }))}><ChevronRight aria-hidden /></IconButton>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* address a gap: review or edit Comply Agent's clause, then apply it to the document (a kit dialog: focus in, Tab wraps, Escape, focus back; a clause edited or a reason typed asks before it is thrown away) */}
      <AnimatedModal isOpen={!!addressGapFinding} onClose={closeAddressGap} size="3xl" title="Address the gap"
        dirty={!!addressGapFinding && (addressGapDraft !== (addressGapFinding.suggested_clause_text || '') || addressGapReason.trim() !== '')}
        subtitle={addressGapFinding ? [addressGapFinding.framework_name, addressGapFinding.clause_reference || '—', addressGapFinding.clause_title].filter(Boolean).join(' · ') : undefined}
        headerAccessory={(
          <span className="flex items-center gap-1">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${addressGapMode === 'replace' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
              {addressGapMode === 'replace' ? 'Replaces a clause' : 'Adds a clause'}
            </span>
            <InfoTip label="About this fix"
              text={addressGapMode === 'replace' ? 'Comply Agent found a clause of the document to replace; check the new wording on the right.'
                : 'A new clause, added at the end of the document under its own heading.'} />
          </span>
        )}
        footer={(
          <div className="flex items-center justify-end gap-2">
            <Button onClick={closeAddressGap}>Cancel</Button>
            <Button variant="primary" loading={applyGapFixMutation.isPending}
              leftIcon={applyGapFixMutation.isPending ? undefined : <Check aria-hidden />}
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
              disabled={!addressGapDraft.trim() || (addressGapMode === 'replace' && !addressGapOriginal.trim()) || (proposes && !addressGapReason.trim())}>
              {applyGapFixMutation.isPending ? (proposes ? 'Sending…' : 'Applying…') : proposes ? sendLabel(decider) : addressGapMode === 'replace' ? 'Replace the clause' : 'Add the clause'}
            </Button>
          </div>
        )}>
        {addressGapFinding && (
          <div className="space-y-4 px-5 py-4">
            {addressGapFinding.gap_description && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <span className="mb-1 block text-xs font-semibold text-amber-900">Gap</span>
                <p className="text-sm text-amber-950">{addressGapFinding.gap_description}</p>
              </div>
            )}
            {addressGapFinding.remediation_recommendation && (
              <div className="rounded-lg border border-[#99d5cc] bg-[#effaf8] p-3">
                <span className="mb-1 block text-xs font-semibold text-[#0b4f46]">Recommendation</span>
                <p className="text-sm text-[#1f2933]">{addressGapFinding.remediation_recommendation}</p>
              </div>
            )}

            <div className="flex justify-end">
              <Button leftIcon={<Sparkles aria-hidden />} loading={generateGapFixMutation.isPending} onClick={() => generateGapFixMutation.mutate(addressGapFinding.id)}>
                {generateGapFixMutation.isPending ? 'Drafting…' : addressGapDraft ? 'Draft again' : 'Draft with Comply Agent'}
              </Button>
            </div>

            {addressGapMode === 'replace' ? (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <FormField label="In the document now">
                  <Textarea value={addressGapOriginal} readOnly rows={14} className="font-mono" />
                </FormField>
                <FormField label="New wording">
                  <Textarea value={addressGapDraft} onChange={(e) => setAddressGapDraft(e.target.value)} rows={14} placeholder="Draft it with Comply Agent, or write it yourself." />
                </FormField>
              </div>
            ) : (
              <>
                <FormField label="New clause">
                  <Textarea value={addressGapDraft} onChange={(e) => setAddressGapDraft(e.target.value)} rows={12} placeholder="Draft it with Comply Agent, or write a clause that closes this gap yourself." />
                </FormField>
                <FormField label="Heading" optional>
                  <TextInput type="text" value={addressGapHeading} onChange={(e) => setAddressGapHeading(e.target.value)} />
                </FormField>
              </>
            )}

            {proposes ? (
              <ProposeNote id={`gap-why-${addressGapFinding.id}`} decider={decider} value={addressGapReason} onChange={setAddressGapReason}
                placeholder="e.g. Closing the gap before the audit" />
            ) : (
              <>
                <FormField label="Why" optional info="Kept in the version history.">
                  <TextInput type="text" value={addressGapReason} onChange={(e) => setAddressGapReason(e.target.value)} placeholder="e.g. Closing the gap before the audit" />
                </FormField>
                <p className="text-xs text-[#586472]">
                  Saved as the document&apos;s next version; earlier versions are kept.
                </p>
              </>
            )}
          </div>
        )}
      </AnimatedModal>

      {/* the frameworks to run against (a kit dialog: focus in, Tab wraps, Escape, focus back) */}
      <AnimatedModal isOpen={showGapModal} onClose={closeGapModal} size="md" title="Run gap analysis"
        headerAccessory={<InfoTip label="About running the analysis" text="Choose the frameworks to check; with none chosen, all of them run." />}
        footer={(
          <div className="flex justify-end gap-2">
            <Button onClick={closeGapModal}>Cancel</Button>
            <Button variant="primary" loading={runGapAnalysisMutation.isPending} leftIcon={<Play aria-hidden />} onClick={handleRunAnalysis}>
              {selectedFrameworkIds.length === 0 ? 'Run all' : `Run (${selectedFrameworkIds.length})`}
            </Button>
          </div>
        )}>
        <div className="space-y-3 px-5 py-4">
          {uploadedFrameworks && uploadedFrameworks.length > 0 && (
            <TextInput type="text" value={gapFrameworkSearch} onChange={(e) => setGapFrameworkSearch(e.target.value)} aria-label="Search frameworks"
              placeholder="Search by name, code or regulator…" leftAdornment={<Search aria-hidden />}
              rightAdornment={gapFrameworkSearch ? (
                <button type="button" onClick={() => setGapFrameworkSearch('')} aria-label="Clear the search"
                  className="grid h-[24px] w-[24px] place-items-center rounded-full text-ds-fg-muted hover:bg-ds-surface-hover hover:text-ds-fg focus-visible:outline-none focus-visible:shadow-ds-ring"><X className="h-[14px] w-[14px]" aria-hidden /></button>
              ) : undefined} />
          )}
          <div className="max-h-64 space-y-2 overflow-y-auto">
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
          {runError && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-[#7a1616]">{runError}</p>}
        </div>
      </AnimatedModal>

      <NcaCompareModal isOpen={showNcaCompareModal} onClose={() => setShowNcaCompareModal(false)}
        documents={allDocumentsForCompare.map((d) => ({ id: d.id, title: d.title, doc_type: d.doc_type }))} initialDocumentId={id} />
    </div>
  );
}

const DETAIL_LABEL = 'mb-1 block text-xs font-semibold text-[#586472]';

function GapFindingRow({
  finding, canEdit, isExpanded, isEditing, editAction, cs, rs, rms,
  onToggleExpand, onSetEditAction,
  tenantUsers, overrideForm, setOverrideForm, acceptRiskForm, setAcceptRiskForm,
  assignOwnerForm, setAssignOwnerForm, targetDateForm, setTargetDateForm,
  statusUpdateForm, setStatusUpdateForm,
  onUpdateFinding, onOverride, onAcceptRisk, onAddressGap, isPending, proposeTo,
}: any) {
  // the words are the page's own (cs/rs/rms.label); the tone of each is the registry's reading
  const pill = (tone: Tone, label: string) => <StatusPill tone={tone} size="sm" label={label} />;
  const toggle = (action: string) => (e: React.MouseEvent) => { e.stopPropagation(); onSetEditAction(editAction === action && isEditing ? null : action); };
  const owner = finding.assigned_owner_name || finding.assigned_owner?.display_name;
  const open = isExpanded ? 'Hide the details' : 'Show the details';
  return (
    <>
      {/* a click on any cell opens the details (as before: the row is not a tab stop of its own); the keyboard and the screen reader have the button in the first cell */}
      <Tr className="cursor-pointer">
        <Td onClick={onToggleExpand}>
          <IconButton label={open} aria-expanded={isExpanded} onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}>
            {isExpanded ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          </IconButton>
        </Td>
        <Td onClick={onToggleExpand}>
          <div className="font-mono text-xs text-[#26323d]">{finding.clause_reference || '-'}</div>
          {finding.clause_title && <div className="mt-0.5 max-w-[180px] truncate text-xs text-[#586472]" title={finding.clause_title}>{finding.clause_title}</div>}
        </Td>
        <Td onClick={onToggleExpand}><div className="max-w-[140px] truncate text-xs text-[#26323d]" title={finding.policy_section_reference || undefined}>{finding.policy_section_reference || '-'}</div></Td>
        <Td onClick={onToggleExpand}>
          {pill(COVERAGE_TONE[finding.compliance_status] ?? 'neutral', cs.label)}
          {finding.is_overridden && <span className="ml-1 text-xs text-[#586472]" title="Overridden">✓<span className="sr-only"> Overridden</span></span>}
        </Td>
        <Td onClick={onToggleExpand}><div className="max-w-[160px] truncate text-xs text-[#26323d]" title={finding.gap_description || undefined}>{finding.gap_description || '-'}</div></Td>
        <Td onClick={onToggleExpand}>{pill(priority.tone(finding.risk_severity), rs.label)}</Td>
        <Td onClick={onToggleExpand}><div className="max-w-[140px] truncate text-xs text-[#26323d]" title={finding.remediation_recommendation || undefined}>{finding.remediation_recommendation || '-'}</div></Td>
        <Td onClick={onToggleExpand} className="text-xs">{owner ? <span className="text-[#26323d]">{owner}</span> : <span className="text-[#586472]" title="No owner">—<span className="sr-only">No owner</span></span>}</Td>
        {/* the target date is a day (what <input type=date> sends), the update a moment */}
        <Td onClick={onToggleExpand} className="text-xs text-[#26323d]">{calendarDay(finding.target_remediation_date)}</Td>
        <Td onClick={onToggleExpand}>{pill(REMEDIATION_TONE[finding.remediation_status] ?? 'neutral', rms.label)}</Td>
        <Td onClick={onToggleExpand}><span className="inline-flex items-center justify-center rounded-full bg-[#eef1f4] px-2 py-0.5 text-xs text-[#26323d]">{finding.evidence_count || finding.evidence?.length || 0}</span></Td>
        <Td onClick={onToggleExpand} className="text-xs text-[#586472]">{day(finding.updated_at)}</Td>
      </Tr>

      {isExpanded && (
        <Tr>
          <Td colSpan={12} className="!bg-[#f7f9fa] px-4 py-4 sm:px-6">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="space-y-4">
                {finding.clause_requirement_text && (
                  <div className="rounded-lg border border-[#99d5cc] bg-[#effaf8] p-3">
                    <span className="mb-1 block text-xs font-semibold text-[#0b4f46]">What the clause requires</span>
                    <p className="text-sm text-[#26323d]">{finding.clause_requirement_text}</p>
                  </div>
                )}
                {finding.policy_section_text && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <span className="mb-1 block text-xs font-semibold text-emerald-800">What the document says</span>
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
                  <p className="text-sm text-[#586472]">Its editors work the findings.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {(finding.compliance_status === 'not_addressed' || finding.compliance_status === 'partially_compliant') && finding.remediation_status !== 'closed' && !finding.applied_at && (
                        <Button variant="primary" leftIcon={<Sparkles aria-hidden />} title="Comply Agent drafts a clause; you check it and apply it to the document"
                          onClick={(e) => { e.stopPropagation(); onAddressGap(finding); }}>
                          Address the gap
                        </Button>
                      )}
                      <Button leftIcon={<User aria-hidden />} aria-expanded={isEditing && editAction === 'assign-owner'} onClick={toggle('assign-owner')}>Owner</Button>
                      <Button leftIcon={<Calendar aria-hidden />} aria-expanded={isEditing && editAction === 'set-date'} onClick={toggle('set-date')}>Target date</Button>
                      <Button leftIcon={<Edit3 aria-hidden />} aria-expanded={isEditing && editAction === 'update-status'} onClick={toggle('update-status')}>Status</Button>
                      <Button leftIcon={<ShieldCheck aria-hidden />} aria-expanded={isEditing && editAction === 'override'} onClick={toggle('override')}>Override</Button>
                      {finding.compliance_status !== 'fully_compliant' && finding.compliance_status !== 'not_applicable' && (
                        <Button leftIcon={<ShieldAlert aria-hidden />} aria-expanded={isEditing && editAction === 'accept-risk'} onClick={toggle('accept-risk')}>Accept the risk</Button>
                      )}
                    </div>

                    {isEditing && editAction === 'assign-owner' && (
                      <div className="space-y-3 rounded-lg border border-[#d5dbe1] bg-white p-3" onClick={(e) => e.stopPropagation()}>
                        <FormField label="Owner">
                          <Select value={assignOwnerForm || ''} onChange={(e) => setAssignOwnerForm(e.target.value ? Number(e.target.value) : null)}>
                            <option value="">Choose a person…</option>
                            {tenantUsers?.map((u: any) => (
                              <option key={u.user_id || u.id} value={u.user_id || u.id}>{u.user?.display_name || u.display_name || u.user?.email || u.email}</option>
                            ))}
                          </Select>
                        </FormField>
                        <Button variant="primary" loading={isPending} disabled={!assignOwnerForm} onClick={() => onUpdateFinding(finding.id, { assigned_owner_id: assignOwnerForm })}>Save</Button>
                      </div>
                    )}
                    {isEditing && editAction === 'set-date' && (
                      <div className="space-y-3 rounded-lg border border-[#d5dbe1] bg-white p-3" onClick={(e) => e.stopPropagation()}>
                        <FormField label="Target date">
                          <TextInput type="date" value={targetDateForm} onChange={(e) => setTargetDateForm(e.target.value)} />
                        </FormField>
                        <Button variant="primary" loading={isPending} disabled={!targetDateForm} onClick={() => onUpdateFinding(finding.id, { target_remediation_date: targetDateForm })}>Save</Button>
                      </div>
                    )}
                    {isEditing && editAction === 'update-status' && (
                      <div className="space-y-3 rounded-lg border border-[#d5dbe1] bg-white p-3" onClick={(e) => e.stopPropagation()}>
                        <FormField label="Status">
                          <Select value={statusUpdateForm} onChange={(e) => setStatusUpdateForm(e.target.value)}>
                            <option value="">Choose…</option>
                            {Object.entries(REMEDIATION_STATUS_STYLES).map(([val, st]) => <option key={val} value={val}>{st.label}</option>)}
                          </Select>
                        </FormField>
                        <Button variant="primary" loading={isPending} disabled={!statusUpdateForm} onClick={() => onUpdateFinding(finding.id, { remediation_status: statusUpdateForm })}>Save</Button>
                      </div>
                    )}
                    {isEditing && editAction === 'override' && (
                      <div className="space-y-3 rounded-lg border border-[#99d5cc] bg-[#effaf8] p-3" onClick={(e) => e.stopPropagation()}>
                        {finding.applied_at && (
                          <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
                            Its fix is in the document. Overriding takes it back out; every other change stays. If its clause was changed since, the document is left as it is.
                            {proposeTo ? ` This goes to ${proposeTo} to accept or reject, with your “Why”; the document does not change until then.` : ''}
                          </p>
                        )}
                        <FormField label="Coverage">
                          <Select value={overrideForm.status} onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, status: e.target.value }))}>
                            {Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, st]) => <option key={val} value={val}>{st.label}</option>)}
                          </Select>
                        </FormField>
                        <FormField label="Why" required>
                          <Textarea value={overrideForm.justification} onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, justification: e.target.value }))} rows={3} />
                        </FormField>
                        <Button variant="primary" loading={isPending} disabled={!overrideForm.justification.trim()}
                          onClick={() => onOverride(finding.id, { override_status: overrideForm.status, override_justification: overrideForm.justification })}>
                          {finding.applied_at ? (proposeTo ? `Override and send the take back to ${proposeTo}` : 'Override and take the fix back') : 'Override'}
                        </Button>
                      </div>
                    )}
                    {isEditing && editAction === 'accept-risk' && (
                      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3" onClick={(e) => e.stopPropagation()}>
                        <FormField label="Why the risk is accepted" required>
                          <Textarea value={acceptRiskForm.justification} onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, justification: e.target.value }))} rows={3} />
                        </FormField>
                        <FormField label="Until" optional>
                          <TextInput type="date" value={acceptRiskForm.expiry_date} onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, expiry_date: e.target.value }))} />
                        </FormField>
                        <Button variant="primary" loading={isPending} disabled={!acceptRiskForm.justification.trim()}
                          onClick={() => {
                            const data: any = { justification: acceptRiskForm.justification };
                            if (acceptRiskForm.expiry_date) data.expiry_date = acceptRiskForm.expiry_date;
                            onAcceptRisk(finding.id, data);
                          }}>
                          Accept the risk
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </Td>
        </Tr>
      )}
    </>
  );
}
