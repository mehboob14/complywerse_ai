'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { InlineLinkPicker, PageLoader } from '@/components/ui';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import {
  ArrowLeft, Loader2, AlertCircle, FileCheck, Calendar, Clock,
  CheckCircle, FileText, Edit, ScanText, Brain, Link2,
  AlertTriangle, Eye, Trash2, Send, RefreshCw,
  History, FileSpreadsheet, Shield, Building2, Info, Image, Settings,
  ShieldCheck, ClipboardList, ExternalLink, Plus, X,
  ChevronDown, ChevronRight, Search, ChevronLeft
} from 'lucide-react';
import Link from 'next/link';
import EvidenceTimeline from './_EvidenceTimeline';
import AuditReadinessCard from './_AuditReadinessCard';
import ReviewerActionPanel from './_ReviewerActionPanel';
import EvidenceCrossMap from './_EvidenceCrossMap';

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
  policy_statements: { total: number; links: Array<{ id: number; policy_statement_id: number; link_type: string | null; policy_statement: { id: number; statement_code: string; statement_summary: string | null; status: string; document_id?: number | null; document_title?: string | null; document_code?: string | null; source_section?: string | null; source_page?: number | null } | null }> };
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
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Draft' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Review' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
  expired: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Expired' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Archived' },
};

const OCR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Pending' },
  processing: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Processing' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
  failed: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Failed' },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'N/A' },
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
  const [reviewAction, setReviewAction] = useState<'approve' | 'reject' | null>(null);
  const [rejectComments, setRejectComments] = useState('');
  const [ocrProcessMessage, setOcrProcessMessage] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(null);
  const [selectedControlId, setSelectedControlId] = useState<number | null>(null);
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [showIncidentModal, setShowIncidentModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [selectedRiskId, setSelectedRiskId] = useState<number | null>(null);
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<number | null>(null);
  const [selectedPolicyStatementId, setSelectedPolicyStatementId] = useState<number | null>(null);
  const [linkingClauseIndex, setLinkingClauseIndex] = useState<number | null>(null);
  const [linkFeedback, setLinkFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showQualityOverlay, setShowQualityOverlay] = useState(false);
  const [showOcrOverlay, setShowOcrOverlay] = useState(false);
  const [showDetailsOverlay, setShowDetailsOverlay] = useState(false);
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
    enabled: true,
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
    enabled: true,
    retry: false,
  });

  const { data: allLinks } = useQuery<AllLinksResponse>({
    queryKey: ['evidence-cross-links', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/cross-links/${evidenceId}/all-links`);
      return response.data;
    },
    enabled: true,
  });

  const { data: controlsData } = useQuery<ControlsResponse>({
    queryKey: ['evidence-controls', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/links/${evidenceId}/controls`);
      return response.data;
    },
    enabled: true,
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
    enabled: true,
  });

  const { data: risksList } = useQuery<Array<{ id: number; title: string }>>({
    queryKey: ['risks-list'],
    queryFn: async () => {
      const response = await apiClient.get('/risks');
      return response.data;
    },
    enabled: true,
  });

  const { data: assetsList } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['assets-list'],
    queryFn: async () => {
      const response = await apiClient.get('/assets');
      return response.data;
    },
    enabled: true,
  });

  const { data: incidentsList } = useQuery<Array<{ id: number; title: string; severity?: string | null }>>({
    queryKey: ['incidents-list'],
    queryFn: async () => {
      const response = await apiClient.get('/erm/incidents');
      return response.data;
    },
    enabled: true,
  });

  // The previous wiring fetched a flat `/compliance/statements` list which
  // doesn't exist in this backend. Instead we fetch governance documents
  // up-front; the picker drills into a doc to show its statements on demand.
  const { data: governanceDocsList } = useQuery<{
    documents: Array<{ id: number; title: string; document_code?: string | null; doc_type?: string | null }>;
  }>({
    queryKey: ['governance-documents-for-evidence-link'],
    queryFn: async () => {
      const response = await apiClient.get('/governance/documents', { params: { limit: 500 } });
      const data = response.data;
      // The backend returns either a list or a paginated envelope; normalise.
      const docs = Array.isArray(data) ? data : (data?.items || data?.documents || []);
      return { documents: docs };
    },
    enabled: true,
  });

  const { data: clauseMappings } = useQuery<ClauseMapping[]>({
    queryKey: ['evidence-clause-mappings', evidenceId],
    queryFn: async () => {
      const response = await apiClient.get(`/evidence-mgmt/ai/${evidenceId}/clause-mappings`);
      return response.data;
    },
    enabled: true,
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
    enabled: true,
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

  // Accepts an array so the new doc → statements picker can link many at
  // once. Single-pick callers can still hand it `[id]`.
  const linkPolicyMutation = useMutation({
    mutationFn: (statementIds: number[]) =>
      apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/policy-statements`, { statement_ids: statementIds }),
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
    if (score === null) return 'bg-slate-400';
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-amber-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-rose-500';
  };

  const getQualityScoreTextColor = (score: number | null) => {
    if (score === null) return 'text-slate-600';
    if (score >= 80) return 'text-emerald-600';
    if (score >= 60) return 'text-amber-600';
    if (score >= 40) return 'text-orange-600';
    return 'text-rose-600';
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
        <PageLoader size="md" />
      </div>
    );
  }

  if (error || !evidence) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-rose-600">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load evidence details</p>
        <Link href="/evidence" className="mt-4 text-primary-600 hover:underline">
          Back to Evidence Library
        </Link>
      </div>
    );
  }

  const daysRemaining = getDaysRemaining();
  const statusStyle = getStatusStyle(evidence.status);
  const ocrStatusStyle = getOCRStatusStyle(evidence.ocr_status);
  const TypeIcon = getTypeIcon(evidence.evidence_type);

  return (
    <div className="risk-workspace -m-4 space-y-4 lg:-m-5">
      <div className="border-b border-[var(--color-border)] px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined' && window.history.length > 1) {
                  router.back();
                } else {
                  router.push('/evidence');
                }
              }}
              className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              title="Go back"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <TypeIcon className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{evidence.name}</h1>
              <p className="text-xs text-slate-600">{evidence.description || 'No description'}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {evidence.evidence_type && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                {evidence.evidence_type.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
            )}
            <span className={`rounded-full ${statusStyle.bg} px-2.5 py-1 text-xs ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
            <button
              type="button"
              onClick={() => setShowDetailsOverlay(true)}
              className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
              title="Basic info & version history"
            >
              <Info className="h-3.5 w-3.5" />
              Details
            </button>
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
              className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
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
                className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
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
                className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
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

      {evidence.status === 'pending_review' && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-600" />
              <div>
                <p className="text-sm font-medium text-amber-700">This evidence is awaiting approval</p>
                <p className="text-xs text-slate-600">
                  Submitted by {evidence.uploader_name || 'Unknown'} on {formatDateTime(evidence.submitted_at)}
                </p>
              </div>
            </div>
            <Link
              href="/compliance/assessments/approvals"
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-sm text-slate-800 border border-amber-300 hover:bg-amber-100"
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
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">Edit Evidence</h2>
              <button onClick={() => setIsEditModalOpen(false)} className="text-slate-500 hover:text-slate-800">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Name</label>
                <input value={editForm.name} onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
                <textarea value={editForm.description} onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))} rows={3} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Evidence Type</label>
                  <select value={editForm.evidence_type} onChange={(e) => setEditForm((prev) => ({ ...prev, evidence_type: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none">
                    <option value="">Select type...</option>
                    {['screenshot','document','certificate','audit_report','log','policy','procedure','configuration','attestation','training_record','access_review','vulnerability_scan','penetration_test','backup_log','change_record','incident_report','other'].map((type) => (
                      <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Collection Date</label>
                  <input type="date" value={editForm.collection_date} onChange={(e) => setEditForm((prev) => ({ ...prev, collection_date: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Validity Days</label>
                  <input type="number" min="1" value={editForm.validity_period_days} onChange={(e) => setEditForm((prev) => ({ ...prev, validity_period_days: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Source System</label>
                  <input value={editForm.source_system} onChange={(e) => setEditForm((prev) => ({ ...prev, source_system: e.target.value }))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button onClick={() => setIsEditModalOpen(false)} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50">Cancel</button>
                <button onClick={() => updateEvidenceMutation.mutate()} disabled={updateEvidenceMutation.isPending || !editForm.name.trim()} className="rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 disabled:opacity-50">
                  {updateEvidenceMutation.isPending ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quality breakdown overlay — surfaces the AI sub-scores without leaving the page */}
      {showQualityOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowQualityOverlay(false)}>
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Brain className="h-4 w-4 text-primary-600" /> Quality breakdown</h3>
              <button onClick={() => setShowQualityOverlay(false)} className="text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5">
              {evidence.quality_score !== null ? (
                <>
                  <div className="mb-4 flex items-center gap-4">
                    <div className={`text-4xl font-bold ${getQualityScoreTextColor(evidence.quality_score)}`}>{Math.round(evidence.quality_score)}%</div>
                    <div className="flex-1">
                      <div className="h-2 w-full rounded-full bg-slate-200"><div className={`h-2 rounded-full ${getQualityScoreColor(evidence.quality_score)}`} style={{ width: `${evidence.quality_score}%` }} /></div>
                      <p className="mt-1 text-xs text-slate-500">Overall quality score</p>
                    </div>
                  </div>
                  {evidence.latest_assessment ? (
                    <div className="space-y-3">
                      {([
                        { label: 'Relevance', v: evidence.latest_assessment.relevance_score },
                        { label: 'Adequacy', v: evidence.latest_assessment.adequacy_score },
                        { label: 'Confidence', v: evidence.latest_assessment.confidence_score },
                        { label: 'Audit readiness', v: evidence.latest_assessment.audit_readiness },
                      ]).map(({ label, v }) => {
                        const pct = v == null ? null : v <= 1 ? Math.round(v * 100) : Math.round(v);
                        return (
                          <div key={label}>
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="text-slate-600">{label}</span>
                              <span className="font-medium text-slate-800">{pct == null ? '—' : `${pct}%`}</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${pct ?? 0}%` }} /></div>
                          </div>
                        );
                      })}
                      {evidence.latest_assessment.content_summary && (
                        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><span className="font-medium text-slate-700">Summary: </span>{evidence.latest_assessment.content_summary}</div>
                      )}
                      <p className="mt-2 text-[11px] text-slate-400">Assessed {formatDateTime(evidence.latest_assessment.assessed_at)}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">Detailed sub-scores aren&apos;t available — run an AI assessment for the full breakdown.</p>
                  )}
                </>
              ) : (
                <div className="py-6 text-center">
                  <Brain className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">No quality score yet.</p>
                  <button
                    onClick={() => { setShowQualityOverlay(false); runAssessmentMutation.mutate(); }}
                    disabled={runAssessmentMutation.isPending || evidence.ocr_status !== 'completed'}
                    className="btn-primary btn-sm mt-3 inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Brain className="h-3.5 w-3.5" /> Run assessment
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* OCR content overlay */}
      {showOcrOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowOcrOverlay(false)}>
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ScanText className="h-4 w-4 text-primary-600" /> OCR content</h3>
              <div className="flex items-center gap-2">
                <span className={`rounded-full ${ocrStatusStyle.bg} px-2 py-0.5 text-xs ${ocrStatusStyle.text}`}>{ocrStatusStyle.label}</span>
                <button onClick={() => setShowOcrOverlay(false)} className="text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {evidence.ocr_processed_at && <p className="mb-3 text-xs text-slate-500">Processed {formatDateTime(evidence.ocr_processed_at)}</p>}
              {ocrProcessMessage && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">{ocrProcessMessage}</p>}
              {ocrContent?.ocr_content ? (
                <pre className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">{ocrContent.ocr_content}</pre>
              ) : evidence.ocr_status === 'completed' ? (
                <p className="text-sm text-slate-500">No text was extracted from this file.</p>
              ) : (
                <div className="py-6 text-center">
                  <ScanText className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                  <p className="text-sm text-slate-500">OCR {ocrStatusStyle.label.toLowerCase()}.</p>
                  {evidence.ocr_status !== 'completed' && evidence.ocr_status !== 'not_applicable' && (
                    <button
                      onClick={() => processOCRMutation.mutate()}
                      disabled={processOCRMutation.isPending}
                      className="btn-primary btn-sm mt-3 inline-flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {processOCRMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanText className="h-3.5 w-3.5" />} Process OCR
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <button
                onClick={() => processOCRMutation.mutate()}
                disabled={processOCRMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {processOCRMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Re-process OCR
              </button>
            </div>
          </div>
        </div>
      )}

      {showDetailsOverlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDetailsOverlay(false)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Info className="h-4 w-4 text-primary-600" /> Details</h3>
              <button onClick={() => setShowDetailsOverlay(false)} className="text-slate-400 hover:text-slate-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <OverviewTab evidence={evidence} formatDate={formatDate} formatDateTime={formatDateTime} />
            </div>
          </div>
        </div>
      )}

      {/* D1 split: pinned left context column + scrolling right work column.
          All sub-components (Assessment/Controls/CrossLinks/RecommendTargets)
          are reused unchanged — only their placement changed. */}
      <div className="mx-4 grid grid-cols-1 gap-4 pb-4 sm:mx-6 lg:grid-cols-12">
        {/* ── LEFT: context stays on screen ───────────────────────────── */}
        <div className="lg:col-span-5">
          <div className="space-y-3 lg:sticky lg:top-4">
            {/* Quality — click for the score breakdown overlay */}
            <button
              type="button"
              onClick={() => setShowQualityOverlay(true)}
              className="group w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-primary-300 hover:bg-slate-50"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Brain className="h-3.5 w-3.5" /> Quality Score</div>
              {evidence.quality_score !== null ? (
                <>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={`text-2xl font-bold ${getQualityScoreTextColor(evidence.quality_score)}`}>{Math.round(evidence.quality_score)}%</span>
                    <span className="text-[11px] text-primary-600 group-hover:underline">breakdown →</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200">
                    <div className={`h-1.5 rounded-full ${getQualityScoreColor(evidence.quality_score)}`} style={{ width: `${evidence.quality_score}%` }} />
                  </div>
                </>
              ) : (
                <div className="mt-1 text-sm text-slate-400">Not assessed yet</div>
              )}
            </button>

            {/* OCR — click for the extracted-text overlay */}
            <button
              type="button"
              onClick={() => setShowOcrOverlay(true)}
              className="group w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-primary-300 hover:bg-slate-50"
            >
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><ScanText className="h-3.5 w-3.5" /> OCR</div>
              <div className="mt-1 flex items-center gap-2">
                <span className={`rounded-full ${ocrStatusStyle.bg} px-2 py-0.5 text-xs ${ocrStatusStyle.text}`}>{ocrStatusStyle.label}</span>
                <span className="text-[11px] text-primary-600 group-hover:underline">view →</span>
              </div>
              <p className="mt-1 truncate text-[11px] text-slate-400">{evidence.ocr_processed_at ? `Processed ${formatDateTime(evidence.ocr_processed_at)}` : 'Not processed'}</p>
            </button>

            {/* Validity */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><Calendar className="h-3.5 w-3.5" /> Validity</div>
              {(evidence.collection_date || evidence.expiry_date) ? (
                <>
                  <p className="mt-1 text-sm text-slate-800">{formatDate(evidence.collection_date)} → {formatDate(evidence.expiry_date)}</p>
                  {daysRemaining !== null && (
                    <p className={`mt-0.5 text-[11px] ${daysRemaining <= 0 ? 'text-rose-600' : daysRemaining <= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days remaining`}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-sm text-slate-400">Not set</p>
              )}
            </div>

            {/* File — compact card with name + Open file (reuses EvidenceViewer) */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500"><FileText className="h-3.5 w-3.5" /> File</div>
              <p className="mt-1 truncate text-sm text-slate-800" title={evidence.file_name || ''}>{evidence.file_name || 'No file'}</p>
              <p className="text-[11px] text-slate-400">{evidence.file_type || 'Unknown'} · v{evidence.version}</p>
              {evidence.file_path && (
                <button
                  onClick={() => setShowFilePreview(true)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  title="Open file"
                >
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> Open file
                </button>
              )}
            </div>

            {/* Lifecycle timeline — derived client-side from evidence fields */}
            <EvidenceTimeline evidence={evidence} fmtDateTime={formatDateTime} />
          </div>
        </div>

        {/* ── RIGHT: scrolling work column ────────────────────────────── */}
        <div className="space-y-4 lg:col-span-7">
          {/* Linkage snapshot — at-a-glance relationship counts (was spread across tabs) */}
          <div className="cw-card flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl px-4 py-3 text-sm text-slate-500">
            <span className="flex items-center gap-1.5 font-medium text-slate-700">
              <Link2 className="h-4 w-4 text-primary-600" /> Linkage
            </span>
            <span className="text-slate-300">·</span>
            <span><span className="font-semibold text-slate-900">{controlsData?.total_mappings ?? 0}</span> Controls</span>
            <span className="text-slate-300">·</span>
            <span><span className="font-semibold text-slate-900">{controlsData?.by_framework?.length ?? 0}</span> Frameworks</span>
            <span className="text-slate-300">·</span>
            <span><span className="font-semibold text-slate-900">{allLinks?.risks?.total ?? 0}</span> Risks</span>
            <span className="text-slate-300">·</span>
            <span><span className="font-semibold text-slate-900">{allLinks?.assets?.total ?? 0}</span> Assets</span>
            <span className="text-slate-300">·</span>
            <span><span className="font-semibold text-slate-900">{allLinks?.incidents?.total ?? 0}</span> Incidents</span>
            <span className="text-slate-300">·</span>
            <span><span className="font-semibold text-slate-900">{allLinks?.policy_statements?.total ?? 0}</span> Policy Statements</span>
            <span className="ml-auto inline-flex items-center rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">
              {allLinks?.total_links ?? 0} total links
            </span>
          </div>

          {/* AI Assessment — reused unchanged; Applicable Frameworks surfaced at the top */}
          <div className="cw-card rounded-xl p-4 sm:p-5">
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
            <div className="mt-6 border-t border-slate-100 pt-6">
              <RecommendTargetsPanel evidenceId={evidenceId} />
            </div>
          </div>

          {/* D4 — Audit readiness (score + satisfies-for-audit clauses) */}
          <AuditReadinessCard
            auditReadiness={latestAssessment?.audit_readiness ?? evidence.latest_assessment?.audit_readiness ?? null}
            summary={latestAssessment?.content_summary ?? evidence.latest_assessment?.content_summary ?? null}
            clauseMappings={latestAssessment?.clause_mappings ?? clauseMappings}
          />

          {/* D4 — Reviewer decision (surfaces the existing reviewMutation) */}
          {canEdit && evidence.status === 'pending_review' && (
            <ReviewerActionPanel
              note={rejectComments}
              onNoteChange={setRejectComments}
              onApprove={() => reviewMutation.mutate({ action: 'approve', comments: rejectComments || undefined })}
              onReject={() => reviewMutation.mutate({ action: 'reject', comments: rejectComments || undefined })}
              isPending={reviewMutation.isPending}
            />
          )}

          {/* Linked Controls — reused unchanged */}
          <div id="linked-controls" className="cw-card scroll-mt-4 rounded-xl p-4 sm:p-5">
            <ControlsTab
              evidenceId={evidenceId}
              controlsData={controlsData}
              usageData={allLinks}
              onUnlink={(mappingId) => unlinkControlMutation.mutate(mappingId)}
              isUnlinking={unlinkControlMutation.isPending}
              onOpenLinkModal={() => setShowLinkModal(true)}
              availableControls={availableControls}
              onLinkControl={(fwId, ctrlId) => {
                setSelectedFrameworkId(fwId);
                setSelectedControlId(ctrlId);
                // Trigger via a small async hop so state updates land before mutate runs.
                setTimeout(() => linkControlMutation.mutate(), 0);
              }}
              isLinkingControl={linkControlMutation.isPending}
            />
          </div>

          {/* D5 — Cross-module map: compact chip summary + full CrossLinks detail */}
          <EvidenceCrossMap
            controls={controlsData?.total_mappings ?? 0}
            risks={allLinks?.risks?.total ?? 0}
            assets={allLinks?.assets?.total ?? 0}
            incidents={allLinks?.incidents?.total ?? 0}
            policyStatements={allLinks?.policy_statements?.total ?? 0}
          />

          <div id="cross-module" className="cw-card scroll-mt-4 rounded-xl p-4 sm:p-5">
            <CrossLinksTab
              links={allLinks}
              evidenceId={evidenceId}
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
              risksList={risksList}
              assetsList={assetsList}
              incidentsList={incidentsList}
              governanceDocsList={governanceDocsList}
              onLinkRisk={(id) => {
                setSelectedRiskId(id);
                setTimeout(() => linkRiskMutation.mutate(), 0);
              }}
              onLinkAsset={(id) => {
                setSelectedAssetId(id);
                setTimeout(() => linkAssetMutation.mutate(), 0);
              }}
              onLinkIncident={(id) => {
                setSelectedIncidentId(id);
                setTimeout(() => linkIncidentMutation.mutate(), 0);
              }}
              onLinkPolicies={(ids) => linkPolicyMutation.mutate(ids)}
              isLinkingRisk={linkRiskMutation.isPending}
              isLinkingAsset={linkAssetMutation.isPending}
              isLinkingIncident={linkIncidentMutation.isPending}
              isLinkingPolicy={linkPolicyMutation.isPending}
            />
          </div>
        </div>
      </div>
        {showLinkModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-lg">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-800">Link Control</h3>
                <button onClick={() => setShowLinkModal(false)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-slate-700">Framework</label>
                    <select
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
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
                    <label className="text-sm font-medium text-slate-700">Control</label>
                    <select
                      className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
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
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
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
                <h3 className="text-lg font-semibold text-slate-800">Link Risk</h3>
                <button onClick={() => setShowRiskModal(false)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                value={selectedRiskId ?? ''}
                onChange={(e) => setSelectedRiskId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select risk</option>
                {risksList?.map((risk) => (
                  <option key={risk.id} value={risk.id}>{risk.title || `Risk #${risk.id}`}</option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowRiskModal(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
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
                <h3 className="text-lg font-semibold text-slate-800">Link Asset</h3>
                <button onClick={() => setShowAssetModal(false)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
                value={selectedAssetId ?? ''}
                onChange={(e) => setSelectedAssetId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select asset</option>
                {assetsList?.map((asset) => (
                  <option key={asset.id} value={asset.id}>{asset.name || `Asset #${asset.id}`}</option>
                ))}
              </select>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowAssetModal(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
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
                <h3 className="text-lg font-semibold text-slate-800">Link Incident</h3>
                <button onClick={() => setShowIncidentModal(false)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <select
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm"
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
                <button onClick={() => setShowIncidentModal(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
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
                <h3 className="text-lg font-semibold text-slate-800">Link Policy Statement</h3>
                <button onClick={() => setShowPolicyModal(false)} className="text-slate-500 hover:text-slate-800"><X className="h-5 w-5" /></button>
              </div>
              <p className="mb-3 text-sm text-slate-600">
                Use the inline picker on the Cross-links tab to choose a document and pick statements.
              </p>
              <div className="mt-4 flex justify-end gap-3">
                <button onClick={() => setShowPolicyModal(false)} className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Close</button>
                <button
                  onClick={() => selectedPolicyStatementId && linkPolicyMutation.mutate([selectedPolicyStatementId])}
                  disabled={!selectedPolicyStatementId || linkPolicyMutation.isPending}
                  className="rounded bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {linkPolicyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Link Statement'}
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Shared in-browser preview of the uploaded file. The viewer
          fetches via the auth'd axios client so /api/uploads/... gets
          the right headers, then routes to per-type renderers (image,
          PDF, xlsx/csv, markdown, text) or degrades to a download CTA
          for non-previewable formats. */}
      <EvidenceViewer
        evidence={showFilePreview && evidence?.file_path ? {
          evidence_id: evidence.id,
          file_path: evidence.file_path,
          file_name: evidence.file_name || 'evidence',
          mime_type: evidence.file_type,
        } : null}
        onClose={() => setShowFilePreview(false)}
      />
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
          <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-800">
            <Info className="h-5 w-5 text-primary-600" />
            Basic Information
          </h3>
          <div className="space-y-3 rounded-lg bg-slate-50 p-4">
            <div>
              <span className="text-sm text-slate-600">Description</span>
              <p className="text-slate-800">{evidence.description || 'No description provided'}</p>
            </div>
            <div>
              <span className="text-sm text-slate-600">Source System</span>
              <p className="text-slate-800">{evidence.source_system || 'Not specified'}</p>
            </div>
            <div>
              <span className="text-sm text-slate-600">Uploaded By</span>
              <p className="text-slate-800">{evidence.uploader_name || 'Unknown'}</p>
            </div>
            <div>
              <span className="text-sm text-slate-600">Uploaded At</span>
              <p className="text-slate-800">{formatDateTime(evidence.uploaded_at)}</p>
            </div>
            {evidence.content_summary && (
              <div>
                <span className="text-sm text-slate-600">Content Summary</span>
                <p className="text-slate-800">{evidence.content_summary}</p>
              </div>
            )}
          </div>
        </div>

        {evidence.review_comments && (
          <div>
            <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-800">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              Review Comments
            </h3>
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="text-amber-800">{evidence.review_comments}</p>
              {evidence.reviewed_at && (
                <p className="mt-2 text-xs text-slate-600">Reviewed on {formatDateTime(evidence.reviewed_at)}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-800">
          <History className="h-5 w-5 text-primary-600" />
          Version History
        </h3>
        {evidence.versions && evidence.versions.length > 0 ? (
          <div className="space-y-2">
            {evidence.versions.map((version) => (
              <div key={version.id} className="rounded-lg bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-800">Version {version.version_number}</span>
                  <span className="text-sm text-slate-600">{formatDateTime(version.created_at)}</span>
                </div>
                {version.changes && (
                  <p className="mt-1 text-sm text-slate-600">{version.changes}</p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg bg-slate-50 p-4 text-center text-slate-600">
            <History className="mx-auto mb-2 h-8 w-8 text-slate-400" />
            <p>No version history available</p>
          </div>
        )}
      </div>
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
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'partial':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'minimal':
        return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'none':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-100 text-slate-600 border-slate-300';
    }
  };

  if (!assessment && !evidence.latest_assessment) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Brain className="mb-4 h-12 w-12 text-slate-400" />
        <p className="text-lg font-medium text-slate-800">No AI Assessment Yet</p>
        <p className="text-slate-600">
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

  // Applicable frameworks — one clean, deduped, human-readable set merged from the
  // most reliable sources first: (1) frameworks of actually-linked controls,
  // (2) DB-verified AI clause suggestions, (3) the raw AI free-text list (stripped
  // of its ':clause' suffix). This replaces the noisy/often-empty AI-string list as
  // the primary signal auditors care about.
  const linkedFrameworkNames = new Set(
    (controlsData?.by_framework || []).map((f) => f.framework_name).filter(Boolean)
  );
  const applicableFrameworks = Array.from(
    new Set(
      [
        ...(controlsData?.by_framework || []).map((f) => f.framework_name),
        ...(clauseMappings || []).map((c) => c.framework_name),
        ...(((assessment?.compliance_frameworks || (data as AIAssessment)?.gap_analysis?.compliance_frameworks) || []).map(
          (s) => (s || '').split(':')[0].trim()
        )),
      ].filter(Boolean)
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          <Brain className="h-5 w-5 text-primary-600" />
          AI Quality Assessment
        </h3>
        <div className="flex items-center gap-3">
          {assessment?.assessed_at && (
            <span className="text-sm text-slate-600">
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


      <div className="space-y-4 rounded-lg bg-slate-50 p-4">
        <h4 className="font-medium text-slate-800">Content Summary</h4>
        <p className="text-slate-700">{data.content_summary || 'No summary available'}</p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
          <ShieldCheck className="h-5 w-5 text-primary-600" />
          Applicable Compliance Frameworks
        </h4>
        <p className="mb-3 text-xs text-slate-600">This evidence can be used to demonstrate compliance with the following requirements:</p>

        {/* Primary, clean applicable-frameworks set — the most useful at-a-glance signal */}
        <div className="mb-4">
          {applicableFrameworks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {applicableFrameworks.map((name) => {
                const linked = linkedFrameworkNames.has(name);
                const count = controlsData?.by_framework?.find((f) => f.framework_name === name)?.controls.length;
                return (
                  <span
                    key={name}
                    className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700"
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {name}
                    {typeof count === 'number' && count > 0 && (
                      <span className="text-[11px] font-normal text-slate-500">{count} control{count === 1 ? '' : 's'}</span>
                    )}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                        linked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {linked ? 'Linked' : 'Suggested'}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
              <ShieldCheck className="h-4 w-4 text-slate-400" />
              Run the AI assessment or link a control to identify applicable frameworks.
            </div>
          )}
        </div>

        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">Coverage breakdown</p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="pb-3 pr-4 font-medium text-slate-700 w-1/3">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-primary-600" />
                    AI-Detected Frameworks
                  </div>
                </th>
                <th className="pb-3 px-4 font-medium text-slate-700 w-1/3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4 text-primary-600" />
                    Linked Controls
                  </div>
                </th>
                <th className="pb-3 pl-4 font-medium text-slate-700 w-1/3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-emerald-600" />
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
                          <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-sm font-medium text-primary-700 border border-primary-200">
                            <Shield className="h-3 w-3" />
                            {framework}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500 text-sm">Run AI assessment to identify</span>
                    );
                  })()}
                </td>
                <td className="py-3 px-4 align-top border-l border-slate-100">
                  {controlsData?.by_framework && controlsData.by_framework.length > 0 ? (
                    <div className="space-y-3">
                      {controlsData.by_framework.map((framework) => (
                        <div key={framework.framework_id}>
                          <div className="text-xs font-medium text-slate-600 mb-1.5">{framework.framework_name}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {framework.controls.slice(0, 5).map((mapping) => (
                              <Link 
                                key={mapping.id}
                                href={`/frameworks`}
                                className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700 border border-primary-200 hover:bg-primary-100 transition-colors"
                              >
                                <ShieldCheck className="h-2.5 w-2.5" />
                                {mapping.framework_control?.code}
                              </Link>
                            ))}
                            {framework.controls.length > 5 && (
                              <span className="text-xs text-slate-500">+{framework.controls.length - 5} more</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-500 text-sm">No linked controls</span>
                  )}
                </td>
                <td className="py-3 pl-4 align-top border-l border-slate-100">
                  {assetsData?.links && assetsData.links.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {assetsData.links.slice(0, 6).map((link) => (
                        link.asset && (
                          <Link 
                            key={link.id}
                            href={`/assets/${link.asset_id}`}
                            className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors"
                          >
                            <Building2 className="h-3 w-3" />
                            {link.asset.name}
                          </Link>
                        )
                      ))}
                      {assetsData.links.length > 6 && (
                        <span className="text-xs text-slate-500 self-center">+{assetsData.links.length - 6} more</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-slate-500 text-sm">No linked assets</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {clauseMappings && clauseMappings.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h4 className="mb-3 font-medium text-slate-800">AI Suggested Clause Mappings</h4>
            <p className="text-sm text-slate-600 mb-2">Click "Link to Requirement" to create actual links.</p>
            <ul className="space-y-2">
              {clauseMappings.map((clause, idx) => (
                <li key={idx} className="rounded-lg border border-slate-200">
                  <div
                    className="flex items-center justify-between p-3 cursor-pointer"
                    onClick={() => toggleClause(idx)}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{clause.framework_name}</span>
                        <span className="text-sm text-slate-500">{clause.control_id}</span>
                      </div>
                      <p className="text-sm text-slate-700">{clause.control_title}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${getCoverageTypeStyle(clause.coverage_type)}`}>{clause.coverage_type}</span>
                      <ChevronDown className={`h-4 w-4 transform transition-transform ${expandedClauses.has(idx) ? 'rotate-180' : ''}`} />
                    </div>
                  </div>
                  {expandedClauses.has(idx) && (
                    <div className="border-t border-slate-200 bg-slate-50 p-3">
                      <p className="text-sm text-slate-600">Clause: {clause.clause_reference}</p>
                      <p className="text-sm italic text-slate-600">{clause.matching_rationale}</p>
                      <p className="text-sm text-slate-600">Confidence: {clause.confidence}%</p>
                      <div className="mt-2 flex items-center justify-between">
                        <button
                          onClick={() => { setLinkingClauseIndex(idx); onLinkFromAI(clause); }}
                          disabled={isLinkingPending || isClauseLinked(clause)}
                          className={`rounded-lg px-3 py-1 text-sm font-medium ${
                            isClauseLinked(clause)
                              ? 'bg-slate-200 text-slate-500'
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
                          <p className={`text-xs ${linkFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
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

        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-6 text-xs text-slate-600">
          <span className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 text-primary-600" />
            <span className="font-medium text-slate-700">{(assessment?.compliance_frameworks || (data as AIAssessment)?.gap_analysis?.compliance_frameworks)?.length || 0}</span> frameworks detected
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary-600" />
            <span className="font-medium text-slate-700">{controlsData?.total_mappings || 0}</span> controls linked
          </span>
          <span className="flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5 text-emerald-600" />
            <span className="font-medium text-slate-700">{assetsData?.total || 0}</span> assets associated
          </span>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-lg bg-slate-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
            <Shield className="h-4 w-4 text-primary-600" />
            Detected Controls
          </h4>
          {(assessment?.detected_controls || (data as AIAssessment)?.gap_analysis?.detected_controls)?.length ? (
            <ul className="space-y-1">
              {((assessment?.detected_controls || (data as AIAssessment)?.gap_analysis?.detected_controls) || []).map((control, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckCircle className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                  {control}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No controls detected</p>
          )}
        </div>

        <div className="rounded-lg bg-slate-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            Compliance Gaps
          </h4>
          {(assessment?.compliance_gaps || (data as AIAssessment)?.gap_analysis?.gaps)?.length ? (
            <ul className="space-y-1">
              {((assessment?.compliance_gaps || (data as AIAssessment)?.gap_analysis?.gaps) || []).map((gap, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                  {gap}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No gaps identified</p>
          )}
        </div>

        <div className="rounded-lg bg-slate-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 font-medium text-slate-800">
            <Info className="h-4 w-4 text-primary-600" />
            Recommendations
          </h4>
          {(assessment?.recommendations || (data as AIAssessment)?.gap_analysis?.recommendations)?.length ? (
            <ul className="space-y-1">
              {((assessment?.recommendations || (data as AIAssessment)?.gap_analysis?.recommendations) || []).map((rec, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary-600" />
                  {rec}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No recommendations</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ControlsTab({
  evidenceId,
  controlsData,
  usageData,
  onUnlink,
  isUnlinking,
  onOpenLinkModal,
  availableControls,
  onLinkControl,
  isLinkingControl,
}: {
  evidenceId: number;
  controlsData?: ControlsResponse;
  usageData?: AllLinksResponse;
  onUnlink: (mappingId: number) => void;
  isUnlinking: boolean;
  onOpenLinkModal: () => void;
  availableControls?: { frameworks: Array<{ id: number; name: string; controls: Array<{ id: number; control_id: string; title: string }> }> };
  onLinkControl: (frameworkId: number, controlId: number) => void;
  isLinkingControl: boolean;
}) {
  if (!controlsData) {
    return (
      <div className="flex items-center justify-center py-8">
        <PageLoader size="md" />
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

  const flatControlItems = (availableControls?.frameworks || []).flatMap((fw) =>
    fw.controls.map((c) => ({
      value: `${fw.id}:${c.id}`,
      label: `${c.control_id} — ${c.title}`,
      subLabel: fw.name,
    }))
  );

  // Already-linked parsed-control ids, so AI suggestions hide what's linked.
  const linkedParsedControlIds = new Set<number>(
    (controlsData.by_framework || []).flatMap((fw) =>
      fw.controls
        .map((m) => m.parsed_control?.id)
        .filter((x): x is number => typeof x === 'number')
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-slate-800">
          <Shield className="h-5 w-5 text-primary-600" />
          Linked Controls ({totalControls})
        </h3>
        <InlineLinkPicker
          triggerLabel="Link Control"
          triggerClassName="flex items-center gap-2 rounded-lg bg-primary-600 px-3 sm:px-4 py-2 text-sm text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
          items={flatControlItems}
          isLoading={isLinkingControl}
          emptyText="No controls available"
          searchPlaceholder="Search controls or frameworks"
          popoverWidth={400}
          onSelect={(value) => {
            const [fwId, ctrlId] = value.split(':').map(Number);
            onLinkControl(fwId, ctrlId);
          }}
        />
      </div>

      <AiLinkRecommendations
        evidenceId={evidenceId}
        target="controls"
        linkedIds={linkedParsedControlIds}
        busy={isLinkingControl}
        onLinkRec={(r) => {
          if (r.meta?.framework_id) onLinkControl(r.meta.framework_id, r.id);
        }}
      />

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <div>
          {totalControls === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 py-8 text-center">
              <div className="mb-3 inline-flex rounded-lg bg-slate-100 p-2.5 text-slate-400">
                <Shield className="h-6 w-6" />
              </div>
              <p className="text-sm font-medium text-slate-900">No Linked Controls</p>
              <p className="mt-1 text-xs text-slate-500">Link this evidence to compliance controls</p>
            </div>
          ) : (
            <div className="space-y-4">
              {controlsData.normalized_controls.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-medium text-slate-600">Normalized Controls</h4>
                  <div className="space-y-2">
                    {controlsData.normalized_controls.map((mapping) => (
                      <div key={mapping.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center gap-3">
                          <ShieldCheck className="h-5 w-5 text-primary-600" />
                          <div>
                            <span className="text-sm font-medium text-primary-600">{mapping.normalized_control?.code}</span>
                            <p className="text-slate-800">{mapping.normalized_control?.name}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => onUnlink(mapping.id)}
                          disabled={isUnlinking}
                          className="rounded p-2 text-slate-600 hover:bg-slate-100 hover:text-rose-600"
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
                  <h4 className="mb-3 text-sm font-medium text-slate-600">
                    {framework.framework_name} ({framework.framework_code})
                  </h4>
                  <div className="space-y-2">
                    {framework.controls.map((mapping) => (
                      <div key={mapping.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
                        <div className="flex items-center gap-3">
                          <Shield className="h-5 w-5 text-primary-600" />
                          <div>
                            <span className="text-sm font-medium text-primary-600">
                              {mapping.framework_control?.code || mapping.parsed_control?.control_id}
                            </span>
                            <p className="text-slate-800">
                              {mapping.framework_control?.name || mapping.parsed_control?.title}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => onUnlink(mapping.id)}
                          disabled={isUnlinking}
                          className="rounded p-2 text-slate-600 hover:bg-slate-100 hover:text-rose-600"
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

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Link2 className="h-4 w-4 text-primary-600" />
            Linked In ({totalUsage})
          </h4>
          {!usageData ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Assessments</span>
                <span className="font-medium text-slate-800">{assessmentUsageTotal}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Assets</span>
                <span className="font-medium text-slate-800">{usageData.assets.total}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Risks</span>
                <span className="font-medium text-slate-800">{usageData.risks.total}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Incidents</span>
                <span className="font-medium text-slate-800">{usageData.incidents.total}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-slate-700">
                <span>Policy Statements</span>
                <span className="font-medium text-slate-800">{usageData.policy_statements.total}</span>
              </div>

              {assessmentUsageLinks.length > 0 && (
                <div className="pt-2 border-t border-slate-200">
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Assessment Usage</p>
                  <div className="space-y-1.5">
                    {assessmentUsageLinks.slice(0, 5).map((link) => (
                      <Link
                        key={link.id}
                        href={link.assessment_id ? `/compliance/assessments/${link.assessment_id}` : '#'}
                        className={`block rounded bg-white px-2 py-1.5 text-xs ${link.assessment_id ? 'text-primary-600 hover:text-primary-700' : 'text-slate-600'}`}
                      >
                        {link.assessment_name || `Assessment Item #${link.assessment_item_id}`}
                        {link.item_number ? ` • Item ${link.item_number}` : ''}
                      </Link>
                    ))}
                    {assessmentUsageLinks.length > 5 && (
                      <p className="text-xs text-slate-500">+{assessmentUsageLinks.length - 5} more assessment links</p>
                    )}
                  </div>
                </div>
              )}

              {totalUsage === 0 && (
                <p className="text-sm text-slate-500">This evidence is not linked to other modules yet.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AI link recommendations for one cross-module section ────────────────────
type AiLinkRec = {
  id: number;
  code?: string | null;
  title?: string | null;
  subtitle?: string | null;
  confidence?: number | null;
  coverage_type?: string | null;
  rationale?: string | null;
  link_source?: string | null;
  meta?: { framework_id?: number } | null;
};

function AiLinkRecommendations({
  evidenceId, target, onLink, onLinkRec, linkedIds, busy,
}: {
  evidenceId: number;
  target: 'risks' | 'assets' | 'incidents' | 'policy_statements' | 'controls';
  onLink?: (id: number) => void;
  onLinkRec?: (rec: AiLinkRec) => void;
  linkedIds: Set<number>;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const r = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-links`, null, { params: { target } });
      return r.data as { recommendations: AiLinkRec[]; ai_available: boolean; candidate_count: number };
    },
  });
  const recs = (mutation.data?.recommendations || []).filter((r) => !linkedIds.has(r.id));
  const link = (r: AiLinkRec) => { if (onLinkRec) onLinkRec(r); else onLink?.(r.id); };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); mutation.mutate(); }}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
      >
        <Brain className="h-3.5 w-3.5" /> Recommend with AI
      </button>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-700">
          <Brain className="h-3.5 w-3.5" /> AI suggestions
          {mutation.data && !mutation.data.ai_available && (
            <span className="font-normal text-slate-500">(keyword match)</span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="text-[11px] text-slate-500 hover:text-slate-700 disabled:opacity-50">
            {mutation.isPending ? 'Analyzing…' : 'Re-run'}
          </button>
          <button type="button" onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {mutation.isPending ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing evidence…
        </div>
      ) : mutation.isError ? (
        <p className="py-1 text-xs text-rose-500">Could not get recommendations.</p>
      ) : recs.length === 0 ? (
        <p className="py-1 text-xs text-slate-400">No strong matches found.</p>
      ) : (
        <div className="space-y-1.5">
          {recs.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-2 rounded-md border border-primary-100 bg-white px-2.5 py-1.5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {r.code && <span className="font-mono text-[10px] text-slate-500">{r.code}</span>}
                  <span className="truncate text-xs font-medium text-slate-800">{r.title || `#${r.id}`}</span>
                  {typeof r.confidence === 'number' && (
                    <span className="rounded-full border border-primary-200 bg-primary-50 px-1.5 text-[10px] text-primary-600">
                      {Math.round(r.confidence * 100)}%
                    </span>
                  )}
                </div>
                {r.rationale && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{r.rationale}</p>}
              </div>
              <button type="button" onClick={() => link(r)} disabled={busy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                <Plus className="h-3 w-3" /> Link
              </button>
            </div>
          ))}
        </div>
      )}
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
  onOpenPolicyModal,
  risksList,
  assetsList,
  incidentsList,
  governanceDocsList,
  onLinkRisk,
  onLinkAsset,
  onLinkIncident,
  onLinkPolicies,
  isLinkingRisk,
  isLinkingAsset,
  isLinkingIncident,
  isLinkingPolicy,
  evidenceId,
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
  risksList?: Array<{ id: number; title?: string | null }>;
  assetsList?: Array<{ id: number; name?: string | null }>;
  incidentsList?: Array<{ id: number; title: string; severity?: string | null }>;
  governanceDocsList?: { documents?: Array<{ id: number; title: string; document_code?: string | null; doc_type?: string | null }> };
  onLinkRisk: (id: number) => void;
  onLinkAsset: (id: number) => void;
  onLinkIncident: (id: number) => void;
  onLinkPolicies: (ids: number[]) => void;
  isLinkingRisk: boolean;
  isLinkingAsset: boolean;
  isLinkingIncident: boolean;
  isLinkingPolicy: boolean;
  evidenceId: number;
}) {
  // Auto reverse-lookup: assessment controls this evidence is linked to.
  const { data: linkedAssessments } = useQuery<{ total: number; controls: any[] }>({
    queryKey: ['evidence-linked-assessments', evidenceId],
    queryFn: async () => (await apiClient.get(`/compliance/assessments/evidence/${evidenceId}/controls`)).data,
  });
  const linkedRiskIds = new Set((links?.risks?.links || []).map((l) => l.risk_id));
  const linkedAssetIds = new Set((links?.assets?.links || []).map((l: any) => l.asset_id));
  const linkedIncidentIds = new Set((links?.incidents?.links || []).map((l: any) => l.incident_id));
  const linkedPolicyIds = new Set((links?.policy_statements?.links || []).map((l: any) => l.policy_statement_id));

  const riskItems = (risksList || [])
    .filter((r) => !linkedRiskIds.has(r.id))
    .map((r) => ({ value: String(r.id), label: r.title || `Risk #${r.id}` }));
  const assetItems = (assetsList || [])
    .filter((a) => !linkedAssetIds.has(a.id))
    .map((a) => ({ value: String(a.id), label: a.name || `Asset #${a.id}` }));
  void linkedAssetIds;
  const incidentItems = (incidentsList || [])
    .filter((i) => !linkedIncidentIds.has(i.id))
    .map((i) => ({
      value: String(i.id),
      label: i.title || `Incident #${i.id}`,
      subLabel: i.severity ?? undefined,
    }));
  const documentsForPicker = (governanceDocsList?.documents || []).map((d) => ({
    id: d.id,
    title: d.title,
    code: d.document_code || undefined,
    docType: d.doc_type || undefined,
  }));

  // Suppress unused-warnings for the legacy modal openers (kept for fallback)
  void onOpenRiskModal; void onOpenAssetModal; void onOpenIncidentModal; void onOpenPolicyModal;
  if (!links) {
    return (
      <div className="flex items-center justify-center py-8">
        <PageLoader size="md" />
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
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h4 className="flex items-center gap-2 font-medium text-slate-800">
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
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          <Link2 className="h-5 w-5 text-primary-600" />
          Cross-Module Links ({links.total_links})
        </h3>
      </div>

      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <LinkSection
          title="Linked Assessments"
          icon={ClipboardList}
          iconColor="text-slate-400"
          count={linkedAssessments?.total ?? 0}
        >
          {(linkedAssessments?.controls?.length ?? 0) > 0 ? (
            <div className="space-y-2">
              {linkedAssessments!.controls.map((c: any) => (
                <div key={c.link_id} className="flex items-start justify-between gap-2 rounded bg-white p-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="font-mono font-semibold text-slate-700">{c.control_id}</span>
                      <span className="truncate text-slate-500">· {c.domain}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{c.assessment_name}</p>
                  </div>
                  <Link href="/compliance/assessments" className="shrink-0 text-slate-500 hover:text-slate-800" title="Open PDPL Assessment">
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No linked assessment controls — this updates automatically when evidence is attached to a control.</p>
          )}
        </LinkSection>

        <LinkSection
          title="Linked Risks"
          icon={AlertTriangle}
          iconColor="text-rose-600"
          count={links.risks.total}
          addButton={
            <InlineLinkPicker
              triggerLabel="Add"
              triggerClassName="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
              triggerIcon={<Plus className="h-4 w-4" />}
              items={riskItems}
              isLoading={isLinkingRisk}
              emptyText="No risks available"
              searchPlaceholder="Search risks"
              popoverWidth={320}
              onSelect={(value) => onLinkRisk(Number(value))}
            />
          }
        >
          {links.risks.links.length > 0 ? (
            <div className="space-y-2">
              {links.risks.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600" />
                    <Link href={`/risks/${link.risk_id}`} className="text-sm text-slate-800 hover:text-primary-600">
                      {link.risk?.title || `Risk #${link.risk_id}`}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/risks/${link.risk_id}`} className="text-slate-600 hover:text-slate-800">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => onUnlinkRisk(link.id)}
                      disabled={isUnlinking}
                      className="text-slate-600 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No linked risks</p>
          )}
          <AiLinkRecommendations evidenceId={evidenceId} target="risks"
            onLink={onLinkRisk} linkedIds={linkedRiskIds} busy={isLinkingRisk} />
        </LinkSection>

        <LinkSection 
          title="Linked Assets" 
          icon={Building2} 
          iconColor="text-primary-600"
          count={links.assets.total}
          addButton={
            <InlineLinkPicker
              triggerLabel="Add"
              triggerClassName="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
              triggerIcon={<Plus className="h-4 w-4" />}
              items={assetItems}
              isLoading={isLinkingAsset}
              emptyText="No assets available"
              searchPlaceholder="Search assets"
              popoverWidth={320}
              onSelect={(value) => onLinkAsset(Number(value))}
            />
          }
        >
          {links.assets.links.length > 0 ? (
            <div className="space-y-2">
              {links.assets.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary-600" />
                    <Link href={`/assets/${link.asset_id}`} className="text-sm text-slate-800 hover:text-primary-600">
                      {link.asset?.name || `Asset #${link.asset_id}`}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/assets/${link.asset_id}`} className="text-slate-600 hover:text-slate-800">
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                    <button
                      onClick={() => onUnlinkAsset(link.id)}
                      disabled={isUnlinking}
                      className="text-slate-600 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No linked assets</p>
          )}
          <AiLinkRecommendations evidenceId={evidenceId} target="assets"
            onLink={onLinkAsset} linkedIds={linkedAssetIds} busy={isLinkingAsset} />
        </LinkSection>

        <LinkSection 
          title="Linked Incidents" 
          icon={AlertCircle} 
          iconColor="text-orange-600"
          count={links.incidents.total}
          addButton={
            <InlineLinkPicker
              triggerLabel="Add"
              triggerClassName="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
              triggerIcon={<Plus className="h-4 w-4" />}
              items={incidentItems}
              isLoading={isLinkingIncident}
              emptyText="No incidents available"
              searchPlaceholder="Search incidents"
              popoverWidth={320}
              onSelect={(value) => onLinkIncident(Number(value))}
            />
          }
        >
          {links.incidents.links.length > 0 ? (
            <div className="space-y-2">
              {links.incidents.links.map((link) => (
                <div key={link.id} className="flex items-center justify-between rounded bg-white p-2">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-orange-600" />
                    <span className="text-sm text-slate-800">
                      {link.incident?.title || `Incident #${link.incident_id}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {link.incident && (
                      <span className={`rounded px-2 py-0.5 text-xs ${
                        link.incident.severity === 'critical' ? 'bg-rose-50 text-rose-600' :
                        link.incident.severity === 'high' ? 'bg-orange-50 text-orange-600' :
                        link.incident.severity === 'medium' ? 'bg-amber-50 text-amber-600' :
                        'bg-emerald-50 text-emerald-600'
                      }`}>
                        {link.incident.severity}
                      </span>
                    )}
                    <button
                      onClick={() => onUnlinkIncident(link.id)}
                      disabled={isUnlinking}
                      className="text-slate-600 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No linked incidents</p>
          )}
          <AiLinkRecommendations evidenceId={evidenceId} target="incidents"
            onLink={onLinkIncident} linkedIds={linkedIncidentIds} busy={isLinkingIncident} />
        </LinkSection>

        <LinkSection
          title="Policy Statements"
          icon={FileText}
          iconColor="text-primary-600"
          count={links.policy_statements.total}
          addButton={
            <PolicyStatementPicker
              documents={documentsForPicker}
              alreadyLinkedStatementIds={linkedPolicyIds}
              isLinking={isLinkingPolicy}
              onLink={(ids) => onLinkPolicies(ids)}
            />
          }
        >
          {links.policy_statements.links.length > 0 ? (
            <div className="space-y-2">
              {links.policy_statements.links.map((link) => {
                const ps = link.policy_statement;
                const policyName = ps?.document_title || 'Policy';
                const locusParts = [
                  ps?.source_section ? `§ ${ps.source_section}` : null,
                  ps?.source_page ? `p.${ps.source_page}` : null,
                  ps?.statement_code || null,
                ].filter(Boolean);
                return (
                  <div key={link.id} className="flex items-start justify-between rounded bg-white p-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <FileText className="h-4 w-4 text-primary-600 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium text-slate-800 truncate">{policyName}</span>
                          {ps?.document_code && (
                            <span className="text-[10px] text-slate-400">{ps.document_code}</span>
                          )}
                        </div>
                        {locusParts.length > 0 && (
                          <p className="text-xs text-slate-500">{locusParts.join(' · ')}</p>
                        )}
                        {ps?.statement_summary && (
                          <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">{ps.statement_summary}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => onUnlinkPolicy(link.id)}
                      disabled={isUnlinking}
                      className="text-slate-600 hover:text-rose-600 flex-shrink-0 ml-2"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-500">No linked policy statements</p>
          )}
          <AiLinkRecommendations evidenceId={evidenceId} target="policy_statements"
            onLink={(id) => onLinkPolicies([id])} linkedIds={linkedPolicyIds} busy={isLinkingPolicy} />
        </LinkSection>
      </div>
    </div>
  );
}

/**
 * Two-stage popover for linking policy statements to an evidence item.
 *   Stage 1: pick a governance document from a searchable list.
 *   Stage 2: see that document's policy statements, tick off as many as
 *            wanted (already-linked ones are pre-disabled), then "Link N".
 *
 * The single flat `/compliance/statements` endpoint we used to call doesn't
 * exist in this backend; statements only live under their document.
 */
function PolicyStatementPicker({
  documents,
  alreadyLinkedStatementIds,
  isLinking,
  onLink,
}: {
  documents: Array<{ id: number; title: string; code?: string; docType?: string }>;
  alreadyLinkedStatementIds: Set<number>;
  isLinking: boolean;
  onLink: (statementIds: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [docSearch, setDocSearch] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [statementSearch, setStatementSearch] = useState('');
  const [selectedStatementIds, setSelectedStatementIds] = useState<Set<number>>(new Set());
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  // Reset internal state whenever the popover closes so the next opening
  // starts fresh.
  useEffect(() => {
    if (!open) {
      setDocSearch('');
      setSelectedDocId(null);
      setStatementSearch('');
      setSelectedStatementIds(new Set());
    }
  }, [open]);

  const { data: statementsForDoc, isLoading: statementsLoading } = useQuery<{
    statements?: Array<{ id: number; statement_code?: string | null; statement_summary?: string | null; statement_text?: string | null; category?: string | null }>;
  }>({
    queryKey: ['policy-statements-by-doc', selectedDocId],
    queryFn: async () => {
      if (!selectedDocId) return { statements: [] };
      const res = await apiClient.get(`/governance/documents/${selectedDocId}/policy-statements`);
      return res.data;
    },
    enabled: !!selectedDocId,
  });

  const filteredDocs = useMemo(() => {
    const q = docSearch.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) =>
      (d.title || '').toLowerCase().includes(q) ||
      (d.code || '').toLowerCase().includes(q) ||
      (d.docType || '').toLowerCase().includes(q)
    );
  }, [documents, docSearch]);

  const filteredStatements = useMemo(() => {
    const all = statementsForDoc?.statements || [];
    const q = statementSearch.trim().toLowerCase();
    if (!q) return all;
    return all.filter((s) =>
      (s.statement_code || '').toLowerCase().includes(q) ||
      (s.statement_summary || '').toLowerCase().includes(q) ||
      (s.statement_text || '').toLowerCase().includes(q)
    );
  }, [statementsForDoc, statementSearch]);

  const toggleStatement = (id: number) => {
    setSelectedStatementIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = () => {
    if (selectedStatementIds.size === 0) return;
    onLink(Array.from(selectedStatementIds));
    setOpen(false);
  };

  const selectedDocTitle = documents.find((d) => d.id === selectedDocId);

  // The picker used to be an inline popover anchored to the "Add" button.
  // It was fragile in practice — `position: absolute` inside a card with
  // `overflow` boundaries on the parent grid sometimes hid the popover, and
  // its tight 380px width made the two-stage flow cramped. Switching to a
  // proper centered modal sidesteps both issues and gives the user real
  // breathing room to find a document and tick off multiple statements.
  return (
    <div ref={wrapperRef} className="inline-block">
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={isLinking}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-primary-600 hover:bg-primary-50 transition-colors disabled:opacity-50"
      >
        {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Add
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">
                  {selectedDocId ? 'Pick statements to link' : 'Pick a governance document'}
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {selectedDocId
                    ? `From "${selectedDocTitle?.title || 'Document'}"`
                    : 'Choose a document to see its policy statements'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Stage 1: pick a document */}
            {!selectedDocId && (
              <>
                <div className="border-b border-slate-100 p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      autoFocus
                      type="text"
                      value={docSearch}
                      onChange={(e) => setDocSearch(e.target.value)}
                      placeholder="Search documents by title, code, or type..."
                      className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {filteredDocs.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-500">
                      {documents.length === 0
                        ? 'No governance documents found in this tenant.'
                        : 'No documents match your search.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filteredDocs.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedDocId(d.id)}
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">{d.title}</p>
                              <p className="truncate text-xs text-slate-500">
                                {[d.code, d.docType].filter(Boolean).join(' · ') || 'Document'}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-400" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {/* Stage 2: pick statements within that document */}
            {selectedDocId && (
              <>
                <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => setSelectedDocId(null)}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    title="Back to documents"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" /> Back to documents
                  </button>
                  <div className="ml-auto text-xs text-slate-500">
                    {selectedStatementIds.size > 0 ? `${selectedStatementIds.size} selected` : 'Tick to link'}
                  </div>
                </div>
                <div className="border-b border-slate-100 p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      autoFocus
                      type="text"
                      value={statementSearch}
                      onChange={(e) => setStatementSearch(e.target.value)}
                      placeholder="Search statements by code or text..."
                      className="w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    />
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {statementsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                    </div>
                  ) : filteredStatements.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-500">
                      {(statementsForDoc?.statements || []).length === 0
                        ? 'This document has no parsed policy statements yet. Run the policy parser on the document first.'
                        : 'No statements match your search.'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {filteredStatements.map((s) => {
                        const alreadyLinked = alreadyLinkedStatementIds.has(s.id);
                        const isSelected = selectedStatementIds.has(s.id);
                        return (
                          <li key={s.id}>
                            <label
                              className={`flex items-start gap-3 px-4 py-3 text-sm ${
                                alreadyLinked ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-slate-50'
                              }`}
                            >
                              <input
                                type="checkbox"
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                checked={isSelected || alreadyLinked}
                                disabled={alreadyLinked}
                                onChange={() => !alreadyLinked && toggleStatement(s.id)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-medium text-primary-600">
                                  {s.statement_code || `Statement #${s.id}`}
                                  {alreadyLinked && (
                                    <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                                      already linked
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-slate-700 line-clamp-3 whitespace-pre-wrap">
                                  {s.statement_summary || s.statement_text || 'Policy statement'}
                                </p>
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}

            {/* Footer — only meaningful in stage 2 */}
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!selectedDocId || selectedStatementIds.size === 0 || isLinking}
                className="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLinking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {selectedStatementIds.size > 0
                  ? `Link ${selectedStatementIds.size} statement${selectedStatementIds.size === 1 ? '' : 's'}`
                  : 'Link statements'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI: recommend governance documents / internal controls / active compliance
// assessments this evidence can be mapped to or used in. Parallel to the
// framework-control recommendations on the assessment. Self-contained.
interface TargetRec {
  id: number;
  code: string | null;
  title: string | null;
  subtitle: string | null;
  confidence: number | null;
  coverage_type: string | null;
  rationale: string | null;
  link_source: string | null;
}
interface TargetRecsResponse {
  evidence_id: number;
  ai_available: boolean;
  governance_documents: TargetRec[];
  internal_controls: TargetRec[];
  compliance_assessments: TargetRec[];
}

function RecommendTargetsPanel({ evidenceId }: { evidenceId: number }) {
  const [data, setData] = useState<TargetRecsResponse | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-targets`);
      return res.data as TargetRecsResponse;
    },
    onSuccess: (d) => setData(d),
  });

  const sections: Array<{
    key: keyof Pick<TargetRecsResponse, 'governance_documents' | 'internal_controls' | 'compliance_assessments'>;
    label: string;
    icon: typeof FileText;
    href: (item: TargetRec) => string;
    emptyHint: string;
  }> = [
    { key: 'governance_documents', label: 'Governance documents', icon: FileText, href: () => '/governance/documents', emptyHint: 'No relevant governance documents found.' },
    { key: 'internal_controls', label: 'Internal controls', icon: Building2, href: () => '/erm/internal-controls', emptyHint: 'No relevant internal controls found (none may exist yet).' },
    { key: 'compliance_assessments', label: 'Active compliance assessments', icon: ClipboardList, href: (i) => `/compliance/assessments/${i.id}`, emptyHint: 'No relevant active assessments found.' },
  ];

  const total = data
    ? data.governance_documents.length + data.internal_controls.length + data.compliance_assessments.length
    : 0;

  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary-600" />
          <h3 className="text-sm font-semibold text-slate-900">Documents, controls &amp; assessments to map</h3>
          {data && (
            <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700">{total}</span>
          )}
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {mutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
          {data ? 'Re-run recommendations' : 'Recommend with AI'}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-slate-500">
        AI scans the governance documents, internal controls and active compliance assessments in this tenant and suggests where this evidence can be mapped or reused.
      </p>

      {mutation.isError && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          <AlertCircle className="h-3.5 w-3.5" />
          {((mutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail) || 'Could not generate recommendations. Try again.'}
        </div>
      )}

      {!data ? (
        !mutation.isPending && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
            Click “Recommend with AI” to find related documents, internal controls and assessments for this evidence.
          </div>
        )
      ) : (
        <div className="mt-3 space-y-4">
          {!data.ai_available && (
            <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-700">
              AI is unavailable — showing closest lexical matches instead.
            </p>
          )}
          {sections.map((section) => {
            const items = data[section.key];
            const Icon = section.icon;
            return (
              <div key={section.key}>
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Icon className="h-3.5 w-3.5" /> {section.label} <span className="text-slate-400">({items.length})</span>
                </p>
                {items.length === 0 ? (
                  <p className="text-[11px] text-slate-400">{section.emptyHint}</p>
                ) : (
                  <div className="space-y-1.5">
                    {items.map((item) => {
                      const pct = item.link_source === 'ai' && typeof item.confidence === 'number'
                        ? `${Math.round(item.confidence * 100)}%` : null;
                      return (
                        <Link
                          key={`${section.key}-${item.id}`}
                          href={section.href(item)}
                          className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 hover:border-primary-300 hover:bg-primary-50"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {item.code && <span className="text-xs font-semibold text-slate-800">{item.code}</span>}
                              <span className="truncate text-sm text-slate-700">{item.title || 'Untitled'}</span>
                              {pct && <span className="rounded bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-600">{pct} match</span>}
                              {item.coverage_type && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{item.coverage_type}</span>}
                            </div>
                            {item.rationale && <p className="mt-0.5 text-[11px] text-slate-500">{item.rationale}</p>}
                            {item.subtitle && <p className="mt-0.5 truncate text-[10px] text-slate-400">{item.subtitle}</p>}
                          </div>
                          <ExternalLink className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
