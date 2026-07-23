'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { InlineLinkPicker, PageLoader, AnimatedModal, RightSlidePanel } from '@/components/ui';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import {
  ArrowLeft, Loader2, AlertCircle, FileCheck, Calendar, Clock,
  CheckCircle, FileText, Edit, ScanText, Brain, Link2,
  AlertTriangle, Eye, Trash2, Send, Sparkles,
  History, FileSpreadsheet, Shield, Building2, Info, Image, Settings,
  ShieldCheck, ClipboardList, ExternalLink, Plus, X,
  ChevronRight, Search, ChevronLeft
} from 'lucide-react';
import Link from 'next/link';
import EvidenceTimeline from './_EvidenceTimeline';
import LinksCoverage from './_LinksCoverage';
import RelationshipsPanel from './_RelationshipsPanel';
import AuditReadinessCard from './_AuditReadinessCard';
import ReviewerActionPanel from './_ReviewerActionPanel';
import EvidenceCrossMap from './_EvidenceCrossMap';
import QualityBreakdownModal from '../_QualityBreakdownModal';
import OcrContentModal from '../_OcrContentModal';

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
  const [showCrossModule, setShowCrossModule] = useState(false);
  const [assessError, setAssessError] = useState<string | null>(null);
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
  // Bumped after an AI assessment completes so the recommendation panels
  // (cross-module link suggestions + targets-to-map) auto-run in parallel —
  // no manual "Recommend with AI" click needed. Guarded so the auto-assess
  // fires exactly once per detail open.
  const [recommendNonce, setRecommendNonce] = useState(0);
  const autoAssessFiredRef = useRef(false);
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
    onMutate: () => setAssessError(null),
    onError: (error: any) => setAssessError(error?.response?.data?.detail || 'AI assessment could not run. Please try again.'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-assessment', evidenceId] });
      // Ensure AI suggested clause mappings and link status refresh immediately
      queryClient.invalidateQueries({ queryKey: ['evidence-clause-mappings', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-ai-link-status', evidenceId] });
      refetchAssessment();
      // Assessment done → kick the recommendation panels to auto-run in parallel.
      setRecommendNonce((n) => n + 1);
    },
  });

  // Auto-run the AI assessment once when the detail opens and OCR is ready but no
  // assessment exists yet — the system runs it itself (no manual "Assess" button).
  // If an assessment already exists, we still bump the nonce once so the
  // recommendation panels auto-populate on open.
  useEffect(() => {
    if (autoAssessFiredRef.current || !evidence) return;
    if (evidence.ocr_status !== 'completed') return;
    const hasAssessment = !!latestAssessment || !!evidence.latest_assessment;
    if (hasAssessment) {
      autoAssessFiredRef.current = true;
      setRecommendNonce((n) => n + 1);
      return;
    }
    if (runAssessmentMutation.isPending) return;
    autoAssessFiredRef.current = true;
    runAssessmentMutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidence, latestAssessment]);

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

  // Id-accepting bulk link mutations — no shared state, so the consolidated
  // panel can link one OR many suggestions at once without a race.
  const bulkLinkControls = useMutation({
    mutationFn: (links: { framework_id: number; control_id: number }[]) =>
      apiClient.post(`/evidence-mgmt/links/${evidenceId}/controls`, {
        control_links: links.map((l) => ({ parsed_control_id: l.control_id, uploaded_framework_id: l.framework_id })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-controls', evidenceId] });
      queryClient.invalidateQueries({ queryKey: ['evidence-detail', evidenceId] });
    },
  });
  const bulkLinkRisks = useMutation({
    mutationFn: (ids: number[]) => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/risks`, { risk_ids: ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] }),
  });
  const bulkLinkAssets = useMutation({
    mutationFn: (ids: number[]) => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/assets`, { asset_ids: ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] }),
  });
  const bulkLinkIncidents = useMutation({
    mutationFn: (ids: number[]) => apiClient.post(`/evidence-mgmt/cross-links/${evidenceId}/incidents`, { incident_ids: ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['evidence-cross-links', evidenceId] }),
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
            {runAssessmentMutation.isPending && (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-3 py-1.5 text-sm text-primary-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI assessing…
              </span>
            )}
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

      {/* Quality breakdown + OCR overlays — shared with the Workbench preview so
          the two surfaces are guaranteed identical. */}
      <QualityBreakdownModal
        isOpen={showQualityOverlay}
        onClose={() => setShowQualityOverlay(false)}
        qualityScore={evidence.quality_score}
        assessment={(evidence.latest_assessment ?? null) as Record<string, unknown> | null}
        ocrStatus={evidence.ocr_status}
        isAssessing={runAssessmentMutation.isPending}
      />

      <OcrContentModal
        isOpen={showOcrOverlay}
        onClose={() => setShowOcrOverlay(false)}
        ocrStatus={evidence.ocr_status}
        ocrContent={ocrContent?.ocr_content ?? null}
        ocrProcessedAt={evidence.ocr_processed_at}
        processMessage={ocrProcessMessage}
        onReprocess={() => processOCRMutation.mutate()}
        isReprocessing={processOCRMutation.isPending}
      />

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
      <div className="mx-4 space-y-4 pb-4 sm:mx-6">
        {/* Context — Quality / OCR / Validity / File at the TOP */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {/* QUALITY SCORE — click for the full breakdown overlay */}
          <button
            type="button"
            onClick={() => setShowQualityOverlay(true)}
            className="group flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-primary-300 hover:bg-slate-50/60"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Brain className="h-3.5 w-3.5" strokeWidth={1.75} /> Quality Score</div>
            {evidence.quality_score !== null ? (
              <>
                <div className={`mt-1.5 text-2xl font-bold leading-none ${getQualityScoreTextColor(evidence.quality_score)}`}>{Math.round(evidence.quality_score)}%</div>
                <p className="mt-1.5 text-[11px] leading-snug text-primary-600 group-hover:underline">
                  {evidence.quality_score >= 80 ? 'Meets the 80% target →' : 'Below the 80% target — see what’s missing →'}
                </p>
                <div className="mt-2 h-1.5 w-full rounded-full bg-slate-200">
                  <div className={`h-1.5 rounded-full ${getQualityScoreColor(evidence.quality_score)}`} style={{ width: `${evidence.quality_score}%` }} />
                </div>
              </>
            ) : (
              <div className="mt-1.5 text-sm text-slate-400">Not assessed yet</div>
            )}
          </button>

          {/* TEXT EXTRACTION (OCR) — click for the extracted-text overlay */}
          <button
            type="button"
            onClick={() => setShowOcrOverlay(true)}
            className="group flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-primary-300 hover:bg-slate-50/60"
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><ScanText className="h-3.5 w-3.5" strokeWidth={1.75} /> Text Extraction (OCR)</div>
            <div className="mt-1.5">
              <span className={`inline-flex rounded-full ${ocrStatusStyle.bg} px-2 py-0.5 text-xs font-medium ${ocrStatusStyle.text}`}>{ocrStatusStyle.label}</span>
            </div>
            <p className="mt-1.5 truncate text-[11px] text-slate-500">
              {evidence.ocr_processed_at ? formatDateTime(evidence.ocr_processed_at) : 'Not processed'}
              <span className="text-primary-600 group-hover:underline"> · view text →</span>
            </p>
          </button>

          {/* VALIDITY PERIOD — click to set/adjust in the edit modal */}
          <button
            type="button"
            onClick={canEdit ? () => {
              setEditForm({
                name: evidence.name || '',
                description: evidence.description || '',
                evidence_type: evidence.evidence_type || '',
                collection_date: evidence.collection_date ? new Date(evidence.collection_date).toISOString().split('T')[0] : '',
                validity_period_days: evidence.validity_period_days ? String(evidence.validity_period_days) : '',
                source_system: evidence.source_system || '',
              });
              setIsEditModalOpen(true);
            } : undefined}
            className={`group flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left ${canEdit ? 'transition-colors hover:border-primary-300 hover:bg-slate-50/60' : 'cursor-default'}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><Calendar className="h-3.5 w-3.5" strokeWidth={1.75} /> Validity Period</div>
            {(evidence.collection_date || evidence.expiry_date) ? (
              <>
                <p className="mt-1.5 text-sm font-medium text-slate-800">{formatDate(evidence.collection_date)} → {formatDate(evidence.expiry_date)}</p>
                {daysRemaining !== null && (
                  <p className={`mt-1 text-[11px] ${daysRemaining <= 0 ? 'text-rose-600' : daysRemaining <= 30 ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {daysRemaining <= 0 ? 'Expired' : `${daysRemaining} days remaining`}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="mt-1.5 text-lg font-semibold text-slate-800">Not set</p>
                {canEdit && <p className="mt-1 text-[11px] text-primary-600 group-hover:underline">Set expiry date →</p>}
              </>
            )}
          </button>

          {/* SOURCE FILE — click to open the file preview */}
          <button
            type="button"
            onClick={() => evidence.file_path && setShowFilePreview(true)}
            className={`group flex w-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left ${evidence.file_path ? 'transition-colors hover:border-primary-300 hover:bg-slate-50/60' : 'cursor-default'}`}
          >
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400"><FileText className="h-3.5 w-3.5" strokeWidth={1.75} /> Source File</div>
            <p className="mt-1.5 truncate text-sm font-semibold text-slate-800" title={evidence.file_name || ''}>{evidence.file_name || 'No file'}</p>
            <p className="mt-1 truncate text-[11px] text-slate-500">
              {evidence.file_type || 'Unknown'} · v{evidence.version}
              {evidence.file_path && <span className="text-primary-600 group-hover:underline"> · Open file →</span>}
            </p>
          </button>
        </div>

        {/* Lifecycle timeline — derived client-side from evidence fields */}
        <EvidenceTimeline evidence={evidence} fmtDateTime={formatDateTime} />

        {/* Rest stays side by side (2-column) as before: cross-module linkage
            (left, sticky) + AI assessment (right). */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* LEFT — cross-module linkage, full inline (no popup) */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-4">
              <div className="cw-card rounded-xl p-4 sm:p-5">
                <LinksCoverage
                  evidenceId={evidenceId}
                  autoRunKey={recommendNonce}
                  totalLinked={
                    (controlsData?.total_mappings ?? 0) +
                    (allLinks?.policy_statements?.total ?? 0) +
                    (allLinks?.assessments?.total ?? 0) +
                    (allLinks?.risks?.total ?? 0) +
                    (allLinks?.assets?.total ?? 0) +
                    (allLinks?.incidents?.total ?? 0)
                  }
                  pills={[
                    { key: 'controls', label: 'Controls', icon: Shield, linkedCount: controlsData?.total_mappings ?? 0 },
                    { key: 'policy_statements', label: 'Policies', icon: FileText, linkedCount: allLinks?.policy_statements?.total ?? 0 },
                    { key: 'assessments', label: 'Assessments', icon: ClipboardList, linkedCount: allLinks?.assessments?.total ?? 0 },
                    { key: 'risks', label: 'Risks', icon: AlertTriangle, linkedCount: allLinks?.risks?.total ?? 0 },
                    { key: 'assets', label: 'Assets', icon: Building2, linkedCount: allLinks?.assets?.total ?? 0 },
                    { key: 'incidents', label: 'Incidents', icon: AlertCircle, linkedCount: allLinks?.incidents?.total ?? 0 },
                  ]}
                  suggestTargets={[
                    {
                      key: 'controls', badgeLabel: 'CONTROL', icon: Shield, busy: bulkLinkControls.isPending,
                      linkedIds: new Set((controlsData?.by_framework || []).flatMap((fw) => fw.controls.map((m) => m.parsed_control?.id).filter((x): x is number => typeof x === 'number'))),
                      onLinkMany: (recs) => bulkLinkControls.mutate(recs.filter((r) => r.meta?.framework_id).map((r) => ({ framework_id: r.meta!.framework_id!, control_id: r.id }))),
                    },
                    {
                      key: 'risks', badgeLabel: 'RISK', icon: AlertTriangle, busy: bulkLinkRisks.isPending,
                      linkedIds: new Set((allLinks?.risks?.links || []).map((l) => l.risk_id)),
                      onLinkMany: (recs) => bulkLinkRisks.mutate(recs.map((r) => r.id)),
                    },
                    {
                      key: 'assets', badgeLabel: 'ASSET', icon: Building2, busy: bulkLinkAssets.isPending,
                      linkedIds: new Set((allLinks?.assets?.links || []).map((l: any) => l.asset_id)),
                      onLinkMany: (recs) => bulkLinkAssets.mutate(recs.map((r) => r.id)),
                    },
                    {
                      key: 'incidents', badgeLabel: 'INCIDENT', icon: AlertCircle, busy: bulkLinkIncidents.isPending,
                      linkedIds: new Set((allLinks?.incidents?.links || []).map((l: any) => l.incident_id)),
                      onLinkMany: (recs) => bulkLinkIncidents.mutate(recs.map((r) => r.id)),
                    },
                    {
                      key: 'policy_statements', badgeLabel: 'POLICY', icon: FileText, busy: linkPolicyMutation.isPending,
                      linkedIds: new Set((allLinks?.policy_statements?.links || []).map((l: any) => l.policy_statement_id)),
                      onLinkMany: (recs) => linkPolicyMutation.mutate(recs.map((r) => r.id)),
                    },
                  ]}
                  manualTypes={[
                    {
                      key: 'controls', label: 'Control', icon: Shield,
                      items: (availableControls?.frameworks || []).flatMap((fw) => fw.controls.map((c) => ({ value: `${fw.id}:${c.id}`, label: `${c.control_id} — ${c.title}`, sub: fw.name }))),
                      onPick: (v) => { const [fwId, ctrlId] = v.split(':').map(Number); bulkLinkControls.mutate([{ framework_id: fwId, control_id: ctrlId }]); },
                    },
                    {
                      key: 'risks', label: 'Risk', icon: AlertTriangle,
                      items: (risksList || []).map((r) => ({ value: String(r.id), label: r.title || `Risk #${r.id}` })),
                      onPick: (v) => bulkLinkRisks.mutate([Number(v)]),
                    },
                    {
                      key: 'assets', label: 'Asset', icon: Building2,
                      items: (assetsList || []).map((a) => ({ value: String(a.id), label: a.name || `Asset #${a.id}` })),
                      onPick: (v) => bulkLinkAssets.mutate([Number(v)]),
                    },
                    {
                      key: 'incidents', label: 'Incident', icon: AlertCircle,
                      items: (incidentsList || []).map((i) => ({ value: String(i.id), label: i.title || `Incident #${i.id}`, sub: i.severity ?? undefined })),
                      onPick: (v) => bulkLinkIncidents.mutate([Number(v)]),
                    },
                    {
                      key: 'policy_statements', label: 'Policy statement', icon: FileText,
                      custom: (
                        <PolicyStatementPicker
                          documents={(governanceDocsList?.documents || []).map((d) => ({ id: d.id, title: d.title, code: d.document_code || undefined, docType: d.doc_type || undefined }))}
                          alreadyLinkedStatementIds={new Set((allLinks?.policy_statements?.links || []).map((l: any) => l.policy_statement_id))}
                          isLinking={linkPolicyMutation.isPending}
                          onLink={(ids) => linkPolicyMutation.mutate(ids)}
                        />
                      ),
                    },
                  ]}
                />
              </div>
          </div>
        </div>

          {/* RIGHT — AI assessment (as it was previously) */}
          <div className="space-y-4 lg:col-span-7">
        {assessError && (
          <div className="cw-card flex items-start gap-2 rounded-xl border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">AI assessment couldn&apos;t run</p>
              <p className="text-xs text-red-600">{assessError}</p>
            </div>
            <button
              onClick={() => { setAssessError(null); autoAssessFiredRef.current = true; runAssessmentMutation.mutate(); }}
              disabled={runAssessmentMutation.isPending}
              className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              {runAssessmentMutation.isPending ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {/* AI Assessment — content summary + AI suggested clause mappings */}
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
            onOpenLinkModal={() => setShowLinkModal(true)}
          />
        </div>

        {/* Reviewer decision (surfaces the existing reviewMutation) */}
        {canEdit && evidence.status === 'pending_review' && (
          <ReviewerActionPanel
            note={rejectComments}
            onNoteChange={setRejectComments}
            onApprove={() => reviewMutation.mutate({ action: 'approve', comments: rejectComments || undefined })}
            onReject={() => reviewMutation.mutate({ action: 'reject', comments: rejectComments || undefined })}
            isPending={reviewMutation.isPending}
          />
        )}
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
  linkFeedback,
  onOpenLinkModal,
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
  onOpenLinkModal: () => void;
}) {
  // Row selected to view the full requirement/rationale in a popup (clause table).
  const [viewClause, setViewClause] = useState<ClauseMapping | null>(null);

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
    const busy = isRunning || evidence.ocr_status !== 'completed';
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        {busy ? (
          <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary-400" />
        ) : (
          <Brain className="mb-4 h-12 w-12 text-slate-400" />
        )}
        <p className="text-lg font-medium text-slate-800">
          {isRunning ? 'AI assessment in progress…' : evidence.ocr_status !== 'completed' ? 'Waiting for OCR…' : 'Preparing AI assessment…'}
        </p>
        <p className="text-slate-600">
          {evidence.ocr_status !== 'completed'
            ? 'OCR is still processing — the AI assessment runs automatically once it finishes.'
            : 'The system runs the AI assessment automatically. This card fills in shortly.'}
        </p>
      </div>
    );
  }

  const data = assessment || evidence.latest_assessment;
  if (!data) return null;

  // Applicable frameworks — only the TRUSTWORTHY, AI-detected set: (1) frameworks of
  // actually-linked controls, (2) DB-verified AI clause suggestions. The raw AI
  // free-text `compliance_frameworks` list is deliberately excluded — it is noisy /
  // unverified ("suggested") and was misleading auditors.
  const linkedFrameworkNames = new Set(
    (controlsData?.by_framework || []).map((f) => f.framework_name).filter(Boolean)
  );
  const applicableFrameworks = Array.from(
    new Set(
      [
        ...(controlsData?.by_framework || []).map((f) => f.framework_name),
        ...(clauseMappings || []).map((c) => c.framework_name),
      ].filter(Boolean)
    )
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
          <Sparkles className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
          AI quality assessment
        </h3>
        {isRunning ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-primary-600">
            <Loader2 className="h-4 w-4 animate-spin" /> Assessing…
          </span>
        ) : (assessment?.assessed_at || data.assessed_at) ? (
          <span className="text-sm text-slate-500">{formatDateTime(assessment?.assessed_at ?? data.assessed_at)}</span>
        ) : null}
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Content summary</p>
        <p className="mt-2 rounded-lg bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">{data.content_summary || 'No summary available'}</p>
      </div>

      {clauseMappings && clauseMappings.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
                <h4 className="font-semibold text-slate-800">Suggested clause mappings</h4>
              </div>
              <p className="mt-1 text-xs text-slate-500">Review each row, then link the ones that fit. <span className="font-medium text-primary-600">AI-suggested · not yet linked</span></p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-2 font-medium">Framework</th>
                    <th className="px-4 py-2 font-medium">Control</th>
                    <th className="px-4 py-2 font-medium">Coverage</th>
                    <th className="px-4 py-2 text-right font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {clauseMappings.map((clause, idx) => {
                    const linked = isClauseLinked(clause);
                    return (
                      <tr
                        key={idx}
                        onClick={() => setViewClause(clause)}
                        className="cursor-pointer border-b border-slate-50 last:border-0 hover:bg-slate-50"
                      >
                        <td className="px-4 py-2.5 align-top font-medium text-slate-800">{clause.framework_name}</td>
                        <td className="px-4 py-2.5 align-top">
                          <div className="text-slate-700">{clause.control_id}</div>
                          <div className="line-clamp-1 text-xs text-slate-500">{clause.control_title}</div>
                        </td>
                        <td className="px-4 py-2.5 align-top">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${getCoverageTypeStyle(clause.coverage_type)}`}>{clause.coverage_type}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right align-top">
                          <button
                            onClick={(e) => { e.stopPropagation(); setLinkingClauseIndex(idx); onLinkFromAI(clause); }}
                            disabled={isLinkingPending || linked}
                            className={`inline-flex items-center gap-1 rounded-lg px-3 py-1 text-xs font-medium ${
                              linked ? 'bg-slate-100 text-slate-500' : 'bg-primary-600 text-white hover:bg-primary-700'
                            } disabled:opacity-60`}
                          >
                            {linked
                              ? <><CheckCircle className="h-3.5 w-3.5" /> Linked</>
                              : linkingClauseIndex === idx && isLinkingPending
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <><Plus className="h-3.5 w-3.5" /> Link</>}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {linkFeedback && (
              <div className={`border-t border-slate-100 px-4 py-2 text-xs ${linkFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                {linkFeedback.message}
              </div>
            )}
          </div>
        )}

      {/* Full-requirement popup for a clicked clause row */}
      <AnimatedModal
        isOpen={!!viewClause}
        onClose={() => setViewClause(null)}
        title={viewClause ? `${viewClause.framework_name} · ${viewClause.control_id}` : ''}
        subtitle={viewClause?.control_title}
        size="lg"
      >
        {viewClause && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold capitalize ${getCoverageTypeStyle(viewClause.coverage_type)}`}>{viewClause.coverage_type} coverage</span>
              <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{viewClause.confidence}% confidence</span>
              {isClauseLinked(viewClause) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"><CheckCircle className="h-3 w-3" /> Linked</span>
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Requirement</p>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-700">{viewClause.clause_reference || viewClause.control_title}</p>
            </div>
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Why this evidence matches</p>
              <p className="whitespace-pre-wrap leading-relaxed text-slate-600">{viewClause.matching_rationale}</p>
            </div>
            <div className="flex justify-end border-t border-slate-100 pt-3">
              <button
                onClick={() => {
                  const idx = (clauseMappings || []).indexOf(viewClause);
                  setLinkingClauseIndex(idx);
                  onLinkFromAI(viewClause);
                }}
                disabled={isLinkingPending || isClauseLinked(viewClause)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ${
                  isClauseLinked(viewClause) ? 'bg-slate-100 text-slate-500' : 'bg-primary-600 text-white hover:bg-primary-700'
                } disabled:opacity-60`}
              >
                {isClauseLinked(viewClause) ? <><CheckCircle className="h-4 w-4" /> Already linked</> : <><Plus className="h-4 w-4" /> Link to requirement</>}
              </button>
            </div>
          </div>
        )}
      </AnimatedModal>
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
  void usageData;

  const flatControlItems = (availableControls?.frameworks || []).flatMap((fw) =>
    fw.controls.map((c) => ({
      value: `${fw.id}:${c.id}`,
      label: `${c.control_id} — ${c.title}`,
      subLabel: fw.name,
    }))
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-slate-800">
          <Shield className="h-5 w-5 text-primary-600" />
          Internal Controls ({totalControls})
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

      <div>
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
                    {framework.framework_name}{framework.framework_code && framework.framework_code !== framework.framework_name ? ` (${framework.framework_code})` : ''}
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
  evidenceId, target, onLink, onLinkRec, linkedIds, busy, autoRunKey,
}: {
  evidenceId: number;
  target: 'risks' | 'assets' | 'incidents' | 'policy_statements' | 'controls';
  onLink?: (id: number) => void;
  onLinkRec?: (rec: AiLinkRec) => void;
  linkedIds: Set<number>;
  busy?: boolean;
  autoRunKey?: number;
}) {
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      const r = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-links`, null, { params: { target } });
      return r.data as { recommendations: AiLinkRec[]; ai_available: boolean; candidate_count: number };
    },
  });

  // Auto-open + fetch once the parent bumps autoRunKey (i.e. after the AI
  // assessment completes) — so link suggestions appear without a manual click.
  const autoRanRef = useRef(0);
  useEffect(() => {
    if (!autoRunKey || autoRanRef.current === autoRunKey) return;
    autoRanRef.current = autoRunKey;
    setOpen(true);
    mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunKey]);
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

/**
 * Consolidated AI link suggestions — ONE panel that fans recommendations out
 * across every target (controls, risks, assets, incidents, policy) in parallel,
 * shows a single "Analyzing…" indicator, and streams grouped suggestions in as
 * each target resolves. Replaces the five separate per-section banners.
 */
interface SuggestTarget {
  key: 'controls' | 'risks' | 'assets' | 'incidents' | 'policy_statements';
  label: string;
  icon: typeof AlertTriangle;
  linkedIds: Set<number>;
  onLink: (rec: AiLinkRec) => void;
  busy?: boolean;
}

function AiSuggestionsPanel({
  evidenceId,
  autoRunKey,
  targets,
}: {
  evidenceId: number;
  autoRunKey?: number;
  targets: SuggestTarget[];
}) {
  const enabled = !!autoRunKey && autoRunKey > 0;
  const results = useQueries({
    queries: targets.map((t) => ({
      queryKey: ['evidence-ai-suggest', evidenceId, t.key, autoRunKey ?? 0],
      queryFn: async () => {
        const r = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-links`, null, { params: { target: t.key } });
        return r.data as { recommendations: AiLinkRec[]; ai_available: boolean };
      },
      enabled,
      staleTime: Infinity,
      retry: false,
    })),
  });

  const anyLoading = results.some((q) => q.isFetching);
  const started = enabled || results.some((q) => q.isFetching || !!q.data);
  const groups = targets
    .map((t, i) => ({ target: t, recs: (results[i].data?.recommendations || []).filter((r) => !t.linkedIds.has(r.id)) }))
    .filter((g) => g.recs.length > 0);
  const total = groups.reduce((n, g) => n + g.recs.length, 0);
  const aiUnavailable = results.some((q) => q.data) && results.every((q) => !q.data || !q.data.ai_available);
  const rerun = () => results.forEach((q) => q.refetch());

  return (
    <div className="rounded-xl border border-primary-100 bg-primary-50/50 p-3 sm:p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-700">
          <Sparkles className="h-4 w-4" strokeWidth={1.75} /> AI suggestions
          {started && aiUnavailable && <span className="font-normal text-slate-400">(keyword match)</span>}
        </span>
        <div className="flex items-center gap-2">
          {anyLoading && (
            <span className="inline-flex items-center gap-1 text-[11px] text-primary-600"><Loader2 className="h-3 w-3 animate-spin" /> Analyzing…</span>
          )}
          <button type="button" onClick={rerun} disabled={anyLoading}
            className="text-[11px] font-medium text-slate-500 hover:text-slate-700 disabled:opacity-50">
            {started ? 'Re-run' : 'Run'}
          </button>
        </div>
      </div>

      {!started ? (
        <p className="py-1 text-xs text-slate-500">Suggestions across controls, risks, assets, incidents &amp; policies appear here once the evidence is assessed.</p>
      ) : anyLoading && total === 0 ? (
        <div className="flex items-center gap-2 py-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing evidence…</div>
      ) : total === 0 ? (
        <p className="py-1 text-xs text-slate-400">No strong matches found.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.target.key}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                <g.target.icon className="h-3.5 w-3.5" strokeWidth={1.75} /> {g.target.label} · {g.recs.length}
              </p>
              <div className="space-y-1.5">
                {g.recs.map((r) => (
                  <div key={`${g.target.key}-${r.id}`} className="flex items-start justify-between gap-2 rounded-lg border border-primary-100 bg-white px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {r.code && <span className="font-mono text-[10px] text-slate-500">{r.code}</span>}
                        <span className="truncate text-xs font-medium text-slate-800">{r.title || `#${r.id}`}</span>
                        {typeof r.confidence === 'number' && (
                          <span className="rounded-full border border-primary-200 bg-primary-50 px-1.5 text-[10px] text-primary-600">{Math.round(r.confidence * 100)}%</span>
                        )}
                      </div>
                      {r.rationale && <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{r.rationale}</p>}
                    </div>
                    <button type="button" onClick={() => g.target.onLink(r)} disabled={g.target.busy}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                      <Plus className="h-3 w-3" /> Link
                    </button>
                  </div>
                ))}
              </div>
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
  recommendNonce,
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
  recommendNonce?: number;
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
  void onOpenRiskModal; void onOpenAssetModal; void onOpenIncidentModal; void onOpenPolicyModal; void recommendNonce;
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
          Related records ({links.total_links})
        </h3>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
                    <Link href={`/erm/risks/${link.risk_id}`} className="text-sm text-slate-800 hover:text-primary-600">
                      {link.risk?.title || `Risk #${link.risk_id}`}
                    </Link>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link href={`/erm/risks/${link.risk_id}`} className="text-slate-600 hover:text-slate-800">
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

function RecommendTargetsPanel({ evidenceId, autoRunKey }: { evidenceId: number; autoRunKey?: number }) {
  const [data, setData] = useState<TargetRecsResponse | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/recommend-targets`);
      return res.data as TargetRecsResponse;
    },
    onSuccess: (d) => setData(d),
  });

  // Auto-run once when the parent bumps autoRunKey (after AI assessment completes).
  const autoRanRef = useRef(0);
  useEffect(() => {
    if (!autoRunKey || autoRanRef.current === autoRunKey) return;
    autoRanRef.current = autoRunKey;
    mutation.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunKey]);

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
