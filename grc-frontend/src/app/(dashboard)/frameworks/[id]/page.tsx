'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { certificationsApi, governanceApi, assetsApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { CertificationJourney, ControlImplementation, ProgressSummary, CertificationControl, SubControlWithEvidence, ControlEvidence, ITAsset } from '@/types';
import ControlImplementationModal from '@/components/ControlImplementationModal';
import { 
  Loader2, 
  AlertCircle,
  Shield,
  ChevronRight,
  ChevronDown,
  Calendar,
  Target,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  Check,
  Search,
  XCircle,
  ArrowLeft,
  Layers,
  FileText,
  Download,
  ExternalLink,
  MapPin,
  Building2,
  Users,
  Percent,
  Filter,
  ChevronUp,
  Circle,
  FileCheck,
  BookOpen,
  ClipboardCheck,
  GraduationCap,
  Eye,
  BarChart3,
  Settings,
  Upload,
  Plus,
  Minus,
  Award,
  TrendingUp,
  Radio,
  Paperclip,
  Sparkles,
  Trash2,
  CheckCircle,
  Unlink
} from 'lucide-react';

const EVIDENCE_TYPE_MAP: Record<string, { label: string; color: string }> = {
  policy: { label: 'Policy', color: 'bg-blue-50 text-blue-700' },
  procedure: { label: 'Procedure', color: 'bg-purple-50 text-purple-700' },
  screenshot: { label: 'Screenshot', color: 'bg-cyan-50 text-cyan-700' },
  audit: { label: 'Audit Log', color: 'bg-orange-50 text-orange-700' },
  log: { label: 'Log', color: 'bg-orange-50 text-orange-700' },
  training: { label: 'Training', color: 'bg-green-50 text-green-700' },
  risk: { label: 'Risk Assessment', color: 'bg-rose-50 text-rose-700' },
  access: { label: 'Access Review', color: 'bg-amber-50 text-amber-700' },
  config: { label: 'Configuration', color: 'bg-indigo-50 text-indigo-700' },
  report: { label: 'Report', color: 'bg-pink-50 text-pink-700' },
  certificate: { label: 'Certificate', color: 'bg-emerald-50 text-emerald-700' },
  contract: { label: 'Contract', color: 'bg-amber-50 text-amber-700' },
  register: { label: 'Register', color: 'bg-teal-50 text-teal-700' },
  inventory: { label: 'Inventory', color: 'bg-lime-50 text-lime-700' },
  plan: { label: 'Plan', color: 'bg-sky-50 text-sky-700' },
  matrix: { label: 'Matrix', color: 'bg-violet-50 text-violet-700' },
  list: { label: 'List', color: 'bg-fuchsia-50 text-fuchsia-700' },
};

const getEvidenceType = (recommendation: string): { label: string; color: string } => {
  const key = recommendation.toLowerCase();
  for (const [pattern, value] of Object.entries(EVIDENCE_TYPE_MAP)) {
    if (key.includes(pattern)) return value;
  }
  return { label: 'Document', color: 'bg-gray-50 text-gray-700' };
};

interface EvidenceRequirement {
  id: string;
  title: string;
  description: string;
  type: string;
  typeLabel: string;
  typeColor: string;
  frequency: string;
  isRequired: boolean;
}

const EVIDENCE_DETAILS: Record<string, { title: string; description: string; frequency: string; isRequired: boolean }> = {
  policy_document: { title: 'Policy Document', description: 'Approved and published policy document', frequency: 'annual', isRequired: true },
  procedure_document: { title: 'Procedure Document', description: 'Documented operational procedures', frequency: 'annual', isRequired: true },
  screenshot: { title: 'System Screenshot', description: 'Screenshot evidence of system configuration', frequency: 'quarterly', isRequired: false },
  audit_log: { title: 'Audit Log Records', description: 'System audit log exports showing activity', frequency: 'monthly', isRequired: true },
  configuration_export: { title: 'Configuration Export', description: 'System configuration settings export', frequency: 'quarterly', isRequired: true },
  training_record: { title: 'Training Records', description: 'Records of personnel training completion', frequency: 'annual', isRequired: true },
  risk_assessment: { title: 'Risk Assessment Report', description: 'Documented risk assessment results', frequency: 'annual', isRequired: true },
  penetration_test_report: { title: 'Penetration Test Report', description: 'External penetration testing results', frequency: 'annual', isRequired: true },
  vulnerability_scan: { title: 'Vulnerability Scan Results', description: 'Automated vulnerability scan output', frequency: 'quarterly', isRequired: true },
  access_review: { title: 'Access Review Records', description: 'Periodic access review documentation', frequency: 'quarterly', isRequired: true },
  change_request: { title: 'Change Request Records', description: 'Records of change requests', frequency: 'monthly', isRequired: true },
  incident_report: { title: 'Incident Reports', description: 'Security incident documentation', frequency: 'as_needed', isRequired: false },
  backup_log: { title: 'Backup Log Records', description: 'System backup verification logs', frequency: 'monthly', isRequired: true },
  encryption_certificate: { title: 'Encryption Certificate', description: 'Valid encryption/SSL certificate', frequency: 'annual', isRequired: true },
  contract: { title: 'Contract/Agreement', description: 'Signed contractual agreements', frequency: 'as_needed', isRequired: true },
  register: { title: 'Register/Inventory', description: 'Maintained register or inventory list', frequency: 'quarterly', isRequired: true },
  plan: { title: 'Management Plan', description: 'Documented management or response plan', frequency: 'annual', isRequired: true },
  matrix: { title: 'Responsibility Matrix', description: 'Roles and responsibilities matrix', frequency: 'annual', isRequired: true },
  meeting_minutes: { title: 'Meeting Minutes', description: 'Meeting records and minutes', frequency: 'monthly', isRequired: false },
  acknowledgment: { title: 'Acknowledgment Records', description: 'Signed acknowledgment forms', frequency: 'annual', isRequired: true },
  job_description: { title: 'Job Descriptions', description: 'Role-specific job descriptions', frequency: 'annual', isRequired: false },
  org_chart: { title: 'Organizational Chart', description: 'Current organizational structure', frequency: 'annual', isRequired: false },
};

const getEvidenceRequirements = (controlName: string, evidenceRecs: string[]): EvidenceRequirement[] => {
  return evidenceRecs.map((rec, idx) => {
    const key = rec.toLowerCase().replace(/-/g, '_');
    const details = EVIDENCE_DETAILS[key] || {
      title: rec.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      description: `Documentation for ${rec.replace(/_/g, ' ')}`,
      frequency: 'annual',
      isRequired: true
    };
    const evType = getEvidenceType(rec);
    return {
      id: `${rec}-${idx}`,
      title: details.title,
      description: details.description,
      type: rec,
      typeLabel: evType.label,
      typeColor: evType.color,
      frequency: details.frequency,
      isRequired: details.isRequired
    };
  });
};

const getCategoryFromDomain = (domainName: string): string => {
  const name = domainName?.toLowerCase() || '';
  if (name.includes('organizational')) return 'Organizational';
  if (name.includes('people')) return 'People';
  if (name.includes('physical')) return 'Physical';
  if (name.includes('technological')) return 'Technological';
  return 'Other';
};

type CategoryFilter = 'all' | 'organizational' | 'people' | 'physical' | 'technological';
type StatusFilter = 'all' | 'implemented' | 'not_implemented' | 'partial' | 'in_progress' | 'verified';
type SortOrder = 'asc' | 'desc' | 'default';


const ANNEX_A_DOMAINS = [
  { id: 'A.5', name: 'Organizational Controls', controlCount: 37 },
  { id: 'A.6', name: 'People Controls', controlCount: 8 },
  { id: 'A.7', name: 'Physical Controls', controlCount: 14 },
  { id: 'A.8', name: 'Technological Controls', controlCount: 34 },
];

const stripCertificationPostfix = (value?: string): string => {
  if (!value) return '';
  return value.replace(/\s+certification\s*$/i, '').trim();
};

type TabType = 'overview' | 'phases' | 'controls' | string;
type ScopingSubTab = 'definition' | 'locations' | 'exclusions' | 'departments';
type SoaSubTab = 'controls' | 'summary' | 'export';
type ControlsSubTab = 'library' | 'policies' | 'evidence';

export default function CertificationJourneyPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const journeyId = parseInt(params.id as string);
  
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [expandedPhases, setExpandedPhases] = useState<number[]>([1]);
  const [expandedDomains, setExpandedDomains] = useState<string[]>(['A.5']);
  const [scopingSubTab, setScopingSubTab] = useState<ScopingSubTab>('definition');
  const [soaSubTab, setSoaSubTab] = useState<SoaSubTab>('controls');
  const [controlsSubTab, setControlsSubTab] = useState<ControlsSubTab>('library');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<number | null>(null);
  const [selectedControl, setSelectedControl] = useState<ControlImplementation | null>(null);
  const [showControlModal, setShowControlModal] = useState(false);
  const [expandedControls, setExpandedControls] = useState<number[]>([]);
  const [expandedSubControlKeys, setExpandedSubControlKeys] = useState<string[]>([]);
  const [expandedRequirementTextIds, setExpandedRequirementTextIds] = useState<number[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('default');
  const [uploadingControlId, setUploadingControlId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: journey, isLoading: journeyLoading, error: journeyError } = useQuery({
    queryKey: ['certification', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getById(journeyId);
      console.info('[JourneyTrace] certification payload', {
        journeyId,
        frameworkName: response?.data?.framework_name,
        classification: (response?.data as any)?.framework_classification,
      });
      return response.data as CertificationJourney;
    },
  });

  const { data: controls, isLoading: controlsLoading } = useQuery({
    queryKey: ['certification-controls', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getControls(journeyId);
      console.info('[JourneyTrace] controls payload', {
        journeyId,
        totalControls: response?.data?.length || 0,
        sample: (response?.data || []).slice(0, 5).map((c: any) => ({
          id: c.id,
          code: c.control_code,
          evidenceRequirements: c.evidence_requirements?.length || 0,
          evidenceRecommendations: c.evidence_recommendations?.length || 0,
          subControls: c.sub_controls?.length || 0,
        })),
      });
      return response.data as CertificationControl[];
    },
    enabled: !!journeyId,
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: async ({ controlId, file }: { controlId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return certificationsApi.uploadEvidence(journeyId, controlId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setUploadingControlId(null);
    },
    onError: () => {
      setUploadingControlId(null);
    }
  });

  const [assessingEvidenceId, setAssessingEvidenceId] = useState<number | null>(null);

  const assessEvidenceMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      return apiClient.post(`/evidence-mgmt/ai/${evidenceId}/assess?force_refresh=true`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setAssessingEvidenceId(null);
    },
    onError: () => {
      setAssessingEvidenceId(null);
    }
  });

  const [deletingEvidenceId, setDeletingEvidenceId] = useState<number | null>(null);

  const deleteEvidenceMutation = useMutation({
    mutationFn: async (ev: { id: number; item_type?: string; linked_evidence_id?: number }) => {
      if (ev.item_type === 'ecm' && ev.linked_evidence_id) {
        // ECM-sourced item: unlink via the evidence-mgmt endpoint
        return apiClient.delete(`/evidence-mgmt/links/${ev.linked_evidence_id}/controls/${ev.id}`);
      }
      // ImplementationEvidence item: unlink via the certifications endpoint
      return apiClient.delete(`/certifications/evidence/${ev.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setDeletingEvidenceId(null);
    },
    onError: () => {
      setDeletingEvidenceId(null);
    }
  });

  const reviewEvidenceMutation = useMutation({
    mutationFn: async ({ evidenceId, action }: { evidenceId: number; action: 'approve' | 'reject' }) => {
      return apiClient.put(`/certifications/evidence/${evidenceId}/review`, { action });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
    }
  });

  const [enhanceSuccess, setEnhanceSuccess] = useState<string | null>(null);
  const [enhanceError, setEnhanceError] = useState<string | null>(null);
  const [editingTargetDate, setEditingTargetDate] = useState(false);
  const [targetDateValue, setTargetDateValue] = useState('');
  const [generatingPhaseTasks, setGeneratingPhaseTasks] = useState(false);

  const [showApplicabilityModal, setShowApplicabilityModal] = useState(false);
  const [applicabilityModalControl, setApplicabilityModalControl] = useState<any>(null);
  const [applicabilityJustification, setApplicabilityJustification] = useState('');
  const [applicabilityIsApplicable, setApplicabilityIsApplicable] = useState(true);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewingRecord, setReviewingRecord] = useState<any>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [applicabilityStatusFilter, setApplicabilityStatusFilter] = useState<string>('all');

  const generateReportMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.get(`/certifications/${journeyId}/report`, {
        responseType: 'blob'
      });
      return response.data as Blob;
    },
    onSuccess: (blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `framework-${journeyId}-report.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    }
  });

  const enhanceMutation = useMutation({
    mutationFn: async (frameworkId: number) => {
      return await apiClient.post(`/framework-upload/parser/frameworks/${frameworkId}/enhance`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['certification-controls', journeyId] });
      setEnhanceSuccess(`Enhancement started for ${data.data?.total_controls || 0} controls. Estimated time: ${data.data?.estimated_time_minutes || 1} minutes.`);
      setTimeout(() => setEnhanceSuccess(null), 8000);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.detail || error?.message || 'Enhancement failed';
      setEnhanceError(message);
      setTimeout(() => setEnhanceError(null), 5000);
    }
  });

  const updateTargetDateMutation = useMutation({
    mutationFn: async (targetDate: string) => {
      return certificationsApi.update(journeyId, { target_date: targetDate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification', journeyId] });
      setEditingTargetDate(false);
    }
  });

  const generatePhasesMutation = useMutation({
    mutationFn: async () => {
      setGeneratingPhaseTasks(true);
      return apiClient.post(`/certifications/${journeyId}/generate-phases`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journey-phases', journeyId] });
      queryClient.invalidateQueries({ queryKey: ['certification', journeyId] });
      setGeneratingPhaseTasks(false);
      setEnhanceSuccess('AI successfully generated certification journey phases.');
      setTimeout(() => setEnhanceSuccess(null), 5000);
    },
    onError: (error: any) => {
      setGeneratingPhaseTasks(false);
      const message = error?.response?.data?.detail || error?.message || 'Failed to generate phases';
      setEnhanceError(message);
      setTimeout(() => setEnhanceError(null), 5000);
    }
  });

  const { data: progress } = useQuery({
    queryKey: ['certification-progress', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getProgress(journeyId);
      return response.data as ProgressSummary;
    },
    enabled: !!journeyId,
  });

  const { data: gaps } = useQuery({
    queryKey: ['certification-gaps', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getGaps(journeyId);
      return response.data;
    },
    enabled: !!journeyId,
  });

  const { data: journeyPhasesData, isLoading: phasesLoading } = useQuery({
    queryKey: ['journey-phases', journeyId],
    queryFn: async () => {
      const response = await apiClient.get(`/certifications/${journeyId}/journey-phases`);
      return response.data;
    },
    enabled: !!journeyId,
  });

  const phasesGenerated = journeyPhasesData?.generated || false;
  const phaseGenerationTriggered = useRef(false);

  const frameworkClassification = ((journey as any)?.framework_classification || '').toLowerCase();
  const fallbackName = (((journey as any)?.framework_name || journey?.framework?.name || '') as string).toLowerCase();
  const isCertificationFramework = frameworkClassification
    ? frameworkClassification === 'certification'
    : (fallbackName.includes('iso') || fallbackName.includes('pci'));
  const entityLabel = isCertificationFramework ? 'Control' : 'Requirement';
  const entityLabelPlural = isCertificationFramework ? 'Controls' : 'Requirements';
  const frameworkOverview = (journey as any)?.framework_overview || {};

  useEffect(() => {
    if (
      journeyId &&
      journeyPhasesData &&
      isCertificationFramework &&
      !journeyPhasesData.generated &&
      !generatingPhaseTasks &&
      !generatePhasesMutation.isPending &&
      !phaseGenerationTriggered.current
    ) {
      phaseGenerationTriggered.current = true;
      generatePhasesMutation.mutate();
    }
  }, [journeyId, journeyPhasesData?.generated, isCertificationFramework]);

  const phases = (journeyPhasesData?.phases || []).map((phase: any) => ({
    id: phase.phase_number || phase.id,
    name: phase.name,
    description: phase.description,
    estimated_duration: phase.estimated_duration || '',
    tasks: phase.key_tasks || [],
    deliverables: phase.deliverables || [],
    status: phase.status || 'not_started',
  }));

  useEffect(() => {
    if (progress?.by_domain?.length && !selectedDomain) {
      setSelectedDomain(progress.by_domain[0].domain_id);
    }
  }, [progress, selectedDomain]);

  const { data: cdeData, isLoading: cdeLoading } = useQuery({
    queryKey: ['cde-systems'],
    queryFn: async () => {
      const response = await certificationsApi.getCDESystems();
      return response.data as {
        systems: Array<{
          id: number;
          name: string;
          asset_type: string;
          description: string;
          location: string;
          owner_name: string | null;
          owner_id: number | null;
          vendor: string | null;
          criticality: string;
          status: string;
          cde_environment: boolean;
          created_at: string;
        }>;
        summary: {
          total: number;
          type_breakdown: Record<string, number>;
          criticality_breakdown: Record<string, number>;
        };
      };
    },
    enabled: activeTab === 'cde-scope',
  });

  const { data: cdeAssetsFallback, isLoading: cdeAssetsFallbackLoading } = useQuery({
    queryKey: ['cde-assets-fallback'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data as ITAsset[];
    },
    enabled: activeTab === 'cde-scope',
  });

  const { data: applicabilityData, isLoading: applicabilityLoading } = useQuery({
    queryKey: ['applicability', journey?.framework_id, applicabilityStatusFilter],
    queryFn: async () => {
      if (!journey?.framework_id) return null;
      const params = applicabilityStatusFilter !== 'all' ? `?status_filter=${applicabilityStatusFilter}` : '';
      const response = await governanceApi.getFrameworkApplicability(journey.framework_id);
      return response.data;
    },
    enabled: !!journey?.framework_id && activeTab === 'applicability',
  });

  const { data: applicabilityAuditLog } = useQuery({
    queryKey: ['applicability-audit-log', journey?.framework_id],
    queryFn: async () => {
      if (!journey?.framework_id) return [];
      const response = await governanceApi.getApplicabilityAuditLog(journey.framework_id);
      return response.data;
    },
    enabled: !!journey?.framework_id && activeTab === 'applicability',
  });

  const setApplicabilityMutation = useMutation({
    mutationFn: async (data: { control_id: number; uploaded_framework_id: number; is_applicable: boolean; justification: string }) => {
      return governanceApi.setClauseApplicability(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicability'] });
      queryClient.invalidateQueries({ queryKey: ['applicability-audit-log'] });
      setShowApplicabilityModal(false);
      setApplicabilityJustification('');
      setApplicabilityModalControl(null);
    },
  });

  const reviewApplicabilityMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { status: string; review_comment?: string } }) => {
      return governanceApi.reviewApplicability(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['applicability'] });
      queryClient.invalidateQueries({ queryKey: ['applicability-audit-log'] });
      setShowReviewModal(false);
      setReviewingRecord(null);
      setReviewComment('');
    },
  });

  const isLoading = journeyLoading || controlsLoading;
  const totalControlsProgress = progress?.total_controls || 0;
  const implementedCount = (progress as any)?.implemented_count ?? (progress as any)?.implemented ?? 0;
  const verifiedCount = (progress as any)?.verified_count ?? (progress as any)?.verified ?? 0;
  const inProgressCount = (progress as any)?.in_progress_count ?? (progress as any)?.in_progress ?? 0;
  const notApplicableCount = (progress as any)?.not_applicable_count ?? (progress as any)?.not_applicable ?? 0;
  const completionPercentage = progress?.completion_percentage || 0;
  const evidenceCoveragePercentage = (progress as any)?.evidence_coverage_percentage ?? completionPercentage;
  const readinessPercentage = (progress as any)?.readiness_percentage ?? completionPercentage;
  const controlsWithEvidence = (progress as any)?.with_evidence_count ?? 0;
  const fullyEvidencedControls = (progress as any)?.fully_evidenced_count ?? 0;

  const togglePhase = (phaseId: number) => {
    setExpandedPhases(prev => 
      prev.includes(phaseId) 
        ? prev.filter(id => id !== phaseId)
        : [...prev, phaseId]
    );
  };

  const toggleDomain = (domainId: string) => {
    setExpandedDomains(prev => 
      prev.includes(domainId) 
        ? prev.filter(id => id !== domainId)
        : [...prev, domainId]
    );
  };

  const toggleControl = (controlId: number) => {
    console.info('[JourneyTrace] toggle control accordion', { controlId });
    setExpandedControls(prev => 
      prev.includes(controlId) 
        ? prev.filter(id => id !== controlId)
        : [...prev, controlId]
    );
  };

  const makeSubControlKey = (sub: SubControlWithEvidence, depth: number, index: number): string => {
    return `${sub.id || 'na'}::${sub.code || 'no-code'}::${depth}::${index}`;
  };

  const toggleSubControl = (key: string, meta: { code?: string; depth: number; hasChildren: boolean }) => {
    console.info('[JourneyTrace] toggle sub-control', { key, ...meta });
    setExpandedSubControlKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const focusControlByCode = (controlCode?: string) => {
    if (!controlCode) return;
    const trimmed = controlCode.trim();
    if (!trimmed) return;

    const match = (controls || []).find((ctrl: CertificationControl) => {
      const code = (ctrl.control_code || '').trim();
      return code === trimmed || code.startsWith(`${trimmed}.`) || trimmed.startsWith(`${code}.`);
    });

    console.info('[JourneyTrace] focusControlByCode', {
      requestedCode: trimmed,
      controlsCount: (controls || []).length,
      foundMatch: !!match,
      activeFilters: {
        categoryFilter,
        statusFilter,
        sortOrder,
        searchQuery,
      },
    });

    if (!match) return;

    setExpandedControls((prev) => (prev.includes(match.id) ? prev : [...prev, match.id]));
    setTimeout(() => {
      const el = document.getElementById(`control-${match.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 80);
  };

  const handleFileUpload = (controlId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadingControlId(controlId);
      uploadEvidenceMutation.mutate({ controlId, file });
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  // Natural sort comparison for section/clause numbers (e.g., "1.2.10" should come after "1.2.9")
  const naturalSortCompare = (a: string, b: string): number => {
    const aParts = (a || '').split(/[.\-_\s]+/).map(p => {
      const num = parseInt(p, 10);
      return isNaN(num) ? p.toLowerCase() : num;
    });
    const bParts = (b || '').split(/[.\-_\s]+/).map(p => {
      const num = parseInt(p, 10);
      return isNaN(num) ? p.toLowerCase() : num;
    });
    
    const maxLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLen; i++) {
      const aPart = aParts[i] ?? '';
      const bPart = bParts[i] ?? '';
      
      if (typeof aPart === 'number' && typeof bPart === 'number') {
        if (aPart !== bPart) return aPart - bPart;
      } else if (typeof aPart === 'number') {
        return -1; // Numbers come before strings
      } else if (typeof bPart === 'number') {
        return 1;
      } else {
        const cmp = String(aPart).localeCompare(String(bPart));
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };

  const filteredControls = controls?.filter((control: CertificationControl) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        control.control_code?.toLowerCase().includes(query) ||
        control.control_name?.toLowerCase().includes(query) ||
        control.control_statement?.toLowerCase().includes(query);
      if (!matchesSearch) return false;
    }
    if (categoryFilter !== 'all') {
      const category = getCategoryFromDomain(control.domain_name).toLowerCase();
      if (category !== categoryFilter) return false;
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'not_implemented' && control.status !== 'not_started') return false;
      if (statusFilter === 'implemented' && !['implemented', 'verified'].includes(control.status)) return false;
      if (statusFilter === 'partial' && control.status !== 'in_progress') return false;
      if (statusFilter === 'in_progress' && control.status !== 'in_progress') return false;
      if (statusFilter === 'verified' && control.status !== 'verified') return false;
    }
    return true;
  }).sort((a: CertificationControl, b: CertificationControl) => {
    const codeA = a.original_control_code || a.system_control_code || a.control_code || '';
    const codeB = b.original_control_code || b.system_control_code || b.control_code || '';
    const result = naturalSortCompare(codeA, codeB);
    return sortOrder === 'desc' ? -result : result;
  }) || [];

  useEffect(() => {
    console.info('[JourneyTrace] filtered controls recalculated', {
      totalControls: (controls || []).length,
      filteredControls: filteredControls.length,
      filters: {
        searchQuery,
        categoryFilter,
        statusFilter,
        sortOrder,
      },
    });
  }, [controls, filteredControls.length, searchQuery, categoryFilter, statusFilter, sortOrder]);

  const controlStats = {
    total: controls?.length || 0,
    applicable: controls?.filter((c: CertificationControl) => c.is_applicable).length || 0,
    notApplicable: controls?.filter((c: CertificationControl) => !c.is_applicable).length || 0,
    implemented: controls?.filter((c: CertificationControl) => ['implemented', 'verified'].includes(c.status)).length || 0,
    partial: controls?.filter((c: CertificationControl) => c.status === 'in_progress').length || 0,
    notImplemented: controls?.filter((c: CertificationControl) => c.status === 'not_started').length || 0,
    byCategory: {
      organizational: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'Organizational').length || 0,
      people: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'People').length || 0,
      physical: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'Physical').length || 0,
      technological: controls?.filter((c: CertificationControl) => getCategoryFromDomain(c.domain_name) === 'Technological').length || 0,
    }
  };

  const totalEvidence = (controls || []).reduce(
    (acc: number, c: CertificationControl) => acc + (c.evidence_count ?? (c.evidence ? c.evidence.length : 0)),
    0
  );

  const handleControlClick = (control: ControlImplementation) => {
    setSelectedControl(control);
    setShowControlModal(true);
  };

  const phaseTabs = phases.map((phase, index) => ({
    id: `phase-${phase.id}` as TabType,
    label: `${index + 1}. ${phase.name.split(' ')[0]}`
  }));

  const isPciDssFramework = (
    (journey as any)?.framework_name ||
    journey?.framework?.name ||
    ''
  ).toLowerCase().includes('pci');

  const toggleRequirementText = (controlId: number) => {
    setExpandedRequirementTextIds((prev) =>
      prev.includes(controlId) ? prev.filter((id) => id !== controlId) : [...prev, controlId]
    );
  };
  
  const tabs: { id: TabType; label: string; icon?: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview' },
    ...(isCertificationFramework ? [{ id: 'phases' as TabType, label: 'Phases' }] : []),
    ...(isPciDssFramework ? [{ id: 'cde-scope' as TabType, label: 'CDE Scope' }] : []),
    { id: 'controls', label: entityLabelPlural },
    { id: 'applicability', label: 'Applicability' },
  ];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (journeyError || !journey) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load certification journey</p>
        <button 
          onClick={() => router.push('/frameworks')}
          className="btn-secondary mt-4"
        >
          Back to Frameworks
        </button>
      </div>
    );
  }

  const CircularProgress = ({ percentage }: { percentage: number }) => {
    const circumference = 2 * Math.PI * 45;
    const strokeDashoffset = circumference - (percentage / 100) * circumference;
    
    return (
      <div className="relative h-32 w-32">
        <svg className="h-32 w-32 -rotate-90 transform">
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            className="text-gray-200"
          />
          <circle
            cx="64"
            cy="64"
            r="45"
            stroke="currentColor"
            strokeWidth="8"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="text-blue-600 transition-all duration-500"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold cw-text">{percentage}%</span>
          <span className="text-xs text-gray-600">Ready</span>
        </div>
      </div>
    );
  };

  const renderOverviewTab = () => (
    !isCertificationFramework ? (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <div className="cw-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
              <Sparkles className="h-5 w-5 text-blue-600" />
              AI Framework Overview
            </h3>
            <div className="space-y-4 text-sm text-gray-700">
              {frameworkOverview.purpose && (
                <div>
                  <p className="font-semibold text-black">Purpose</p>
                  <p>{frameworkOverview.purpose}</p>
                </div>
              )}
              {frameworkOverview.scope && (
                <div>
                  <p className="font-semibold text-black">Scope</p>
                  <p>{frameworkOverview.scope}</p>
                </div>
              )}
              {frameworkOverview.classification_reasoning && (
                <div>
                  <p className="font-semibold text-black">AI Assessment</p>
                  <p>{frameworkOverview.classification_reasoning}</p>
                </div>
              )}
              {Array.isArray(frameworkOverview.objectives) && frameworkOverview.objectives.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold text-black">Key Objectives</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {frameworkOverview.objectives.slice(0, 8).map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(frameworkOverview.adoption_approach) && frameworkOverview.adoption_approach.length > 0 && (
                <div>
                  <p className="mb-2 font-semibold text-black">Adoption Approach</p>
                  <ul className="list-disc pl-5 space-y-1">
                    {frameworkOverview.adoption_approach.slice(0, 8).map((item: string, idx: number) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {!frameworkOverview.purpose && !frameworkOverview.scope && !frameworkOverview.classification_reasoning && (
                <p className="text-gray-500">AI overview data is not yet available for this framework.</p>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="cw-card p-6">
            <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              Key Metrics
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">{entityLabelPlural} Implemented</span>
                <span className="font-semibold cw-text">{progress?.implemented || 0}/{progress?.total_controls || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">{entityLabelPlural} In Progress</span>
                <span className="font-semibold text-blue-600">{progress?.in_progress || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">Evidence Collected</span>
                <span className="font-semibold cw-text">{totalEvidence}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="cw-text-muted">Open Gaps</span>
                <span className="font-semibold text-orange-600">{(gaps as any)?.not_implemented?.length || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="cw-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
            <Clock className="h-5 w-5 text-blue-600" />
            Certification Timeline
          </h3>
          <div className="space-y-2">
            {phases.length === 0 && phasesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
              </div>
            ) : phases.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <p className="text-sm text-gray-500">No certification phases defined for this framework</p>
              </div>
            ) : phases.map((phase) => {
              const isExpanded = expandedPhases.includes(phase.id);
              const isCurrent = journey.current_phase === phase.id;
              const isCompleted = journey.current_phase > phase.id;
              
              return (
                <div key={phase.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
                  <button
                    onClick={() => togglePhase(phase.id)}
                    className="flex w-full items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                        isCompleted ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {isCompleted ? <Check className="h-4 w-4" /> : phase.id}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isCompleted ? 'text-emerald-700' : isCurrent ? 'cw-text' : 'cw-text-muted'}`}>
                            {phase.name}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                              In Progress
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-500">{phase.description}</p>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 cw-text-muted" />
                    ) : (
                      <ChevronDown className="h-5 w-5 cw-text-muted" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[var(--color-border)] p-4">
                      <div className="mb-3">
                        <h4 className="mb-2 text-sm font-medium text-gray-700">Key Tasks</h4>
                        <ul className="space-y-1">
                          {phase.tasks.map((task, idx) => (
                            <li key={idx} className="flex items-center gap-2 text-sm cw-text-muted">
                              <Circle className="h-2 w-2 fill-current" />
                              {task}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-gray-700">Deliverables</h4>
                        <div className="flex flex-wrap gap-2">
                          {phase.deliverables.map((deliverable, idx) => (
                            <span key={idx} className="rounded-full bg-[var(--color-subtle)] px-3 py-1 text-xs cw-text-muted">
                              {deliverable}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div className="cw-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            Key Metrics
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Controls Implemented</span>
                <span className="font-semibold cw-text">{implementedCount}/{totalControlsProgress}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Controls In Progress</span>
                <span className="font-semibold text-blue-600">{inProgressCount || controlsWithEvidence}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Evidence Collected</span>
              <span className="font-semibold cw-text">{totalEvidence}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Not Applicable</span>
                <span className="font-semibold text-gray-500">{notApplicableCount}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="cw-text-muted">Open Gaps</span>
              <span className="font-semibold text-orange-600">{(gaps as any)?.not_implemented?.length || 0}</span>
            </div>
          </div>
        </div>

        <div className="cw-card p-6">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold cw-text">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            Attention Required
          </h3>
          <div className="space-y-3">
            {(gaps as any)?.not_implemented?.length > 0 && (
              <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
                <p className="text-sm font-medium text-orange-700">{(gaps as any).not_implemented.length} {entityLabelPlural.toLowerCase()} not implemented</p>
                <p className="text-xs text-gray-600">Require implementation</p>
              </div>
            )}
            {(gaps as any)?.missing_evidence?.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-sm font-medium text-amber-700">{(gaps as any).missing_evidence.length} controls missing evidence</p>
                <p className="text-xs text-gray-600">Evidence collection needed</p>
              </div>
            )}
            {(gaps as any)?.pending_verification?.length > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3">
                <p className="text-sm font-medium text-blue-700">{(gaps as any).pending_verification.length} controls pending verification</p>
                <p className="text-xs text-gray-600">Ready for review</p>
              </div>
            )}
            {!(gaps as any)?.not_implemented?.length && !(gaps as any)?.missing_evidence?.length && !(gaps as any)?.pending_verification?.length && (
              <p className="text-sm text-gray-500">No attention items at this time</p>
            )}
          </div>
        </div>
      </div>
    </div>
    )
  );

  const renderPhasesTab = () => (
    !isCertificationFramework ? (
      <div className="cw-card p-8 text-center">
        <p className="text-lg font-semibold text-black">Phases are disabled for compliance frameworks</p>
        <p className="mt-2 text-sm text-gray-600">Use the Overview and {entityLabelPlural} tabs to manage compliance implementation.</p>
      </div>
    ) : (
    <div className="cw-card p-6">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold cw-text">Certification Journey Phases</h3>
          {phasesGenerated && (
            <span className="flex items-center gap-1 rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-xs text-purple-700">
              <Sparkles className="h-3 w-3" />
              AI Generated
            </span>
          )}
          {!phasesGenerated && !generatingPhaseTasks && phases.length > 0 && (
            <button
              onClick={() => generatePhasesMutation.mutate()}
              disabled={generatingPhaseTasks || generatePhasesMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-700 hover:from-purple-100 hover:to-blue-100 transition-all disabled:opacity-50"
            >
              <Sparkles className="h-3 w-3" />
              Generate Journey Phases
            </button>
          )}
        </div>
        <span className="text-sm text-gray-600">
          {phases.length > 0 ? `${phases.length} Phases` : ''}
        </span>
      </div>
      <div className="space-y-3">
        {(phasesLoading || generatingPhaseTasks || generatePhasesMutation.isPending) && phases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <div className="mb-4 relative">
              <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
              <Sparkles className="h-4 w-4 text-purple-500 absolute -top-1 -right-1 animate-pulse" />
            </div>
            <p className="text-sm font-medium text-black mb-1">Generating Certification Journey Phases</p>
            <p className="text-xs text-gray-600 text-center max-w-md">AI is analyzing the framework controls and domains to create a tailored compliance roadmap with actionable tasks and deliverables...</p>
          </div>
        ) : phases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Sparkles className="mb-3 h-10 w-10 text-gray-400" />
            <p className="text-sm text-gray-600 mb-1">No certification phases generated yet</p>
            <p className="text-xs text-gray-500 mb-4">Phases will be automatically generated using AI</p>
            <button
              onClick={() => generatePhasesMutation.mutate()}
              disabled={generatePhasesMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-white hover:from-purple-700 hover:to-blue-700 transition-all disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              Generate Journey Phases
            </button>
          </div>
        ) : phases.map((phase) => {
          const isExpanded = expandedPhases.includes(phase.id);
          const isCurrent = journey.current_phase === phase.id;
          const isCompleted = journey.current_phase > phase.id;
          
          return (
            <div key={phase.id} className={`rounded-lg border ${isCurrent ? 'border-blue-300' : 'border-gray-200'} bg-white`}>
              <button
                onClick={() => togglePhase(phase.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                    isCompleted ? 'bg-emerald-500 text-white' : isCurrent ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {isCompleted ? <Check className="h-5 w-5" /> : phase.id}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-medium ${isCompleted ? 'text-emerald-700' : isCurrent ? 'text-black' : 'text-gray-600'}`}>
                        {phase.name}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          Current
                        </span>
                      )}
                      {isCompleted && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Completed
                        </span>
                      )}
                      {phase.estimated_duration && (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {phase.estimated_duration}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 line-clamp-2">{phase.description}</p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-5 w-5 text-gray-600 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-gray-600 flex-shrink-0" />
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-gray-200 p-4">
                  {phase.description && (
                    <p className="text-sm text-gray-600 mb-4">{phase.description}</p>
                  )}
                  {phase.tasks.length === 0 && phase.deliverables.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-4 text-center">
                      <p className="text-sm text-gray-500">No tasks or deliverables defined for this phase</p>
                    </div>
                  ) : (
                    <div className="grid gap-6 md:grid-cols-2">
                      {phase.tasks.length > 0 && (
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
                            <CheckCircle2 className="h-4 w-4" />
                            Key Tasks
                          </h4>
                          <ul className="space-y-2">
                            {phase.tasks.map((task: string, idx: number) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                                <Circle className="mt-1.5 h-2 w-2 flex-shrink-0 fill-gray-400 text-gray-400" />
                                {task}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {phase.deliverables.length > 0 && (
                        <div>
                          <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-700">
                            <FileText className="h-4 w-4" />
                            Deliverables
                          </h4>
                          <div className="flex flex-wrap gap-2">
                            {phase.deliverables.map((deliverable: string, idx: number) => (
                              <span key={idx} className="rounded-full bg-blue-50 px-3 py-1 text-xs text-blue-700">
                                {deliverable}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
    )
  );

  const renderScopingTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <MapPin className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">0</p>
            <p className="text-xs text-slate-400">Locations</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-orange-500/20 p-2">
            <XCircle className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">0</p>
            <p className="text-xs text-slate-400">Exclusions</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-purple-500/20 p-2">
            <Building2 className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">0</p>
            <p className="text-xs text-slate-400">Departments</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-green-500/20 p-2">
            <Percent className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">0%</p>
            <p className="text-xs text-slate-400">Complete</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-6 flex gap-4 border-b border-slate-700">
          {(['definition', 'locations', 'exclusions', 'departments'] as ScopingSubTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setScopingSubTab(tab)}
              className={`border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                scopingSubTab === tab
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {tab === 'definition' ? 'Scope Definition' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {scopingSubTab === 'definition' && (
          <div className="space-y-6">
            <div>
              <label className="label">Scope Name</label>
              <input
                type="text"
                className="input"
                placeholder="Enter scope name..."
              />
            </div>
            <div>
              <label className="label">Description</label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Describe the scope of the ISMS..."
              />
            </div>
            <div>
              <label className="label">Boundaries</label>
              <textarea
                className="input min-h-[100px]"
                placeholder="Define the boundaries of the ISMS..."
              />
            </div>
            <div className="flex gap-3">
              <button className="btn-secondary flex items-center gap-2">
                <Download className="h-4 w-4" />
                Download Scope Report
              </button>
              <button className="btn-primary flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Create Scope
              </button>
            </div>
          </div>
        )}

        {scopingSubTab === 'locations' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <MapPin className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No Locations Defined</h3>
            <p className="mt-1 text-slate-400">Add locations that are in scope for certification</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Location
            </button>
          </div>
        )}

        {scopingSubTab === 'exclusions' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <XCircle className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No Exclusions Defined</h3>
            <p className="mt-1 text-slate-400">Document any scope exclusions with justifications</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Exclusion
            </button>
          </div>
        )}

        {scopingSubTab === 'departments' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Building2 className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No Departments Defined</h3>
            <p className="mt-1 text-slate-400">Add departments that are in scope for certification</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Department
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderSubControlsRecursive = (subControls: SubControlWithEvidence[], depth: number): JSX.Element => {
    const borderColors = ['border-blue-300', 'border-cyan-300', 'border-purple-300'];
    const bgColors = ['bg-gray-50', 'bg-gray-50', 'bg-white'];
    const borderColor = borderColors[Math.min(depth, borderColors.length - 1)];
    const bgColor = bgColors[Math.min(depth, bgColors.length - 1)];
    
    return (
      <div className={`space-y-2 ${depth > 0 ? `pl-4 border-l-2 ${borderColor}` : `pl-4 border-l-2 ${borderColor}`}`}>
        {subControls.map((sub, idx) => {
          const key = makeSubControlKey(sub, depth, idx);
          const hasChildren = !!(sub.sub_controls && sub.sub_controls.length > 0);
          const isExpanded = expandedSubControlKeys.includes(key);

          return (
          <div key={sub.id || idx} className={`rounded-lg ${bgColor} border border-gray-200 p-3`}>
            <div className="flex items-start gap-3">
              <ChevronRight className={`h-4 w-4 mt-0.5 flex-shrink-0 ${depth === 0 ? 'text-blue-600' : depth === 1 ? 'text-cyan-600' : 'text-purple-600'}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (hasChildren) {
                        toggleSubControl(key, { code: sub.code, depth, hasChildren });
                      } else {
                        focusControlByCode(sub.code);
                      }
                    }}
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-blue-50"
                    title={hasChildren ? 'Expand/collapse sub-controls in place' : `Locate ${entityLabel.toLowerCase()} ${sub.code}`}
                  >
                    {hasChildren ? (
                      isExpanded ? <ChevronDown className="h-3 w-3 text-gray-600" /> : <ChevronRight className="h-3 w-3 text-gray-600" />
                    ) : null}
                    <span className={`font-mono text-xs ${depth === 0 ? 'text-blue-600' : depth === 1 ? 'text-cyan-600' : 'text-purple-600'}`}>{sub.code}</span>
                    <span className="text-sm font-medium text-black underline decoration-dotted underline-offset-2">{sub.name}</span>
                  </button>
                  {depth > 0 && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">Level {depth + 1}</span>
                  )}
                </div>
                {sub.description && (
                  <p className="text-xs text-gray-600 mt-1 line-clamp-2">{sub.description}</p>
                )}
                {sub.evidence_requirements && sub.evidence_requirements.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sub.evidence_requirements.slice(0, 4).map((ev, evIdx) => (
                      <span key={evIdx} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                        {ev.title}
                      </span>
                    ))}
                    {sub.evidence_requirements.length > 4 && (
                      <span className="text-xs text-gray-600">+{sub.evidence_requirements.length - 4} more</span>
                    )}
                  </div>
                )}
                {(!sub.evidence_requirements || sub.evidence_requirements.length === 0) && sub.evidence_recommendations && sub.evidence_recommendations.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sub.evidence_recommendations.slice(0, 4).map((rec, recIdx) => (
                      <span key={recIdx} className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700">
                        {rec}
                      </span>
                    ))}
                    {sub.evidence_recommendations.length > 4 && (
                      <span className="text-xs text-gray-600">+{sub.evidence_recommendations.length - 4} more</span>
                    )}
                  </div>
                )}
                {sub.sub_controls && sub.sub_controls.length > 0 && isExpanded && (
                  <div className="mt-3">
                    <p className="text-xs text-gray-600 mb-2">Sub-controls ({sub.sub_controls.length})</p>
                    {renderSubControlsRecursive(sub.sub_controls, depth + 1)}
                  </div>
                )}
              </div>
            </div>
          </div>
          );
        })}
      </div>
    );
  };

  const renderControlAccordion = (control: CertificationControl, showUpload = true) => {
    const isExpanded = expandedControls.includes(control.id);
    const category = getCategoryFromDomain(control.domain_name);
    const statusConfig: Record<string, { label: string; color: string }> = {
      not_started: { label: 'Not Implemented', color: 'bg-rose-50 text-rose-700' },
      in_progress: { label: 'Partial', color: 'bg-amber-50 text-amber-700' },
      implemented: { label: 'Implemented', color: 'bg-emerald-50 text-emerald-700' },
      verified: { label: 'Verified', color: 'bg-blue-50 text-blue-700' },
      not_applicable: { label: 'N/A', color: 'bg-gray-50 text-gray-700' },
    };
    const status = statusConfig[control.status] || statusConfig.not_started;
    const evidenceCount = control.evidence_count ?? (control.evidence ? control.evidence.length : 0);
    const requiredEvidenceCount = control.required_evidence_count ?? (control.evidence_requirements ? control.evidence_requirements.length : 0);
    const approvedEvidenceCount = control.approved_evidence_count ?? (control.evidence ? control.evidence.filter((ev) => ev.review_status === 'approved').length : 0);
    const hasEvidence = evidenceCount > 0;
    const evidenceCoverageValue = control.evidence_coverage ?? (requiredEvidenceCount > 0 ? Math.min(1, evidenceCount / requiredEvidenceCount) : hasEvidence ? 1 : 0);
    const isRequirementTextExpanded = expandedRequirementTextIds.includes(control.id);
    const requirementTextFull = control.control_statement_full || control.control_statement || '';
    const requirementTextShort = control.control_statement || requirementTextFull;
    const hasLongRequirementText = requirementTextFull.length > 160;
    
    return (
      <div id={`control-${control.id}`} key={control.id} className="rounded-lg border border-gray-200 bg-white">
        <button
          onClick={() => toggleControl(control.id)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-gray-600 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-gray-600 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-blue-600">{control.control_code}</span>
                <span className="font-medium text-black">{control.control_name}</span>
              </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                    Original: {control.original_control_code || control.control_code}
                  </span>
                  <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                    System: {control.system_control_code || control.control_code}
                  </span>
                </div>
              <p className="text-sm text-gray-500 mt-0.5 whitespace-pre-wrap break-words">{control.control_statement}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{category}</span>
            <span className={`rounded-lg px-2 py-1 text-xs ${control.is_applicable ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-50 text-gray-700'}`}>
              {control.is_applicable ? 'Applicable' : 'N/A'}
            </span>
            <span className={`rounded-lg px-2 py-1 text-xs ${status.color}`}>{status.label}</span>
            <span className="text-xs text-gray-500">{approvedEvidenceCount}/{requiredEvidenceCount || '—'} approved</span>
            <span className="text-xs text-gray-500">{evidenceCount}/{requiredEvidenceCount || '—'} evidence</span>
            <div className="flex items-center gap-1">
              <Circle className={`h-4 w-4 ${hasEvidence ? 'text-emerald-600 fill-emerald-600' : 'text-gray-300'}`} />
              <span className="text-[10px] text-gray-500">{Math.round(evidenceCoverageValue * 100)}%</span>
            </div>
          </div>
        </button>
        {isExpanded && (
          <div className="border-t border-gray-200 p-4">
            {/* Sub-controls section - recursive hierarchy */}
            {control.sub_controls && control.sub_controls.length > 0 && (
              <div className="mb-6">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-black">
                  <Layers className="h-4 w-4 text-blue-600" />
                  {entityLabel} Hierarchy ({control.sub_controls.length} sub-controls)
                </h4>
                {renderSubControlsRecursive(control.sub_controls, 0)}
              </div>
            )}
            
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Linked Evidence - Now appears FIRST (left column) */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-black">
                    <Paperclip className="h-4 w-4 text-blue-600" />
                    Linked Evidence ({evidenceCount})
                  </h4>
                  {showUpload && (
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(control.id, e)}
                        disabled={uploadingControlId === control.id}
                      />
                      <span className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
                        {uploadingControlId === control.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        Upload
                      </span>
                    </label>
                  )}
                </div>
                {control.evidence?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence.map((ev: ControlEvidence) => {
                      const getAIAssessmentBadge = () => {
                        const status = ev.ai_assessment_status || 'pending';
                        switch (status) {
                          case 'completed':
                            return { label: 'Assessed', className: 'bg-emerald-50 text-emerald-700' };
                          case 'processing':
                            return { label: 'Assessing...', className: 'bg-amber-50 text-amber-700' };
                          case 'pending_assessment':
                            return { label: 'Ready for Assessment', className: 'bg-blue-50 text-blue-700' };
                          case 'pending_ocr':
                            return { label: 'Processing...', className: 'bg-gray-50 text-gray-700' };
                          default:
                            return { label: 'Pending', className: 'bg-gray-50 text-gray-700' };
                        }
                      };
                      const aiBadge = getAIAssessmentBadge();
                      const canAssess = ev.ai_assessment_status === 'pending_assessment' || ev.ai_assessment_status === 'pending' || !ev.ai_assessment_status;
                      const isAssessing = assessingEvidenceId === ev.id;
                      const isPendingReview = ev.review_status === 'pending';
                      
                      return (
                        <div key={ev.id} className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                          <div className="flex items-center gap-3">
                            <Paperclip className="h-4 w-4 text-gray-600 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-black truncate">{ev.file_name || 'Evidence file'}</p>
                              <p className="text-xs text-gray-500">{ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`rounded px-2 py-0.5 text-xs ${aiBadge.className}`} title={ev.ai_assessment_summary || ''}>
                                {aiBadge.label}
                              </span>
                              <span className={`rounded px-2 py-0.5 text-xs ${
                                ev.review_status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                                ev.review_status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                                'bg-amber-50 text-amber-700'
                              }`}>
                                {ev.review_status}
                              </span>
                            </div>
                          </div>
                          {ev.ai_assessment_summary && (
                            <div className="mt-2 ml-7 rounded bg-white border border-gray-200 p-2">
                              <p className="text-xs text-gray-700">{ev.ai_assessment_summary}</p>
                            </div>
                          )}
                          {/* Action buttons row */}
                          <div className="mt-3 ml-7 flex items-center gap-2 flex-wrap">
                            {isPendingReview && (
                              <>
                                <button
                                  onClick={() => {
                                    reviewEvidenceMutation.mutate({ evidenceId: ev.id, action: 'approve' });
                                  }}
                                  disabled={reviewEvidenceMutation.isPending}
                                  className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                  title="Approve evidence"
                                >
                                  <CheckCircle className="h-3 w-3" />
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    reviewEvidenceMutation.mutate({ evidenceId: ev.id, action: 'reject' });
                                  }}
                                  disabled={reviewEvidenceMutation.isPending}
                                  className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                                  title="Reject evidence"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </button>
                              </>
                            )}
                            {canAssess && ev.linked_evidence_id && (
                              <button
                                onClick={() => {
                                  setAssessingEvidenceId(ev.id);
                                  assessEvidenceMutation.mutate(ev.linked_evidence_id);
                                }}
                                disabled={isAssessing}
                                className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                                title="Trigger AI assessment"
                              >
                                {isAssessing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3" />
                                )}
                                Assess
                              </button>
                            )}
                            <button
                              onClick={() => {
                                if (window.confirm('Unlink this evidence from the control? The evidence will remain in your evidence library.')) {
                                  setDeletingEvidenceId(ev.id);
                                  deleteEvidenceMutation.mutate(ev);
                                }
                              }}
                              disabled={deletingEvidenceId === ev.id}
                              className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                              title="Unlink evidence from this control"
                            >
                              {deletingEvidenceId === ev.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Unlink className="h-3 w-3" />
                              )}
                              Unlink
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center">
                    <Paperclip className="mx-auto h-8 w-8 text-gray-400 mb-2" />
                    <p className="text-sm text-black">No evidence linked yet</p>
                    <p className="text-xs text-gray-600 mt-1">Upload evidence to comply</p>
                  </div>
                )}
              </div>
              {/* Required Evidence - Now appears SECOND (right column) */}
              <div>
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-black">
                  <FileCheck className="h-4 w-4 text-blue-600" />
                  Required Evidence for {entityLabel} {control.control_code}
                </h4>
                {control.evidence_requirements?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence_requirements.map((ev, idx: number) => {
                      const evType = ev.type || 'document';
                      const typeColors: Record<string, string> = {
                        'policy': 'bg-blue-100 text-blue-700',
                        'procedure': 'bg-purple-100 text-purple-700',
                        'log': 'bg-orange-100 text-orange-700',
                        'report': 'bg-pink-100 text-pink-700',
                        'screenshot': 'bg-cyan-100 text-cyan-700',
                        'record': 'bg-green-100 text-green-700',
                        'configuration': 'bg-indigo-100 text-indigo-700',
                        'certificate': 'bg-emerald-100 text-emerald-700',
                        'contract': 'bg-amber-100 text-amber-700',
                        'attestation': 'bg-teal-100 text-teal-700',
                        'test_results': 'bg-lime-100 text-lime-700',
                        'register': 'bg-violet-100 text-violet-700',
                      };
                      const typeColor = typeColors[evType] || 'bg-gray-100 text-gray-700';
                      const typeLabel = evType.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                      
                      return (
                        <div key={`${idx}`} className="rounded-lg bg-gray-50 border border-gray-200 p-3">
                          <div className="flex items-start gap-3">
                            <Radio className="h-4 w-4 text-blue-600 mt-1 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-black">{ev.title}</p>
                              {(() => {
                                const titleText = (ev.title || '').trim();
                                const descText = (ev.description || '').trim();
                                const isDuplicate = titleText.toLowerCase() === descText.toLowerCase();
                                return !descText || isDuplicate ? null : (
                                  <p className="text-xs text-gray-600 mt-1">{ev.description}</p>
                                );
                              })()}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-xs ${typeColor}`}>
                                  {typeLabel}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`rounded px-2 py-1 text-xs ${ev.is_required !== false ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-700'}`}>
                                {ev.is_required !== false ? 'Required' : 'Optional'}
                              </span>
                              {showUpload && (
                                <label className="cursor-pointer">
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => handleFileUpload(control.id, e)}
                                    disabled={uploadingControlId === control.id}
                                  />
                                  <span className="flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                                    {uploadingControlId === control.id ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Upload className="h-3 w-3" />
                                    )}
                                  </span>
                                </label>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  control.evidence_recommendations?.length ? (
                    <div className="rounded-lg bg-white border border-gray-200 p-4">
                      <p className="mb-2 text-sm font-medium text-black">Recommended Evidence</p>
                      <div className="flex flex-wrap gap-2">
                        {control.evidence_recommendations.map((rec: string, idx: number) => (
                          <span key={idx} className="rounded bg-blue-50 px-2 py-1 text-xs text-blue-700">{rec}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-white border border-dashed border-gray-300 p-4 text-center">
                      <p className="text-sm text-black">No evidence requirements defined</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSoaTab = () => {
    const soaChartData = [
      { name: 'Implemented', value: controlStats.implemented, fill: '#22c55e' },
      { name: 'In Progress',  value: controlStats.partial,      fill: '#f59e0b' },
      { name: 'Not Impl.',    value: controlStats.notImplemented, fill: '#ef4444' },
      { name: 'Not Applic.',  value: controlStats.notApplicable,  fill: '#94a3b8' },
    ].filter((d) => d.value > 0);
    const soaTotal = controlStats.total;
    return (
    <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {/* Donut: implementation status */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Implementation Status</p>
            <div className="flex items-center gap-4">
              <div className="relative h-[110px] w-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={soaChartData.length ? soaChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]}
                      cx="50%" cy="50%" innerRadius={30} outerRadius={50} dataKey="value" paddingAngle={2} stroke="none">
                      {(soaChartData.length ? soaChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]).map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold text-slate-900">{soaTotal}</span>
                  <span className="text-[10px] text-slate-400">controls</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {soaChartData.map((d) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                    <span className="text-slate-500">{d.name}</span>
                    <span className="font-semibold text-slate-800 ml-auto">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Coverage progress bar */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Coverage</p>
            {[{ label: 'Applicable', value: controlStats.applicable, total: soaTotal, color: '#3b82f6' },
              { label: 'Implemented', value: controlStats.implemented, total: Math.max(controlStats.applicable, 1), color: '#22c55e' },
            ].map(({ label, value, total: t, color }) => {
              const pct = t > 0 ? Math.round((value / t) * 100) : 0;
              return (
                <div key={label} className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">{label}</span>
                    <span className="font-semibold text-slate-800">{value} / {t} <span className="text-slate-400">({pct}%)</span></span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stats summary */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Breakdown</p>
            <div className="space-y-2">
              {[{ label: 'Total Controls', value: controlStats.total, color: '' },
                { label: 'Applicable',     value: controlStats.applicable, color: 'text-blue-600' },
                { label: 'Not Applicable', value: controlStats.notApplicable, color: 'text-slate-500' },
                { label: 'Implemented',    value: controlStats.implemented,   color: 'text-green-600' },
                { label: 'In Progress',    value: controlStats.partial,       color: 'text-amber-600' },
                { label: 'Not Impl.',      value: controlStats.notImplemented, color: 'text-red-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex justify-between text-xs">
                  <span className="text-slate-500">{label}</span>
                  <span className={`font-semibold ${color || 'text-slate-800'}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-gray-200 pb-4">
          {([
            { key: 'all', label: 'All', count: controlStats.total },
            { key: 'organizational', label: 'Organizational', count: controlStats.byCategory.organizational },
            { key: 'people', label: 'People', count: controlStats.byCategory.people },
            { key: 'physical', label: 'Physical', count: controlStats.byCategory.physical },
            { key: 'technological', label: 'Technological', count: controlStats.byCategory.technological },
          ] as { key: CategoryFilter; label: string; count: number }[]).map((cat) => (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(cat.key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                categoryFilter === cat.key
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-black'
              }`}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>

        <div className="mb-4 flex gap-4 items-center justify-end">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="input w-48"
          >
            <option value="all">All Status</option>
            <option value="implemented">Implemented</option>
            <option value="not_implemented">Not Implemented</option>
            <option value="partial">Partial</option>
          </select>
        </div>

        <div className="space-y-3">
          {filteredControls.length > 0 ? (
            filteredControls.map((control: CertificationControl) => renderControlAccordion(control))
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Shield className="mb-4 h-12 w-12 text-gray-400" />
              <p className="text-gray-600">No {entityLabelPlural.toLowerCase()} found</p>
              <p className="mt-1 text-sm text-gray-500">Try adjusting your filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
  };

  const renderControlsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center gap-3 p-4">
          <div className="rounded-lg bg-gray-100 p-2">
            <Layers className="h-5 w-5 text-gray-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-black">{controlStats.total}</p>
            <p className="text-xs text-gray-600">Total {entityLabelPlural}</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center gap-3 p-4">
          <div className="rounded-lg bg-emerald-50 p-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-600">{controlStats.implemented}</p>
            <p className="text-xs text-gray-600">Implemented</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center gap-3 p-4">
          <div className="rounded-lg bg-blue-50 p-2">
            <FileCheck className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-600">{controlStats.partial}</p>
            <p className="text-xs text-gray-600">In Progress</p>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center gap-3 p-4">
          <div className="rounded-lg bg-purple-50 p-2">
            <FileText className="h-5 w-5 text-purple-600" />
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-600">{totalEvidence}</p>
            <p className="text-xs text-gray-600">Evidence Collected</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-gray-600">Evidence Readiness</span>
          <span className="font-medium text-black">{readinessPercentage}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all"
            style={{ width: `${readinessPercentage}%` }}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
        <div className="mb-6 flex items-center justify-between border-b border-gray-200 pb-4">
          <div className="flex gap-4">
            {(['library', 'policies', 'evidence'] as ControlsSubTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setControlsSubTab(tab)}
                className={`text-sm font-medium transition-colors ${
                  controlsSubTab === tab
                    ? 'text-blue-600'
                    : 'text-gray-600 hover:text-black'
                }`}
              >
                {tab === 'library' ? `${entityLabel} Library` : tab === 'policies' ? 'Policies & Procedures' : 'Evidence Management'}
              </button>
            ))}
          </div>
          <button className="flex items-center gap-2 rounded-lg bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            <Download className="h-4 w-4" />
            Download Implementation Report
          </button>
        </div>

        {controlsSubTab === 'library' && (
          <div>
            <div className="mb-4 flex gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder={`Search ${entityLabelPlural.toLowerCase()}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input w-full pl-10"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                className="input w-48"
              >
                <option value="all">All Categories</option>
                <option value="organizational">Organizational</option>
                <option value="people">People</option>
                <option value="physical">Physical</option>
                <option value="technological">Technological</option>
              </select>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="input w-48"
              >
                <option value="all">All Statuses</option>
                <option value="implemented">Implemented</option>
                <option value="partial">In Progress</option>
                <option value="not_implemented">Not Started</option>
              </select>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                className="input w-48"
              >
                <option value="default">Sort by Default</option>
                <option value="asc">Clause # (Ascending)</option>
                <option value="desc">Clause # (Descending)</option>
              </select>
            </div>

            <div className="space-y-3">
              {filteredControls.length > 0 ? (
                filteredControls.map((control: CertificationControl) => renderControlAccordion(control))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="mb-4 h-12 w-12 text-gray-400" />
                  <p className="text-gray-600">No {entityLabelPlural.toLowerCase()} found</p>
                  <p className="text-sm text-gray-500 mt-1">Try adjusting your filters</p>
                </div>
              )}
            </div>
          </div>
        )}

        {controlsSubTab === 'policies' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-gray-400" />
            <h3 className="text-lg font-medium text-black">Policies & Procedures</h3>
            <p className="mt-1 text-gray-600">Manage policies and procedures documentation</p>
            <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 mt-4">
              <Upload className="h-4 w-4" />
              Upload Policy
            </button>
          </div>
        )}

        {controlsSubTab === 'evidence' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-gray-400" />
            <h3 className="text-lg font-medium text-black">Evidence Management</h3>
            <p className="mt-1 text-gray-600">Collect and manage implementation evidence</p>
            <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 mt-4">
              <Upload className="h-4 w-4" />
              Upload Evidence
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderPlaceholderTab = (title: string, icon: React.ReactNode, description: string) => (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-gray-50 p-4">
          {icon}
        </div>
        <h3 className="text-xl font-semibold text-black">{title}</h3>
        <p className="mt-2 max-w-md text-gray-600">{description}</p>
        <button className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 mt-6">
          Get Started
        </button>
      </div>
    </div>
  );

  const renderCDEScopeTab = () => {
    if (cdeLoading || cdeAssetsFallbackLoading) {
      return (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      );
    }

    const fallbackSystems = (cdeAssetsFallback || [])
      .filter((asset) => {
        const raw = (asset as any).cde_environment;
        if (typeof raw === 'boolean') return raw;
        if (typeof raw === 'number') return raw === 1;
        if (typeof raw === 'string') return ['true', '1', 'yes', 'y', 'on'].includes(raw.toLowerCase().trim());
        return false;
      })
      .map((asset) => ({
        id: asset.id,
        name: asset.name,
        asset_type: asset.asset_type,
        description: asset.description || '',
        location: asset.location || '',
        owner_name: asset.owner_name || null,
        owner_id: asset.owner_id || null,
        vendor: asset.vendor || null,
        criticality: asset.criticality,
        status: asset.status,
        cde_environment: true,
        created_at: asset.created_at,
      }));

    const systems = (cdeData?.systems && cdeData.systems.length > 0) ? cdeData.systems : fallbackSystems;
    const summary = systems.reduce(
      (acc, asset) => {
        acc.total += 1;
        const assetType = asset.asset_type || 'other';
        const criticality = asset.criticality || 'medium';
        acc.type_breakdown[assetType] = (acc.type_breakdown[assetType] || 0) + 1;
        acc.criticality_breakdown[criticality] = (acc.criticality_breakdown[criticality] || 0) + 1;
        return acc;
      },
      { total: 0, type_breakdown: {} as Record<string, number>, criticality_breakdown: {} as Record<string, number> }
    );

    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <p className="text-sm text-blue-700">
            CDE assets are sourced from your <a href="/assets" className="font-medium underline">IT Asset Inventory</a>. Mark an IT asset as CDE Environment to include it automatically in PCI-DSS scope.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-600">CDE Assets</p>
            <p className="text-2xl font-bold text-black">{summary.total}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-600">Asset Types</p>
            <p className="text-2xl font-bold text-black">{Object.keys(summary.type_breakdown || {}).length}</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-600">High/Critical</p>
            <p className="text-2xl font-bold text-black">{(summary.criticality_breakdown?.critical || 0) + (summary.criticality_breakdown?.high || 0)}</p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase text-gray-600">
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Criticality</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Vendor</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {systems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                    No CDE assets found. Mark assets as CDE in IT Assets.
                  </td>
                </tr>
              ) : (
                systems.map((asset) => (
                  <tr key={asset.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-black">{asset.name}</p>
                      {asset.description && <p className="mt-0.5 text-xs text-gray-500 line-clamp-1">{asset.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 capitalize">{asset.asset_type?.replace('_', ' ') || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 capitalize">{asset.criticality || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{asset.location || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{asset.vendor || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700">{asset.owner_name || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 capitalize">{asset.status || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const openApplicabilityModal = (control: any, isApplicable: boolean) => {
    setApplicabilityModalControl(control);
    setApplicabilityIsApplicable(isApplicable);
    setApplicabilityJustification('');
    setShowApplicabilityModal(true);
  };

  const handleSetApplicability = () => {
    if (!applicabilityModalControl || !journey?.framework_id) return;
    if (!applicabilityIsApplicable && !applicabilityJustification.trim()) return;
    setApplicabilityMutation.mutate({
      control_id: applicabilityModalControl.id,
      uploaded_framework_id: journey.framework_id,
      is_applicable: applicabilityIsApplicable,
      justification: applicabilityJustification,
    });
  };

  const handleReviewApplicability = (status: 'approved' | 'rejected') => {
    if (!reviewingRecord) return;
    reviewApplicabilityMutation.mutate({
      id: reviewingRecord.id,
      data: { status, review_comment: reviewComment },
    });
  };

  const renderApplicabilityTab = () => {
    const applicabilityRecords = (applicabilityData as any)?.records || [];
    const applicabilityMap = new Map<number, any>();
    applicabilityRecords.forEach((r: any) => applicabilityMap.set(r.control_id, r));

    const allControls = controls || [];
    const filteredApplicabilityControls = allControls.filter((c: any) => {
      if (applicabilityStatusFilter === 'all') return true;
      const record = applicabilityMap.get(c.id);
      if (applicabilityStatusFilter === 'pending') return record?.status === 'pending';
      if (applicabilityStatusFilter === 'approved') return record?.status === 'approved';
      if (applicabilityStatusFilter === 'rejected') return record?.status === 'rejected';
      if (applicabilityStatusFilter === 'not_applicable') return record && !record.is_applicable;
      return true;
    });

    const totalControls = allControls.length;
    const naCount = applicabilityRecords.filter((r: any) => !r.is_applicable).length;
    const pendingCount = applicabilityRecords.filter((r: any) => r.status === 'pending').length;
    const approvedCount = applicabilityRecords.filter((r: any) => r.status === 'approved').length;
    const rejectedCount = applicabilityRecords.filter((r: any) => r.status === 'rejected').length;

    return (
      <div className="space-y-6">
        {/* Applicability summary donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          {(() => {
            const appChartData = [
              { name: 'Approved', value: approvedCount, fill: '#22c55e' },
              { name: 'Pending',  value: pendingCount,  fill: '#f59e0b' },
              { name: 'N/A',     value: naCount,       fill: '#94a3b8' },
              { name: 'Rejected', value: rejectedCount, fill: '#ef4444' },
            ].filter((d) => d.value > 0);
            return (
              <div className="flex items-center gap-6">
                <div className="relative h-[100px] w-[100px] flex-shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={appChartData.length ? appChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]}
                        cx="50%" cy="50%" innerRadius={28} outerRadius={46} dataKey="value" paddingAngle={2} stroke="none"
                      >
                        {(appChartData.length ? appChartData : [{ name: 'None', value: 1, fill: '#e2e8f0' }]).map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-base font-bold text-slate-900">{totalControls}</span>
                    <span className="text-[9px] text-slate-400">total</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span className="text-slate-500">Approved</span>
                    <span className="font-semibold text-slate-800">{approvedCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    <span className="text-slate-500">Pending Review</span>
                    <span className="font-semibold text-slate-800">{pendingCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                    <span className="text-slate-500">Not Applicable</span>
                    <span className="font-semibold text-slate-800">{naCount}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    <span className="text-slate-500">Rejected</span>
                    <span className="font-semibold text-slate-800">{rejectedCount}</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-600">Filter:</span>
          {['all', 'pending', 'approved', 'rejected', 'not_applicable'].map((f) => (
            <button
              key={f}
              onClick={() => setApplicabilityStatusFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                applicabilityStatusFilter === f
                  ? 'bg-blue-50 text-blue-700 border border-blue-200'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
            >
              {f === 'not_applicable' ? 'Not Applicable' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {applicabilityLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Reference</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Title</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-600">Applicable</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Justification</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-600">Requested By</th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredApplicabilityControls.map((control: any) => {
                  const record = applicabilityMap.get(control.id);
                  const isApplicable = record ? record.is_applicable : true;
                  const status = record?.status || null;

                  return (
                    <tr key={control.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <span className="text-sm font-mono text-blue-600">
                          {control.control_code || control.original_reference || control.control_id || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-black line-clamp-2">
                          {control.control_name || control.title || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {isApplicable ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Yes
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700">
                            <XCircle className="h-3 w-3" />
                            N/A
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700 line-clamp-2">
                          {record?.justification || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {status === 'pending' && (
                          <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                            <Clock className="mr-1 h-3 w-3" />
                            Pending
                          </span>
                        )}
                        {status === 'approved' && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                            <CheckCircle2 className="mr-1 h-3 w-3" />
                            Approved
                          </span>
                        )}
                        {status === 'rejected' && (
                          <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">
                            <XCircle className="mr-1 h-3 w-3" />
                            Rejected
                          </span>
                        )}
                        {!status && (
                          <span className="text-xs text-gray-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-700">
                          {record?.requested_by_name || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {!record || record.is_applicable ? (
                            <button
                              onClick={() => openApplicabilityModal(control, false)}
                              className="rounded-lg bg-orange-50 border border-orange-200 px-2.5 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
                            >
                              Mark N/A
                            </button>
                          ) : (
                            <button
                              onClick={() => openApplicabilityModal(control, true)}
                              className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
                            >
                              Mark Applicable
                            </button>
                          )}
                          {record?.status === 'pending' && (
                            <>
                              <button
                                onClick={() => { setReviewingRecord(record); setReviewComment(''); setShowReviewModal(true); }}
                                className="rounded-lg bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                              >
                                Review
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredApplicabilityControls.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-gray-500">
                      No {entityLabelPlural.toLowerCase()} found matching the selected filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {(applicabilityAuditLog as any[])?.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold uppercase text-gray-600">Audit Trail</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(applicabilityAuditLog as any[]).slice(0, 20).map((log: any) => (
                <div key={log.id} className="flex items-start gap-3 rounded-lg bg-gray-50 border border-gray-200 p-3">
                  <div className={`mt-0.5 h-2 w-2 rounded-full flex-shrink-0 ${
                    log.action === 'applicability_approved' ? 'bg-emerald-500' :
                    log.action === 'applicability_rejected' ? 'bg-rose-500' : 'bg-amber-500'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700">{log.details}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {log.created_at ? new Date(log.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showApplicabilityModal && applicabilityModalControl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex h-[70vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="mb-1 text-lg font-semibold text-black">
                  {applicabilityIsApplicable ? 'Mark as Applicable' : 'Mark as Not Applicable'}
                </h3>
                <p className="mb-4 text-sm text-gray-600">
                  Control: <span className="font-mono text-blue-600">{applicabilityModalControl.control_code || applicabilityModalControl.original_reference || applicabilityModalControl.control_id}</span>
                  {' — '}
                  {applicabilityModalControl.control_name || applicabilityModalControl.title}
                </p>
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700">
                    Justification {!applicabilityIsApplicable && <span className="text-rose-600">*</span>}
                  </label>
                  <textarea
                    value={applicabilityJustification}
                    onChange={(e) => setApplicabilityJustification(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    rows={4}
                    placeholder={applicabilityIsApplicable ? 'Provide justification for re-applying this control...' : 'Explain why this clause is not applicable to your organization...'}
                  />
                  {!applicabilityIsApplicable && !applicabilityJustification.trim() && (
                    <p className="mt-1 text-xs text-rose-600">Justification is required when marking a clause as Not Applicable</p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-gray-200 p-6 pt-4">
                <button
                  onClick={() => { setShowApplicabilityModal(false); setApplicabilityModalControl(null); }}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSetApplicability}
                  disabled={setApplicabilityMutation.isPending || (!applicabilityIsApplicable && !applicabilityJustification.trim())}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {setApplicabilityMutation.isPending ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving...</span>
                  ) : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showReviewModal && reviewingRecord && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex h-[70vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
              <div className="flex-1 overflow-y-auto p-6">
                <h3 className="mb-1 text-lg font-semibold text-black">Review Applicability Decision</h3>
                <p className="mb-2 text-sm text-gray-600">
                  Control: <span className="font-mono text-blue-600">{reviewingRecord.control_reference}</span>
                  {' — '}
                  {reviewingRecord.control_title}
                </p>
                <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="mb-1 text-xs text-gray-600">Decision</p>
                  <p className="text-sm text-black">{reviewingRecord.is_applicable ? 'Applicable' : 'Not Applicable'}</p>
                  <p className="mb-1 mt-2 text-xs text-gray-600">Justification</p>
                  <p className="text-sm text-gray-700">{reviewingRecord.justification}</p>
                  <p className="mb-1 mt-2 text-xs text-gray-600">Requested By</p>
                  <p className="text-sm text-gray-700">{reviewingRecord.requested_by_name} on {reviewingRecord.requested_at ? new Date(reviewingRecord.requested_at).toLocaleDateString() : ''}</p>
                </div>
                <div className="mb-4">
                  <label className="mb-2 block text-sm font-medium text-gray-700">Review Comment</label>
                  <textarea
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-black placeholder-gray-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                    rows={3}
                    placeholder="Add a review comment (optional)..."
                  />
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 border-t border-gray-200 p-6 pt-4">
                <button
                  onClick={() => { setShowReviewModal(false); setReviewingRecord(null); }}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReviewApplicability('rejected')}
                  disabled={reviewApplicabilityMutation.isPending}
                  className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-100 transition-colors disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  onClick={() => handleReviewApplicability('approved')}
                  disabled={reviewApplicabilityMutation.isPending}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {reviewApplicabilityMutation.isPending ? (
                    <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Processing...</span>
                  ) : 'Approve'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'overview':
        return renderOverviewTab();
      case 'phases':
        return renderPhasesTab();
      case 'scoping':
        return renderScopingTab();
      case 'context':
        return renderPlaceholderTab(
          'Context of Organization',
          <Building2 className="h-12 w-12 text-slate-500" />,
          'Analyze internal and external context, identify interested parties, and determine their requirements for the ISMS.'
        );
      case 'risk':
        return renderPlaceholderTab(
          'Risk Assessment & Treatment',
          <AlertTriangle className="h-12 w-12 text-slate-500" />,
          'Identify, analyze, and evaluate information security risks. Develop and implement risk treatment plans.'
        );
      case 'soa':
        return renderSoaTab();
      case 'controls':
        return renderControlsTab();
      case 'cde-scope':
        return renderCDEScopeTab();
      case 'applicability':
        return renderApplicabilityTab();
      case 'training':
        return renderPlaceholderTab(
          'Training & Awareness',
          <GraduationCap className="h-12 w-12 text-slate-500" />,
          'Manage security awareness training programs, track completion, and assess competency across the organization.'
        );
      case 'audit':
        return renderPlaceholderTab(
          'Internal Audit',
          <ClipboardCheck className="h-12 w-12 text-slate-500" />,
          'Plan and conduct internal ISMS audits, document findings, and track corrective actions.'
        );
      case 'review':
        return renderPlaceholderTab(
          'Management Review',
          <Eye className="h-12 w-12 text-slate-500" />,
          'Conduct management reviews of ISMS performance, document decisions, and track action items.'
        );
      case 'certification':
        return renderPlaceholderTab(
          'Certification Audit',
          <Award className="h-12 w-12 text-slate-500" />,
          'Prepare for and track certification audit stages, manage non-conformities, and achieve certification.'
        );
      default:
        return renderOverviewTab();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => router.push('/frameworks')}
              className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 hover:text-black"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-black">{stripCertificationPostfix(journey.name)}</h1>
              <p className="text-gray-600">{isCertificationFramework ? 'Framework certification lifecycle' : 'Framework compliance lifecycle'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2">
              <Calendar className="h-4 w-4 text-gray-600" />
              {editingTargetDate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={targetDateValue}
                    onChange={(e) => setTargetDateValue(e.target.value)}
                    className="rounded bg-white px-2 py-1 text-sm text-black border border-gray-300 focus:border-blue-600 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      if (targetDateValue) updateTargetDateMutation.mutate(targetDateValue);
                    }}
                    disabled={updateTargetDateMutation.isPending || !targetDateValue}
                    className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {updateTargetDateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditingTargetDate(false)}
                    className="rounded px-2 py-1 text-xs text-gray-600 hover:text-black"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setTargetDateValue(journey.target_date ? new Date(journey.target_date).toISOString().split('T')[0] : '');
                    setEditingTargetDate(true);
                  }}
                  className="text-sm text-gray-700 hover:text-black transition-colors"
                >
                  {journey.target_date ? `Target: ${new Date(journey.target_date).toLocaleDateString()}` : 'Set Target Date'}
                </button>
              )}
            </div>
            <button
              onClick={() => generateReportMutation.mutate()}
              disabled={generateReportMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {generateReportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {generateReportMutation.isPending ? 'Generating...' : 'Generate Report'}
            </button>
            <button 
              onClick={() => router.push(`/auditor-portal/${journey.id}`)}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="h-4 w-4" />
              Auditor Portal
            </button>
          </div>
        </div>

        {enhanceSuccess && (
          <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5" />
              {enhanceSuccess}
            </div>
          </div>
        )}

        {enhanceError && (
          <div className="mt-4 rounded-lg bg-rose-50 border border-rose-200 p-4 text-rose-700">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5" />
              {enhanceError}
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex items-center justify-center p-6">
            <CircularProgress percentage={readinessPercentage} />
            <div className="ml-4">
              <p className="text-lg font-semibold text-black">{isCertificationFramework ? 'Certification Readiness' : 'Compliance Readiness'}</p>
              <p className="text-sm text-gray-600">Approved evidence readiness</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2">
                <Target className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">{isCertificationFramework ? 'Current Phase' : 'Framework Type'}</p>
                <p className="text-lg font-semibold text-black">{isCertificationFramework ? `Phase ${journey.current_phase}` : 'Compliance'}</p>
                <p className="text-sm text-blue-600">{isCertificationFramework ? (phasesLoading ? 'Loading...' : (phases[journey.current_phase - 1]?.name || 'Phase ' + journey.current_phase)) : ((journey as any)?.framework_overview?.regulatory_authority || 'Regulatory / Standard Requirements')}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-50 p-2">
                <Shield className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                  <p className="text-sm text-gray-600">{entityLabel} Coverage</p>
                  <p className="text-lg font-semibold text-black">{fullyEvidencedControls}/{totalControlsProgress}</p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-blue-600"
                      style={{ width: `${evidenceCoveragePercentage}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-50 p-2">
                <Calendar className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Target Date</p>
                <p className="text-lg font-semibold text-black">
                  {journey.target_date ? new Date(journey.target_date).toLocaleDateString() : 'Not set'}
                </p>
                <p className="text-sm text-gray-500">{isCertificationFramework ? 'Stage 2 audit scheduled' : 'Compliance review target'}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-blue-600 text-blue-600'
                  : 'text-gray-600 hover:text-black'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {renderActiveTab()}
      </div>

      {selectedControl && (
        <ControlImplementationModal
          isOpen={showControlModal}
          onClose={() => {
            setShowControlModal(false);
            setSelectedControl(null);
          }}
          journeyId={journeyId}
          control={selectedControl}
        />
      )}
    </div>
  );
}
