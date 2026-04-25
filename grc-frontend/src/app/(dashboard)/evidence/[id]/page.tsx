'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { 
  ArrowLeft, Loader2, AlertCircle, FileCheck, Calendar, Clock,
  CheckCircle, XCircle, FileText, Edit, ScanText, Brain, Link2,
  AlertTriangle, Eye, Trash2, Send, ThumbsUp, ThumbsDown, RefreshCw,
  History, FileSpreadsheet, Shield, Building2, Info, Image, Settings,
  ShieldCheck, ClipboardList, ExternalLink, Plus, X, Lock, Unlock,
  ChevronDown, ChevronRight, Hash, Cpu, FileCode, Quote
} from 'lucide-react';
import Link from 'next/link';

type TabType = 'overview' | 'ocr' | 'assessment' | 'controls' | 'cross-links';

interface EvidenceVersion {
  id: number;
  version_number: number;
  file_path: string | null;
  changes: string | null;
  created_by: number | null;
  created_at: string | null;
}

interface ControlMapping {
  id: number;
  normalized_control_id: number | null;
  normalized_control_code: string | null;
  normalized_control_name: string | null;
  framework_control_id: number | null;
  framework_control_code: string | null;
  framework_control_name: string | null;
}

interface AIAssessment {
  id: number;
  relevance_score: number | null;
  adequacy_score: number | null;
  confidence_score: number | null;
  audit_readiness: number | null;
  content_summary: string | null;
  gap_analysis: {
    detected_controls?: string[];
    compliance_frameworks?: string[];
    gaps?: string[];
    recommendations?: string[];
  } | null;
  assessed_at: string | null;
}

interface RiskLink {
  id: number;
  risk_id: number;
  risk_title: string | null;
}

interface AssetLink {
  id: number;
  asset_id: number;
  asset_name: string | null;
}

interface IncidentLink {
  id: number;
  incident_id: number;
}

interface PolicyLink {
  id: number;
  policy_statement_id: number;
}

interface EvidenceDetail {
  id: number;
  tenant_id: number;
  name: string;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  version: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  uploaded_at: string | null;
  status: string;
  ocr_status: string;
  ocr_processed_at: string | null;
  evidence_type: string | null;
  collection_date: string | null;
  validity_period_days: number | null;
  expiry_date: string | null;
  is_stale: boolean;
  source_system: string | null;
  content_summary: string | null;
  quality_score: number | null;
  submitted_by: number | null;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_comments: string | null;
  approved_by: number | null;
  approved_at: string | null;
  control_mappings: ControlMapping[];
  versions: EvidenceVersion[];
  latest_assessment: AIAssessment | null;
  risk_links: RiskLink[];
  asset_links: AssetLink[];
  incident_links: IncidentLink[];
  policy_links: PolicyLink[];
}

interface OCRContent {
  evidence_id: number;
  ocr_content: string | null;
  ocr_status: string;
  ocr_processed_at: string | null;
}

interface ClauseMapping {
  framework_name: string;
  control_id: string;
  clause_reference: string;
  control_title: string;
  matching_rationale: string;
  confidence: number;
  coverage_type: string;
  matched_text_excerpt: string;
  match_type?: 'explicit' | 'implicit' | 'inferred';
  intent_analysis?: string;
  cross_framework_equivalents?: string[];
}

interface LatestAssessment {
  id: number;
  evidence_id: number;
  relevance_score: number | null;
  adequacy_score: number | null;
  confidence_score: number | null;
  audit_readiness: number | null;
  content_summary: string | null;
  detected_controls: string[];
  compliance_frameworks: string[];
  compliance_gaps: string[];
  recommendations: string[];
  assessed_at: string;
  content_hash: string | null;
  model_version: string | null;
  prompt_version: string | null;
  assessment_mode: string | null;
  is_locked: boolean;
  clause_mappings: ClauseMapping[];
  matched_text_excerpts: { text: string; relevance: string }[];
}

interface AllLinksResponse {
  evidence_id: number;
  evidence_name: string;
  risks: { total: number; links: Array<{ id: number; risk_id: number; risk: { id: number; title: string; status: string; inherent_score: number | null; residual_score: number | null } | null }> };
  assets: { total: number; links: Array<{ id: number; asset_id: number; link_type: string; asset: { id: number; name: string; asset_type: string; criticality: string; status: string } | null }> };
  incidents: { total: number; links: Array<{ id: number; incident_id: number; link_type: string | null; incident: { id: number; title: string; severity: string; status: string } | null }> };
  policy_statements: { total: number; links: Array<{ id: number; policy_statement_id: number; link_type: string | null; policy_statement: { id: number; statement_code: string; statement_summary: string | null; status: string } | null }> };
  assessments?: { total: number; links: Array<{ id: number; assessment_item_id: number; assessment_id: number | null; assessment_name: string | null; assessment_type: string | null; assessment_status: string | null; item_number: string | null; area_domain: string | null; control_description: string | null; link_status: string; created_at: string | null }> };
  total_links: number;
}

interface ControlsResponse {
  evidence_id: number;
  evidence_name: string;
  total_mappings: number;
  normalized_controls: Array<{ id: number; normalized_control: { id: number; code: string; name: string } | null }>;
  by_framework: Array<{ framework_id: number; framework_name: string; framework_code: string; controls: Array<{ id: number; framework_control?: { id: number; code: string; name: string } | null; parsed_control?: { id: number; control_id: string; title: string } | null }> }>;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  pending_review: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Pending Review' },
  approved: { bg: 'bg-green-50', text: 'text-green-700', label: 'Approved' },
  rejected: { bg: 'bg-red-50', text: 'text-red-700', label: 'Rejected' },
  expired: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Expired' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Archived' },
};

const OCR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Pending' },
  processing: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Processing' },
  completed: { bg: 'bg-green-50', text: 'text-green-700', label: 'Completed' },
  failed: { bg: 'bg-red-50', text: 'text-red-700', label: 'Failed' },
  not_applicable: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'N/A' },
};

const TYPE_ICONS: Record<string, typeof FileText> = {
  screenshot: Image,
  document: FileText,
  certificate: ShieldCheck,
  audit_report: ClipboardList,
  log: FileSpreadsheet,
  policy: FileText,
  procedure: ClipboardList,
  configuration: Settings,
  attestation: ShieldCheck,
  training_record: ClipboardList,
  access_review: Eye,
  vulnerability_scan: AlertTriangle,
  penetration_test: ShieldCheck,
  backup_log: FileSpreadsheet,
  change_record: Edit,
  incident_report: AlertCircle,
  other: FileCheck,
};

export default function EvidenceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const evidenceId = Number(params.id);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('evidence:evidence_library:edit');
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [rejectComments, setRejectComments] = useState('');
  const [ocrProcessMessage, setOcrProcessMessage] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<number | null>(null);
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [selectedRiskId, setSelectedRiskId] = useState<number | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [selectedPolicyStatementId, setSelectedPolicyStatementId] = useState<number | null>(null);
  const [linkingClauseIndex, setLinkingClauseIndex] = useState<number | null>(null);
  const [linkFeedback, setLinkFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    evidence_type: '',
    collection_date: '',
    validity_period_days: '',
    source_system: '',
  });

  const { data: evidence, isLoading, error } = useQuery<EvidenceDetail>({
    queryKey: ['evidence-detail', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/items/${evidenceId}`);
      return response.data;
    },
    refetchInterval: (query) => {
      const currentEvidence = query.state.data as EvidenceDetail | undefined;
      const hasActiveOCR = currentEvidence?.ocr_status === 'pending' || currentEvidence?.ocr_status === 'processing';
      return hasActiveOCR ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const { data: ocrContent } = useQuery<OCRContent>({
    queryKey: ['evidence-ocr', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/ocr/${evidenceId}/ocr-content`);
      return response.data;
    },
    enabled: activeTab === 'ocr',
    refetchInterval: (query) => {
      const currentContent = query.state.data as OCRContent | undefined;
      const hasActiveOCR = currentContent?.ocr_status === 'pending' || currentContent?.ocr_status === 'processing';
      return hasActiveOCR ? 3000 : false;
    },
    refetchIntervalInBackground: true,
  });

  const { data: latestAssessment, refetch: refetchAssessment } = useQuery<LatestAssessment>({
    queryKey: ['evidence-assessment', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/ai/${evidenceId}/latest-assessment`);
      return response.data;
    },
    enabled: activeTab === 'assessment',
    retry: false,
  });

  const { data: allLinks } = useQuery<AllLinksResponse>({
    queryKey: ['evidence-cross-links', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/cross-links/${evidenceId}/all-links`);
      return response.data;
    },
    enabled: activeTab === 'cross-links' || activeTab === 'assessment' || activeTab === 'controls',
  });

  const { data: controlsData } = useQuery<ControlsResponse>({
    queryKey: ['evidence-controls', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/links/${evidenceId}/controls`);
      return response.data;
    },
    enabled: activeTab === 'controls' || activeTab === 'assessment',
  });

  const { data: availableControls } = useQuery<{
    frameworks: Array<{ id: number; name: string; short_code: string; controls: Array<{ id: number; control_id: string; original_reference: string | null; title: string }> }>;
    normalized_controls: Array<{ id: number; code: string; name: string }>;
  }>({
    queryKey: ['available-controls'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/links/available-controls');
      return response.data;
    },
    enabled: showLinkModal,
  });

  const { data: risksList } = useQuery<Array<{ id: number; title: string }>>({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await apiClient.get('/risks');
      return response.data;
    },
    enabled: showRiskModal,
  });

  const { data: assetsList } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['assets-list'],
    queryFn: async () => {
      const response = await apiClient.get('/assets');
      return response.data;
    },
    enabled: showAssetModal,
  });

  const { data: incidentsList } = useQuery<Array<{ id: number; title: string; severity?: string | null }>>({
    queryKey: ['incidents-list'],
    queryFn: async () => {
      const response = await apiClient.get('/erm/incidents');
      return response.data;
    },
    enabled: showIncidentModal,
  });

  const { data: policyStatementsList } = useQuery<{
    statements: Array<{ id: number; statement_code: string; statement_summary?: string | null }>;
    total: number;
  }>({
    queryKey: ['policy-statements-list'],
    queryFn: async () => {
      const response = await apiClient.get('/compliance/statements', { params: { limit: 200 } });
      return response.data;
    },
    enabled: showPolicyModal,
  });

  const { data: clauseMappings } = useQuery<ClauseMapping[]>({
    queryKey: ['evidence-clause-mappings', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/ai/${evidenceId}/clause-mappings`);
      return response.data;
    },
    enabled: activeTab === 'assessment',
    retry: false,
  });

  const { data: aiLinkStatus, refetch: refetchLinkStatus } = useQuery<{
    evidence_id: number;
    linked_controls: Record<string, { mapping_id: number; control_id: string; original_reference: string; framework_name: string }>;
    total_linked: number;
  }>({
    queryKey: ['evidence-ai-link-status', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/links/${evidenceId}/ai-link-status`);
      return response.data;
    },
    enabled: activeTab === 'assessment',
    retry: false,
  });

  const processOCRMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/ocr/${evidenceId}/process-ocr`),
    onMutate: () => {
      setOcrProcessMessage(null);
    },
    onSuccess: (response) => {
      const status = response.data?.status as string | undefined;
      const message = response.data?.message as string | undefined;

      if (status === 'failed') {
        setOcrProcessMessage(message || 'OCR processing failed. Please retry.');
      } else if (message) {
        setOcrProcessMessage(message);
      }

      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-ocr', evidenceId] });
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      const detail = error.response?.data?.detail;
      setOcrProcessMessage(detail || 'OCR request failed. Please retry.');
    },
  });

  const runAssessmentMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/ai/${evidenceId}/assess?force_refresh=true`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-assessment', evidenceId] });
      // Ensure AI suggested clause mappings and link status refresh immediately
      queryClient.invalidateQueries({ queryKey: ['evidence-clause-mappings', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-ai-link-status', evidenceId] });
      refetchAssessment();
    },
  });

  const submitForReviewMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/lifecycle/${evidenceId}/submit`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      router.push('/compliance/assessments/approvals');
    },
  });

  const updateEvidenceMutation = useMutation({
    mutationFn: () => apiClient.put(`/evidence-mgmt/items/${evidenceId}`, {
      name: editForm.name,
      description: editForm.description || null,
      evidence_type: editForm.evidence_type || null,
      collection_date: editForm.collection_date ? `${editForm.collection_date}T00:00:00` : null,
      validity_period_days: editForm.validity_period_days ? Number(editForm.validity_period_days) : null,
      source_system: editForm.source_system || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      setIsEditModalOpen(false);
    },
  });

  const reviewMutation = useMutation({
    mutationFn: (data: { action: string; comments?: string }) => 
      apiClient.post(`/evidence-mgmt/lifecycle/${evidenceId}/review`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      setReviewAction(null);
      setRejectComments('');
    },
  });

  const unlinkControlMutation = useMutation({
    mutationFn: (mappingId: number) => 
      apiClient.delete(`/evidence-mgmt/links/${evidenceId}/controls/${mappingId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-controls', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
    },
  });

  const unlinkRiskMutation = useMutation({
    mutationFn: (linkId: number) => 
      apiClient.delete(`/evidence-mgmt/cross-links/${evidenceId}/risks/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const unlinkAssetMutation = useMutation({
    mutationFn: (linkId: number) => 
      apiClient.delete(`/evidence-mgmt/cross-links/${evidenceId}/assets/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const unlinkIncidentMutation = useMutation({
    mutationFn: (linkId: number) => 
      apiClient.delete(`/evidence-mgmt/cross-links/${evidenceId}/incidents/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const unlinkPolicyMutation = useMutation({
    mutationFn: (linkId: number) => 
      apiClient.delete(`/evidence-mgmt/cross-links/${evidenceId}/policy-statements/${linkId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const lockAssessmentMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/ai/${evidenceId}/lock`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-assessment', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
    },
  });

  const linkControlMutation = useMutation({
    mutationFn: () => {
      if (selectedFrameworkId && selectedControlId) {
        return apiClient.post(`/evidence-mgmt/links/${evidenceId}/controls`, {
          control_links: [{ parsed_control_id: selectedControlId, uploaded_framework_id: selectedFrameworkId }],
        });
      }
      return Promise.reject(new Error('Select a control to link'));
    },
    onSuccess: () => {
      setShowLinkModal(false);
      setSelectedControlId(null);
      setSelectedFrameworkId(null);
      queryClient.invalidateQueries({ queryKey: ['evidence-controls', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
    },
  });

  const linkRiskMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/risks`, { risk_ids: [selectedRiskId] }),
    onSuccess: () => {
      setShowRiskModal(false);
      setSelectedRiskId(null);
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const linkAssetMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/assets`, { asset_ids: [selectedAssetId] }),
    onSuccess: () => {
      setShowAssetModal(false);
      setSelectedAssetId(null);
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const linkIncidentMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/incidents`, { incident_ids: [selectedIncidentId] }),
    onSuccess: () => {
      setShowIncidentModal(false);
      setSelectedIncidentId(null);
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const linkPolicyMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/policy-statements`, { statement_ids: [selectedPolicyStatementId] }),
    onSuccess: () => {
      setShowPolicyModal(false);
      setSelectedPolicyStatementId(null);
      queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] });
    },
  });

  const unlockAssessmentMutation = useMutation({
    mutationFn: () => apiClient.post(`/evidence-mgmt/ai/${evidenceId}/unlock`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-assessment', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
    },
  });

  const linkFromAIMutation = useMutation({
    mutationFn: (clause: ClauseMapping) => 
      apiClient.post(`/evidence-mgmt/links/${evidenceId}/link-from-ai`, {
        framework_name: clause.framework_name,
        control_id: clause.control_id,
        clause_reference: clause.clause_reference,
        confidence: clause.confidence,
        matching_rationale: clause.matching_rationale
      }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['evidence-ai-link-status', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-controls', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      setLinkingClauseIndex(null);
      refetchLinkStatus();
      const data = response.data;
      if (data.already_linked) {
        setLinkFeedback({ type: 'success', message: `Already linked to ${data.control_id}` });
      } else {
        setLinkFeedback({ type: 'success', message: `Successfully linked to ${data.control_id}: ${data.control_title}` });
      }
      setTimeout(() => setLinkFeedback(null), 5000);
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      setLinkingClauseIndex(null);
      const errorMessage = error.response?.data?.detail || 'Failed to create link. Please try again.';
      setLinkFeedback({ type: 'error', message: errorMessage });
      setTimeout(() => setLinkFeedback(null), 5000);
    }
  });

  const isClauseLinked = (clause: ClauseMapping): boolean => {
    if (!aiLinkStatus?.linked_controls) return false;
    const key = `${clause.framework_name}:${clause.control_id}`;
    return !!aiLinkStatus.linked_controls[key];
  };

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getDaysRemaining = () => {
    if (!evidence?.expiry_date) return null;
    const now = new Date();
    const expiry = new Date(evidence.expiry_date);
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const getQualityScoreColor = (score: number | null) => {
    if (score === null) return 'bg-gray-400';
    if (score >= 80) return 'bg-green-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getQualityScoreTextColor = (score: number | null) => {
    if (score === null) return 'text-gray-600';
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-red-600';
  };

  const getStatusStyle = (status: string) => {
    return STATUS_STYLES[status] || STATUS_STYLES.draft;
  };

  const getOCRStatusStyle = (status: string) => {
    return OCR_STATUS_STYLES[status] || OCR_STATUS_STYLES.pending;
  };

  const getTypeIcon = (type: string | null) => {
    if (!type) return FileCheck;
    return TYPE_ICONS[type] || FileCheck;
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !evidence) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load evidence details</p>
        <Link href="/evidence" className="mt-4 text-blue-600 hover:underline">
          Back to Evidence Library
        </Link>
      </div>
    );
  }

  const daysRemaining = getDaysRemaining();
  const statusStyle = getStatusStyle(evidence.status);
  const ocrStatusStyle = getOCRStatusStyle(evidence.ocr_status);
  const TypeIcon = getTypeIcon(evidence.evidence_type);

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Info },
    { id: 'ocr', label: 'OCR Content', icon: ScanText },
    { id: 'assessment', label: 'AI Assessment', icon: Brain },
    { id: 'controls', label: 'Linked Controls', icon: Shield },
    { id: 'cross-links', label: 'Cross-Module Links', icon: Link2 },
  ];

  return (
    <div className="risk-workspace -m-4 space-y-4 lg:-m-5">
      <div className="border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/evidence" className="mt-0.5 rounded-md p-1.5 text-gray-600 hover:bg-gray-50 hover:text-black">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <TypeIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-black">{evidence.name}</h1>
              <p className="text-xs text-gray-600">{evidence.description || 'No description'}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {evidence.evidence_type && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs text-blue-600">
                {evidence.evidence_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
            <span className={`rounded-full ${statusStyle.bg} px-2.5 py-1 text-xs ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
            {evidence.quality_score !== null && (
              <span className={`rounded-full ${getQualityScoreColor(evidence.quality_score)} px-2.5 py-1 text-xs text-white`}>
                Quality: {Math.round(evidence.quality_score)}%
              </span>
            )}
            {canEdit && (
            <button
              onClick={() => {
                setEditForm({
                  name: evidence.name || '',
                  description: evidence.description || '',
                  evidence_type: evidence.evidence_type || '',
                  collection_date: evidence.collection_date ? new Date(evidence.collection_date).toISOString().split('T')[0] : '',
                  validity_period_days: evidence.validity_period_days ? String(evidence.validity_period_days) : '',
                  source_system: evidence.source_system || '',
                });
                setIsEditModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-black hover:bg-gray-50"
              title="Edit Evidence"
            >
              <Edit className="h-3.5 w-3.5" />
              Edit
            </button>
            )}
            {evidence.status === 'draft' && (
              <button
                onClick={() => submitForReviewMutation.mutate()}
                disabled={submitForReviewMutation.isPending}
                className="flex items-center gap-1.5 rounded-md bg-yellow-600 px-3 py-1.5 text-sm text-white hover:bg-yellow-700 disabled:opacity-50"
                title="Submit for Review"
              >
                {submitForReviewMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Submit for Review
              </button>
            )}
            {evidence.ocr_status !== 'completed' && evidence.ocr_status !== 'not_applicable' && (
              <button
                onClick={() => processOCRMutation.mutate()}
                disabled={processOCRMutation.isPending}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                title="Process OCR"
              >
                {processOCRMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />}
                OCR
              </button>
            )}
            <button
              onClick={() => runAssessmentMutation.mutate()}
              disabled={runAssessmentMutation.isPending || evidence.ocr_status !== 'completed'}
              className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
              title={evidence.ocr_status !== 'completed' ? 'Run OCR first' : 'Run AI Assessment'}
            >
              {runAssessmentMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
              Assess
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 px-4 sm:px-6 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-gray-700">
            <Calendar className="h-4 w-4" />
            <span className="text-sm font-medium">Collection & Expiry</span>
          </div>
          <div className="space-y-2">
            <div>
              <span className="text-xs text-gray-500">Collected</span>
              <p className="text-black">{formatDate(evidence.collection_date)}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500">Expires</span>
              <p className={`${evidence.is_stale ? 'text-red-600' : daysRemaining !== null && daysRemaining <= 30 ? 'text-yellow-600' : 'text-black'}`}>
                {formatDate(evidence.expiry_date)}
              </p>
            </div>
            {daysRemaining !== null && (
              <div className={`text-sm ${daysRemaining <= 0 ? 'text-red-600' : daysRemaining <= 30 ? 'text-yellow-600' : 'text-green-600'}`}>
                {daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days remaining`}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-gray-700">
            <ScanText className="h-4 w-4" />
            <span className="text-sm font-medium">OCR Status</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full ${ocrStatusStyle.bg} px-3 py-1 text-sm ${ocrStatusStyle.text}`}>
              {ocrStatusStyle.label}
            </span>
          </div>
          {evidence.ocr_processed_at && (
            <p className="mt-2 text-xs text-gray-500">
              Processed: {formatDateTime(evidence.ocr_processed_at)}
            </p>
          )}
          {evidence.ocr_status === 'pending' && (
            <button
              onClick={() => processOCRMutation.mutate()}
              disabled={processOCRMutation.isPending}
              className="mt-3 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              {processOCRMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ScanText className="h-3 w-3" />
              )}
              Process Now
            </button>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-gray-700">
            <Brain className="h-4 w-4" />
            <span className="text-sm font-medium">Quality Score</span>
          </div>
          {evidence.quality_score !== null ? (
            <>
              <div className={`text-3xl font-bold ${getQualityScoreTextColor(evidence.quality_score)}`}>
                {Math.round(evidence.quality_score)}%
              </div>
              <div className="mt-2">
                <div className="h-2 w-full rounded-full bg-gray-200">
                  <div 
                    className={`h-2 rounded-full transition-all ${getQualityScoreColor(evidence.quality_score)}`}
                    style={{ width: `${evidence.quality_score}%` }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl font-bold text-gray-500">-</div>
              <button
                onClick={() => runAssessmentMutation.mutate()}
                disabled={runAssessmentMutation.isPending || evidence.ocr_status !== 'completed'}
                className="mt-3 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400"
              >
                {runAssessmentMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Brain className="h-3 w-3" />
                )}
                Run Assessment
              </button>
            </>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-gray-700">
            <FileText className="h-4 w-4" />
            <span className="text-sm font-medium">File Info</span>
          </div>
          <div className="space-y-2">
            <div>
              <span className="text-xs text-gray-500">Filename</span>
              <p className="truncate text-sm text-black">{evidence.file_name || 'No file'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500">Type</span>
              <p className="text-sm text-black">{evidence.file_type || 'Unknown'}</p>
            </div>
            <div>
              <span className="text-xs text-gray-500">Version</span>
              <p className="text-sm text-black">v{evidence.version}</p>
            </div>
          </div>
        </div>
      </div>

      {evidence.status === 'pending_review' && (
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-yellow-600" />
              <div>
                <p className="text-sm font-medium text-yellow-700">This evidence is awaiting approval</p>
                <p className="text-xs text-gray-600">
                  Submitted by {evidence.uploader_name || 'Unknown'} on {formatDateTime(evidence.submitted_at)}
                </p>
              </div>
            </div>
            <Link
              href="/compliance/assessments/approvals"
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm text-black border border-yellow-300 hover:bg-yellow-100"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open Pending Approvals
            </Link>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-4">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-black">Edit Evidence</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-gray-500 hover:text-black">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))} rows={3} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Evidence Type</label>
                  <select value={editForm.evidence_type} onChange={(e) => setEditForm((prev) => ({ ...prev, evidence_type: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none">
                    <option value="">Select type...</option>
                    {['screenshot','document','certificate','audit_report','log','policy','procedure','configuration','attestation','training_record','access_review','vulnerability_scan','penetration_test','backup_log','change_record','incident_report','other'].map((type) => (
                      <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Collection Date</label>
                  <input type="date" value={editForm.collection_date} onChange={(e) => setEditForm((prev) => ({ ...prev, collection_date: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Validity Days</label>
                  <input type="number" min="1" value={editForm.validity_period_days} onChange={(e) => setEditForm((prev) => ({ ...prev, validity_period_days: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-700">Source System</label>
                  <input value={editForm.source_system} onChange={(e) => setEditForm((prev) => ({ ...prev, source_system: e.target.value }))} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-gray-200 pt-3">
                <button onClick={() => setIsEditModalOpen(false)} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-black hover:bg-gray-50">Cancel</button>
                <button onClick={() => updateEvidenceMutation.mutate()} disabled={updateEvidenceMutation.isPending || !editForm.name.trim()} className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
                  {updateEvidenceMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      <div className="border-b border-gray-200 px-4 sm:px-6">
        <nav className="flex flex-wrap gap-1 overflow-x-auto py-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-black'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="mx-4 rounded-lg border border-gray-200 bg-white p-3 sm:mx-6 sm:p-4">
        {activeTab === 'overview' && (
          <OverviewTab evidence={evidence} formatDate={formatDate} formatDateTime={formatDateTime} />
        )}
        {activeTab === 'ocr' && (
          <OCRTab 
            evidence={evidence}
            ocrContent={ocrContent}
            onProcessOCR={() => processOCRMutation.mutate()}
            isProcessing={processOCRMutation.isPending}
            ocrProcessMessage={ocrProcessMessage}
            formatDateTime={formatDateTime}
          />
        )}
        {activeTab === 'assessment' && (
          <AssessmentTab 
            evidence={evidence}
            assessment={latestAssessment}
            controlsData={controlsData}
            assetsData={allLinks?.assets}
            clauseMappings={clauseMappings}
            onRunAssessment={() => runAssessmentMutation.mutate()}
            onLock={() => lockAssessmentMutation.mutate()}
            onUnlock={() => unlockAssessmentMutation.mutate()}
            isRunning={runAssessmentMutation.isPending}
            isLocking={lockAssessmentMutation.isPending}
            isUnlocking={unlockAssessmentMutation.isPending}
            formatDateTime={formatDateTime}
            isClauseLinked={isClauseLinked}
            onLinkFromAI={(clause: ClauseMapping) => {
              linkFromAIMutation.mutate(clause);
            }}
            linkingClauseIndex={linkingClauseIndex}
            setLinkingClauseIndex={setLinkingClauseIndex}
            isLinkingPending={linkFromAIMutation.isPending}
            linkFeedback={linkFeedback}
          />
        )}
        {activeTab === 'controls' && (
          <ControlsTab 
            controlsData={controlsData}
            usageData={allLinks}
            onUnlink={(mappingId) => unlinkControlMutation.mutate(mappingId)}
            isUnlinking={unlinkControlMutation.isPending}
            onOpenLinkModal={() => setShowLinkModal(true)}
          />
        )}
        {activeTab === 'cross-links' && (
          <CrossLinksTab 
            links={allLinks}
            onUnlinkRisk={(linkId) => unlinkRiskMutation.mutate(linkId)}
            onUnlinkAsset={(linkId) => unlinkAssetMutation.mutate(linkId)}
            onUnlinkIncident={(linkId) => unlinkIncidentMutation.mutate(linkId)}
            onUnlinkPolicy={(linkId) => unlinkPolicyMutation.mutate(linkId)}
            isUnlinking={
              unlinkRiskMutation.isPending ||
              unlinkAssetMutation.isPending ||
              unlinkIncidentMutation.isPending ||
              unlinkPolicyMutation.isPending
            }
            onOpenRiskModal={() => setShowRiskModal(true)}
            onOpenAssetModal={() => setShowAssetModal(true)}
            onOpenIncidentModal={() => setShowIncidentModal(true)}
            onOpenPolicyModal={() => setShowPolicyModal(true)}
          />
        )}
      </div>
        {showLinkModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-black">Link Control</h3>
                <button onClick={() => setShowLinkModal(false)} className="text-gray-500 hover:text-black"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-gray-700">Framework</label>
                    <select
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      value={selectedFrameworkId ?? ''}
                      onChange={(e) => {
                        const val = e.target.value ? Number(e.target.value) : null;
                        setSelectedFrameworkId(val);
                        setSelectedControlId(null);
                      }}
                    >
                      <option value="">Select framework</option>
                      {availableControls?.frameworks.map((fw) => (
                        <option key={fw.id} value={fw.id}>{fw.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-gray-700">Control</label>
                    <select
                      className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                      value={selectedControlId ?? ''}
                      onChange={(e) => setSelectedControlId(e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">Select control</option>
                      {availableControls?.frameworks
                        .find((fw) => fw.id === selectedFrameworkId)?.controls
                        .map((c) => (
                          <option key={c.id} value={c.id}>{c.control_id} - {c.title}</option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setShowLinkModal(false)}
                    className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => linkControlMutation.mutate()}
                    className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                    disabled={linkControlMutation.isPending || !selectedFrameworkId || !selectedControlId}
                  >
                    {linkControlMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {showRiskModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-black">Link Risk</h3>
                <button onClick={() => setShowRiskModal(false)} className="text-gray-500 hover:text-black"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={selectedRiskId ?? ''}
                onChange={(e) => setSelectedRiskId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select risk</option>
                {risksList?.map((risk) => (
                  <option key={risk.id} value={risk.id}>{risk.title || `Risk #${risk.id}`}</option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowRiskModal(false)} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button
                  onClick={() => linkRiskMutation.mutate()}
                  disabled={!selectedRiskId || linkRiskMutation.isPending}
                  className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {linkRiskMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link Risk'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAssetModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-black">Link Asset</h3>
                <button onClick={() => setShowAssetModal(false)} className="text-gray-500 hover:text-black"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={selectedAssetId ?? ''}
                onChange={(e) => setSelectedAssetId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select asset</option>
                {assetsList?.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name || `Asset #${asset.id}`}</option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowAssetModal(false)} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button
                  onClick={() => linkAssetMutation.mutate()}
                  disabled={!selectedAssetId || linkAssetMutation.isPending}
                  className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {linkAssetMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link Asset'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showIncidentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-black">Link Incident</h3>
                <button onClick={() => setShowIncidentModal(false)} className="text-gray-500 hover:text-black"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={selectedIncidentId ?? ''}
                onChange={(e) => setSelectedIncidentId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select incident</option>
                {incidentsList?.map((incident) => (
                  <option key={incident.id} value={incident.id}>
                    {(incident.title || `Incident #${incident.id}`) + (incident.severity ? ` • ${incident.severity}` : '')}
                  </option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowIncidentModal(false)} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button
                  onClick={() => linkIncidentMutation.mutate()}
                  disabled={!selectedIncidentId || linkIncidentMutation.isPending}
                  className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {linkIncidentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link Incident'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showPolicyModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
            <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-black">Link Policy Statement</h3>
                <button onClick={() => setShowPolicyModal(false)} className="text-gray-500 hover:text-black"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
                value={selectedPolicyStatementId ?? ''}
                onChange={(e) => setSelectedPolicyStatementId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select policy statement</option>
                {policyStatementsList?.statements?.map((statement) => (
                  <option key={statement.id} value={statement.id}>
                    {(statement.statement_code || `Statement #${statement.id}`) + ' - ' + (statement.statement_summary || 'Policy Statement')}
                  </option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowPolicyModal(false)} className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
                <button
                  onClick={() => linkPolicyMutation.mutate()}
                  disabled={!selectedPolicyStatementId || linkPolicyMutation.isPending}
                  className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {linkPolicyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link Statement'}
                </button>
              </div>
            </div>
          </div>
        )}

    </div>
  );
}

function OverviewTab({ 
  evidence, 
  formatDate, 
  formatDateTime 
}: { 
  evidence: EvidenceDetail; 
  formatDate: (d?: string | null) => string;
  formatDateTime: (d?: string | null) => string;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-6">
        <div>
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-black">
            <Info className="h-5 w-5 text-blue-600" />
            Basic Information
          </h3>
          <div className="space-y-3 rounded-lg bg-gray-50 p-4">
            <div>
              <span className="text-sm text-gray-600">Description</span>
              <p className="text-black">{evidence.description || 'No description provided'}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Source System</span>
              <p className="text-black">{evidence.source_system || 'Not specified'}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Uploaded By</span>
              <p className="text-black">{evidence.uploader_name || 'Unknown'}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Uploaded At</span>
              <p className="text-black">{formatDateTime(evidence.uploaded_at)}</p>
            </div>
            {evidence.content_summary && (
              <div>
                <span className="text-sm text-gray-600">Content Summary</span>
                <p className="text-black">{evidence.content_summary}</p>
              </div>
            )}
          </div>
        </div>

        {evidence.review_comments && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-black">
              <AlertCircle className="h-5 w-5 text-yellow-400" />
              Review Comments
            </h3>
            <div className="rounded-lg bg-yellow-900/20 border border-yellow-600/30 p-4">
              <p className="text-yellow-200">{evidence.review_comments}</p>
              {evidence.reviewed_at && (
                <p className="mt-2 text-xs text-gray-600">Reviewed on {formatDateTime(evidence.reviewed_at)}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-black">
          <History className="h-5 w-5 text-blue-600" />
          Version History
        </h3>
        {evidence.versions && evidence.versions.length > 0 ? (
          <div className="space-y-2">
            {evidence.versions.map((version) => (
              <div key={version.id} className="rounded-lg bg-gray-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-black">Version {version.version_number}</span>
                  <span className="text-sm text-gray-600">{formatDateTime(version.created_at)}</span>
                </div>
                {version.changes && (
                  <p className="mt-1 text-sm text-gray-600">{version.changes}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-gray-50 p-4 text-center text-gray-600">
            <History className="mx-auto mb-2 h-8 w-8 text-gray-400" />
            <p>No version history available</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OCRTab({ 
  evidence, 
  ocrContent,
  onProcessOCR,
  isProcessing,
  ocrProcessMessage,
  formatDateTime
}: { 
  evidence: EvidenceDetail;
  ocrContent?: OCRContent;
  onProcessOCR: () => void;
  isProcessing: boolean;
  ocrProcessMessage?: string | null;
  formatDateTime: (d?: string | null) => string;
}) {
  const content = ocrContent?.ocr_content;
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-black">
          <ScanText className="h-5 w-5 text-blue-600" />
          OCR Extracted Content
        </h3>
        <div className="flex items-center gap-3">
          {ocrContent?.ocr_processed_at && (
            <span className="text-sm text-gray-600">
              Processed: {formatDateTime(ocrContent.ocr_processed_at)}
            </span>
          )}
          <button
            onClick={onProcessOCR}
            disabled={isProcessing}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isProcessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Re-process OCR
          </button>
        </div>
      </div>

      {evidence.ocr_status === 'completed' && content ? (
        <div className="max-h-[600px] overflow-auto rounded-lg bg-gray-50 p-4">
          <pre className="whitespace-pre-wrap font-mono text-sm text-gray-700">{content}</pre>
        </div>
      ) : evidence.ocr_status === 'processing' ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Loader2 className="mb-4 h-12 w-12 animate-spin text-blue-400" />
          <p className="text-lg font-medium text-black">Processing OCR...</p>
          <p className="text-gray-600">This may take a moment</p>
        </div>
      ) : evidence.ocr_status === 'failed' ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <XCircle className="mb-4 h-12 w-12 text-red-400" />
          <p className="text-lg font-medium text-black">OCR Processing Failed</p>
          <p className="text-gray-600">Try re-processing the document</p>
          {ocrProcessMessage && (
            <p className="mt-2 max-w-xl text-sm text-red-600">{ocrProcessMessage}</p>
          )}
          <button
            onClick={onProcessOCR}
            disabled={isProcessing}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Retry OCR
          </button>
        </div>
      ) : evidence.ocr_status === 'not_applicable' ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="mb-4 h-12 w-12 text-gray-400" />
          <p className="text-lg font-medium text-black">OCR Not Applicable</p>
          <p className="text-gray-600">This file type does not support OCR extraction</p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ScanText className="mb-4 h-12 w-12 text-gray-400" />
          <p className="text-lg font-medium text-black">No OCR Content Yet</p>
          <p className="text-gray-600">Process the document to extract text content</p>
          <button
            onClick={onProcessOCR}
            disabled={isProcessing}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanText className="h-4 w-4" />}
            Process OCR
          </button>
        </div>
      )}
    </div>
  );
}

interface AssetsDataType {
  total: number;
  links: Array<{
    id: number;
    asset_id: number;
    link_type: string;
    asset: { id: number; name: string; asset_type: string; criticality: string; status: string } | null;
  }>;
}

function AssessmentTab({ 
  evidence, 
  assessment,
  controlsData,
  assetsData,
  clauseMappings,
  onRunAssessment,
  onLock,
  onUnlock,
  isRunning,
  isLocking,
  isUnlocking,
  formatDateTime,
  isClauseLinked,
  onLinkFromAI,
  linkingClauseIndex,
  setLinkingClauseIndex,
  isLinkingPending,
  linkFeedback
}: { 
  evidence: EvidenceDetail;
  assessment?: LatestAssessment;
  controlsData?: ControlsResponse;
  assetsData?: AssetsDataType;
  clauseMappings?: ClauseMapping[];
  onRunAssessment: () => void;
  onLock: () => void;
  onUnlock: () => void;
  isRunning: boolean;
  isLocking: boolean;
  isUnlocking: boolean;
  formatDateTime: (d?: string | null) => string;
  isClauseLinked: (clause: ClauseMapping) => boolean;
  onLinkFromAI: (clause: ClauseMapping) => void;
  linkingClauseIndex: number | null;
  setLinkingClauseIndex: (index: number | null) => void;
  isLinkingPending: boolean;
  linkFeedback: { type: 'success' | 'error'; message: string } | null;
}) {
  const [expandedClauses, setExpandedClauses] = useState<Set<number>>(new Set());

  const toggleClause = (index: number) => {
    setExpandedClauses(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  };

  const getCoverageTypeStyle = (coverageType: string) => {
    switch (coverageType.toLowerCase()) {
      case 'full':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'partial':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'minimal':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'none':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      default:
        return 'bg-gray-100 text-gray-600 border-gray-300';
    }
  };

  const truncateHash = (hash: string | null) => {
    if (!hash) return '-';
    return `${hash.substring(0, 8)}...${hash.substring(hash.length - 8)}`;
  };

  const ScoreBar = ({ label, score, color }: { label: string; score: number | null; color: string }) => {
    const value = score || 0;
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-600">{label}</span>
          <span className={`font-bold ${value >= 70 ? 'text-green-400' : value >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>
            {value.toFixed(0)}%
          </span>
        </div>
        <div className="h-3 w-full rounded-full bg-gray-100">
          <div 
            className={`h-3 rounded-full transition-all ${color}`}
            style={{ width: `${value}%` }}
          />
        </div>
      </div>
    );
  };

  if (!assessment && !evidence.latest_assessment) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Brain className="mb-4 h-12 w-12 text-gray-400" />
        <p className="text-lg font-medium text-black">No AI Assessment Yet</p>
        <p className="text-gray-600">
          {evidence.ocr_status !== 'completed' 
            ? 'Process OCR first, then run the AI assessment'
            : 'Run an AI assessment to analyze evidence quality'}
        </p>
        <button
          onClick={onRunAssessment}
          disabled={isRunning || evidence.ocr_status !== 'completed'}
          className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          Run Assessment
        </button>
      </div>
    );
  }

  const data = assessment || evidence.latest_assessment;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-black">
          <Brain className="h-5 w-5 text-blue-600" />
          AI Quality Assessment
        </h3>
        <div className="flex items-center gap-3">
          {assessment?.assessed_at && (
            <span className="text-sm text-gray-600">
              Assessed: {formatDateTime(assessment.assessed_at)}
            </span>
          )}
          <button
            onClick={onRunAssessment}
            disabled={isRunning || evidence.ocr_status !== 'completed'}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Re-assess
          </button>
        </div>
      </div>


      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-4 rounded-lg bg-gray-50 p-4">
          <h4 className="font-medium text-black">Quality Scores</h4>
          <ScoreBar label="Relevance" score={data.relevance_score} color="bg-blue-500" />
          <ScoreBar label="Adequacy" score={data.adequacy_score} color="bg-green-500" />
          <ScoreBar label="Audit Readiness" score={data.audit_readiness} color="bg-purple-500" />
          <ScoreBar label="Confidence" score={data.confidence_score} color="bg-cyan-500" />
        </div>

        <div className="space-y-4 rounded-lg bg-gray-50 p-4">
          <h4 className="font-medium text-black">Content Summary</h4>
          <p className="text-gray-700">{data.content_summary || 'No summary available'}</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h4 className="mb-3 flex items-center gap-2 font-medium text-black">
          <ShieldCheck className="h-5 w-5 text-blue-600" />
          Applicable Compliance Frameworks
        </h4>
        <p className="mb-3 text-xs text-gray-600">This evidence can be used to demonstrate compliance with the following requirements:</p>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-300/50">
                <th className="pb-3 pr-4 font-medium text-gray-700 w-1/3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-600" />
                    AI-Detected Frameworks
                  </div>
                </th>
                <th className="pb-3 px-4 font-medium text-gray-700 w-1/3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-blue-400" />
                    Linked Controls
                  </div>
                </th>
                <th className="pb-3 pl-4 font-medium text-gray-700 w-1/3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-green-400" />
                    Associated Assets
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="py-3 pr-4 align-top">
                  {(() => {
                    const frameworks = (assessment?.compliance_frameworks || (data as AIAssessment)?.gap_analysis?.compliance_frameworks) || [];
                    return frameworks.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {frameworks.map((framework, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-primary-500/20 px-3 py-1 text-sm font-medium text-blue-700 border border-primary-500/30">
                            <Shield className="h-3 w-3" />
                            {framework}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-500 text-sm">Run AI assessment to identify</span>
                    );
                  })()}
                </td>
                <td className="py-3 px-4 align-top border-l border-gray-200/30">
                  {controlsData?.by_framework && controlsData.by_framework.length > 0 ? (
                    <div className="space-y-3">
                      {controlsData.by_framework.map((framework) => (
                        <div key={framework.framework_id}>
                          <div className="text-xs font-medium text-gray-600 mb-1.5">{framework.framework_name}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {framework.controls.slice(0, 5).map((mapping) => (
                              <Link 
                                key={mapping.id}
                                href={`/frameworks`}
                                className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
                              >
                                <ShieldCheck className="h-2.5 w-2.5" />
                                {mapping.framework_control?.code}
                              </Link>
                            ))}
                            {framework.controls.length > 5 && (
                              <span className="text-xs text-gray-500">+{framework.controls.length - 5} more</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm">No linked controls</span>
                  )}
                </td>
                <td className="py-3 pl-4 align-top border-l border-gray-200/30">
                  {assetsData?.links && assetsData.links.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {assetsData.links.slice(0, 6).map((link) => (
                        link.asset && (
                          <Link 
                            key={link.id}
                            href={`/assets/${link.asset_id}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-green-500/20 px-3 py-1 text-sm font-medium text-green-300 border border-green-500/30 hover:bg-green-500/30 transition-colors"
                          >
                            <Building2 className="h-3 w-3" />
                            {link.asset.name}
                          </Link>
                        )
                      ))}
                      {assetsData.links.length > 6 && (
                        <span className="text-xs text-gray-500 self-center">+{assetsData.links.length - 6} more</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-gray-500 text-sm">No linked assets</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {clauseMappings && clauseMappings.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h4 className="mb-3 font-medium text-black">AI Suggested Clause Mappings</h4>
            <p className="text-sm text-gray-600 mb-2">Click "Link to Requirement" to create actual links.</p>
            <ul className="space-y-2">
              {clauseMappings.map((clause, idx) => (
                <li key={idx} className="rounded-lg border border-gray-200">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => toggleClause(idx)}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-black">{clause.framework_name}</span>
                        <span className="text-sm text-gray-500">{clause.control_id}</span>
                      </div>
                      <p className="text-sm text-gray-700">{clause.control_title}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${getCoverageTypeStyle(clause.coverage_type)}`}>{clause.coverage_type}</span>
                      <ChevronDown className={`h-4 w-4 transform transition-transform ${expandedClauses.has(idx) ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {expandedClauses.has(idx) && (
                    <div className="border-t border-gray-200 bg-gray-50 p-3">
                      <p className="text-sm text-gray-600">Clause: {clause.clause_reference}</p>
                      <p className="text-sm italic text-gray-600">{clause.matching_rationale}</p>
                      <p className="text-sm text-gray-600">Confidence: {clause.confidence}%</p>
                      <div className="mt-2 flex items-center justify-between">
                        <button
                          onClick={() => { setLinkingClauseIndex(idx); onLinkFromAI(clause); }}
                          disabled={isLinkingPending || isClauseLinked(clause)}
                          className={`rounded-lg px-3 py-1 text-sm font-medium ${
                            isClauseLinked(clause)
                              ? 'bg-gray-200 text-gray-500'
                              : 'bg-primary-600 text-white hover:bg-primary-700'
                          }`}
                        >
                          {isClauseLinked(clause)
                            ? 'Linked'
                            : linkingClauseIndex === idx && isLinkingPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : 'Link to Requirement'}
                        </button>
                        {linkFeedback && linkingClauseIndex === idx && (
                          <p className={`text-xs ${linkFeedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                            {linkFeedback.message}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-gray-200/30 flex items-center gap-6 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-blue-600" />
            <span className="font-medium text-gray-700">{(assessment?.compliance_frameworks || (data as AIAssessment)?.gap_analysis?.compliance_frameworks)?.length || 0}</span> frameworks detected
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-400" />
            <span className="font-medium text-gray-700">{controlsData?.total_mappings || 0}</span> controls linked
          </span>
          <span className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-green-400" />
            <span className="font-medium text-gray-700">{assetsData?.total || 0}</span> assets associated
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-lg bg-gray-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-medium text-black">
            <Shield className="h-4 w-4 text-blue-400" />
            Detected Controls
          </h4>
          {(assessment?.detected_controls || (data as AIAssessment)?.gap_analysis?.detected_controls)?.length ? (
            <ul className="space-y-1">
              {((assessment?.detected_controls || (data as AIAssessment)?.gap_analysis?.detected_controls) || []).map((control, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-green-400" />
                  {control}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No controls detected</p>
          )}
        </div>

        <div className="rounded-lg bg-gray-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-medium text-black">
            <AlertTriangle className="h-4 w-4 text-yellow-400" />
            Compliance Gaps
          </h4>
          {(assessment?.compliance_gaps || (data as AIAssessment)?.gap_analysis?.gaps)?.length ? (
            <ul className="space-y-1">
              {((assessment?.compliance_gaps || (data as AIAssessment)?.gap_analysis?.gaps) || []).map((gap, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
                  {gap}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No gaps identified</p>
          )}
        </div>

        <div className="rounded-lg bg-gray-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-medium text-black">
            <Info className="h-4 w-4 text-blue-600" />
            Recommendations
          </h4>
          {(assessment?.recommendations || (data as AIAssessment)?.gap_analysis?.recommendations)?.length ? (
            <ul className="space-y-1">
              {((assessment?.recommendations || (data as AIAssessment)?.gap_analysis?.recommendations) || []).map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-blue-600" />
                  {rec}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-500">No recommendations</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlsTab({ 
  controlsData,
  usageData,
  onUnlink,
  isUnlinking,
  onOpenLinkModal
}: { 
  controlsData?: ControlsResponse;
  usageData?: AllLinksResponse;
  onUnlink: (mappingId: number) => void;
  isUnlinking: boolean;
  onOpenLinkModal: () => void;
}) {
  if (!controlsData) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const totalControls = controlsData.total_mappings;
  const assessmentUsageTotal = usageData?.assessments?.total ?? 0;
  const assessmentUsageLinks = usageData?.assessments?.links ?? [];
  const totalUsage = usageData
    ? assessmentUsageTotal +
      usageData.assets.total +
      usageData.risks.total +
      usageData.incidents.total +
      usageData.policy_statements.total
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-black">
          <Shield className="h-5 w-5 text-blue-600" />
          Linked Controls ({totalControls})
        </h3>
        <button
          onClick={onOpenLinkModal}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Link Control
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div>
          {totalControls === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-gray-50 py-12 text-center">
              <Shield className="mb-4 h-12 w-12 text-gray-400" />
              <p className="text-lg font-medium text-black">No Linked Controls</p>
              <p className="text-gray-600">Link this evidence to compliance controls</p>
            </div>
          ) : (
            <div className="space-y-4">
              {controlsData.normalized_controls.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-medium text-gray-600">Normalized Controls</h4>
                  <div className="space-y-2">
                    {controlsData.normalized_controls.map((mapping) => (
                      <div key={mapping.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                        <div className="flex items-center gap-3">
                          <ShieldCheck className="h-5 w-5 text-blue-600" />
                          <div>
                            <span className="text-sm font-medium text-blue-600">{mapping.normalized_control?.code}</span>
                            <p className="text-black">{mapping.normalized_control?.name}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => onUnlink(mapping.id)}
                          disabled={isUnlinking}
                          className="rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {controlsData.by_framework.map((framework) => (
                <div key={framework.framework_id}>
                  <h4 className="mb-3 text-sm font-medium text-gray-600">
                    {framework.framework_name} ({framework.framework_code})
                  </h4>
                  <div className="space-y-2">
                    {framework.controls.map((mapping) => (
                      <div key={mapping.id} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                        <div className="flex items-center gap-3">
                          <Shield className="h-5 w-5 text-blue-400" />
                          <div>
                            <span className="text-sm font-medium text-blue-400">
                              {mapping.framework_control?.code || mapping.parsed_control?.control_id}
                            </span>
                            <p className="text-black">
                              {mapping.framework_control?.name || mapping.parsed_control?.title}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => onUnlink(mapping.id)}
                          disabled={isUnlinking}
                          className="rounded p-2 text-gray-600 hover:bg-gray-100 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Link2 className="h-4 w-4 text-blue-600" />
            Linked In ({totalUsage})
          </h4>
          {!usageData ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Assessments</span>
                <span className="font-medium text-black">{assessmentUsageTotal}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Assets</span>
                <span className="font-medium text-black">{usageData.assets.total}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Risks</span>
                <span className="font-medium text-black">{usageData.risks.total}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Incidents</span>
                <span className="font-medium text-black">{usageData.incidents.total}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-gray-700">
                <span>Policy Statements</span>
                <span className="font-medium text-black">{usageData.policy_statements.total}</span>
              </div>

              {assessmentUsageLinks.length > 0 && (
                <div className="pt-2 border-t border-gray-200">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Assessment Usage</p>
                  <div className="space-y-1.5">
                    {assessmentUsageLinks.slice(0, 5).map((link) => (
                      <Link
                        key={link.id}
                        href={link.assessment_id ? `/compliance/assessments/${link.assessment_id}` : '#'}
                        className={`block rounded bg-white px-2 py-1.5 text-xs ${link.assessment_id ? 'text-blue-600 hover:text-blue-700' : 'text-gray-600'}`}
                      >
                        {link.assessment_name || `Assessment Item #${link.assessment_item_id}`}
                        {link.item_number ? ` • Item ${link.item_number}` : ''}
                      </Link>
                    ))}
                    {assessmentUsageLinks.length > 5 && (
                      <p className="text-xs text-gray-500">+{assessmentUsageLinks.length - 5} more assessment links</p>
                    )}
                  </div>
                </div>
              )}

              {totalUsage === 0 && (
                <p className="text-sm text-gray-500">This evidence is not linked to other modules yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CrossLinksTab({ 
  links,
  onUnlinkRisk,
  onUnlinkAsset,
  onUnlinkIncident,
  onUnlinkPolicy,
  isUnlinking,
  onOpenRiskModal,
  onOpenAssetModal,
  onOpenIncidentModal,
  onOpenPolicyModal
}: { 
  links?: AllLinksResponse;
  onUnlinkRisk: (linkId: number) => void;
  onUnlinkAsset: (linkId: number) => void;
  onUnlinkIncident: (linkId: number) => void;
  onUnlinkPolicy: (linkId: number) => void;
  isUnlinking: boolean;
  onOpenRiskModal: () => void;
  onOpenAssetModal: () => void;
  onOpenIncidentModal: () => void;
  onOpenPolicyModal: () => void;
}) {
  if (!links) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const LinkSection = ({ 
    title, 
    icon: Icon, 
    iconColor,
    count,
    children,
    addButton
  }: { 
    title: string; 
    icon: typeof AlertTriangle;
    iconColor: string;
    count: number;
    children: React.ReactNode;
    addButton?: React.ReactNode;
  }) => (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 font-medium text-black">
          <Icon className={`h-5 w-5 ${iconColor}`} />
          {title} ({count})
        </h4>
        {addButton}
      </div>
      {children}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-black">
          <Link2 className="h-5 w-5 text-blue-600" />
          Cross-Module Links ({links.total_links})
        </h3>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <LinkSection 
          title="Linked Risks" 
          icon={AlertTriangle} 
          iconColor="text-red-400"
          count={links.risks.total}
          addButton={
            <button
              onClick={onOpenRiskModal}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          }
        >
          {links.risks.links.length > 0 ? (
            <div className="space-y-2">
              {links.risks.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <Link href={`/risks/${link.risk_id}`} className="text-sm text-black hover:text-blue-600">
                      {link.risk?.title || `Risk #${link.risk_id}`}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/risks/${link.risk_id}`} className="text-gray-600 hover:text-black">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => onUnlinkRisk(link.id)}
                      disabled={isUnlinking}
                      className="text-gray-600 hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No linked risks</p>
          )}
        </LinkSection>

        <LinkSection 
          title="Linked Assets" 
          icon={Building2} 
          iconColor="text-blue-400"
          count={links.assets.total}
          addButton={
            <button
              onClick={onOpenAssetModal}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          }
        >
          {links.assets.links.length > 0 ? (
            <div className="space-y-2">
              {links.assets.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-blue-400" />
                    <Link href={`/assets/${link.asset_id}`} className="text-sm text-black hover:text-blue-600">
                      {link.asset?.name || `Asset #${link.asset_id}`}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/assets/${link.asset_id}`} className="text-gray-600 hover:text-black">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => onUnlinkAsset(link.id)}
                      disabled={isUnlinking}
                      className="text-gray-600 hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No linked assets</p>
          )}
        </LinkSection>

        <LinkSection 
          title="Linked Incidents" 
          icon={AlertCircle} 
          iconColor="text-orange-400"
          count={links.incidents.total}
          addButton={
            <button
              onClick={onOpenIncidentModal}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          }
        >
          {links.incidents.links.length > 0 ? (
            <div className="space-y-2">
              {links.incidents.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-400" />
                    <span className="text-sm text-black">
                      {link.incident?.title || `Incident #${link.incident_id}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {link.incident && (
                      <span className={`rounded px-2 py-0.5 text-xs ${
                        link.incident.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                        link.incident.severity === 'high' ? 'bg-orange-500/20 text-orange-400' :
                        link.incident.severity === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-green-500/20 text-green-400'
                      }`}>
                        {link.incident.severity}
                      </span>
                    )}
                    <button
                      onClick={() => onUnlinkIncident(link.id)}
                      disabled={isUnlinking}
                      className="text-gray-600 hover:text-red-400"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No linked incidents</p>
          )}
        </LinkSection>

        <LinkSection 
          title="Policy Statements" 
          icon={FileText} 
          iconColor="text-purple-400"
          count={links.policy_statements.total}
          addButton={
            <button
              onClick={onOpenPolicyModal}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" /> Add
            </button>
          }
        >
          {links.policy_statements.links.length > 0 ? (
            <div className="space-y-2">
              {links.policy_statements.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-purple-400" />
                    <div>
                      <span className="text-xs text-purple-500">{link.policy_statement?.statement_code}</span>
                      <p className="text-sm text-black">{link.policy_statement?.statement_summary || 'Policy Statement'}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onUnlinkPolicy(link.id)}
                    disabled={isUnlinking}
                    className="text-gray-600 hover:text-red-400"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No linked policy statements</p>
          )}
        </LinkSection>
      </div>
    </div>
  );
}
