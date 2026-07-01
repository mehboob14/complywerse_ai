'use client';


import { PageLoader } from '@/components/ui';
import { useState, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient, { tenantApi } from '@/lib/api';
import XlsxMaturityViewer from './XlsxMaturityViewer';
import ArtifactsTab from '@/components/compliance/ArtifactsTab';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import DCCAssessmentTab from '@/components/compliance/DCCAssessmentTab';
import AuditPlanTab from '@/components/compliance/AuditPlanTab';
import NcaTab from '@/components/compliance/NcaTab';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Search,
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
  Package,
  Shield,
  ClipboardList,
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

const COMPLIANCE_STATUS_STYLES: Record<string, { bg: string; text: string; border: string; label: string; icon: typeof CheckCircle }> = {
  complied: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', label: 'Complied', icon: CheckCircle },
  partially_complied: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', label: 'Partial', icon: AlertTriangle },
  not_complied: { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', label: 'Not Complied', icon: XCircle },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-200', label: 'In Progress', icon: Clock },
  na: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200', label: 'N/A', icon: Minus },
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

const PRIORITY_STYLES: Record<string, { bg: string; text: string; border: string; dot: string; label: string }> = {
  critical: { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-200', dot: 'bg-rose-500', label: 'Critical' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500', label: 'High' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-500', label: 'Medium' },
  low: { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500', label: 'Low' },
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

  const [activeTab, setActiveTab] = useState<'assessment' | 'nca' | 'artifacts' | 'doc_assessment' | 'audit_plan'>('assessment');
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [expandedAuditItems, setExpandedAuditItems] = useState<Set<number>>(new Set());
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  // Add new item drawer state.
  const [newItemOpen, setNewItemOpen] = useState<boolean>(false);
  // When adding an item, the user picks an existing domain (or creates a new
  // one). Selecting an existing domain reveals only the fields that domain
  // actually uses (see domainFieldUsage below).
  const [addNewDomain, setAddNewDomain] = useState(false);
  // Left-sidebar domain navigator: which domain is in focus ('__all__' = all).
  const [selectedDomain, setSelectedDomain] = useState<string>('__all__');
  // Inventory-style filter bar over the items table.
  const [itemSearch, setItemSearch] = useState('');
  const [itemStatusFilter, setItemStatusFilter] = useState('');
  const [itemPriorityFilter, setItemPriorityFilter] = useState('');
  const [newItemForm, setNewItemForm] = useState({
    item_number: '',
    area_domain: '',
    control_description: '',
    compliance_status: 'in_progress',
    priority: 'medium',
    responsible_party: '',
    timeline: '',
    gaps_identified: '',
    proposed_solution: '',
    evidence_reference: '',
    remarks: '',
  });
  // Delete confirmation target. When set, the modal renders.
  const [deleteItemTarget, setDeleteItemTarget] = useState<{ id: number; name: string } | null>(null);
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
  // Side-panel (system RightSlidePanel) for Evidence/AI per control — opened
  // from the paperclip / sparkles buttons. panelTab picks the active tab.
  const [panelItemId, setPanelItemId] = useState<number | null>(null);
  const [panelTab, setPanelTab] = useState<'ai' | 'evidence'>('evidence');
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

  // Add / delete item parity with criticality assessments. Single body fits
  // every assessment type since they all share ComplianceAssessmentDocumentItem.
  const createItemMutation = useMutation({
    mutationFn: async (body: {
      item_number?: string;
      area_domain?: string;
      control_description: string;
      compliance_status?: string;
      gaps_identified?: string;
      proposed_solution?: string;
      responsible_party?: string;
      timeline?: string;
      priority?: string;
      evidence_reference?: string;
      remarks?: string;
    }) => {
      const response = await apiClient.post(
        `/compliance/assessments/${assessmentId}/items`,
        body,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      setNewItemOpen(false);
      setAddNewDomain(false);
      setNewItemForm({
        item_number: '',
        area_domain: '',
        control_description: '',
        compliance_status: 'in_progress',
        priority: 'medium',
        responsible_party: '',
        timeline: '',
        gaps_identified: '',
        proposed_solution: '',
        evidence_reference: '',
        remarks: '',
      });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      await apiClient.delete(`/compliance/assessments/items/${itemId}`);
      return itemId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      setDeleteItemTarget(null);
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

  // Open the per-control side panel on a given tab, loading its evidence.
  const openItemPanel = (itemId: number, tab: 'ai' | 'evidence') => {
    setPanelItemId(itemId);
    setPanelTab(tab);
    setExpandedEvidence((prev) => new Set(prev).add(itemId)); // enable evidence query
  };

  const handleGenerateAIRecommendation = (itemId: number) => {
    // Open the side panel on the AI tab so the generated recommendation is
    // visible — otherwise the request succeeds but the result stays hidden.
    openItemPanel(itemId, 'ai');
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
        <PageLoader size="md" />
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

  // One Evidence/AI side panel for the whole page, driven by panelItemId — so
  // the items table rows stay clean (no overlay markup nested in the table).
  const activePanelItem = allItems.find((i) => i.id === panelItemId) || null;
  const activePanelEvidence = activePanelItem ? (itemEvidence?.[activePanelItem.id] || []) : [];
  const activePanelAi = activePanelItem ? parseAIRecommendation(activePanelItem.ai_evidence_recommendation) : null;
  const activePanelLinkedIds = new Set(
    activePanelEvidence.map((ev) => ev.evidence_id).filter((evId): evId is number => typeof evId === 'number' && Number.isFinite(evId) && evId > 0),
  );
  const activePanelSearch = activePanelItem ? (existingEvidenceSearch[activePanelItem.id] || '').trim().toLowerCase() : '';
  const activePanelEvidenceOptions = evidenceLibraryOptions.filter((ev) => {
    if (activePanelLinkedIds.has(ev.id)) return false;
    if (!activePanelSearch) return true;
    return ev.name.toLowerCase().includes(activePanelSearch) || (ev.file_name || '').toLowerCase().includes(activePanelSearch) || String(ev.id).includes(activePanelSearch);
  });

  // Existing domains (actual area_domain values) for the "Add item" dropdown,
  // and which optional fields each domain actually uses — inferred from its
  // items, since there is no separate per-domain schema. Selecting a domain in
  // the add form then shows only that domain's fields.
  const existingDomains = Object.keys(assessment.items_by_domain || {})
    .filter((d) => d && d !== 'Uncategorized')
    .sort((a, b) => a.localeCompare(b));
  const DOMAIN_OPTIONAL_FIELDS = ['responsible_party', 'timeline', 'gaps_identified', 'proposed_solution', 'evidence_reference', 'remarks'];
  const domainFieldUsage = {};
  for (const dom of existingDomains) {
    const used = new Set();
    for (const it of assessment.items_by_domain[dom] || []) {
      for (const f of DOMAIN_OPTIONAL_FIELDS) {
        const v = it[f];
        if (v !== null && v !== undefined && String(v).trim() !== '') used.add(f);
      }
    }
    domainFieldUsage[dom] = used;
  }
  // For the add form: which optional fields to show for the chosen domain.
  const selectedDomainUsage = !addNewDomain && newItemForm.area_domain ? domainFieldUsage[newItemForm.area_domain] : undefined;
  const showItemField = (f) => !selectedDomainUsage || selectedDomainUsage.size === 0 || selectedDomainUsage.has(f);

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
  // Hero (redesigned dashboard) — overall compliance ring + plain verdict.
  const heroPct = assessment.overall_score != null ? Math.round(assessment.overall_score) : 0;
  const heroColor = heroPct >= 70 ? '#10b981' : heroPct >= 40 ? '#f59e0b' : '#ef4444';
  const heroC = 2 * Math.PI * 48;
  const heroAssessed = (statusCounts['complied'] || 0) + (statusCounts['partially_complied'] || 0) + (statusCounts['not_complied'] || 0) + (statusCounts['na'] || 0);
  let heroReadiness = 'Not started';
  let heroVerdict = 'No items assessed yet — score the controls to see where you stand.';
  if (heroAssessed > 0) {
    if (heroPct >= 70) { heroReadiness = 'On track'; heroVerdict = 'Most items are compliant. Keep closing the remaining gaps.'; }
    else if (heroPct >= 40) { heroReadiness = 'Developing'; heroVerdict = 'Partially compliant — several items still need attention.'; }
    else { heroReadiness = 'At risk'; heroVerdict = 'Early stage — many items remain non-compliant.'; }
  }
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


      {activeTab === 'assessment' && (
      <>
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
          {canEdit && (
            <button
              onClick={() => { setAddNewDomain(false); setNewItemOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <span className="text-base leading-none">+</span> New Item
            </button>
          )}
        </div>

        <div className="space-y-4">
          {/* Filter bar over the items (inventory-style) */}
          {domains.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Search items by number or description…"
                  className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-blue-400 focus:outline-none"
                />
              </div>
              <select value={itemStatusFilter} onChange={(e) => setItemStatusFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none">
                <option value="">All statuses</option>
                <option value="complied">Complied</option>
                <option value="partially_complied">Partially Complied</option>
                <option value="not_complied">Not Complied</option>
                <option value="in_progress">In Progress</option>
                <option value="na">N/A</option>
              </select>
              <select value={itemPriorityFilter} onChange={(e) => setItemPriorityFilter(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 focus:border-blue-400 focus:outline-none">
                <option value="">All priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              {(itemSearch || itemStatusFilter || itemPriorityFilter) && (
                <button onClick={() => { setItemSearch(''); setItemStatusFilter(''); setItemPriorityFilter(''); }} className="text-xs font-medium text-blue-600 hover:underline">Clear</button>
              )}
            </div>
          )}
          {domains.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No assessment items found</p>
            </div>
          ) : (
            domainEntries.map((domainEntry) => {
              const domain = domainEntry.key;
              const itemSearchLc = itemSearch.trim().toLowerCase();
              const items = domainEntry.items.filter((it) => {
                if (itemStatusFilter && it.compliance_status !== itemStatusFilter) return false;
                if (itemPriorityFilter && (it.priority || '').toLowerCase() !== itemPriorityFilter) return false;
                if (itemSearchLc) {
                  const hay = `${it.item_number || ''} ${it.control_description || ''}`.toLowerCase();
                  if (!hay.includes(itemSearchLc)) return false;
                }
                return true;
              });
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
                    items.length === 0 ? (
                      <div className="px-4 py-6 text-center text-sm text-gray-400">No items match the filters.</div>
                    ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full table-fixed text-sm">
                        <colgroup>
                          <col style={{ width: '40px' }} />
                          <col style={{ width: '56px' }} />
                          <col />
                          <col className="hidden lg:table-column" style={{ width: '150px' }} />
                          <col className="hidden lg:table-column" style={{ width: '120px' }} />
                          <col style={{ width: '132px' }} />
                          <col className="hidden md:table-column" style={{ width: '104px' }} />
                          <col style={{ width: '128px' }} />
                        </colgroup>
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <th className="px-2 py-2.5"></th>
                            <th className="px-2 py-2.5">#</th>
                            <th className="px-2 py-2.5">Control</th>
                            <th className="hidden px-2 py-2.5 lg:table-cell">Responsible</th>
                            <th className="hidden px-2 py-2.5 lg:table-cell">Timeline</th>
                            <th className="px-2 py-2.5">Status</th>
                            <th className="hidden px-2 py-2.5 md:table-cell">Priority</th>
                            <th className="px-2 py-2.5 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {items.map((item) => {
                            const itemStatusStyle = COMPLIANCE_STATUS_STYLES[item.compliance_status] || COMPLIANCE_STATUS_STYLES.in_progress;
                            const StatusIcon = itemStatusStyle.icon;
                            const isEditing = editingItemId === item.id;
                            const evCount = (itemEvidence?.[item.id] || []).length;
                            const hasAi = !!parseAIRecommendation(item.ai_evidence_recommendation);
                            const rowExpanded = expandedAuditItems.has(item.id);
                            return (
                              <Fragment key={item.id}>
                                <tr className="align-top transition-colors hover:bg-slate-50">
                                  <td className="px-2 py-2.5">
                                    <button type="button" onClick={() => toggleAuditItem(item.id)} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={rowExpanded ? 'Collapse' : 'Expand'}>
                                      {rowExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  </td>
                                  <td className="truncate px-2 py-2.5 align-top font-mono text-xs text-slate-400">{item.item_number}</td>
                                  <td className="px-2 py-2.5 align-top">
                                    <button type="button" onClick={() => toggleAuditItem(item.id)} className="block w-full text-left">
                                      <p className="line-clamp-2 text-sm leading-snug text-slate-800">{item.control_description}</p>
                                    </button>
                                  </td>
                                  <td className="hidden truncate px-2 py-2.5 align-top text-xs text-slate-600 lg:table-cell" title={item.responsible_party || undefined}>{item.responsible_party || '—'}</td>
                                  <td className="hidden truncate px-2 py-2.5 align-top text-xs text-slate-600 lg:table-cell">{formatTimelineDisplay(item.timeline)}</td>
                                  <td className="px-2 py-2.5 align-top">
                                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${itemStatusStyle.bg} ${itemStatusStyle.text} ${itemStatusStyle.border}`}>
                                      <StatusIcon className="h-3 w-3 shrink-0" /> <span className="truncate">{itemStatusStyle.label}</span>
                                    </span>
                                  </td>
                                  <td className="hidden px-2 py-2.5 align-top md:table-cell">
                                    {(() => {
                                      const p = PRIORITY_STYLES[(item.priority || '').toLowerCase()];
                                      return p ? (
                                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${p.bg} ${p.text} ${p.border}`}>
                                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.dot}`} />{p.label}
                                        </span>
                                      ) : <span className="text-xs text-slate-400">—</span>;
                                    })()}
                                  </td>
                                  <td className="px-2 py-2.5">
                                    <div className="flex items-center justify-end gap-1">
                                      {isEditing ? (
                                        <>
                                          <button onClick={saveEditing} disabled={updateItemMutation.isPending} className="rounded-lg bg-blue-600 p-1.5 text-white hover:bg-blue-700 disabled:opacity-50" title="Save">
                                            {updateItemMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                          </button>
                                          <button onClick={cancelEditing} className="rounded-lg p-1.5 text-gray-600 hover:bg-gray-100" title="Cancel"><X className="h-4 w-4" /></button>
                                        </>
                                      ) : (
                                        <>
                                          {canEdit && (
                                            <button onClick={() => { startEditing(item); if (!expandedAuditItems.has(item.id)) toggleAuditItem(item.id); }} className="rounded-lg p-1.5 text-gray-600 hover:bg-blue-50 hover:text-blue-600" title="Edit"><Edit2 className="h-4 w-4" /></button>
                                          )}
                                          {canEdit && (
                                            <button onClick={() => setDeleteItemTarget({ id: item.id, name: item.control_description?.slice(0, 80) || `Item ${item.item_number}` })} className="rounded-lg p-1.5 text-gray-600 hover:bg-rose-50 hover:text-rose-600" title="Delete"><X className="h-4 w-4" /></button>
                                          )}
                                          <button onClick={() => openItemPanel(item.id, 'evidence')} className={`relative rounded-lg p-1.5 ${panelItemId === item.id ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600'}`} title="Evidence">
                                            <Paperclip className="h-4 w-4" />
                                            {evCount > 0 && <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[10px] text-white">{evCount}</span>}
                                          </button>
                                          <button onClick={() => handleGenerateAIRecommendation(item.id)} disabled={generatingAIForItem === item.id} className={`rounded-lg p-1.5 ${hasAi ? 'bg-purple-50 text-purple-600' : 'text-gray-600 hover:bg-purple-50 hover:text-purple-600'} disabled:opacity-50`} title="AI Suggest Evidence">
                                            {generatingAIForItem === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                                          </button>
                                        </>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                                {rowExpanded && (
                                  <tr className="bg-slate-50/60">
                                    <td colSpan={8} className="px-3 pb-3 pt-1 sm:px-4">
                                      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                                        <table className="w-full table-fixed text-sm">
                                          <colgroup>
                                            <col style={{ width: '190px' }} />
                                            <col />
                                          </colgroup>
                                          <tbody className="divide-y divide-slate-100">
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Control / Audit Point</th>
                                              <td className="whitespace-pre-line px-3 py-2 text-sm text-slate-700">{item.control_description}</td>
                                            </tr>
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Responsible Party</th>
                                              <td className="px-3 py-2 text-sm text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <select value={editingResponsibleParty} onChange={(e) => setEditingResponsibleParty(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                    <option value="">Unassigned</option>
                                                    {responsiblePartyOptions.map((o) => <option key={o} value={o}>{o}</option>)}
                                                  </select>
                                                ) : (item.responsible_party || <span className="italic text-slate-400">—</span>)}
                                              </td>
                                            </tr>
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Timeline</th>
                                              <td className="px-3 py-2 text-sm text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <input type="date" value={editingTimeline} onChange={(e) => { setEditingTimeline(e.target.value); setEditingTimelineTouched(true); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                                ) : formatTimelineDisplay(item.timeline)}
                                              </td>
                                            </tr>
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Priority</th>
                                              <td className="px-3 py-2 text-sm capitalize text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <select value={editingPriority} onChange={(e) => setEditingPriority(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                    <option value="">— Select —</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                                                  </select>
                                                ) : (item.priority || <span className="italic text-slate-400">—</span>)}
                                              </td>
                                            </tr>
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Area / Domain</th>
                                              <td className="px-3 py-2 text-sm text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <input type="text" value={editingAreaDomain} onChange={(e) => setEditingAreaDomain(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                                ) : (item.area_domain || <span className="italic text-slate-400">—</span>)}
                                              </td>
                                            </tr>
                                            {isEditing && canEdit && (
                                              <tr className="align-top">
                                                <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Status</th>
                                                <td className="px-3 py-2 text-sm text-slate-700">
                                                  <select value={editingStatus} onChange={(e) => setEditingStatus(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                                                    {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                                  </select>
                                                </td>
                                              </tr>
                                            )}
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Remarks</th>
                                              <td className="px-3 py-2 text-sm text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <textarea value={editingRemarks} onChange={(e) => setEditingRemarks(e.target.value)} rows={2} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                                ) : (item.remarks || <span className="italic text-slate-400">—</span>)}
                                              </td>
                                            </tr>
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Gaps Identified</th>
                                              <td className="whitespace-pre-line px-3 py-2 text-sm text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <textarea value={editingGapsIdentified} onChange={(e) => setEditingGapsIdentified(e.target.value)} rows={3} placeholder="Describe the gaps observed…" className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                                ) : (item.gaps_identified || <span className="italic text-slate-400">No gaps recorded</span>)}
                                              </td>
                                            </tr>
                                            <tr className="align-top">
                                              <th className="bg-slate-50 px-3 py-2 text-left align-top text-xs font-medium text-slate-500">Proposed Solution</th>
                                              <td className="whitespace-pre-line px-3 py-2 text-sm text-slate-700">
                                                {isEditing && canEdit ? (
                                                  <textarea value={editingProposedSolution} onChange={(e) => setEditingProposedSolution(e.target.value)} rows={3} placeholder="Suggest remediation steps…" className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                                                ) : (item.proposed_solution || <span className="italic text-slate-400">No proposed solution</span>)}
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    )
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      </>)}

      {/* Evidence & AI side panel — single instance, driven by panelItemId. */}
      {activePanelItem && (
        <RightSlidePanel
          isOpen={panelItemId === activePanelItem.id}
          onClose={() => setPanelItemId(null)}
          title={`${activePanelItem.item_number ?? ''} · Evidence & AI`}
          subtitle={activePanelItem.control_description || undefined}
          width="w-full max-w-2xl"
        >
          <div className="mb-4 flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {([{ id: 'ai', label: 'AI Suggestions', icon: Sparkles }, { id: 'evidence', label: 'Evidence', icon: Paperclip }] as { id: 'ai' | 'evidence'; label: string; icon: typeof Sparkles }[]).map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setPanelTab(id)} className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold transition ${panelTab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <Icon className="h-3.5 w-3.5" /> {label}
                {id === 'evidence' && activePanelEvidence.length > 0 && <span className="ml-0.5 rounded-full bg-blue-100 px-1.5 text-[10px] font-bold text-blue-700">{activePanelEvidence.length}</span>}
              </button>
            ))}
          </div>

          {panelTab === 'ai' && (
            <div className="space-y-4">
              {activePanelAi ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-purple-600" />
                    <h4 className="text-sm font-medium text-purple-600">AI Evidence Recommendations</h4>
                    {activePanelItem.ai_recommendation_generated_at && <span className="text-xs text-gray-500">Generated {formatDateTime(activePanelItem.ai_recommendation_generated_at)}</span>}
                  </div>
                  <p className="text-sm text-gray-700">{activePanelAi.summary}</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {activePanelAi.recommendations.map((rec, idx) => (
                      <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-black">{rec.evidence_type}</span>
                          <span className={`rounded px-2 py-0.5 text-xs ${rec.priority === 'high' ? 'bg-rose-50 text-rose-700' : rec.priority === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>{rec.priority}</span>
                        </div>
                        <p className="mb-2 text-xs text-gray-600">{rec.description}</p>
                        {rec.example_files.length > 0 && <div className="text-xs text-gray-500">Examples: {rec.example_files.join(', ')}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 py-2">
                  <button onClick={() => handleGenerateAIRecommendation(activePanelItem.id)} disabled={generatingAIForItem === activePanelItem.id} className="btn-secondary btn-sm flex items-center gap-2">
                    {generatingAIForItem === activePanelItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Generate AI Suggestions
                  </button>
                  <span className="text-xs text-gray-500">Get AI-powered recommendations for evidence to upload</span>
                </div>
              )}
            </div>
          )}

          {panelTab === 'evidence' && (
            <div className="space-y-4">
              {activePanelEvidence.length > 0 && (
                <div className="space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700"><Paperclip className="h-4 w-4" /> Linked Evidence ({activePanelEvidence.length})</h4>
                  <div className="space-y-2">
                    {activePanelEvidence.map((ev) => {
                      const isFrameworkLink = ev.source === 'framework_link';
                      const evStatusStyle = EVIDENCE_STATUS_STYLES[ev.status] || EVIDENCE_STATUS_STYLES.draft;
                      return (
                        <div key={ev.id} className={`rounded-lg border p-3 ${isFrameworkLink ? 'border-purple-200 bg-purple-50' : 'border-gray-200 bg-gray-50'}`}>
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <FileText className={`h-4 w-4 ${isFrameworkLink ? 'text-purple-600' : 'text-gray-600'}`} />
                                <span className="text-sm font-medium text-black">{ev.evidence?.name || 'Evidence'}</span>
                                <span className={`rounded px-2 py-0.5 text-xs ${evStatusStyle.bg} ${evStatusStyle.text}`}>{evStatusStyle.label}</span>
                              </div>
                              {ev.evidence && (
                                <div className="mt-1 flex items-center gap-2">
                                  <p className="text-xs text-gray-500">{ev.evidence.file_name} • {ev.evidence.file_type}</p>
                                  <EvidencePreviewButton evidenceId={ev.evidence.id} label="Preview" className="inline-flex items-center gap-1 rounded bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100" />
                                </div>
                              )}
                              <p className="text-xs text-gray-500">Linked {formatDateTime(ev.created_at)}</p>
                            </div>
                            {!isFrameworkLink && ev.status === 'draft' && (
                              <button onClick={() => approvalActionMutation.mutate({ evidenceLinkId: ev.id as number, action: 'submit', comments: '' })} disabled={approvalActionMutation.isPending} className="btn-primary ml-4 flex items-center gap-2 text-sm">
                                {approvalActionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for Review
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-3 border-t border-gray-200 pt-2">
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700"><Paperclip className="h-4 w-4" /> Link Existing Evidence</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="md:col-span-1">
                    <label className="mb-1 block text-xs text-gray-600">Search</label>
                    <input type="text" value={existingEvidenceSearch[activePanelItem.id] || ''} onChange={(e) => setExistingEvidenceSearch((prev) => ({ ...prev, [activePanelItem.id]: e.target.value }))} placeholder="Search evidence by name or file" className="input text-sm" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="mb-1 block text-xs text-gray-600">Evidence Library</label>
                    <select value={selectedExistingEvidence[activePanelItem.id] ?? ''} onChange={(e) => setSelectedExistingEvidence((prev) => ({ ...prev, [activePanelItem.id]: e.target.value ? Number(e.target.value) : null }))} className="input text-sm">
                      <option value="">{isEvidenceLibraryLoading ? 'Loading evidence...' : 'Select evidence to link'}</option>
                      {activePanelEvidenceOptions.map((ev) => <option key={ev.id} value={ev.id}>{ev.name} ({ev.file_name || `Evidence #${ev.id}`})</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={() => handleLinkExistingEvidence(activePanelItem.id)} disabled={!selectedExistingEvidence[activePanelItem.id] || linkingExistingEvidenceItemId === activePanelItem.id} className="btn-secondary btn-sm flex items-center gap-2">
                  {linkingExistingEvidenceItemId === activePanelItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} Link Selected Evidence
                </button>
              </div>

              <div className="space-y-3 border-t border-gray-200 pt-2">
                <h4 className="flex items-center gap-2 text-sm font-medium text-gray-700"><FileUp className="h-4 w-4" /> Upload New Evidence</h4>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">File</label>
                    <input type="file" accept="*/*" onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)} className="input py-1 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Evidence Name</label>
                    <input type="text" value={evidenceName} onChange={(e) => setEvidenceName(e.target.value)} placeholder="e.g., Security Policy v2" className="input text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600">Description (optional)</label>
                    <input type="text" value={evidenceDescription} onChange={(e) => setEvidenceDescription(e.target.value)} placeholder="Brief description" className="input text-sm" />
                  </div>
                </div>
                <button onClick={() => handleUploadEvidence(activePanelItem.id)} disabled={!evidenceFile || uploadEvidenceMutation.isPending} className="btn-primary btn-sm flex items-center gap-2">
                  {uploadEvidenceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Upload Evidence
                </button>
              </div>
            </div>
          )}
        </RightSlidePanel>
      )}

      {/* Add new item drawer. Compatible with every assessment type since
          ComplianceAssessmentDocumentItem is the shared row schema. */}
      {newItemOpen && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-slate-900/40">
          <div className="w-full max-w-xl bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Add Assessment Item</h3>
                <p className="text-[11px] text-slate-500">A new item under this assessment.</p>
              </div>
              <button onClick={() => setNewItemOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <FieldRow label="Item Number">
                <input
                  value={newItemForm.item_number}
                  onChange={(e) => setNewItemForm((s) => ({ ...s, item_number: e.target.value }))}
                  placeholder="Auto generated when blank"
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </FieldRow>
              <FieldRow label="Area / Domain">
                {existingDomains.length > 0 && (
                  <select
                    value={addNewDomain ? '__new__' : newItemForm.area_domain}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === '__new__') { setAddNewDomain(true); setNewItemForm((s) => ({ ...s, area_domain: '' })); }
                      else { setAddNewDomain(false); setNewItemForm((s) => ({ ...s, area_domain: v })); }
                    }}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select a domain…</option>
                    {existingDomains.map((d) => <option key={d} value={d}>{d}</option>)}
                    <option value="__new__">+ New domain…</option>
                  </select>
                )}
                {(addNewDomain || existingDomains.length === 0) && (
                  <input
                    value={newItemForm.area_domain}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, area_domain: e.target.value }))}
                    placeholder="New domain name (e.g. Access Control)"
                    className={`w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${existingDomains.length > 0 ? 'mt-2' : ''}`}
                  />
                )}
                {!addNewDomain && newItemForm.area_domain && selectedDomainUsage && selectedDomainUsage.size > 0 && (
                  <p className="mt-1 text-[11px] text-slate-400">Showing the fields used by “{newItemForm.area_domain}”.</p>
                )}
              </FieldRow>
              <FieldRow label="Control Description" required>
                <textarea
                  value={newItemForm.control_description}
                  onChange={(e) => setNewItemForm((s) => ({ ...s, control_description: e.target.value }))}
                  rows={3}
                  placeholder="Describe the control requirement, obligation, or audit point."
                  className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Status">
                  <select
                    value={newItemForm.compliance_status}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, compliance_status: e.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="in_progress">In Progress</option>
                    <option value="complied">Complied</option>
                    <option value="partially_complied">Partially Complied</option>
                    <option value="not_complied">Not Complied</option>
                    <option value="na">N/A</option>
                  </select>
                </FieldRow>
                <FieldRow label="Priority">
                  <select
                    value={newItemForm.priority}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, priority: e.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </FieldRow>
              </div>
              {showItemField('responsible_party') && (
                <FieldRow label="Responsible Party">
                  <input
                    value={newItemForm.responsible_party}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, responsible_party: e.target.value }))}
                    placeholder="Owner team or person"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </FieldRow>
              )}
              {showItemField('timeline') && (
                <FieldRow label="Timeline">
                  <input
                    value={newItemForm.timeline}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, timeline: e.target.value }))}
                    placeholder="Target date or Q3 2026"
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </FieldRow>
              )}
              {showItemField('gaps_identified') && (
                <FieldRow label="Gaps Identified">
                  <textarea
                    value={newItemForm.gaps_identified}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, gaps_identified: e.target.value }))}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </FieldRow>
              )}
              {showItemField('proposed_solution') && (
                <FieldRow label="Proposed Solution">
                  <textarea
                    value={newItemForm.proposed_solution}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, proposed_solution: e.target.value }))}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </FieldRow>
              )}
              {showItemField('evidence_reference') && (
                <FieldRow label="Evidence Reference">
                  <input
                    value={newItemForm.evidence_reference}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, evidence_reference: e.target.value }))}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </FieldRow>
              )}
              {showItemField('remarks') && (
                <FieldRow label="Remarks">
                  <textarea
                    value={newItemForm.remarks}
                    onChange={(e) => setNewItemForm((s) => ({ ...s, remarks: e.target.value }))}
                    rows={2}
                    className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </FieldRow>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 bg-slate-50">
              <button
                onClick={() => setNewItemOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={!newItemForm.control_description.trim() || createItemMutation.isPending}
                onClick={() => createItemMutation.mutate(newItemForm)}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {createItemMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Create Item
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete item confirmation. */}
      {deleteItemTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
              <h3 className="text-sm font-semibold text-slate-900">Delete this item?</h3>
            </div>
            <p className="mb-5 text-sm text-slate-600">
              <span className="text-slate-800 font-medium">{deleteItemTarget.name}</span>
              <br />
              This removes the item, its evidence links, and any AI recommendations. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setDeleteItemTarget(null)}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                disabled={deleteItemMutation.isPending}
                onClick={() => deleteItemMutation.mutate(deleteItemTarget.id)}
                className="inline-flex items-center gap-2 rounded-md bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {deleteItemMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Field row helper ───────────────────────────────────────────────────────
function FieldRow({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
        {label}{required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
    </div>
  );
}


