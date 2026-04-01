'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Download,
  Edit2,
  Save,
  X,
  Minus,
  Upload,
  Sparkles,
  Paperclip,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Send,
  FileUp,
} from 'lucide-react';

interface EvidenceUpload {
  id: number;
  assessment_item_id: number;
  evidence_id: number | null;
  status: string;
  current_tier: number;
  ai_recommendation: string | null;
  submitted_at: string | null;
  created_at: string;
  evidence?: {
    id: number;
    name: string;
    file_name: string;
    file_type: string;
    status: string;
    uploaded_at: string;
  };
  approval_history?: Array<{
    id: number;
    action: string;
    tier_number: number;
    comments: string | null;
    performed_at: string;
    performer?: { full_name: string };
  }>;
}

interface AIRecommendation {
  recommendations: Array<{
    evidence_type: string;
    description: string;
    priority: string;
    example_files: string[];
  }>;
  summary: string;
}

interface AssessmentItem {
  id: number;
  item_number: string;
  area_domain: string | null;
  control_description: string | null;
  compliance_status: string;
  gaps_identified: string | null;
  proposed_solution: string | null;
  responsible_party: string | null;
  timeline: string | null;
  priority: string | null;
  evidence_reference: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string | null;
  ai_evidence_recommendation: string | null;
  ai_recommendation_generated_at: string | null;
}

interface Assessment {
  id: number;
  tenant_id: number;
  name: string;
  assessment_type: string;
  source: string | null;
  file_name: string | null;
  status: string;
  due_date: string | null;
  assessor: string | null;
  overall_score: number | null;
  total_items: number | null;
  complied_count: number | null;
  partially_complied_count: number | null;
  not_complied_count: number | null;
  in_progress_count: number | null;
  na_count: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  items: AssessmentItem[];
  items_by_domain: Record<string, AssessmentItem[]>;
}

const STATUS_OPTIONS = [
  { value: 'complied', label: 'Complied' },
  { value: 'partially_complied', label: 'Partially Complied' },
  { value: 'not_complied', label: 'Not Complied' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'na', label: 'N/A' },
];

const COMPLIANCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof CheckCircle }> = {
  complied: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Complied', icon: CheckCircle },
  partially_complied: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partial', icon: AlertTriangle },
  not_complied: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Not Complied', icon: XCircle },
  in_progress: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Progress', icon: Clock },
  na: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'N/A', icon: Minus },
};

const ASSESSMENT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Draft' },
  in_progress: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Progress' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Archived' },
};

const EVIDENCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-50', text: 'text-gray-600', label: 'Draft' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Review' },
  in_approval: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Approval' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
  returned: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Returned' },
};

function getScoreColor(score: number | null): { bg: string; text: string } {
  if (score === null) return { bg: 'bg-gray-50', text: 'text-gray-600' };
  if (score >= 80) return { bg: 'bg-emerald-50', text: 'text-emerald-700' };
  if (score >= 50) return { bg: 'bg-amber-50', text: 'text-amber-700' };
  return { bg: 'bg-rose-50', text: 'text-rose-700' };
}

function getScoreBarColor(score: number | null): string {
  if (score === null) return 'bg-gray-300';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function parseAIRecommendation(jsonStr: string | null): AIRecommendation | null {
  if (!jsonStr) return null;
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export default function AssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assessmentId = Number(params.id);
  const queryClient = useQueryClient();

  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingStatus, setEditingStatus] = useState<string>('');
  const [expandedEvidence, setExpandedEvidence] = useState<Set<number>>(new Set());
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);
  const [generatingAIForItem, setGeneratingAIForItem] = useState<number | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceName, setEvidenceName] = useState('');
  const [evidenceDescription, setEvidenceDescription] = useState('');
  const [approvalComments, setApprovalComments] = useState<Record<number, string>>({});
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: assessment, isLoading, error } = useQuery<Assessment>({
    queryKey: ['compliance-assessment-detail', assessmentId],
    queryFn: async () => {
      const response = await apiClient.get(`/compliance/assessments/${assessmentId}`);
      return response.data;
    },
  });

  const { data: itemEvidence, refetch: refetchEvidence } = useQuery({
    queryKey: ['assessment-item-evidence', assessmentId, Array.from(expandedEvidence)],
    queryFn: async () => {
      const results: Record<number, EvidenceUpload[]> = {};
      for (const itemId of Array.from(expandedEvidence)) {
        try {
          const response = await apiClient.get(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence`);
          const evidenceData = response.data?.evidence || response.data || [];
          results[itemId] = Array.isArray(evidenceData) ? evidenceData.map((ev: any) => ({
            id: ev.id,
            assessment_item_id: itemId,
            evidence_id: ev.evidence_id,
            status: ev.approval_status || ev.status || 'draft',
            current_tier: ev.current_tier,
            workflow_id: ev.workflow_id,
            created_at: ev.created_at,
            evidence: ev.evidence_id ? {
              id: ev.evidence_id,
              name: ev.evidence_name,
              file_name: ev.evidence_file_name,
              file_type: ev.evidence_file_type,
              status: ev.evidence_status,
            } : null,
          })) : [];
        } catch {
          results[itemId] = [];
        }
      }
      return results;
    },
    enabled: expandedEvidence.size > 0,
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      const response = await apiClient.put(`/compliance/assessments/items/${itemId}`, null, {
        params: { compliance_status: status },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      setEditingItemId(null);
      setEditingStatus('');
    },
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: async ({ itemId, formData }: { itemId: number; formData: FormData }) => {
      const response = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/evidence/upload`,
        formData,
        { headers: { 'Content-Type': 'multipart/form-data' } }
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      refetchEvidence();
      setUploadingItemId(null);
      setEvidenceFile(null);
      setEvidenceName('');
      setEvidenceDescription('');
    },
  });

  const generateAIRecommendationMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const response = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/ai-recommendation`
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      setGeneratingAIForItem(null);
    },
    onError: (error: any) => {
      setGeneratingAIForItem(null);
      const message = error?.response?.data?.detail || 'Failed to generate AI recommendation. Please try again.';
      setAiError(message);
      setTimeout(() => setAiError(null), 5000);
    },
  });

  const approvalActionMutation = useMutation({
    mutationFn: async ({ evidenceLinkId, action, comments }: { evidenceLinkId: number; action: string; comments?: string }) => {
      const response = await apiClient.post(`/compliance/assessments/evidence/${evidenceLinkId}/approval`, {
        action,
        comments,
      });
      return response.data;
    },
    onSuccess: () => {
      refetchEvidence();
      setApprovalComments({});
    },
  });

  const handleExport = async () => {
    try {
      const response = await apiClient.get(`/compliance/assessments/${assessmentId}/export`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${assessment?.name || 'assessment'}_export.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export assessment:', err);
    }
  };

  const toggleDomain = (domain: string) => {
    const newExpanded = new Set(expandedDomains);
    if (newExpanded.has(domain)) {
      newExpanded.delete(domain);
    } else {
      newExpanded.add(domain);
    }
    setExpandedDomains(newExpanded);
  };

  const toggleEvidencePanel = (itemId: number) => {
    const newExpanded = new Set(expandedEvidence);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedEvidence(newExpanded);
  };

  const expandAll = () => {
    if (assessment?.items_by_domain) {
      setExpandedDomains(new Set(Object.keys(assessment.items_by_domain)));
    }
  };

  const collapseAll = () => {
    setExpandedDomains(new Set());
  };

  const startEditing = (item: AssessmentItem) => {
    setEditingItemId(item.id);
    setEditingStatus(item.compliance_status);
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setEditingStatus('');
  };

  const saveEditing = () => {
    if (editingItemId && editingStatus) {
      updateItemMutation.mutate({ itemId: editingItemId, status: editingStatus });
    }
  };

  const handleGenerateAIRecommendation = (itemId: number) => {
    setGeneratingAIForItem(itemId);
    generateAIRecommendationMutation.mutate(itemId);
  };

  const handleUploadEvidence = (itemId: number) => {
    if (!evidenceFile) return;
    const formData = new FormData();
    formData.append('file', evidenceFile);
    formData.append('name', evidenceName || evidenceFile.name);
    if (evidenceDescription) {
      formData.append('description', evidenceDescription);
    }
    uploadEvidenceMutation.mutate({ itemId, formData });
  };

  const handleApprovalAction = (evidenceLinkId: number, action: string) => {
    approvalActionMutation.mutate({
      evidenceLinkId,
      action,
      comments: approvalComments[evidenceLinkId],
    });
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 flex flex-col items-center justify-center">
        <div className="w-12 h-12 bg-rose-50 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="h-6 w-6 text-rose-600" />
        </div>
        <p className="text-black font-medium mb-2">Failed to load assessment details</p>
        <Link href="/compliance/assessments" className="text-blue-600 hover:text-blue-700 hover:underline font-medium">
          Back to Assessments
        </Link>
      </div>
    );
  }

  const statusStyle = ASSESSMENT_STATUS_STYLES[assessment.status] || ASSESSMENT_STATUS_STYLES.draft;
  const scoreColor = getScoreColor(assessment.overall_score);
  const domains = Object.keys(assessment.items_by_domain || {});

  return (
    <div className="space-y-6">
      {aiError && (
        <div className="fixed top-4 right-4 z-50 bg-rose-50 border border-rose-200 text-rose-900 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-md animate-in slide-in-from-top-2">
          <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-black">AI Recommendation Error</p>
            <p className="text-xs text-rose-700">{aiError}</p>
          </div>
          <button onClick={() => setAiError(null)} className="text-rose-600 hover:text-rose-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex items-start gap-4">
        <Link
          href="/compliance/assessments"
          className="mt-1 rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-black">{assessment.name}</h1>
              <p className="text-gray-600">
                {assessment.assessment_type.replace(/_/g, ' ')} • {assessment.file_name}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`px-3 py-1 text-sm font-medium rounded-lg ${statusStyle.bg} ${statusStyle.text}`}>
            {statusStyle.label}
          </span>
          <button onClick={handleExport} className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-emerald-50 p-3">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-emerald-600">{assessment.complied_count || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Complied</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-amber-50 p-3">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-amber-600">{assessment.partially_complied_count || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Partially Complied</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-rose-50 p-3">
              <XCircle className="h-5 w-5 text-rose-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-rose-600">{assessment.not_complied_count || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Not Complied</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-blue-50 p-3">
              <Clock className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-blue-600">{assessment.in_progress_count || 0}</p>
          <p className="text-sm text-gray-600 mt-1">In Progress</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-gray-50 p-3">
              <Minus className="h-5 w-5 text-gray-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-gray-600">{assessment.na_count || 0}</p>
          <p className="text-sm text-gray-600 mt-1">N/A</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
            <div className="mb-4">
              <div>
                <h2 className="text-lg font-semibold text-black">Overall Compliance Score</h2>
                <p className="text-sm text-gray-600">Based on {assessment.total_items || 0} items</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getScoreBarColor(assessment.overall_score)} transition-all`}
                      style={{ width: `${assessment.overall_score || 0}%` }}
                    />
                  </div>
                </div>
                <span className={`text-2xl font-bold ${scoreColor.text}`}>
                  {assessment.overall_score !== null
                    ? `${Math.round(assessment.overall_score)}%`
                    : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-black">Assessment Details</h2>
          </div>
          <div className="space-y-3">
            {assessment.source && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Source</span>
                <span className="text-black">{assessment.source}</span>
              </div>
            )}
            {assessment.assessor && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Assessor</span>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="text-black">{assessment.assessor}</span>
                </div>
              </div>
            )}
            {assessment.due_date && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Due Date</span>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-gray-400" />
                  <span className="text-black">{formatDate(assessment.due_date)}</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Created</span>
              <span className="text-black">{formatDate(assessment.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-black">Assessment Items</h2>
            <p className="text-sm text-gray-600">
              {domains.length} domain{domains.length !== 1 ? 's' : ''} • {assessment.total_items} items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Expand All
            </button>
            <button onClick={collapseAll} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Collapse All
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {domains.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No assessment items found</p>
            </div>
          ) : (
            domains.map((domain) => {
              const items = assessment.items_by_domain[domain] || [];
              const isExpanded = expandedDomains.has(domain);
              const domainComplied = items.filter((i) => i.compliance_status === 'complied').length;
              const domainPercentage = items.length > 0 ? Math.round((domainComplied / items.length) * 100) : 0;

              return (
                <div
                  key={domain}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => toggleDomain(domain)}
                    className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-gray-600" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-gray-600" />
                      )}
                      <span className="font-medium text-black">{domain}</span>
                      <span className="text-sm text-gray-500">({items.length} items)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getScoreBarColor(domainPercentage)} transition-all`}
                            style={{ width: `${domainPercentage}%` }}
                          />
                        </div>
                        <span className="text-sm text-gray-600">{domainPercentage}%</span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="divide-y divide-gray-200">
                      {items.map((item) => {
                        const itemStatusStyle =
                          COMPLIANCE_STATUS_STYLES[item.compliance_status] ||
                          COMPLIANCE_STATUS_STYLES.in_progress;
                        const StatusIcon = itemStatusStyle.icon;
                        const isEditing = editingItemId === item.id;
                        const isEvidenceExpanded = expandedEvidence.has(item.id);
                        const currentItemEvidence = itemEvidence?.[item.id] || [];
                        const aiRecommendation = parseAIRecommendation(item.ai_evidence_recommendation);

                        return (
                          <div key={item.id} className="bg-white">
                            <div className="p-4">
                              <div className="flex items-start gap-4">
                                <span className="text-sm font-mono text-gray-500 mt-1">
                                  {item.item_number}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-black mb-2">{item.control_description}</p>

                                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                                    {item.gaps_identified && (
                                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                        <p className="text-xs text-gray-600 mb-1">Gaps Identified</p>
                                        <p className="text-sm text-gray-700">{item.gaps_identified}</p>
                                      </div>
                                    )}
                                    {item.proposed_solution && (
                                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                        <p className="text-xs text-gray-600 mb-1">Proposed Solution</p>
                                        <p className="text-sm text-gray-700">{item.proposed_solution}</p>
                                      </div>
                                    )}
                                    {item.responsible_party && (
                                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                        <p className="text-xs text-gray-600 mb-1">Responsible Party</p>
                                        <p className="text-sm text-gray-700">{item.responsible_party}</p>
                                      </div>
                                    )}
                                    {item.timeline && (
                                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                        <p className="text-xs text-gray-600 mb-1">Timeline</p>
                                        <p className="text-sm text-gray-700">{item.timeline}</p>
                                      </div>
                                    )}
                                    {item.priority && (
                                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                        <p className="text-xs text-gray-600 mb-1">Priority</p>
                                        <p className="text-sm text-gray-700 capitalize">{item.priority}</p>
                                      </div>
                                    )}
                                    {item.remarks && (
                                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                        <p className="text-xs text-gray-600 mb-1">Remarks</p>
                                        <p className="text-sm text-gray-700">{item.remarks}</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="flex items-center gap-2">
                                  {isEditing ? (
                                    <>
                                      <select
                                        value={editingStatus}
                                        onChange={(e) => setEditingStatus(e.target.value)}
                                        className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      >
                                        {STATUS_OPTIONS.map((opt) => (
                                          <option key={opt.value} value={opt.value}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={saveEditing}
                                        disabled={updateItemMutation.isPending}
                                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                                      >
                                        {updateItemMutation.isPending ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Save className="h-4 w-4" />
                                        )}
                                      </button>
                                      <button onClick={cancelEditing} className="p-2 text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
                                        <X className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <span
                                        className={`px-2 py-1 text-xs font-medium rounded ${itemStatusStyle.bg} ${itemStatusStyle.text} flex items-center gap-1`}
                                      >
                                        <StatusIcon className="h-3 w-3" />
                                        {itemStatusStyle.label}
                                      </span>
                                      <button
                                        onClick={() => startEditing(item)}
                                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title="Edit Status"
                                      >
                                        <Edit2 className="h-4 w-4" />
                                      </button>
                                      <button
                                        onClick={() => toggleEvidencePanel(item.id)}
                                        className={`p-2 rounded-lg transition-colors relative ${isEvidenceExpanded ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'}`}
                                        title="Evidence"
                                      >
                                        <Paperclip className="h-4 w-4" />
                                        {currentItemEvidence.length > 0 && (
                                          <span className="absolute -top-1 -right-1 h-4 w-4 text-xs bg-blue-600 text-white rounded-full flex items-center justify-center">
                                            {currentItemEvidence.length}
                                          </span>
                                        )}
                                      </button>
                                      <button
                                        onClick={() => handleGenerateAIRecommendation(item.id)}
                                        disabled={generatingAIForItem === item.id}
                                        className={`p-2 rounded-lg transition-colors ${aiRecommendation ? 'text-purple-600 bg-purple-50' : 'text-gray-600 hover:text-purple-600 hover:bg-purple-50'} disabled:opacity-50`}
                                        title="AI Suggest Evidence"
                                      >
                                        {generatingAIForItem === item.id ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Sparkles className="h-4 w-4" />
                                        )}
                                      </button>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {isEvidenceExpanded && (
                              <div className="mx-4 mb-4 bg-white border border-gray-200 rounded-lg p-4 space-y-4">
                                {aiRecommendation && (
                                  <div className="space-y-3">
                                    <div className="flex items-center gap-2">
                                      <Sparkles className="h-4 w-4 text-purple-600" />
                                      <h4 className="text-sm font-medium text-purple-600">AI Evidence Recommendations</h4>
                                      {item.ai_recommendation_generated_at && (
                                        <span className="text-xs text-gray-500">
                                          Generated {formatDateTime(item.ai_recommendation_generated_at)}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm text-gray-700">{aiRecommendation.summary}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                      {aiRecommendation.recommendations.map((rec, idx) => (
                                        <div key={idx} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                                          <div className="flex items-center justify-between mb-2">
                                            <span className="text-sm font-medium text-black">{rec.evidence_type}</span>
                                            <span className={`text-xs px-2 py-0.5 rounded ${
                                              rec.priority === 'high' ? 'bg-rose-50 text-rose-700' :
                                              rec.priority === 'medium' ? 'bg-amber-50 text-amber-700' :
                                              'bg-gray-100 text-gray-700'
                                            }`}>
                                              {rec.priority}
                                            </span>
                                          </div>
                                          <p className="text-xs text-gray-600 mb-2">{rec.description}</p>
                                          {rec.example_files.length > 0 && (
                                            <div className="text-xs text-gray-500">
                                              Examples: {rec.example_files.join(', ')}
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {!aiRecommendation && (
                                  <div className="flex items-center gap-3 py-2">
                                    <button
                                      onClick={() => handleGenerateAIRecommendation(item.id)}
                                      disabled={generatingAIForItem === item.id}
                                      className="btn-secondary btn-sm flex items-center gap-2">
                                      {generatingAIForItem === item.id ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Sparkles className="h-4 w-4" />
                                      )}
                                      Generate AI Suggestions
                                    </button>
                                    <span className="text-xs text-gray-500">
                                      Get AI-powered recommendations for evidence to upload
                                    </span>
                                  </div>
                                )}

                                {currentItemEvidence.length > 0 && (
                                  <div className="space-y-3">
                                    <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                      <Paperclip className="h-4 w-4" />
                                      Uploaded Evidence ({currentItemEvidence.length})
                                    </h4>
                                    <div className="space-y-2">
                                      {currentItemEvidence.map((ev) => {
                                        const evStatusStyle = EVIDENCE_STATUS_STYLES[ev.status] || EVIDENCE_STATUS_STYLES.draft;
                                        return (
                                          <div key={ev.id} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                                            <div className="flex items-start justify-between">
                                              <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                  <FileText className="h-4 w-4 text-gray-600" />
                                                  <span className="text-sm font-medium text-black">
                                                    {ev.evidence?.name || 'Evidence'}
                                                  </span>
                                                  <span className={`badge ${evStatusStyle.bg} ${evStatusStyle.text} text-xs`}>
                                                    {evStatusStyle.label}
                                                  </span>
                                                </div>
                                                {ev.evidence && (
                                                  <p className="text-xs text-gray-500 mt-1">
                                                    {ev.evidence.file_name} • {ev.evidence.file_type}
                                                  </p>
                                                )}
                                                <p className="text-xs text-gray-500">
                                                  Uploaded {formatDateTime(ev.created_at)}
                                                </p>
                                              </div>
                                              {ev.status === 'draft' && (
                                                <button
                                                  onClick={() => approvalActionMutation.mutate({
                                                    evidenceLinkId: ev.id,
                                                    action: 'submit',
                                                    comments: ''
                                                  })}
                                                  disabled={approvalActionMutation.isPending}
                                                  className="btn-primary flex items-center gap-2 text-sm ml-4"
                                                >
                                                  {approvalActionMutation.isPending ? (
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                  ) : (
                                                    <Send className="h-4 w-4" />
                                                  )}
                                                  Submit for Review
                                                </button>
                                              )}
                                              {(ev.status === 'pending_review' || ev.status === 'in_approval') && (
                                                <div className="flex items-center gap-2 ml-4">
                                                  <input
                                                    type="text"
                                                    placeholder="Comments (optional)"
                                                    value={approvalComments[ev.id] || ''}
                                                    onChange={(e) => setApprovalComments({ ...approvalComments, [ev.id]: e.target.value })}
                                                    className="input text-xs py-1 px-2 w-32"
                                                  />
                                                  <button
                                                    onClick={() => handleApprovalAction(ev.id, 'approve')}
                                                    disabled={approvalActionMutation.isPending}
                                                    className="btn-ghost btn-sm text-emerald-400 hover:bg-emerald-500/20"
                                                    title="Approve"
                                                  >
                                                    <ThumbsUp className="h-4 w-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => handleApprovalAction(ev.id, 'reject')}
                                                    disabled={approvalActionMutation.isPending}
                                                    className="btn-ghost btn-sm text-rose-400 hover:bg-rose-500/20"
                                                    title="Reject"
                                                  >
                                                    <ThumbsDown className="h-4 w-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => handleApprovalAction(ev.id, 'return')}
                                                    disabled={approvalActionMutation.isPending}
                                                    className="btn-ghost btn-sm text-orange-400 hover:bg-orange-500/20"
                                                    title="Return for revision"
                                                  >
                                                    <RotateCcw className="h-4 w-4" />
                                                  </button>
                                                </div>
                                              )}
                                            </div>
                                            {ev.approval_history && ev.approval_history.length > 0 && (
                                              <div className="mt-2 pt-2 border-t border-gray-200">
                                                <p className="text-xs text-gray-600 mb-1">Approval History</p>
                                                <div className="space-y-1">
                                                  {ev.approval_history.map((history) => (
                                                    <div key={history.id} className="text-xs text-gray-600">
                                                      <span className={`font-medium ${
                                                        history.action === 'approved' ? 'text-emerald-700' :
                                                        history.action === 'rejected' ? 'text-rose-700' :
                                                        'text-orange-700'
                                                      }`}>
                                                        {history.action}
                                                      </span>
                                                      {' by '}
                                                      {history.performer?.full_name || 'Unknown'}
                                                      {' at Tier '}
                                                      {history.tier_number}
                                                      {history.comments && (
                                                        <span className="text-gray-500"> - {history.comments}</span>
                                                      )}
                                                    </div>
                                                  ))}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                <div className="space-y-3 pt-2 border-t border-gray-200">
                                  <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <FileUp className="h-4 w-4" />
                                    Upload New Evidence
                                  </h4>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">File</label>
                                      <input
                                        type="file"
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"
                                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                                        className="input text-sm py-1"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Evidence Name</label>
                                      <input
                                        type="text"
                                        value={evidenceName}
                                        onChange={(e) => setEvidenceName(e.target.value)}
                                        placeholder="e.g., Security Policy v2"
                                        className="input text-sm"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Description (optional)</label>
                                      <input
                                        type="text"
                                        value={evidenceDescription}
                                        onChange={(e) => setEvidenceDescription(e.target.value)}
                                        placeholder="Brief description"
                                        className="input text-sm"
                                      />
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleUploadEvidence(item.id)}
                                    disabled={!evidenceFile || uploadEvidenceMutation.isPending}
                                    className="btn-primary btn-sm flex items-center gap-2"
                                  >
                                    {uploadEvidenceMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Send className="h-4 w-4" />
                                    )}
                                    Upload Evidence
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
