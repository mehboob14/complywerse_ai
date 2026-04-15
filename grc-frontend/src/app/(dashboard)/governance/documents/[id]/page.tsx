'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from '@/components/ui/ToastProvider';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Download,
  Eye,
  Shield,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Search,
  ExternalLink,
  Wand2,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  BarChart3,
  Play,
  X,
  User,
  Calendar,
  Edit3,
  ShieldAlert,
  ShieldCheck,
  Check,
  Minus,
  Link2,
  Save,
  Pencil,
  Send,
  Archive,
  Plus,
  Trash2,
  History,
  RotateCcw,
  GitCompare,
} from 'lucide-react';

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  pending_review: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Pending Review' },
  pending_approval: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Pending Approval' },
  approved: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Approved' },
  published: { bg: 'bg-green-100', text: 'text-green-700', label: 'Published' },
  expired: { bg: 'bg-red-100', text: 'text-red-700', label: 'Expired' },
  archived: { bg: 'bg-gray-200', text: 'text-gray-700', label: 'Archived' },
};

const COMPLIANCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  fully_compliant: { bg: 'bg-green-100', text: 'text-green-700', label: 'Fully Compliant' },
  partially_compliant: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Partially Compliant' },
  not_addressed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Not Addressed' },
  not_applicable: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Not Applicable' },
};

const RISK_SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-700', label: 'Critical' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'High' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Medium' },
  low: { bg: 'bg-green-100', text: 'text-green-700', label: 'Low' },
};

const REMEDIATION_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-red-100', text: 'text-red-700', label: 'Open' },
  in_progress: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'In Progress' },
  closed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Closed' },
  accepted_risk: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Accepted Risk' },
};

const DOC_TYPE_STYLES: Record<string, { icon: any; color: string; bgColor: string; label: string }> = {
  policy: { icon: BookOpen, color: 'text-purple-700', bgColor: 'bg-purple-100', label: 'Policy' },
  standard: { icon: FileCheck, color: 'text-blue-700', bgColor: 'bg-blue-100', label: 'Standard' },
  procedure: { icon: ClipboardList, color: 'text-green-700', bgColor: 'bg-green-100', label: 'Procedure' },
  guideline: { icon: Lightbulb, color: 'text-yellow-700', bgColor: 'bg-yellow-100', label: 'Guideline' },
  charter: { icon: Shield, color: 'text-cyan-700', bgColor: 'bg-cyan-100', label: 'Charter' },
  framework: { icon: Layers, color: 'text-orange-700', bgColor: 'bg-orange-100', label: 'Framework' },
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
};

const truncateText = (text: string | null | undefined, maxLen: number = 80) => {
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
};

type TabKey = 'viewer' | 'statements' | 'controls' | 'gap-analysis' | 'review-history';

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = Number(params.id);

  const [activeTab, setActiveTab] = useState<TabKey>('viewer');
  const [showGapModal, setShowGapModal] = useState(false);
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editAction, setEditAction] = useState<string | null>(null);

  const [gapFilters, setGapFilters] = useState({
    framework_name: '',
    compliance_status: '',
    risk_severity: '',
    remediation_status: '',
    sort_by: 'clause_reference',
    sort_order: 'asc' as 'asc' | 'desc',
    skip: 0,
    limit: 20,
  });

  const [overrideForm, setOverrideForm] = useState({ status: 'fully_compliant', justification: '' });
  const [acceptRiskForm, setAcceptRiskForm] = useState({ justification: '', expiry_date: '' });
  const [assignOwnerForm, setAssignOwnerForm] = useState<number | null>(null);
  const [targetDateForm, setTargetDateForm] = useState('');
  const [statusUpdateForm, setStatusUpdateForm] = useState('');
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', description: '', classification: '', doc_type: '' });

  const { data: document, isLoading: docLoading, error: docError } = useQuery({
    queryKey: ['governance-document', id],
    queryFn: async () => {
      const response = await governanceApi.getDocument(id);
      return response.data as any;
    },
    enabled: !!id,
  });

  const { data: htmlContent, isLoading: htmlLoading } = useQuery({
    queryKey: ['document-view-html', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentViewHtml(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'viewer',
  });

  const { data: statements, isLoading: statementsLoading } = useQuery({
    queryKey: ['document-policy-statements', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentPolicyStatements(id);
      return (response.data as any) || [];
    },
    enabled: !!id && activeTab === 'statements',
  });

  const { data: mappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ['document-mappings', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentMappings(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'controls',
  });

  const { data: gapAnalysisRuns } = useQuery({
    queryKey: ['gap-analysis-runs', id],
    queryFn: async () => {
      const response = await governanceApi.getGapAnalysisRuns(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'gap-analysis',
    refetchInterval: (query) => {
      const data = query.state.data;
      const runs = data?.runs || data || [];
      const hasRunning = Array.isArray(runs) && runs.some((r: any) => r.status === 'running');
      return hasRunning ? 5000 : false;
    },
  });

  const hasRunningAnalysis = (() => {
    const runs = gapAnalysisRuns?.runs || gapAnalysisRuns || [];
    return Array.isArray(runs) && runs.some((r: any) => r.status === 'running');
  })();

  const { data: complianceSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ['compliance-summary', id],
    queryFn: async () => {
      const response = await governanceApi.getComplianceSummary(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'gap-analysis',
  });

  const { data: gapFindings, isLoading: findingsLoading } = useQuery({
    queryKey: ['document-gap-findings', id, gapFilters],
    queryFn: async () => {
      const params: Record<string, any> = {
        skip: gapFilters.skip,
        limit: gapFilters.limit,
        sort_by: gapFilters.sort_by,
        sort_order: gapFilters.sort_order,
      };
      if (gapFilters.framework_name) params.framework_name = gapFilters.framework_name;
      if (gapFilters.compliance_status) params.compliance_status = gapFilters.compliance_status;
      if (gapFilters.risk_severity) params.risk_severity = gapFilters.risk_severity;
      if (gapFilters.remediation_status) params.remediation_status = gapFilters.remediation_status;
      const response = await governanceApi.getDocumentGapFindings(id, params);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'gap-analysis',
    refetchInterval: hasRunningAnalysis ? 3000 : false, // Poll every 3 seconds when analysis is running
  });

  const { data: uploadedFrameworks } = useQuery({
    queryKey: ['frameworks-list'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const data = response.data;
      const items = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      return items.filter((f: any) => f.is_active && (f.upload_status === 'parsed' || f.upload_status === 'published'));
    },
    enabled: showGapModal,
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users', document?.tenant_id],
    queryFn: async () => {
      const response = await governanceApi.getTenantUsers(document?.tenant_id || 1);
      return response.data as any[];
    },
    enabled: !!document?.tenant_id && editAction === 'assign-owner',
  });

  const [isParsing, setIsParsing] = useState(false);
  const parsePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopParsePolling = () => {
    if (parsePollingRef.current) {
      clearInterval(parsePollingRef.current);
      parsePollingRef.current = null;
    }
  };

  const startParsePolling = () => {
    stopParsePolling();
    setIsParsing(true);
    parsePollingRef.current = setInterval(async () => {
      try {
        const res = await governanceApi.getParseStatus(id);
        const data = res.data as any;
        if (data.status === 'completed') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'success', title: 'Policy Parsed', message: data.message || `${data.total_statements || 0} statements extracted.` });
          queryClient.invalidateQueries({ queryKey: ['document-policy-statements', id] });
        } else if (data.status === 'review_required') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'info', title: 'Review Required', message: data.message || 'Re-parse proposals are ready for review.' });
          queryClient.invalidateQueries({ queryKey: ['document-policy-statements', id] });
          queryClient.invalidateQueries({ queryKey: ['reparse-proposals', id] });
        } else if (data.status === 'failed') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'error', title: 'Parse Failed', message: data.error || 'Failed to parse policy.' });
        }
      } catch {
        stopParsePolling();
        setIsParsing(false);
      }
    }, 3000);
  };

  useEffect(() => {
    return () => stopParsePolling();
  }, []);

  const parsePolicyMutation = useMutation({
    mutationFn: () => governanceApi.parsePolicy(id),
    onSuccess: () => {
      toast({ type: 'info', title: 'Parsing Started', message: 'Policy parsing started in background. Results will appear automatically.' });
      startParsePolling();
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Parse Failed', message: error?.response?.data?.detail || 'Failed to parse policy.' });
    },
  });

  const runGapAnalysisMutation = useMutation({
    mutationFn: (data: { document_id: number; framework_ids?: number[]; run_all?: boolean }) =>
      governanceApi.runGapAnalysis(data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Gap Analysis Started', message: 'Processing in background. Results will appear automatically.' });
      // Refetch all gap analysis related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['compliance-summary', id], refetchType: 'all' });
      // Refetch findings with all filter combinations
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings'] }, { refetchType: 'all' });
      setShowGapModal(false);
      setSelectedFrameworkIds([]);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Analysis Failed', message: error?.response?.data?.detail || 'Failed to run gap analysis.' });
    },
  });

  const updateFindingMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: Record<string, any> }) =>
      governanceApi.updateGapFinding(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Finding Updated' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update finding.' });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { override_status: string; override_justification: string } }) =>
      governanceApi.overrideGapFinding(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Override Applied' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
      setOverrideForm({ status: 'fully_compliant', justification: '' });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Override Failed', message: error?.response?.data?.detail || 'Failed to override.' });
    },
  });

  const acceptRiskMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { justification: string; expiry_date?: string } }) =>
      governanceApi.acceptGapRisk(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Risk Accepted' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
      setAcceptRiskForm({ justification: '', expiry_date: '' });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Accept Risk Failed', message: error?.response?.data?.detail || 'Failed to accept risk.' });
    },
  });

  const updateDocumentMutation = useMutation({
    mutationFn: (data: any) => governanceApi.updateDocument(id, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Document Updated' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      setShowEditForm(false);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update document.' });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => governanceApi.updateDocumentStatus(id, status),
    onSuccess: () => {
      toast({ type: 'success', title: 'Status Updated' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Status Update Failed', message: error?.response?.data?.detail || 'Failed to update status.' });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => governanceApi.publishDocument(id),
    onSuccess: () => {
      toast({ type: 'success', title: 'Document Published' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Publish Failed', message: error?.response?.data?.detail || 'Failed to publish document.' });
    },
  });

  const handleEditOpen = () => {
    setEditForm({
      title: document?.title || '',
      description: document?.description || '',
      classification: document?.classification || 'internal',
      doc_type: document?.doc_type || 'policy',
    });
    setShowEditForm(true);
  };

  const handleEditSave = () => {
    updateDocumentMutation.mutate(editForm);
  };

  const handleDownload = async () => {
    try {
      const response = await governanceApi.downloadDocumentFile(id);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = document?.file_name || `document_${id}`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch {
      toast({ type: 'error', title: 'Download Failed' });
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await governanceApi.exportGapFindings(id);
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `gap_findings_${id}.csv`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
      toast({ type: 'success', title: 'Export Complete' });
    } catch {
      toast({ type: 'error', title: 'Export Failed' });
    }
  };

  const handleRunAnalysis = () => {
    if (selectedFrameworkIds.length === 0) {
      runGapAnalysisMutation.mutate({ document_id: id, run_all: true });
    } else {
      runGapAnalysisMutation.mutate({ document_id: id, framework_ids: selectedFrameworkIds });
    }
  };

  const toggleFramework = (fwId: number) => {
    setSelectedFrameworkIds(prev =>
      prev.includes(fwId) ? prev.filter(i => i !== fwId) : [...prev, fwId]
    );
  };

  const toggleSelectAll = () => {
    if (!uploadedFrameworks) return;
    if (selectedFrameworkIds.length === uploadedFrameworks.length) {
      setSelectedFrameworkIds([]);
    } else {
      setSelectedFrameworkIds(uploadedFrameworks.map((f: any) => f.id));
    }
  };

  const toggleRowExpand = (rowId: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const handleGapSort = (field: string) => {
    setGapFilters(prev => ({
      ...prev,
      sort_by: field,
      sort_order: prev.sort_by === field && prev.sort_order === 'asc' ? 'desc' : 'asc',
      skip: 0,
    }));
  };

  const findings = useMemo(() => {
    const data = gapFindings;
    if (Array.isArray(data)) return data;
    if (data?.items) return data.items;
    if (data?.findings) return data.findings;
    return [];
  }, [gapFindings]);

  const totalFindings = useMemo(() => {
    if (gapFindings?.total) return gapFindings.total;
    return findings.length;
  }, [gapFindings, findings]);

  const totalPages = Math.ceil(totalFindings / gapFilters.limit);
  const currentPage = Math.floor(gapFilters.skip / gapFilters.limit);

  if (docLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (docError || !document) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-400">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load document</p>
        <button onClick={() => router.back()} className="text-primary-400 hover:underline">Go Back</button>
      </div>
    );
  }

  const docStatus = STATUS_STYLES[document.status] || { bg: 'bg-slate-500/20', text: 'text-gray-600', label: document.status };
  const docType = DOC_TYPE_STYLES[document.doc_type] || { icon: FileText, color: 'text-gray-600', bgColor: 'bg-slate-500/20', label: document.doc_type };
  const TypeIcon = docType.icon;

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: 'viewer', label: 'Document Viewer', icon: Eye },
    { key: 'statements', label: 'Statements', icon: ClipboardList },
    { key: 'controls', label: 'Controls', icon: Shield },
    { key: 'gap-analysis', label: 'Gap Analysis', icon: BarChart3 },
    { key: 'review-history', label: 'Review History', icon: Clock },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push('/governance/documents')}
            className="mt-1 rounded-lg border border-gray-300 bg-white p-2 text-gray-600 hover:text-black hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <div className={`rounded-lg ${docType.bgColor} p-2`}>
                <TypeIcon className={`h-5 w-5 ${docType.color}`} />
              </div>
              <h1 className="text-2xl font-bold text-black">{document.title}</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              {document.document_code && <span className="font-mono">{document.document_code}</span>}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docStatus.bg} ${docStatus.text}`}>
                {docStatus.label}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docType.bgColor} ${docType.color}`}>
                {docType.label}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {document.has_file && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-800 hover:text-black hover:bg-gray-100 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download File
            </button>
          )}
          <button
            onClick={handleEditOpen}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-800 hover:text-black hover:bg-gray-100 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Edit Details
          </button>
        </div>
      </div>

      {showEditForm && (
        <div className="rounded-xl border border-gray-300 bg-white p-5">
          <h3 className="text-lg font-semibold text-black mb-4">Edit Document Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Classification</label>
              <select
                value={editForm.classification}
                onChange={(e) => setEditForm(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-800 mb-1">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">Document Type</label>
              <select
                value={editForm.doc_type}
                onChange={(e) => setEditForm(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="policy">Policy</option>
                <option value="standard">Standard</option>
                <option value="procedure">Procedure</option>
                <option value="guideline">Guideline</option>
                <option value="charter">Charter</option>
                <option value="framework">Framework</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-gray-300">
            <button
              onClick={() => setShowEditForm(false)}
              className="px-4 py-2 text-sm font-medium text-gray-800 hover:text-black rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={updateDocumentMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-black hover:bg-primary-700 disabled:opacity-50"
            >
              {updateDocumentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Workflow Actions */}
      <div className="flex items-center gap-3">
        {document.status === 'draft' && (
          <button
            onClick={() => updateStatusMutation.mutate('pending_review')}
            disabled={updateStatusMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-yellow-600 px-4 py-2 text-sm font-medium text-black hover:bg-yellow-700 disabled:opacity-50 transition-colors"
          >
            {updateStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Submit for Review
          </button>
        )}
        {document.status === 'pending_review' && (
          <button
            onClick={() => updateStatusMutation.mutate('approved')}
            disabled={updateStatusMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-black hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {updateStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Approve
          </button>
        )}
        {document.status === 'approved' && (
          <button
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-black hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Publish
          </button>
        )}
        {document.status === 'published' && (
          <button
            onClick={() => updateStatusMutation.mutate('archived')}
            disabled={updateStatusMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-black hover:bg-slate-500 disabled:opacity-50 transition-colors"
          >
            {updateStatusMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
            Archive
          </button>
        )}
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-gray-300">
        <nav className="flex gap-1">
          {tabs.map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-black hover:border-gray-300'
                }`}
              >
                <TabIcon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'viewer' && (
        <DocumentViewerTab
          document={document}
          htmlContent={htmlContent}
          htmlLoading={htmlLoading}
          docType={docType}
        />
      )}

      {activeTab === 'statements' && (
        <StatementsTab
          statements={statements}
          statementsLoading={statementsLoading}
          parsePolicyMutation={parsePolicyMutation}
          isParsing={isParsing}
          documentId={id}
        />
      )}

      {activeTab === 'controls' && (
        <ControlsTab
          mappings={mappings}
          mappingsLoading={mappingsLoading}
          documentId={id}
        />
      )}

      {activeTab === 'gap-analysis' && (
        <div className="space-y-6">
          {/* Run Analysis Panel */}
          <div className="rounded-xl border border-gray-300 bg-gradient-to-r from-purple-50 to-blue-50 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-100 p-2.5">
                  <Wand2 className="h-6 w-6 text-purple-700" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-black">AI Gap Analysis</h3>
                  <p className="text-sm text-gray-600">Analyze this document against compliance frameworks</p>
                </div>
              </div>
              <button
                onClick={() => setShowGapModal(true)}
                disabled={runGapAnalysisMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {runGapAnalysisMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run Gap Analysis
              </button>
            </div>
            {(runGapAnalysisMutation.isPending || hasRunningAnalysis) && (
              <div className="mt-4 flex items-center gap-3 rounded-lg bg-purple-100 border border-purple-300 p-3">
                <Loader2 className="h-5 w-5 animate-spin text-purple-600" />
                <span className="text-purple-700">
                  {hasRunningAnalysis
                    ? 'Gap analysis is running in the background. Results will appear automatically when complete...'
                    : `Submitting analysis request...`}
                </span>
              </div>
            )}
          </div>

          {/* Compliance Summary */}
          <ComplianceSummarySection summary={complianceSummary} loading={summaryLoading} />

          {/* Gap Findings Table */}
          <div className="rounded-xl border border-gray-300 bg-white overflow-hidden">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-gray-300">
              <h3 className="text-lg font-semibold text-black">Gap Findings & Remediation Tracker</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 hover:text-black hover:bg-gray-100 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-3 p-4 border-b border-gray-300 bg-white/30">
              <select
                value={gapFilters.framework_name}
                onChange={(e) => setGapFilters(prev => ({ ...prev, framework_name: e.target.value, skip: 0 }))}
                className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="">All Frameworks</option>
                {(complianceSummary?.frameworks || complianceSummary?.framework_summaries || []).map((fw: any) => (
                  <option key={fw.framework_id || fw.framework_name} value={fw.framework_name || fw.name}>
                    {fw.framework_name || fw.name}
                  </option>
                ))}
              </select>
              <select
                value={gapFilters.compliance_status}
                onChange={(e) => setGapFilters(prev => ({ ...prev, compliance_status: e.target.value, skip: 0 }))}
                className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="">All Compliance Status</option>
                {Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => (
                  <option key={val} value={val}>{s.label}</option>
                ))}
              </select>
              <select
                value={gapFilters.risk_severity}
                onChange={(e) => setGapFilters(prev => ({ ...prev, risk_severity: e.target.value, skip: 0 }))}
                className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="">All Risk Severity</option>
                {Object.entries(RISK_SEVERITY_STYLES).map(([val, s]) => (
                  <option key={val} value={val}>{s.label}</option>
                ))}
              </select>
              <select
                value={gapFilters.remediation_status}
                onChange={(e) => setGapFilters(prev => ({ ...prev, remediation_status: e.target.value, skip: 0 }))}
                className="rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="">All Remediation Status</option>
                {Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => (
                  <option key={val} value={val}>{s.label}</option>
                ))}
              </select>
            </div>

            {findingsLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : findings.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-gray-600">
                <BarChart3 className="h-12 w-12" />
                <p>No gap findings yet</p>
                <p className="text-sm">Run a gap analysis to generate findings</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-white">
                      <tr>
                        <th className="w-8 px-2 py-3"></th>
                        <SortHeader field="clause_reference" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Framework Clause</SortHeader>
                        <SortHeader field="policy_section_reference" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Policy Ref</SortHeader>
                        <SortHeader field="compliance_status" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Compliance</SortHeader>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Gap Description</th>
                        <SortHeader field="risk_severity" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Risk</SortHeader>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Recommendation</th>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Owner</th>
                        <SortHeader field="target_remediation_date" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Target Date</SortHeader>
                        <SortHeader field="remediation_status" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Status</SortHeader>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Evidence</th>
                        <SortHeader field="updated_at" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Updated</SortHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {findings.map((finding: any) => {
                        const isExpanded = expandedRows.has(finding.id);
                        const isEditing = editingRow === finding.id;
                        const cs = COMPLIANCE_STATUS_STYLES[finding.compliance_status] || { bg: 'bg-slate-500/20', text: 'text-gray-600', label: finding.compliance_status };
                        const rs = RISK_SEVERITY_STYLES[finding.risk_severity] || { bg: 'bg-slate-500/20', text: 'text-gray-600', label: finding.risk_severity };
                        const rms = REMEDIATION_STATUS_STYLES[finding.remediation_status] || { bg: 'bg-slate-500/20', text: 'text-gray-600', label: finding.remediation_status };

                        return (
                          <GapFindingRow
                            key={finding.id}
                            finding={finding}
                            isExpanded={isExpanded}
                            isEditing={isEditing}
                            editAction={editAction}
                            cs={cs}
                            rs={rs}
                            rms={rms}
                            onToggleExpand={() => toggleRowExpand(finding.id)}
                            onSetEditAction={(action: string | null) => {
                              setEditingRow(action ? finding.id : null);
                              setEditAction(action);
                            }}
                            tenantUsers={tenantUsers}
                            overrideForm={overrideForm}
                            setOverrideForm={setOverrideForm}
                            acceptRiskForm={acceptRiskForm}
                            setAcceptRiskForm={setAcceptRiskForm}
                            assignOwnerForm={assignOwnerForm}
                            setAssignOwnerForm={setAssignOwnerForm}
                            targetDateForm={targetDateForm}
                            setTargetDateForm={setTargetDateForm}
                            statusUpdateForm={statusUpdateForm}
                            setStatusUpdateForm={setStatusUpdateForm}
                            onUpdateFinding={(findingId: number, data: any) => updateFindingMutation.mutate({ findingId, data })}
                            onOverride={(findingId: number, data: any) => overrideMutation.mutate({ findingId, data })}
                            onAcceptRisk={(findingId: number, data: any) => acceptRiskMutation.mutate({ findingId, data })}
                            isPending={updateFindingMutation.isPending || overrideMutation.isPending || acceptRiskMutation.isPending}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t border-gray-300">
                    <span className="text-sm text-gray-600">
                      Showing {gapFilters.skip + 1}-{Math.min(gapFilters.skip + gapFilters.limit, totalFindings)} of {totalFindings}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setGapFilters(prev => ({ ...prev, skip: Math.max(0, prev.skip - prev.limit) }))}
                        disabled={currentPage === 0}
                        className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-sm text-gray-800">
                        Page {currentPage + 1} of {totalPages}
                      </span>
                      <button
                        onClick={() => setGapFilters(prev => ({ ...prev, skip: prev.skip + prev.limit }))}
                        disabled={currentPage >= totalPages - 1}
                        className="rounded-lg border border-gray-300 p-2 text-gray-600 hover:text-black disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'review-history' && (
        <ReviewHistoryTab documentId={id} document={document} />
      )}

      {/* Gap Analysis Framework Selection Modal */}
      {showGapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-gray-300 bg-white p-6 shadow-2xl mx-4">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-black">Run Gap Analysis</h3>
                <p className="text-sm text-gray-600">Select frameworks to analyze against</p>
              </div>
              <button
                onClick={() => { setShowGapModal(false); setSelectedFrameworkIds([]); }}
                className="p-2 text-gray-600 hover:text-black rounded-lg hover:bg-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 max-h-64 overflow-y-auto mb-6">
              {!uploadedFrameworks ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : uploadedFrameworks.length === 0 ? (
                <p className="text-sm text-gray-600 text-center py-4">No frameworks uploaded yet</p>
              ) : (
                <>
                  <label className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white p-3 cursor-pointer hover:bg-gray-100 transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedFrameworkIds.length === uploadedFrameworks.length}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-500 focus:ring-primary-500"
                    />
                    <span className="font-medium text-black">Select All ({uploadedFrameworks.length})</span>
                  </label>
                  {uploadedFrameworks.map((fw: any) => (
                    <label
                      key={fw.id}
                      className="flex items-center gap-3 rounded-lg border border-gray-300/50 bg-white/50 p-3 cursor-pointer hover:bg-gray-100/50 transition-colors"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFrameworkIds.includes(fw.id)}
                        onChange={() => toggleFramework(fw.id)}
                        className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-500 focus:ring-primary-500"
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-black">{fw.name || `Framework ${fw.id}`}</span>
                          {(fw.short_code || fw.framework_type) && (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-800">{fw.short_code || fw.framework_type}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-600">
                          {fw.version && <span>v{fw.version}</span>}
                          {(fw.control_count != null || fw.parsed_controls_count != null) && <span>{fw.control_count ?? fw.parsed_controls_count} controls</span>}
                          {(fw.regulator || fw.source_organization) && <span>{fw.regulator || fw.source_organization}</span>}
                        </div>
                      </div>
                    </label>
                  ))}
                </>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-300">
              <button
                onClick={() => { setShowGapModal(false); setSelectedFrameworkIds([]); }}
                className="px-4 py-2 text-sm font-medium text-gray-800 hover:text-black rounded-lg hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={handleRunAnalysis}
                disabled={runGapAnalysisMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-black hover:bg-purple-700 disabled:opacity-50"
              >
                {runGapAnalysisMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {selectedFrameworkIds.length === 0 ? 'Run All' : `Run Analysis (${selectedFrameworkIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SortHeader({ field, current, order, onSort, children }: {
  field: string;
  current: string;
  order: string;
  onSort: (f: string) => void;
  children: React.ReactNode;
}) {
  return (
    <th
      className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600 cursor-pointer hover:text-black transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${current === field ? 'text-primary-400' : ''}`} />
      </div>
    </th>
  );
}

const REVIEW_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Pending' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
};

const OUTCOME_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  no_changes: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'No Changes' },
  minor_update: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Minor Update' },
  major_revision: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Major Revision' },
  retired: { bg: 'bg-red-100', text: 'text-red-700', label: 'Retired' },
};

function ReviewHistoryTab({ documentId, document: doc }: { documentId: number; document: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [completeForm, setCompleteForm] = useState({ review_notes: '', changes_made: '', outcome: 'no_changes' });

  const { data: reviewHistory, isLoading } = useQuery({
    queryKey: ['review-history', documentId],
    queryFn: async () => {
      const response = await governanceApi.getDocumentReviewHistory(documentId);
      return response.data as any[];
    },
    enabled: !!documentId,
  });

  const startReviewMutation = useMutation({
    mutationFn: () => governanceApi.startDocumentReview(documentId),
    onSuccess: () => {
      toast({ type: 'success', title: 'Review Started', message: 'Periodic review has been initiated.' });
      queryClient.invalidateQueries({ queryKey: ['review-history', documentId] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Failed to Start Review', message: error?.response?.data?.detail || 'An error occurred.' });
    },
  });

  const completeReviewMutation = useMutation({
    mutationFn: (data: { review_notes: string; changes_made: string; outcome: string }) =>
      governanceApi.completeDocumentReview(documentId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Review Completed', message: 'Review has been completed and next review date updated.' });
      queryClient.invalidateQueries({ queryKey: ['review-history', documentId] });
      queryClient.invalidateQueries({ queryKey: ['governance-document', documentId] });
      setShowCompleteForm(false);
      setCompleteForm({ review_notes: '', changes_made: '', outcome: 'no_changes' });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Failed to Complete Review', message: error?.response?.data?.detail || 'An error occurred.' });
    },
  });

  const hasInProgressReview = reviewHistory?.some((r: any) => r.review_status === 'in_progress');
  const isOverdue = doc?.next_review_date && new Date(doc.next_review_date) < new Date();

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-300 bg-gradient-to-r from-blue-50 to-cyan-50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2.5">
              <Clock className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-black">Policy Review Lifecycle</h3>
              <div className="flex items-center gap-3 mt-1">
                {doc?.next_review_date ? (
                  <span className={`text-sm ${isOverdue ? 'text-red-400' : 'text-gray-600'}`}>
                    {isOverdue ? (
                      <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Overdue — was due {formatDate(doc.next_review_date)}</span>
                    ) : (
                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Next review: {formatDate(doc.next_review_date)}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-gray-700">No review date scheduled</span>
                )}
                {doc?.review_cycle_months && (
                  <span className="text-xs text-gray-700">({doc.review_cycle_months}-month cycle)</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!hasInProgressReview && (
              <button
                onClick={() => startReviewMutation.mutate()}
                disabled={startReviewMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 font-medium text-black hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {startReviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start Review
              </button>
            )}
            {hasInProgressReview && (
              <button
                onClick={() => setShowCompleteForm(!showCompleteForm)}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-black hover:bg-green-700 transition-colors"
              >
                <CheckCircle className="h-4 w-4" />
                Complete Review
              </button>
            )}
          </div>
        </div>

        {showCompleteForm && (
          <div className="mt-4 rounded-lg border border-gray-300 bg-white p-4 space-y-3">
            <h4 className="text-sm font-medium text-black">Complete Review</h4>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Outcome</label>
              <select
                value={completeForm.outcome}
                onChange={(e) => setCompleteForm(prev => ({ ...prev, outcome: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
              >
                <option value="no_changes">No Changes Needed</option>
                <option value="minor_update">Minor Update</option>
                <option value="major_revision">Major Revision</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Review Notes</label>
              <textarea
                value={completeForm.review_notes}
                onChange={(e) => setCompleteForm(prev => ({ ...prev, review_notes: e.target.value }))}
                rows={2}
                placeholder="Notes about the review..."
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Changes Made</label>
              <textarea
                value={completeForm.changes_made}
                onChange={(e) => setCompleteForm(prev => ({ ...prev, changes_made: e.target.value }))}
                rows={2}
                placeholder="Summary of changes made (if any)..."
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => completeReviewMutation.mutate(completeForm)}
                disabled={completeReviewMutation.isPending}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-black hover:bg-green-700 disabled:opacity-50"
              >
                {completeReviewMutation.isPending ? 'Submitting...' : 'Submit Review'}
              </button>
              <button
                onClick={() => setShowCompleteForm(false)}
                className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm text-gray-800 hover:text-black hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-300 bg-white overflow-hidden">
        <div className="border-b border-gray-300 bg-white/50 px-6 py-3">
          <h3 className="font-medium text-black">Review History</h3>
        </div>
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
          </div>
        ) : !reviewHistory || reviewHistory.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-gray-600">
            <Clock className="h-8 w-8" />
            <p className="text-sm">No review history yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-300 bg-white/30">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Outcome</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Started</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Completed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-600">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {reviewHistory.map((review: any) => {
                  const statusStyle = REVIEW_STATUS_STYLES[review.review_status] || { bg: 'bg-slate-500/20', text: 'text-gray-600', label: review.review_status };
                  const outcomeStyle = review.outcome ? (OUTCOME_STYLES[review.outcome] || { bg: 'bg-slate-500/20', text: 'text-gray-600', label: review.outcome }) : null;
                  return (
                    <tr key={review.id} className="hover:bg-gray-100/30">
                      <td className="px-4 py-3 text-sm text-gray-800 capitalize">{(review.review_type || 'periodic').replace('_', ' ')}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {outcomeStyle ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomeStyle.bg} ${outcomeStyle.text}`}>
                            {outcomeStyle.label}
                          </span>
                        ) : <span className="text-xs text-gray-700">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(review.started_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDate(review.completed_at)}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">{review.review_notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function DocumentViewerTab({ document: doc, htmlContent, htmlLoading, docType }: any) {
  // Detect if doc.content is markdown (AI-generated docs always are)
  const rawContent: string = doc?.content || '';
  const isMarkdown = /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s/m.test(rawContent);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 rounded-xl border border-gray-300 bg-white overflow-hidden">
        <div className="border-b border-gray-300 bg-white/50 px-6 py-3">
          <h3 className="font-medium text-black">Document Content</h3>
        </div>
        <div className="p-6">
          {htmlLoading ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            </div>
          ) : isMarkdown ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => <h1 className="text-2xl font-bold text-black mt-6 mb-3 pb-2 border-b border-gray-200">{children}</h1>,
                h2: ({ children }) => <h2 className="text-xl font-semibold text-black mt-5 mb-2">{children}</h2>,
                h3: ({ children }) => <h3 className="text-lg font-semibold text-black mt-4 mb-2">{children}</h3>,
                h4: ({ children }) => <h4 className="text-base font-semibold text-black mt-3 mb-1">{children}</h4>,
                h5: ({ children }) => <h5 className="text-sm font-semibold text-black mt-2 mb-1">{children}</h5>,
                h6: ({ children }) => <h6 className="text-sm font-medium text-gray-700 mt-2 mb-1">{children}</h6>,
                p: ({ children }) => <p className="text-gray-800 mb-3 leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1 text-gray-800 pl-4">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-3 space-y-1 text-gray-800 pl-4">{children}</ol>,
                li: ({ children }) => <li className="text-gray-800">{children}</li>,
                strong: ({ children }) => <strong className="font-semibold text-black">{children}</strong>,
                em: ({ children }) => <em className="italic text-gray-800">{children}</em>,
                blockquote: ({ children }) => <blockquote className="border-l-4 border-gray-300 pl-4 my-3 text-gray-700 italic">{children}</blockquote>,
                code: ({ children }) => <code className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>,
                pre: ({ children }) => <pre className="bg-gray-100 text-gray-800 p-4 rounded-lg overflow-x-auto mb-3 text-sm font-mono">{children}</pre>,
                hr: () => <hr className="border-gray-200 my-4" />,
                a: ({ href, children }) => <a href={href} className="text-blue-600 underline hover:text-blue-800">{children}</a>,
                table: ({ children }) => <div className="overflow-x-auto mb-4"><table className="w-full border-collapse border border-gray-300 text-sm">{children}</table></div>,
                th: ({ children }) => <th className="border border-gray-300 bg-gray-100 px-3 py-2 text-left font-semibold text-black">{children}</th>,
                td: ({ children }) => <td className="border border-gray-300 px-3 py-2 text-gray-800">{children}</td>,
              }}
            >
              {rawContent}
            </ReactMarkdown>
          ) : htmlContent?.html ? (
            <div
              className="document-viewer-html text-black"
              dangerouslySetInnerHTML={{ __html: htmlContent.html }}
              style={{ color: '#000' }}
            />
          ) : (
            <div className="flex h-48 flex-col items-center justify-center gap-3 text-gray-600">
              <FileText className="h-12 w-12" />
              <p>No viewable content available</p>
              {doc.has_file && <p className="text-sm">Download the file to view its contents</p>}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-gray-300 bg-white p-5">
          <h3 className="font-medium text-black mb-4">Document Metadata</h3>
          <div className="space-y-3">
            <MetadataRow label="Type" value={docType.label} />
            <MetadataRow label="Classification" value={doc.classification || '-'} />
            <MetadataRow label="Version" value={doc.current_version || '1.0'} />
            <MetadataRow label="Owner" value={doc.owner_name || '-'} />
            <MetadataRow label="Effective Date" value={formatDate(doc.effective_date)} />
            <MetadataRow label="Next Review" value={formatDate(doc.next_review_date)} />
            <MetadataRow label="Review Cycle" value={`${doc.review_cycle_months || 12} months`} />
            {doc.file_name && <MetadataRow label="File" value={doc.file_name} />}
            {doc.file_size && <MetadataRow label="File Size" value={`${(doc.file_size / 1024).toFixed(1)} KB`} />}
          </div>
        </div>

        {doc.description && (
          <div className="rounded-xl border border-gray-300 bg-white p-5">
            <h3 className="font-medium text-black mb-2">Description</h3>
            <p className="text-sm text-black">{doc.description}</p>
          </div>
        )}

        {doc.tags?.length > 0 && (
          <div className="rounded-xl border border-gray-300 bg-white p-5">
            <h3 className="font-medium text-black mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {doc.tags.map((tag: string) => (
                <span key={tag} className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-black">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className="text-black capitalize">{value}</span>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  security: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  privacy: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-300' },
  governance: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-300' },
  compliance: { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-300' },
  operational: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  risk_management: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-300' },
  hr: { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-300' },
  it: { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-300' },
  financial: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  legal: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  environmental: { bg: 'bg-teal-100', text: 'text-teal-700', border: 'border-teal-300' },
  quality: { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-300' },
};

function StatementsTab({ statements, statementsLoading, parsePolicyMutation, isParsing, documentId }: any) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stmts = Array.isArray(statements) ? statements : statements?.statements || [];
  const allCategories = Object.keys(CATEGORY_COLORS);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(allCategories));
  const [editingStmtId, setEditingStmtId] = useState<number | null>(null);
  const [editStmtForm, setEditStmtForm] = useState({ statement_text: '', statement_summary: '', category: '', priority: '', is_mandatory: false, source_section: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ statement_text: '', statement_summary: '', category: 'security', priority: 'medium', is_mandatory: true, source_section: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [versionHistoryStmtId, setVersionHistoryStmtId] = useState<number | null>(null);
  const [compareVersions, setCompareVersions] = useState<{a: number, b: number} | null>(null);

  const addMutation = useMutation({
    mutationFn: (data: any) => {
      console.log('[Add Statement] Sending to backend:', data);
      return governanceApi.addStatement(documentId, data);
    },
    onSuccess: (response: any) => {
      console.log('[Add Statement] Success response:', response);
      toast({ type: 'success', title: 'Statement Added' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      setShowAddForm(false);
      setAddForm({ statement_text: '', statement_summary: '', category: 'security', priority: 'medium', is_mandatory: true, source_section: '' });
    },
    onError: (error: any) => {
      console.error('[Add Statement] Error:', error);
      console.error('[Add Statement] Error details:', error?.response?.data);
      toast({ type: 'error', title: 'Add Failed', message: error?.response?.data?.detail || error?.message || 'Failed to add statement.' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ stmtId, data }: { stmtId: number; data: any }) => governanceApi.updateStatement(documentId, stmtId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Statement Updated' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      setEditingStmtId(null);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update statement.' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (stmtId: number) => governanceApi.deleteStatement(documentId, stmtId),
    onSuccess: () => {
      toast({ type: 'success', title: 'Statement Deleted' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Delete Failed', message: error?.response?.data?.detail || 'Failed to delete statement.' });
    },
  });

  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['statement-versions', documentId, versionHistoryStmtId],
    queryFn: async () => {
      const res = await governanceApi.getStatementVersions(documentId, versionHistoryStmtId!);
      return res.data;
    },
    enabled: !!versionHistoryStmtId,
  });

  const { data: diffData } = useQuery({
    queryKey: ['statement-diff', documentId, versionHistoryStmtId, compareVersions],
    queryFn: async () => {
      const res = await governanceApi.getStatementDiff(documentId, versionHistoryStmtId!, compareVersions!.a, compareVersions!.b);
      return res.data;
    },
    enabled: !!versionHistoryStmtId && !!compareVersions,
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ stmtId, versionId }: { stmtId: number; versionId: number }) =>
      governanceApi.rollbackStatement(documentId, stmtId, versionId),
    onSuccess: () => {
      toast({ type: 'success', title: 'Rolled Back', message: 'Statement restored to selected version' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId, versionHistoryStmtId] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Rollback Failed', message: error?.response?.data?.detail || 'Failed to rollback' });
    },
  });

  const { data: parseStatus } = useQuery({
    queryKey: ['parse-status', documentId],
    queryFn: async () => {
      const res = await governanceApi.getParseStatus(documentId);
      return res.data as any;
    },
    enabled: !!documentId,
  });

  const { data: proposalsData } = useQuery({
    queryKey: ['reparse-proposals', documentId],
    queryFn: async () => {
      const res = await governanceApi.getReparseProposals(documentId);
      return res.data;
    },
    enabled: !!parseStatus?.has_proposals || parseStatus?.status === 'review_required',
  });

  const applyProposalsMutation = useMutation({
    mutationFn: (decisions: Array<{index: number, action: string}>) =>
      governanceApi.applyReparseProposals(documentId, decisions),
    onSuccess: (res: any) => {
      toast({ type: 'success', title: 'Proposals Applied', message: res.data?.message || 'Changes applied successfully' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
      queryClient.invalidateQueries({ queryKey: ['parse-status', documentId] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Apply Failed', message: error?.response?.data?.detail || 'Failed to apply proposals' });
    },
  });

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    stmts.forEach((stmt: any) => {
      const cat = stmt.category || 'uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(stmt);
    });
    return groups;
  }, [stmts]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const startEdit = (stmt: any) => {
    setEditingStmtId(stmt.id);
    setEditStmtForm({
      statement_text: stmt.statement_text || '',
      statement_summary: stmt.statement_summary || '',
      category: stmt.category || 'security',
      priority: stmt.priority || 'medium',
      is_mandatory: stmt.is_mandatory ?? true,
      source_section: stmt.source_section || '',
    });
  };

  if (statementsLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (stmts.length === 0) {
    return (
      <div className="space-y-4">
        {showAddForm && (
          <div className="rounded-xl border border-green-500/30 bg-white p-5">
            <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add New Statement
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statement Text *</label>
                <textarea
                  value={addForm.statement_text}
                  onChange={(e) => setAddForm(prev => ({ ...prev, statement_text: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                  placeholder="Enter the policy statement text..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Summary</label>
                <input
                  type="text"
                  value={addForm.statement_summary}
                  onChange={(e) => setAddForm(prev => ({ ...prev, statement_summary: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                  placeholder="Brief summary..."
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                  <select
                    value={addForm.category}
                    onChange={(e) => setAddForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                  >
                    {Object.keys(CATEGORY_COLORS).map(c => (
                      <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                  <select
                    value={addForm.priority}
                    onChange={(e) => setAddForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Source Section</label>
                  <input
                    type="text"
                    value={addForm.source_section}
                    onChange={(e) => setAddForm(prev => ({ ...prev, source_section: e.target.value }))}
                    className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                    placeholder="e.g. Section 4.1"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={addForm.is_mandatory}
                      onChange={(e) => setAddForm(prev => ({ ...prev, is_mandatory: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-500"
                    />
                    <span className="text-sm text-gray-800">Mandatory</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-gray-300">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-sm text-gray-600 hover:text-black rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    console.log('[Add Statement Button] Clicked - Form data:', addForm);
                    addMutation.mutate(addForm);
                  }}
                  disabled={addMutation.isPending || !addForm.statement_text.trim()}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-black hover:bg-green-700 disabled:opacity-50"
                >
                  {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Statement
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-gray-300 bg-white p-8 text-center">
          <ClipboardList className="h-12 w-12 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-600 mb-4">No policy statements have been parsed yet</p>
          <div className="flex items-center gap-3 justify-center">
            <button
              onClick={() => parsePolicyMutation.mutate()}
              disabled={parsePolicyMutation.isPending || isParsing}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-black hover:bg-purple-700 disabled:opacity-50"
            >
              {(parsePolicyMutation.isPending || isParsing) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {isParsing ? 'Parsing in background...' : 'Parse Policy Statements'}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 font-medium text-black hover:bg-gray-100"
            >
              <Plus className="h-4 w-4" />
              Add Manually
            </button>
          </div>
        </div>
      </div>
    );
  }

  const categoryKeys = Object.keys(grouped);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-semibold text-black">{stmts.length} Policy Statement{stmts.length !== 1 ? 's' : ''}</h3>
          <div className="flex items-center gap-1.5 flex-wrap">
            {categoryKeys.map(cat => {
              const colors = CATEGORY_COLORS[cat] || { bg: 'bg-slate-500/20', text: 'text-gray-600', border: 'border-slate-500/30' };
              return (
                <span key={cat} className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>
                  {cat.replace(/_/g, ' ')}: {grouped[cat].length}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const response = await governanceApi.exportPolicyStatements(documentId);
                const blob = new Blob([response.data], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = window.document.createElement('a');
                a.href = url;
                a.download = `policy_statements_${documentId}_${new Date().toISOString().slice(0, 10)}.csv`;
                window.document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                window.document.body.removeChild(a);
              } catch (e) { console.error('Export failed:', e); }
            }}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 hover:text-black hover:bg-gray-100 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export Statements (CSV)
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-lg border border-green-500/50 bg-green-500/10 px-3 py-1.5 text-sm text-green-400 hover:bg-green-500/20"
          >
            <Plus className="h-4 w-4" />
            Add Statement
          </button>
          <button
            onClick={() => parsePolicyMutation.mutate()}
            disabled={parsePolicyMutation.isPending || isParsing}
            className="flex items-center gap-2 rounded-lg border border-purple-500/50 bg-purple-500/10 px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-500/20 disabled:opacity-50"
          >
            {(parsePolicyMutation.isPending || isParsing) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {isParsing ? 'Parsing...' : 'Re-parse All'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className="rounded-xl border border-green-500/30 bg-white p-5">
          <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add New Statement
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Statement Text *</label>
              <textarea
                value={addForm.statement_text}
                onChange={(e) => setAddForm(prev => ({ ...prev, statement_text: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                placeholder="Enter the policy statement text..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Summary</label>
              <input
                type="text"
                value={addForm.statement_summary}
                onChange={(e) => setAddForm(prev => ({ ...prev, statement_summary: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                placeholder="Brief summary..."
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  value={addForm.category}
                  onChange={(e) => setAddForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                >
                  {Object.keys(CATEGORY_COLORS).map(c => (
                    <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                <select
                  value={addForm.priority}
                  onChange={(e) => setAddForm(prev => ({ ...prev, priority: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Source Section</label>
                <input
                  type="text"
                  value={addForm.source_section}
                  onChange={(e) => setAddForm(prev => ({ ...prev, source_section: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                  placeholder="e.g. Section 4.1"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={addForm.is_mandatory}
                    onChange={(e) => setAddForm(prev => ({ ...prev, is_mandatory: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-500"
                  />
                  <span className="text-sm text-gray-800">Mandatory</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-gray-300">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 text-sm text-gray-600 hover:text-black rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  console.log('[Add Statement Button] Clicked - Form data:', addForm);
                  addMutation.mutate(addForm);
                }}
                disabled={addMutation.isPending || !addForm.statement_text.trim()}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-black hover:bg-green-700 disabled:opacity-50"
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {proposalsData?.proposals?.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <div>
                <h4 className="text-sm font-semibold text-amber-400">Re-parse Review Required</h4>
                <p className="text-xs text-gray-600 mt-0.5">{proposalsData.total} proposed changes ({proposalsData.update_count} updates, {proposalsData.new_count} new)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const decisions = proposalsData.proposals.map((_: any, i: number) => ({ index: i, action: 'accept' }));
                  applyProposalsMutation.mutate(decisions);
                }}
                disabled={applyProposalsMutation.isPending}
                className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-black hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Accept All
              </button>
              <button
                onClick={() => {
                  const decisions = proposalsData.proposals.map((_: any, i: number) => ({ index: i, action: 'reject' }));
                  applyProposalsMutation.mutate(decisions);
                }}
                disabled={applyProposalsMutation.isPending}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-black hover:bg-red-700 disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Reject All
              </button>
            </div>
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {proposalsData.proposals.filter((p: any) => p.status === 'pending').map((proposal: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-gray-300 bg-white p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${proposal.type === 'update' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                      {proposal.type === 'update' ? 'Update Existing' : 'New Statement'}
                    </span>
                    {proposal.similarity_score > 0 && (
                      <span className="text-xs text-gray-700">{Math.round(proposal.similarity_score * 100)}% match</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'accept' }])}
                      disabled={applyProposalsMutation.isPending}
                      className="p-1.5 text-green-400 hover:bg-green-500/20 rounded-lg transition-colors"
                      title="Accept"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'reject' }])}
                      disabled={applyProposalsMutation.isPending}
                      className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                      title="Reject"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {proposal.type === 'update' && proposal.existing_text && (
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div className="rounded bg-red-500/5 border border-red-500/20 p-2">
                      <span className="text-xs text-red-400 font-medium">Current</span>
                      <p className="text-xs text-gray-600 mt-1 line-clamp-3">{proposal.existing_text}</p>
                    </div>
                    <div className="rounded bg-green-500/5 border border-green-500/20 p-2">
                      <span className="text-xs text-green-400 font-medium">Proposed</span>
                      <p className="text-xs text-gray-600 mt-1 line-clamp-3">{proposal.new_statement?.statement_text}</p>
                    </div>
                  </div>
                )}
                {proposal.type === 'new' && (
                  <p className="text-xs text-gray-600 line-clamp-3">{proposal.new_statement?.statement_text}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {categoryKeys.map(cat => {
        const colors = CATEGORY_COLORS[cat] || { bg: 'bg-slate-500/20', text: 'text-gray-600', border: 'border-slate-500/30' };
        const isExpanded = expandedCategories.has(cat);
        const catStmts = grouped[cat];

        return (
          <div key={cat} className={`rounded-xl border ${colors.border} bg-white overflow-hidden`}>
            <button
              onClick={() => toggleCategory(cat)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-100/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${colors.bg} ${colors.text} capitalize`}>
                  {cat.replace(/_/g, ' ')}
                </span>
                <span className="text-sm text-gray-800">{catStmts.length} statement{catStmts.length !== 1 ? 's' : ''}</span>
              </div>
              {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-600" /> : <ChevronDown className="h-4 w-4 text-gray-600" />}
            </button>

            {isExpanded && (
              <div className="border-t border-gray-300 divide-y divide-slate-700/50">
                {catStmts.map((stmt: any, idx: number) => {
                  const isEditingThis = editingStmtId === stmt.id;
                  const isDeleting = deleteConfirm === stmt.id;

                  return (
                    <div key={stmt.id || idx} className="p-4 hover:bg-white/80 transition-colors">
                      {isEditingThis ? (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Statement Text</label>
                            <textarea
                              value={editStmtForm.statement_text}
                              onChange={(e) => setEditStmtForm(prev => ({ ...prev, statement_text: e.target.value }))}
                              rows={3}
                              className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-600 mb-1">Summary</label>
                            <input
                              type="text"
                              value={editStmtForm.statement_summary}
                              onChange={(e) => setEditStmtForm(prev => ({ ...prev, statement_summary: e.target.value }))}
                              className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                              <select
                                value={editStmtForm.category}
                                onChange={(e) => setEditStmtForm(prev => ({ ...prev, category: e.target.value }))}
                                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                              >
                                {Object.keys(CATEGORY_COLORS).map(c => (
                                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Priority</label>
                              <select
                                value={editStmtForm.priority}
                                onChange={(e) => setEditStmtForm(prev => ({ ...prev, priority: e.target.value }))}
                                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                              >
                                <option value="critical">Critical</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-600 mb-1">Source Section</label>
                              <input
                                type="text"
                                value={editStmtForm.source_section}
                                onChange={(e) => setEditStmtForm(prev => ({ ...prev, source_section: e.target.value }))}
                                className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 cursor-pointer pb-2">
                                <input
                                  type="checkbox"
                                  checked={editStmtForm.is_mandatory}
                                  onChange={(e) => setEditStmtForm(prev => ({ ...prev, is_mandatory: e.target.checked }))}
                                  className="h-4 w-4 rounded border-gray-300 bg-gray-100 text-primary-500"
                                />
                                <span className="text-sm text-gray-800">Mandatory</span>
                              </label>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setEditingStmtId(null)} className="px-3 py-1.5 text-sm text-gray-600 hover:text-black rounded-lg hover:bg-gray-100">Cancel</button>
                            <button
                              onClick={() => updateMutation.mutate({ stmtId: stmt.id, data: editStmtForm })}
                              disabled={updateMutation.isPending}
                              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-black hover:bg-primary-700 disabled:opacity-50"
                            >
                              {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {stmt.statement_code && (
                                <span className="rounded bg-primary-500/20 px-2 py-0.5 text-xs font-mono text-primary-400">
                                  {stmt.statement_code}
                                </span>
                              )}
                              {stmt.source_section && (
                                <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                  {stmt.source_section}
                                </span>
                              )}
                              {stmt.is_mandatory && (
                                <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">mandatory</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {stmt.priority && (
                                <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  stmt.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                                  stmt.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                  stmt.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-green-500/20 text-green-400'
                                }`}>
                                  {stmt.priority}
                                </span>
                              )}
                              {(stmt.ai_confidence != null || stmt.confidence_score != null) && (
                                <span className="text-xs text-gray-600">
                                  {Math.round((stmt.ai_confidence ?? stmt.confidence_score) * 100)}% confidence
                                </span>
                              )}
                              <button
                                onClick={() => setVersionHistoryStmtId(stmt.id)}
                                className="p-1 text-gray-700 hover:text-purple-400 rounded hover:bg-gray-100 transition-colors"
                                title="Version history"
                              >
                                <History className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => startEdit(stmt)}
                                className="p-1 text-gray-700 hover:text-blue-400 rounded hover:bg-gray-100 transition-colors"
                                title="Edit statement"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {isDeleting ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => deleteMutation.mutate(stmt.id)}
                                    disabled={deleteMutation.isPending}
                                    className="px-2 py-0.5 text-xs bg-red-600 text-black rounded hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {deleteMutation.isPending ? '...' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="px-2 py-0.5 text-xs text-gray-600 rounded hover:bg-gray-100"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(stmt.id)}
                                  className="p-1 text-gray-700 hover:text-red-400 rounded hover:bg-gray-100 transition-colors"
                                  title="Delete statement"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-800">{stmt.statement_text || stmt.text}</p>
                          {stmt.statement_summary && (
                            <p className="text-xs text-gray-700 mt-1 italic">{stmt.statement_summary}</p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {versionHistoryStmtId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-gray-300 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-300 bg-white px-6 py-4">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-purple-400" />
                <h3 className="text-lg font-semibold text-black">Version History</h3>
                {versionData?.total_versions != null && (
                  <span className="rounded-full bg-purple-500/20 px-2.5 py-0.5 text-xs font-medium text-purple-400">
                    {versionData.total_versions} version{versionData.total_versions !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button onClick={() => { setVersionHistoryStmtId(null); setCompareVersions(null); }} className="p-1.5 text-gray-600 hover:text-black rounded-lg hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {versionsLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
                </div>
              ) : versionData?.versions?.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {versionData.versions.map((v: any, idx: number) => {
                      const isLatest = idx === 0;
                      const changeColors: Record<string, string> = {
                        initial_parse: 'bg-purple-500/20 text-purple-400',
                        manual_edit: 'bg-blue-500/20 text-blue-400',
                        ai_reparse: 'bg-amber-500/20 text-amber-400',
                        rollback: 'bg-cyan-500/20 text-cyan-400',
                        manual_add: 'bg-green-500/20 text-green-400',
                      };
                      return (
                        <div key={v.id} className={`rounded-xl border ${isLatest ? 'border-purple-500/40 bg-purple-500/5' : 'border-gray-300 bg-white'} p-4`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-800">v{v.version_number}</span>
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${changeColors[v.change_type] || 'bg-slate-500/20 text-gray-600'}`}>
                                {v.change_type?.replace(/_/g, ' ')}
                              </span>
                              {isLatest && <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">current</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isLatest && (
                                <>
                                  <button
                                    onClick={() => setCompareVersions({ a: v.id, b: versionData.versions[0].id })}
                                    className="flex items-center gap-1 rounded-lg border border-gray-300 bg-gray-100 px-2.5 py-1 text-xs text-gray-800 hover:text-black hover:bg-gray-100"
                                  >
                                    <GitCompare className="h-3 w-3" />
                                    Compare
                                  </button>
                                  <button
                                    onClick={() => rollbackMutation.mutate({ stmtId: versionHistoryStmtId, versionId: v.id })}
                                    disabled={rollbackMutation.isPending}
                                    className="flex items-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-xs text-cyan-400 hover:bg-cyan-500/20 disabled:opacity-50"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    {rollbackMutation.isPending ? 'Rolling back...' : 'Rollback'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-gray-800 line-clamp-2">{v.statement_text}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-700">
                            {v.changed_by_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {v.changed_by_name}</span>}
                            {v.changed_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(v.changed_at).toLocaleString()}</span>}
                            {v.change_reason && <span className="italic">&quot;{v.change_reason}&quot;</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {compareVersions && diffData && (
                    <div className="mt-6 rounded-xl border border-purple-500/30 bg-white p-5">
                      <h4 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
                        <GitCompare className="h-4 w-4" />
                        Version Comparison
                      </h4>
                      {diffData.field_changes?.length > 0 ? (
                        <div className="space-y-2">
                          {diffData.field_changes.map((change: any, i: number) => (
                            <div key={i} className="rounded-lg border border-gray-300 bg-white p-3">
                              <span className="text-xs font-semibold text-gray-600 uppercase">{change.field.replace(/_/g, ' ')}</span>
                              <div className="grid grid-cols-2 gap-3 mt-1">
                                <div className="rounded bg-red-500/10 border border-red-500/20 p-2">
                                  <span className="text-xs text-red-400">v{diffData.version_a.version_number}</span>
                                  <p className="text-sm text-gray-800 mt-1">{change.version_a_value || '(empty)'}</p>
                                </div>
                                <div className="rounded bg-green-500/10 border border-green-500/20 p-2">
                                  <span className="text-xs text-green-400">v{diffData.version_b.version_number}</span>
                                  <p className="text-sm text-gray-800 mt-1">{change.version_b_value || '(empty)'}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-600">No differences found between these versions.</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-600 text-center py-8">No version history available for this statement.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ControlsTab({ mappings, mappingsLoading, documentId }: any) {
  if (mappingsLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  const links = mappings?.control_links || [];

  if (links.length === 0) {
    return (
      <div className="rounded-xl border border-gray-300 bg-white p-8 text-center">
        <Shield className="h-12 w-12 text-gray-700 mx-auto mb-3" />
        <p className="text-gray-600 mb-4">No controls linked to this document</p>
        <a
          href="/governance/mappings"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-black hover:bg-primary-700 transition-colors"
        >
          <Link2 className="h-4 w-4" />
          Go to Mappings
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-black">{links.length} Linked Control{links.length !== 1 ? 's' : ''}</h3>
        <a
          href="/governance/mappings"
          className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
        >
          Manage Mappings
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {links.map((link: any) => (
        <div key={link.id} className="rounded-xl border border-gray-300 bg-white/50 p-4 hover:bg-white transition-colors">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/20 p-2">
              <Shield className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-black">{link.control_code}</p>
              <p className="text-sm text-gray-600">{link.control_name}</p>
            </div>
            <span className="rounded-full bg-primary-500/20 px-2.5 py-0.5 text-xs text-primary-400 capitalize">
              {(link.link_type || '').replace('_', ' ')}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ComplianceSummarySection({ summary, loading }: { summary: any; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
      </div>
    );
  }

  const frameworks = summary?.frameworks || summary?.framework_summaries || [];
  if (!Array.isArray(frameworks) || frameworks.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-300 bg-white p-5">
      <h3 className="text-lg font-semibold text-black mb-4">Compliance Summary by Framework</h3>
      <div className="space-y-4">
        {frameworks.map((fw: any, idx: number) => {
          const pct = fw.compliance_percentage ?? fw.compliance_score ?? 0;
          const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500';
          const textColor = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';
          return (
            <div key={fw.framework_id || idx}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-800">{fw.framework_name || fw.name || `Framework ${fw.framework_id}`}</span>
                <span className={`text-sm font-bold ${textColor}`}>{Math.round(pct)}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-gray-600">
                {fw.total_clauses != null && <span>{fw.total_clauses} clauses</span>}
                {fw.compliant_count != null && <span className="text-green-400">{fw.compliant_count} compliant</span>}
                {fw.gaps_count != null && <span className="text-red-400">{fw.gaps_count} gaps</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GapFindingRow({
  finding, isExpanded, isEditing, editAction, cs, rs, rms,
  onToggleExpand, onSetEditAction,
  tenantUsers, overrideForm, setOverrideForm, acceptRiskForm, setAcceptRiskForm,
  assignOwnerForm, setAssignOwnerForm, targetDateForm, setTargetDateForm,
  statusUpdateForm, setStatusUpdateForm,
  onUpdateFinding, onOverride, onAcceptRisk, isPending,
}: any) {
  return (
    <>
      <tr className="bg-white/50 hover:bg-white transition-colors cursor-pointer" onClick={onToggleExpand}>
        <td className="px-2 py-3">
          {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-600" /> : <ChevronDown className="h-4 w-4 text-gray-600" />}
        </td>
        <td className="px-3 py-3">
          <div className="text-sm text-gray-800 font-mono">{finding.clause_reference || '-'}</div>
          {finding.clause_title && (
            <div className="text-xs text-gray-600 mt-0.5 max-w-[200px] line-clamp-2">{finding.clause_title}</div>
          )}
        </td>
        <td className="px-3 py-3">
          <div className="text-sm text-gray-800">{finding.policy_section_reference || '-'}</div>
          {finding.policy_section_text && (
            <div className="text-xs text-gray-600 mt-0.5 max-w-[220px] line-clamp-2">{finding.policy_section_text}</div>
          )}
        </td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cs.bg} ${cs.text}`}>
            {cs.label}
          </span>
        </td>
        <td className="px-3 py-3 text-sm text-gray-800 max-w-[180px]">{truncateText(finding.gap_description)}</td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${rs.bg} ${rs.text}`}>
            {rs.label}
          </span>
        </td>
        <td className="px-3 py-3 text-sm text-gray-800 max-w-[160px]">{truncateText(finding.remediation_recommendation, 60)}</td>
        <td className="px-3 py-3 text-sm">
          {finding.assigned_owner_name || finding.assigned_owner?.display_name ? (
            <span className="text-gray-800">{finding.assigned_owner_name || finding.assigned_owner?.display_name}</span>
          ) : (
            <span className="text-gray-700 italic">Unassigned</span>
          )}
        </td>
        <td className="px-3 py-3 text-sm text-gray-800">{formatDate(finding.target_remediation_date)}</td>
        <td className="px-3 py-3">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${rms.bg} ${rms.text}`}>
            {rms.label}
          </span>
        </td>
        <td className="px-3 py-3">
          <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-800">
            {finding.evidence_count || finding.evidence?.length || 0}
          </span>
        </td>
        <td className="px-3 py-3 text-sm text-gray-600">{formatDate(finding.updated_at)}</td>
      </tr>

      {isExpanded && (
        <tr className="bg-white/50">
          <td colSpan={12} className="px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Details Section */}
              <div className="space-y-4">
                {finding.clause_requirement_text && (
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-blue-400 block mb-1">Framework Clause Requirement</label>
                    <p className="text-sm text-gray-800">{finding.clause_requirement_text}</p>
                  </div>
                )}
                {finding.policy_section_text && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-emerald-400 block mb-1">Matching Policy Text</label>
                    <p className="text-sm text-gray-800">{finding.policy_section_text}</p>
                  </div>
                )}
                {finding.gap_description && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-gray-600 block mb-1">Full Gap Description</label>
                    <p className="text-sm text-gray-800">{finding.gap_description}</p>
                  </div>
                )}
                {finding.ai_reasoning && (
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-purple-400 block mb-1">AI Reasoning</label>
                    <p className="text-sm text-gray-800">{finding.ai_reasoning}</p>
                  </div>
                )}
                {finding.confidence_score != null && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-gray-600 block mb-1">Confidence Score</label>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-gray-100 overflow-hidden">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${finding.confidence_score * 100}%` }} />
                      </div>
                      <span className="text-sm text-gray-800">{Math.round(finding.confidence_score * 100)}%</span>
                    </div>
                  </div>
                )}
                {finding.missing_requirement && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-gray-600 block mb-1">Missing Requirement</label>
                    <p className="text-sm text-gray-800">{finding.missing_requirement}</p>
                  </div>
                )}
                {finding.remediation_recommendation && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-gray-600 block mb-1">Remediation Recommendation</label>
                    <p className="text-sm text-gray-800">{finding.remediation_recommendation}</p>
                  </div>
                )}
                {/* Impact Types */}
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-gray-600 block mb-2">Impact Types</label>
                  <div className="flex flex-wrap gap-3">
                    {['regulatory', 'operational', 'financial', 'reputational'].map(impact => {
                      const isActive = finding[`${impact}_impact`] || finding.impact_types?.includes(impact);
                      return (
                        <div key={impact} className="flex items-center gap-1.5">
                          {isActive ? (
                            <Check className="h-4 w-4 text-green-400" />
                          ) : (
                            <Minus className="h-4 w-4 text-slate-600" />
                          )}
                          <span className={`text-sm capitalize ${isActive ? 'text-gray-800' : 'text-gray-700'}`}>{impact}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Actions Section */}
              <div className="space-y-3">
                <label className="text-xs font-medium uppercase tracking-wider text-gray-600 block">Actions</label>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'assign-owner' ? null : 'assign-owner'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 hover:text-black hover:bg-gray-100"
                  >
                    <User className="h-3.5 w-3.5" /> Assign Owner
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'set-date' ? null : 'set-date'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 hover:text-black hover:bg-gray-100"
                  >
                    <Calendar className="h-3.5 w-3.5" /> Set Target Date
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'update-status' ? null : 'update-status'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-300 bg-gray-100 px-3 py-1.5 text-sm text-gray-800 hover:text-black hover:bg-gray-100"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Update Status
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'override' ? null : 'override'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-purple-500/50 bg-purple-500/10 px-3 py-1.5 text-sm text-purple-400 hover:bg-purple-500/20"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" /> Override
                  </button>
                  {finding.compliance_status !== 'fully_compliant' && finding.compliance_status !== 'not_applicable' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'accept-risk' ? null : 'accept-risk'); }}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-500/20"
                    >
                      <ShieldAlert className="h-3.5 w-3.5" /> Accept Risk
                    </button>
                  )}
                </div>

                {/* Inline Forms */}
                {isEditing && editAction === 'assign-owner' && (
                  <div className="rounded-lg border border-gray-300 bg-white p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-gray-800">Select Owner</label>
                    <select
                      value={assignOwnerForm || ''}
                      onChange={(e) => setAssignOwnerForm(e.target.value ? Number(e.target.value) : null)}
                      className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                    >
                      <option value="">Select user...</option>
                      {tenantUsers?.map((u: any) => (
                        <option key={u.user_id || u.id} value={u.user_id || u.id}>
                          {u.user?.display_name || u.display_name || u.user?.email || u.email}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => onUpdateFinding(finding.id, { assigned_owner_id: assignOwnerForm })}
                      disabled={!assignOwnerForm || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'set-date' && (
                  <div className="rounded-lg border border-gray-300 bg-white p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-gray-800">Target Remediation Date</label>
                    <input
                      type="date"
                      value={targetDateForm}
                      onChange={(e) => setTargetDateForm(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                    />
                    <button
                      onClick={() => onUpdateFinding(finding.id, { target_remediation_date: targetDateForm })}
                      disabled={!targetDateForm || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'update-status' && (
                  <div className="rounded-lg border border-gray-300 bg-white p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-gray-800">Remediation Status</label>
                    <select
                      value={statusUpdateForm}
                      onChange={(e) => setStatusUpdateForm(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                    >
                      <option value="">Select status...</option>
                      {Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => (
                        <option key={val} value={val}>{s.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => onUpdateFinding(finding.id, { remediation_status: statusUpdateForm })}
                      disabled={!statusUpdateForm || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'override' && (
                  <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-purple-300">Override Compliance Status</label>
                    <select
                      value={overrideForm.status}
                      onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, status: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                    >
                      {Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => (
                        <option key={val} value={val}>{s.label}</option>
                      ))}
                    </select>
                    <textarea
                      value={overrideForm.justification}
                      onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, justification: e.target.value }))}
                      placeholder="Justification (required)"
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                    />
                    <button
                      onClick={() => onOverride(finding.id, { override_status: overrideForm.status, override_justification: overrideForm.justification })}
                      disabled={!overrideForm.justification || isPending}
                      className="rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-purple-700 disabled:opacity-50"
                    >
                      {isPending ? 'Applying...' : 'Apply Override'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'accept-risk' && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-amber-300">Accept Risk</label>
                    <textarea
                      value={acceptRiskForm.justification}
                      onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, justification: e.target.value }))}
                      placeholder="Justification (required)"
                      rows={3}
                      className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                    />
                    <div>
                      <label className="text-xs text-gray-600 block mb-1">Expiry Date (optional)</label>
                      <input
                        type="date"
                        value={acceptRiskForm.expiry_date}
                        onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, expiry_date: e.target.value }))}
                        className="w-full rounded-lg border border-gray-300 bg-gray-100 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={() => {
                        const data: any = { justification: acceptRiskForm.justification };
                        if (acceptRiskForm.expiry_date) data.expiry_date = acceptRiskForm.expiry_date;
                        onAcceptRisk(finding.id, data);
                      }}
                      disabled={!acceptRiskForm.justification || isPending}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-black hover:bg-amber-700 disabled:opacity-50"
                    >
                      {isPending ? 'Accepting...' : 'Accept Risk'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
