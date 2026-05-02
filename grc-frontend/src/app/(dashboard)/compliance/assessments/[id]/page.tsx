'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient, { tenantApi } from '@/lib/api';
import XlsxMaturityViewer from './XlsxMaturityViewer';
import { usePermissions } from '@/hooks/usePermissions';
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
  id: number | string;
  assessment_item_id?: number;
  evidence_id: number | null;
  status: string;
  current_tier: number;
  ai_recommendation: string | null;
  submitted_at: string | null;
  created_at: string;
  source?: string;  // 'assessment_upload' | 'framework_link'
  framework_name?: string;
  control_code?: string;
  confidence_score?: number;
  matching_rationale?: string;
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

interface EvidenceLibraryOption {
  id: number;
  name: string;
  file_name: string | null;
  file_type: string | null;
  status: string;
  uploaded_at: string | null;
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
  assessment_format?: string;
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

interface TenantUserOption {
  id: number;
  label: string;
  email: string | null;
}

const STATUS_OPTIONS = [
  { value: 'complied', label: 'Complied' },
  { value: 'partially_complied', label: 'Partially Compliant' },
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
  framework_linked: { bg: 'bg-purple-50', text: 'text-purple-700', label: 'Framework Linked' },
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

function getDomainDisplayName(domain: string): string {
  const normalized = domain.trim().toLowerCase();
  if (!normalized || normalized === 'uncategorized') {
    return 'Requirements';
  }
  return domain;
}

const STATUS_ORDER = ['complied', 'partially_complied', 'not_complied', 'in_progress', 'na'] as const;

const STATUS_COLORS: Record<(typeof STATUS_ORDER)[number], string> = {
  complied: '#22c55e',
  partially_complied: '#f59e0b',
  not_complied: '#ef4444',
  in_progress: '#60a5fa',
  na: '#64748b',
};

const DRAFT_REMAINDER_COLOR = '#d1d5db';

function normalizeComplianceStatus(value: string | null | undefined): (typeof STATUS_ORDER)[number] {
  const status = (value || '').trim().toLowerCase();
  if (status === 'complied') return 'complied';
  if (status === 'partially_complied' || status === 'partially compliant') return 'partially_complied';
  if (status === 'not_complied' || status === 'not complied') return 'not_complied';
  if (status === 'na' || status === 'n/a') return 'na';
  return 'in_progress';
}

function deriveCategoryFromDomain(domain: string): string {
  const cleaned = (domain || '').trim();
  if (!cleaned) return 'Uncategorized';
  return cleaned.split(/[-/:|]/)[0].trim() || 'Uncategorized';
}

function getAuditMasterDomainGroup(domain: string): string {
  const value = (domain || '').trim();
  if (!value) return 'Uncategorized';
  const separatorIndex = value.indexOf(' - ');
  if (separatorIndex <= 0) return value;
  const prefix = value.slice(0, separatorIndex).trim();
  return prefix || value;
}

export default function AssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assessmentId = Number(params.id);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('compliance:assessments:edit');

  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [expandedAuditItems, setExpandedAuditItems] = useState<Set<number>>(new Set());
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingStatus, setEditingStatus] = useState<string>('');
  const [editingResponsibleParty, setEditingResponsibleParty] = useState<string>('');
  const [editingTimeline, setEditingTimeline] = useState<string>('');
  const [editingTimelineRaw, setEditingTimelineRaw] = useState<string>('');
  const [editingTimelineTouched, setEditingTimelineTouched] = useState<boolean>(false);
  const [editingRemarks, setEditingRemarks] = useState<string>('');
  const [editingGapsIdentified, setEditingGapsIdentified] = useState<string>('');
  const [editingProposedSolution, setEditingProposedSolution] = useState<string>('');
  const [editingAreaDomain, setEditingAreaDomain] = useState<string>('');
  const [editingPriority, setEditingPriority] = useState<string>('');
  const [expandedEvidence, setExpandedEvidence] = useState<Set<number>>(new Set());
  const [uploadingItemId, setUploadingItemId] = useState<number | null>(null);
  const [generatingAIForItem, setGeneratingAIForItem] = useState<number | null>(null);
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceName, setEvidenceName] = useState('');
  const [evidenceDescription, setEvidenceDescription] = useState('');
  const [existingEvidenceSearch, setExistingEvidenceSearch] = useState<Record<number, string>>({});
  const [selectedExistingEvidence, setSelectedExistingEvidence] = useState<Record<number, number | null>>({});
  const [linkingExistingEvidenceItemId, setLinkingExistingEvidenceItemId] = useState<number | null>(null);
  const [approvalComments, setApprovalComments] = useState<Record<number, string>>({});
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: assessment, isLoading, error } = useQuery<Assessment>({
    queryKey: ['compliance-assessment-detail', assessmentId],
    queryFn: async () => {
      const response = await apiClient.get(`/compliance/assessments/${assessmentId}`);
      return response.data;
    },
  });

  const isAuditMasterAssessment = assessment?.assessment_format === 'ubl_audit_master_tracking';

  const { data: tenantUsers = [] } = useQuery<TenantUserOption[]>({
    queryKey: ['compliance-assessment-tenant-users', assessment?.tenant_id],
    queryFn: async () => {
      const response = await tenantApi.getTenantUsers(assessment!.tenant_id);
      const rows = Array.isArray(response.data) ? response.data : [];
      return rows
        .map((entry: any) => {
          const user = entry?.user || {};
          const userId = Number(entry?.user_id ?? user?.id);
          if (!Number.isFinite(userId) || userId <= 0) return null;
          const label = String(
            user?.display_name ||
            user?.username ||
            user?.email ||
            `User ${userId}`
          ).trim();
          if (!label) return null;
          return {
            id: userId,
            label,
            email: user?.email ? String(user.email) : null,
          } as TenantUserOption;
        })
        .filter((entry: TenantUserOption | null): entry is TenantUserOption => !!entry);
    },
    // Used by every assessment type now (NCA, Cloud Cybersecurity, NIST,
    // OWASP, audit master) for the Responsible Party dropdown.
    enabled: Boolean(assessment?.tenant_id),
    staleTime: 60 * 1000,
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
            ai_recommendation: ev.ai_recommendation || null,
            submitted_at: ev.submitted_at || null,
            workflow_id: ev.workflow_id,
            created_at: ev.created_at,
            source: ev.source || 'assessment_upload',
            framework_name: ev.framework_name || null,
            control_code: ev.control_code || null,
            confidence_score: ev.confidence_score ?? null,
            matching_rationale: ev.matching_rationale || null,
            evidence: ev.evidence_id ? {
              id: ev.evidence_id,
              name: ev.evidence_name,
              file_name: ev.evidence_file_name,
              file_type: ev.evidence_file_type,
              status: ev.evidence_status,
              uploaded_at: ev.evidence_uploaded_at || ev.created_at || '',
            } : undefined,
          })) : [];
        } catch {
          results[itemId] = [];
        }
      }
      return results;
    },
    enabled: expandedEvidence.size > 0,
  });

  const { data: evidenceLibraryOptions = [], isLoading: isEvidenceLibraryLoading } = useQuery<EvidenceLibraryOption[]>({
    queryKey: ['assessment-evidence-library-options', assessmentId],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items', {
        params: { skip: 0, limit: 2000 },
      });
      const rows = Array.isArray(response.data?.items) ? response.data.items : [];
      return rows
        .map((row: any) => ({
          id: Number(row?.id),
          name: String(row?.name || '').trim(),
          file_name: row?.file_name ?? null,
          file_type: row?.file_type ?? null,
          status: String(row?.status || 'draft'),
          uploaded_at: row?.uploaded_at ?? null,
        }))
        .filter((row: EvidenceLibraryOption) => Number.isFinite(row.id) && row.id > 0 && !!row.name);
    },
    enabled: expandedEvidence.size > 0,
    staleTime: 60 * 1000,
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({
      itemId,
      complianceStatus,
      responsibleParty,
      timeline,
      remarks,
      gapsIdentified,
      proposedSolution,
      areaDomain,
      priority,
    }: {
      itemId: number;
      complianceStatus?: string;
      responsibleParty?: string;
      timeline?: string;
      remarks?: string;
      gapsIdentified?: string;
      proposedSolution?: string;
      areaDomain?: string;
      priority?: string;
    }) => {
      const params: Record<string, string> = {};
      if (complianceStatus !== undefined) params.compliance_status = complianceStatus;
      if (responsibleParty !== undefined) params.responsible_party = responsibleParty;
      if (timeline !== undefined) params.timeline = timeline;
      if (remarks !== undefined) params.remarks = remarks;
      if (gapsIdentified !== undefined) params.gaps_identified = gapsIdentified;
      if (proposedSolution !== undefined) params.proposed_solution = proposedSolution;
      if (areaDomain !== undefined) params.area_domain = areaDomain;
      if (priority !== undefined) params.priority = priority;
      const response = await apiClient.put(`/compliance/assessments/items/${itemId}`, null, {
        params,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      setEditingItemId(null);
      setEditingStatus('');
      setEditingResponsibleParty('');
      setEditingTimeline('');
      setEditingTimelineRaw('');
      setEditingTimelineTouched(false);
      setEditingRemarks('');
      setEditingGapsIdentified('');
      setEditingProposedSolution('');
      setEditingAreaDomain('');
      setEditingPriority('');
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

  const linkExistingEvidenceMutation = useMutation({
    mutationFn: async ({ itemId, evidenceId }: { itemId: number; evidenceId: number }) => {
      const response = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/evidence/link`,
        { evidence_id: evidenceId }
      );
      return response.data;
    },
    onMutate: ({ itemId }) => {
      setLinkingExistingEvidenceItemId(itemId);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      refetchEvidence();
      setSelectedExistingEvidence((prev) => ({ ...prev, [variables.itemId]: null }));
      setExistingEvidenceSearch((prev) => ({ ...prev, [variables.itemId]: '' }));
    },
    onSettled: () => {
      setLinkingExistingEvidenceItemId(null);
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

  const toggleAuditItem = (itemId: number) => {
    setExpandedAuditItems((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleEvidencePanel = (itemId: number) => {
    const newExpanded = new Set(expandedEvidence);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedEvidence(newExpanded);
    if (isAuditMasterAssessment) {
      setExpandedAuditItems((prev) => {
        const next = new Set(prev);
        next.add(itemId);
        return next;
      });
    }
  };

  const expandAll = () => {
    if (!assessment?.items_by_domain) return;
    const rawDomains = Object.keys(assessment.items_by_domain);
    if (!isAuditMasterAssessment) {
      setExpandedDomains(new Set(rawDomains));
      return;
    }
    const groupedDomains = Array.from(new Set(rawDomains.map((domain) => getAuditMasterDomainGroup(domain))));
    setExpandedDomains(new Set(groupedDomains));
  };

  const collapseAll = () => {
    setExpandedDomains(new Set());
  };

  const startEditing = (item: AssessmentItem) => {
    setEditingItemId(item.id);
    setEditingStatus(item.compliance_status);
    setEditingResponsibleParty(item.responsible_party || '');
    const timelineInputValue = toDateInputValue(item.timeline);
    setEditingTimeline(timelineInputValue);
    setEditingTimelineRaw(item.timeline || '');
    setEditingTimelineTouched(false);
    setEditingRemarks(item.remarks || '');
    setEditingGapsIdentified(item.gaps_identified || '');
    setEditingProposedSolution(item.proposed_solution || '');
    setEditingAreaDomain(item.area_domain || '');
    setEditingPriority(item.priority || '');
    if (isAuditMasterAssessment) {
      setExpandedAuditItems((prev) => {
        const next = new Set(prev);
        next.add(item.id);
        return next;
      });
    }
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setEditingStatus('');
    setEditingResponsibleParty('');
    setEditingTimeline('');
    setEditingTimelineRaw('');
    setEditingTimelineTouched(false);
    setEditingRemarks('');
    setEditingGapsIdentified('');
    setEditingProposedSolution('');
    setEditingAreaDomain('');
    setEditingPriority('');
  };

  const saveEditing = () => {
    if (editingItemId && editingStatus) {
      // Same payload for every assessment type — the user wants the full
      // editable surface (responsible party, timeline, remarks, gaps,
      // proposed solution) to save on OWASP / NCA / NIST too, not just on
      // the audit-master flow.
      const timelineForSave = editingTimelineTouched ? editingTimeline : editingTimelineRaw;
      updateItemMutation.mutate({
        itemId: editingItemId,
        complianceStatus: editingStatus,
        responsibleParty: editingResponsibleParty,
        timeline: timelineForSave,
        remarks: editingRemarks,
        gapsIdentified: editingGapsIdentified,
        proposedSolution: editingProposedSolution,
        areaDomain: editingAreaDomain,
        priority: editingPriority,
      });
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

  const handleLinkExistingEvidence = (itemId: number) => {
    const evidenceId = selectedExistingEvidence[itemId];
    if (!evidenceId) return;
    linkExistingEvidenceMutation.mutate({ itemId, evidenceId });
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

  const toDateInputValue = (value: string | null): string => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const formatTimelineDisplay = (timeline: string | null): string => {
    if (!timeline) return '-';
    const parsed = new Date(timeline);
    if (Number.isNaN(parsed.getTime())) return timeline;
    return parsed.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
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
  const rawDomains = Object.keys(assessment.items_by_domain || {});
  const domainEntries = (() => {
    if (!isAuditMasterAssessment) {
      return rawDomains.map((domain) => ({
        key: domain,
        name: getDomainDisplayName(domain),
        items: assessment.items_by_domain[domain] || [],
      }));
    }

    const grouped: Record<string, AssessmentItem[]> = {};
    for (const domain of rawDomains) {
      const groupKey = getAuditMasterDomainGroup(domain);
      if (!grouped[groupKey]) grouped[groupKey] = [];
      grouped[groupKey].push(...(assessment.items_by_domain[domain] || []));
    }

    return Object.entries(grouped).map(([groupKey, items]) => ({
      key: groupKey,
      name: getDomainDisplayName(groupKey),
      items,
    }));
  })();
  const domains = domainEntries.map((entry) => entry.key);
  const allItems = assessment.items || [];
  const fallbackStatusCounts = allItems.reduce(
    (acc, item) => {
      const normalized = normalizeComplianceStatus(item.compliance_status);
      acc[normalized] += 1;
      return acc;
    },
    {
      complied: 0,
      partially_complied: 0,
      not_complied: 0,
      in_progress: 0,
      na: 0,
    } as Record<(typeof STATUS_ORDER)[number], number>,
  );
  const statusCounts: Record<(typeof STATUS_ORDER)[number], number> = {
    complied: assessment.complied_count ?? fallbackStatusCounts.complied,
    partially_complied: assessment.partially_complied_count ?? fallbackStatusCounts.partially_complied,
    not_complied: assessment.not_complied_count ?? fallbackStatusCounts.not_complied,
    in_progress: assessment.in_progress_count ?? fallbackStatusCounts.in_progress,
    na: assessment.na_count ?? fallbackStatusCounts.na,
  };
  const totalItems = Math.max(assessment.total_items ?? allItems.length, 0);
  const accountedItems = STATUS_ORDER.reduce((sum, key) => sum + (statusCounts[key] || 0), 0);
  const normalizedTotal = Math.max(totalItems, accountedItems);
  const remainingDraftCount = Math.max(normalizedTotal - accountedItems, 0);
  const statusSegments = STATUS_ORDER.map((key) => ({
    key,
    label: COMPLIANCE_STATUS_STYLES[key]?.label || key,
    count: statusCounts[key] || 0,
    color: STATUS_COLORS[key],
    percent: normalizedTotal > 0 ? ((statusCounts[key] || 0) / normalizedTotal) * 100 : 0,
  })).filter((segment) => segment.count > 0 && segment.percent > 0);
  const ringMetrics = [
    { key: 'complied', label: 'Complied', icon: CheckCircle },
    { key: 'partially_complied', label: 'Partial', icon: AlertTriangle },
    { key: 'not_complied', label: 'Not Complied', icon: XCircle },
    { key: 'in_progress', label: 'In Progress', icon: Clock },
  ].map((metric) => {
    const key = metric.key as (typeof STATUS_ORDER)[number];
    const count = statusCounts[key] || 0;
    const percent = normalizedTotal > 0 ? (count / normalizedTotal) * 100 : 0;
    return {
      ...metric,
      count,
      percent,
      color: STATUS_COLORS[key],
    };
  });
  const domainCoverageRows = domainEntries
    .map((entry) => {
      const items = entry.items;
      const counts = items.reduce(
        (acc, item) => {
          const normalized = normalizeComplianceStatus(item.compliance_status);
          acc[normalized] += 1;
          return acc;
        },
        {
          complied: 0,
          partially_complied: 0,
          not_complied: 0,
          in_progress: 0,
          na: 0,
        } as Record<(typeof STATUS_ORDER)[number], number>,
      );
      const total = items.length;
      const segments = STATUS_ORDER.map((key) => ({
        key,
        count: counts[key],
        color: STATUS_COLORS[key],
        percent: total > 0 ? (counts[key] / total) * 100 : 0,
      })).filter((segment) => segment.count > 0 && segment.percent > 0);
      const completedPercent = total > 0 ? Math.round((counts.complied / total) * 100) : 0;
      const totalSegmentPercent = segments.reduce((sum, segment) => sum + segment.percent, 0);
      const remainderPercent = Math.max(100 - totalSegmentPercent, 0);

      return {
        name: entry.name,
        total,
        completedPercent,
        segments,
        remainderPercent,
      };
    })
    .sort((a, b) => b.total - a.total);
  const categoryCoverageRows = Object.entries(
    allItems.reduce((acc, item) => {
      const category = deriveCategoryFromDomain(item.area_domain || 'Uncategorized');
      const normalized = normalizeComplianceStatus(item.compliance_status);
      if (!acc[category]) {
        acc[category] = {
          total: 0,
          complied: 0,
          partially_complied: 0,
          not_complied: 0,
          in_progress: 0,
          na: 0,
        };
      }
      acc[category].total += 1;
      acc[category][normalized] += 1;
      return acc;
    }, {} as Record<string, { total: number } & Record<(typeof STATUS_ORDER)[number], number>>),
  )
    .map(([name, values]) => ({
      name,
      total: values.total,
      completion: values.total > 0 ? Math.round((values.complied / values.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  const responsiblePartyOptions = (() => {
    const names = new Set<string>();
    for (const user of tenantUsers) {
      const trimmed = user.label.trim();
      if (trimmed) names.add(trimmed);
    }
    if (editingResponsibleParty.trim()) {
      names.add(editingResponsibleParty.trim());
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  })();

  return (
    <div className="space-y-4">
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
      <div className="flex items-start gap-3 flex-wrap">
        <Link
          href="/compliance/assessments"
          className="mt-0.5 rounded-lg p-1.5 text-gray-600 hover:bg-gray-100 hover:text-black transition-colors flex-shrink-0"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600 flex-shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight truncate">{assessment.name}</h1>
              <p className="mt-0.5 text-sm text-slate-600 truncate">
                {assessment.assessment_type.replace(/_/g, ' ')} • {assessment.file_name}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <span className={`px-2.5 py-1 text-xs font-medium rounded-lg ${statusStyle.bg} ${statusStyle.text}`}>
            {statusStyle.label}
          </span>
          <button onClick={handleExport} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors flex items-center gap-2">
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export Excel</span>
            <span className="sm:hidden">Export</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <div className="mb-2">
              <h2 className="text-sm font-semibold text-black">Overall Compliance Score</h2>
              <p className="text-xs text-gray-500">Based on {normalizedTotal} items</p>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden flex">
                    {statusSegments.map((segment) => (
                      <div
                        key={segment.key}
                        className="h-full transition-all"
                        style={{
                          width: `${segment.percent}%`,
                          backgroundColor: segment.color,
                        }}
                      />
                    ))}
                    {remainingDraftCount > 0 && (
                      <div
                        className="h-full"
                        style={{
                          width: `${normalizedTotal > 0 ? (remainingDraftCount / normalizedTotal) * 100 : 0}%`,
                          backgroundColor: DRAFT_REMAINDER_COLOR,
                        }}
                      />
                    )}
                  </div>
                </div>
                <span className={`text-lg font-semibold ${scoreColor.text}`}>
                  {assessment.overall_score !== null ? `${Math.round(assessment.overall_score)}%` : '-'}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                {statusSegments.map((segment) => (
                  <span key={segment.key} className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: segment.color }} />
                    {segment.label}: {segment.count}
                  </span>
                ))}
                {remainingDraftCount > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: DRAFT_REMAINDER_COLOR }} />
                    Draft: {remainingDraftCount}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-black">Assessment Details</h2>
          </div>
          <div className="space-y-2.5 text-sm">
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
                  <User className="h-3.5 w-3.5 text-gray-400" />
                  <span className="text-black">{assessment.assessor}</span>
                </div>
              </div>
            )}
            {assessment.due_date && (
              <div className="flex items-center justify-between">
                <span className="text-gray-600">Due Date</span>
                <div className="flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-gray-400" />
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

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm xl:col-span-4">
          <h3 className="text-sm font-semibold text-black mb-3">Status Coverage</h3>
          <div className="grid grid-cols-2 gap-3">
            {ringMetrics.map((metric) => {
              const Icon = metric.icon;
              return (
                <div key={metric.key} className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                  <div className="mx-auto relative h-16 w-16">
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background: `conic-gradient(${metric.color} ${Math.max(metric.percent * 3.6, 2)}deg, #e5e7eb ${Math.max(metric.percent * 3.6, 2)}deg 360deg)`,
                      }}
                    />
                    <div className="absolute inset-[6px] rounded-full bg-white flex items-center justify-center">
                      <Icon className="h-4 w-4" style={{ color: metric.color }} />
                    </div>
                  </div>
                  <p className="mt-2 text-base font-semibold text-center text-black">{metric.percent.toFixed(1)}%</p>
                  <p className="text-[11px] text-center text-gray-600">{metric.label}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm xl:col-span-8">
          <h3 className="text-sm font-semibold text-black mb-3">Domain Coverage</h3>
          <div className="space-y-2.5">
            {domainCoverageRows.length === 0 ? (
              <p className="text-sm text-gray-500">No domain data available.</p>
            ) : (
              domainCoverageRows.slice(0, 8).map((row, idx) => (
                <div key={`${row.name}-${idx}`} className="grid grid-cols-12 items-center gap-2">
                  <div className="col-span-5 truncate text-sm text-gray-800">{row.name}</div>
                  <div className="col-span-1 text-xs text-gray-500 text-right">{row.total}</div>
                  <div className="col-span-5 h-2 rounded-full bg-gray-200 overflow-hidden flex">
                    {row.segments.map((segment) => (
                      <div
                        key={`${row.name}-${String(segment.key)}`}
                        className="h-full"
                        style={{ width: `${segment.percent}%`, backgroundColor: segment.color }}
                      />
                    ))}
                    {row.remainderPercent > 0 && (
                      <div
                        className="h-full"
                        style={{ width: `${row.remainderPercent}%`, backgroundColor: DRAFT_REMAINDER_COLOR }}
                      />
                    )}
                  </div>
                  <div className="col-span-1 text-xs font-medium text-gray-700 text-right">{row.completedPercent}%</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-black mb-3">Category Coverage</h3>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {categoryCoverageRows.length === 0 ? (
            <p className="text-sm text-gray-500">No category data available.</p>
          ) : (
            categoryCoverageRows.map((row) => (
              <div key={row.name} className="rounded-lg border border-gray-200 bg-gray-50 p-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm text-gray-800 truncate pr-2">{row.name}</span>
                  <span className="text-xs text-gray-600">{row.total}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
                  <div className="h-full bg-emerald-500" style={{ width: `${row.completion}%` }} />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {assessment.assessment_format === 'xlsx_maturity' && (
        <XlsxMaturityViewer assessmentId={assessmentId} assessmentItems={assessment.items || []} />
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-black">Assessment Items</h2>
            <p className="text-xs text-gray-500">
              {domains.length} domain{domains.length !== 1 ? 's' : ''} • {normalizedTotal} items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="px-2.5 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Expand All
            </button>
            <button onClick={collapseAll} className="px-2.5 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors">
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
            domainEntries.map((domainEntry) => {
              const domain = domainEntry.key;
              const items = domainEntry.items;
              const isExpanded = expandedDomains.has(domain);
              const domainComplied = items.filter((i) => i.compliance_status === 'complied').length;
              const domainPercentage = items.length > 0 ? Math.round((domainComplied / items.length) * 100) : 0;

              return (
                <div
                  key={domain}
                  className="border border-gray-200 rounded-lg overflow-hidden"
                >
                  <div className="w-full flex items-center justify-between p-3 bg-gray-50">
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleDomain(domain)}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${domainEntry.name}`}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-600 hover:bg-gray-200 hover:text-black transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                      <span className="text-sm font-medium text-black">{domainEntry.name}</span>
                      <span className="text-xs text-gray-500">({items.length} items)</span>
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
                  </div>

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
                        const linkedEvidenceIds = new Set(
                          currentItemEvidence
                            .map((ev) => ev.evidence_id)
                            .filter((evId): evId is number => typeof evId === 'number' && Number.isFinite(evId) && evId > 0)
                        );
                        const currentSearchTerm = (existingEvidenceSearch[item.id] || '').trim().toLowerCase();
                        const availableEvidenceOptions = evidenceLibraryOptions.filter((ev) => {
                          if (linkedEvidenceIds.has(ev.id)) return false;
                          if (!currentSearchTerm) return true;
                          return (
                            ev.name.toLowerCase().includes(currentSearchTerm) ||
                            (ev.file_name || '').toLowerCase().includes(currentSearchTerm) ||
                            String(ev.id).includes(currentSearchTerm)
                          );
                        });
                        const isAuditItemExpanded = !isAuditMasterAssessment || expandedAuditItems.has(item.id);

                        return (
                          <div key={item.id} className="bg-white">
                            <div className="p-4">
                              <div className="flex items-start gap-3">
                                <span className="text-sm font-mono text-gray-500 mt-1 shrink-0">
                                  {item.item_number}
                                </span>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-black ${isAuditMasterAssessment ? 'text-sm font-medium' : 'mb-2'}`}>
                                    {item.control_description}
                                  </p>

                                  {isAuditMasterAssessment && !isAuditItemExpanded && (
                                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-600">
                                      <span className="rounded bg-gray-100 px-2 py-0.5">
                                        Responsible: {item.responsible_party || 'Unassigned'}
                                      </span>
                                      <span className="rounded bg-gray-100 px-2 py-0.5">
                                        Timeline: {formatTimelineDisplay(item.timeline)}
                                      </span>
                                      <span className="rounded bg-gray-100 px-2 py-0.5">
                                        Remarks: {item.remarks ? 'Available' : 'None'}
                                      </span>
                                    </div>
                                  )}

                                  {isAuditItemExpanded && (
                                    <>
                                      {/* Unified Control Information panel.
                                          Used for every assessment type (UBL
                                          audit master AND framework-style
                                          assessments like NCA, Cloud
                                          Cybersecurity, NIST, OWASP) so the
                                          editable surface is identical
                                          everywhere. */}
                                      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/30 p-4">
                                          <div className="mb-3 flex items-center justify-between">
                                            <h4 className="text-sm font-semibold text-black">Control Information</h4>
                                            <span className="text-xs text-gray-500">
                                              {isEditing ? 'Editing' : 'Read Only'}
                                            </span>
                                          </div>
                                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                              <p className="mb-1 text-xs text-gray-600">Responsible Party</p>
                                              {isEditing && canEdit ? (
                                                <select
                                                  value={editingResponsibleParty}
                                                  onChange={(e) => setEditingResponsibleParty(e.target.value)}
                                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                >
                                                  <option value="">Unassigned</option>
                                                  {responsiblePartyOptions.map((option) => (
                                                    <option key={option} value={option}>
                                                      {option}
                                                    </option>
                                                  ))}
                                                </select>
                                              ) : (
                                                <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                                  {item.responsible_party || '-'}
                                                </p>
                                              )}
                                            </div>
                                            <div>
                                              <p className="mb-1 text-xs text-gray-600">Timeline</p>
                                              {isEditing && canEdit ? (
                                                <input
                                                  type="date"
                                                  value={editingTimeline}
                                                  onChange={(e) => {
                                                    setEditingTimeline(e.target.value);
                                                    setEditingTimelineTouched(true);
                                                  }}
                                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                              ) : (
                                                <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                                  {formatTimelineDisplay(item.timeline)}
                                                </p>
                                              )}
                                            </div>
                                            <div className="md:col-span-2">
                                              <p className="mb-1 text-xs text-gray-600">Remarks</p>
                                              {isEditing && canEdit ? (
                                                <textarea
                                                  value={editingRemarks}
                                                  onChange={(e) => setEditingRemarks(e.target.value)}
                                                  rows={3}
                                                  placeholder="Add comments or remediation remarks"
                                                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                              ) : (
                                                <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
                                                  {item.remarks ? item.remarks : '-'}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                                              <p className="text-xs text-gray-600 mb-1">Gaps Identified</p>
                                              {isEditing && canEdit ? (
                                                <textarea
                                                  value={editingGapsIdentified}
                                                  onChange={(e) => setEditingGapsIdentified(e.target.value)}
                                                  rows={3}
                                                  placeholder="Describe the gaps observed..."
                                                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                              ) : (
                                                <p className="text-sm text-gray-700 whitespace-pre-line">
                                                  {item.gaps_identified || <span className="italic text-gray-400">No gaps recorded</span>}
                                                </p>
                                              )}
                                            </div>
                                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                                              <p className="text-xs text-gray-600 mb-1">Proposed Solution</p>
                                              {isEditing && canEdit ? (
                                                <textarea
                                                  value={editingProposedSolution}
                                                  onChange={(e) => setEditingProposedSolution(e.target.value)}
                                                  rows={3}
                                                  placeholder="Suggest remediation steps..."
                                                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                              ) : (
                                                <p className="text-sm text-gray-700 whitespace-pre-line">
                                                  {item.proposed_solution || <span className="italic text-gray-400">No proposed solution</span>}
                                                </p>
                                              )}
                                            </div>
                                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                                              <p className="text-xs text-gray-600 mb-1">Area / Domain</p>
                                              {isEditing && canEdit ? (
                                                <input
                                                  type="text"
                                                  value={editingAreaDomain}
                                                  onChange={(e) => setEditingAreaDomain(e.target.value)}
                                                  placeholder="e.g. Access Control"
                                                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                />
                                              ) : (
                                                <p className="text-sm text-gray-700">{item.area_domain || <span className="italic text-gray-400">—</span>}</p>
                                              )}
                                            </div>
                                            <div className="rounded-lg border border-gray-200 bg-white p-3">
                                              <p className="text-xs text-gray-600 mb-1">Priority</p>
                                              {isEditing && canEdit ? (
                                                <select
                                                  value={editingPriority}
                                                  onChange={(e) => setEditingPriority(e.target.value)}
                                                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-black focus:outline-none focus:ring-2 focus:ring-blue-500"
                                                >
                                                  <option value="">— Select priority —</option>
                                                  <option value="critical">Critical</option>
                                                  <option value="high">High</option>
                                                  <option value="medium">Medium</option>
                                                  <option value="low">Low</option>
                                                </select>
                                              ) : (
                                                <p className="text-sm text-gray-700 capitalize">{item.priority || <span className="italic text-gray-400">—</span>}</p>
                                              )}
                                            </div>
                                          </div>
                                          {/* Per-item evidence is managed via
                                              the Paperclip toggle on each
                                              row — that opens the rich
                                              search-existing + upload-new
                                              panel below, which is the
                                              canonical evidence linking flow
                                              for every assessment type. */}
                                        </div>
                                    </>
                                  )}
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
                                      {canEdit && (
                                      <button
                                        onClick={() => startEditing(item)}
                                        className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                        title={isAuditMasterAssessment ? 'Edit control fields' : 'Edit status'}
                                      >
                                        <Edit2 className="h-4 w-4" />
                                      </button>
                                      )}
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
                                      {isAuditMasterAssessment && (
                                        <button
                                          onClick={() => toggleAuditItem(item.id)}
                                          className={`p-2 rounded-lg transition-colors ${
                                            isAuditItemExpanded ? 'text-blue-600 bg-blue-50' : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
                                          }`}
                                          title={isAuditItemExpanded ? 'Collapse control' : 'Expand control'}
                                        >
                                          {isAuditItemExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>

                            {isEvidenceExpanded && isAuditItemExpanded && (
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
                                      Linked Evidence ({currentItemEvidence.length})
                                    </h4>
                                    <div className="space-y-2">
                                      {currentItemEvidence.map((ev) => {
                                        const isFrameworkLink = ev.source === 'framework_link';
                                        const evStatusStyle = EVIDENCE_STATUS_STYLES[ev.status] || EVIDENCE_STATUS_STYLES.draft;
                                        return (
                                          <div key={ev.id} className={`border rounded-lg p-3 ${isFrameworkLink ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                                            <div className="flex items-start justify-between">
                                              <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                  <FileText className={`h-4 w-4 ${isFrameworkLink ? 'text-purple-600' : 'text-gray-600'}`} />
                                                  <span className="text-sm font-medium text-black">
                                                    {ev.evidence?.name || 'Evidence'}
                                                  </span>
                                                  <span className={`px-2 py-0.5 text-xs rounded ${evStatusStyle.bg} ${evStatusStyle.text}`}>
                                                    {evStatusStyle.label}
                                                  </span>
                                                  {isFrameworkLink && (
                                                    <span className="px-2 py-0.5 text-xs rounded bg-purple-100 text-purple-700 flex items-center gap-1">
                                                      <Sparkles className="h-3 w-3" />
                                                      Linked from Evidence Module
                                                    </span>
                                                  )}
                                                </div>
                                                {ev.evidence && (
                                                  <p className="text-xs text-gray-500 mt-1">
                                                    {ev.evidence.file_name} • {ev.evidence.file_type}
                                                  </p>
                                                )}
                                                {isFrameworkLink && ev.framework_name && (
                                                  <p className="text-xs text-purple-600 mt-1">
                                                    {ev.framework_name}{ev.control_code ? ` · ${ev.control_code}` : ''}
                                                    {ev.confidence_score ? ` · ${Math.round(ev.confidence_score)}% confidence` : ''}
                                                  </p>
                                                )}
                                                <p className="text-xs text-gray-500">
                                                  Linked {formatDateTime(ev.created_at)}
                                                </p>
                                              </div>
                                              {!isFrameworkLink && ev.status === 'draft' && (
                                                <button
                                                  onClick={() => approvalActionMutation.mutate({
                                                    evidenceLinkId: ev.id as number,
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
                                              {!isFrameworkLink && (ev.status === 'pending_review' || ev.status === 'in_approval') && (
                                                <div className="flex items-center gap-2 ml-4">
                                                  <input
                                                    type="text"
                                                    placeholder="Comments (optional)"
                                                    value={approvalComments[ev.id as number] || ''}
                                                    onChange={(e) => setApprovalComments({ ...approvalComments, [ev.id as number]: e.target.value })}
                                                    className="input text-xs py-1 px-2 w-32"
                                                  />
                                                  <button
                                                    onClick={() => handleApprovalAction(ev.id as number, 'approve')}
                                                    disabled={approvalActionMutation.isPending}
                                                    className="btn-ghost btn-sm text-emerald-400 hover:bg-emerald-500/20"
                                                    title="Approve"
                                                  >
                                                    <ThumbsUp className="h-4 w-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => handleApprovalAction(ev.id as number, 'reject')}
                                                    disabled={approvalActionMutation.isPending}
                                                    className="btn-ghost btn-sm text-rose-400 hover:bg-rose-500/20"
                                                    title="Reject"
                                                  >
                                                    <ThumbsDown className="h-4 w-4" />
                                                  </button>
                                                  <button
                                                    onClick={() => handleApprovalAction(ev.id as number, 'return')}
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
                                    <Paperclip className="h-4 w-4" />
                                    Link Existing Evidence
                                  </h4>
                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                    <div className="md:col-span-1">
                                      <label className="block text-xs text-gray-600 mb-1">Search</label>
                                      <input
                                        type="text"
                                        value={existingEvidenceSearch[item.id] || ''}
                                        onChange={(e) =>
                                          setExistingEvidenceSearch((prev) => ({
                                            ...prev,
                                            [item.id]: e.target.value,
                                          }))
                                        }
                                        placeholder="Search evidence by name or file"
                                        className="input text-sm"
                                      />
                                    </div>
                                    <div className="md:col-span-2">
                                      <label className="block text-xs text-gray-600 mb-1">Evidence Library</label>
                                      <select
                                        value={selectedExistingEvidence[item.id] ?? ''}
                                        onChange={(e) =>
                                          setSelectedExistingEvidence((prev) => ({
                                            ...prev,
                                            [item.id]: e.target.value ? Number(e.target.value) : null,
                                          }))
                                        }
                                        className="input text-sm"
                                      >
                                        <option value="">
                                          {isEvidenceLibraryLoading ? 'Loading evidence...' : 'Select evidence to link'}
                                        </option>
                                        {availableEvidenceOptions.map((ev) => (
                                          <option key={ev.id} value={ev.id}>
                                            {ev.name} ({ev.file_name || `Evidence #${ev.id}`})
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleLinkExistingEvidence(item.id)}
                                    disabled={!selectedExistingEvidence[item.id] || linkingExistingEvidenceItemId === item.id}
                                    className="btn-secondary btn-sm flex items-center gap-2"
                                  >
                                    {linkingExistingEvidenceItemId === item.id ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Paperclip className="h-4 w-4" />
                                    )}
                                    Link Selected Evidence
                                  </button>
                                  {availableEvidenceOptions.length === 0 && (
                                    <p className="text-xs text-gray-500">
                                      No unmatched evidence found for this search.
                                    </p>
                                  )}
                                </div>

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
                                        accept="*/*"
                                        onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                                        className="input text-sm py-1"
                                      />
                                      <p className="mt-1 text-[11px] text-gray-500">Any file type is supported.</p>
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


