'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { certificationsApi } from '@/lib/api';
import { CertificationJourney, ControlImplementation, ProgressSummary, CertificationControl, SubControlWithEvidence, ControlEvidence } from '@/types';
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
  Search,
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
  Paperclip
} from 'lucide-react';

const EVIDENCE_TYPE_MAP: Record<string, { label: string; color: string }> = {
  policy: { label: 'Policy', color: 'bg-blue-500/20 text-blue-400' },
  procedure: { label: 'Procedure', color: 'bg-purple-500/20 text-purple-400' },
  screenshot: { label: 'Screenshot', color: 'bg-cyan-500/20 text-cyan-400' },
  audit: { label: 'Audit Log', color: 'bg-orange-500/20 text-orange-400' },
  log: { label: 'Log', color: 'bg-orange-500/20 text-orange-400' },
  training: { label: 'Training', color: 'bg-green-500/20 text-green-400' },
  risk: { label: 'Risk Assessment', color: 'bg-red-500/20 text-red-400' },
  access: { label: 'Access Review', color: 'bg-yellow-500/20 text-yellow-400' },
  config: { label: 'Configuration', color: 'bg-indigo-500/20 text-indigo-400' },
  report: { label: 'Report', color: 'bg-pink-500/20 text-pink-400' },
  certificate: { label: 'Certificate', color: 'bg-emerald-500/20 text-emerald-400' },
  contract: { label: 'Contract', color: 'bg-amber-500/20 text-amber-400' },
  register: { label: 'Register', color: 'bg-teal-500/20 text-teal-400' },
  inventory: { label: 'Inventory', color: 'bg-lime-500/20 text-lime-400' },
  plan: { label: 'Plan', color: 'bg-sky-500/20 text-sky-400' },
  matrix: { label: 'Matrix', color: 'bg-violet-500/20 text-violet-400' },
  list: { label: 'List', color: 'bg-fuchsia-500/20 text-fuchsia-400' },
};

const getEvidenceType = (recommendation: string): { label: string; color: string } => {
  const key = recommendation.toLowerCase();
  for (const [pattern, value] of Object.entries(EVIDENCE_TYPE_MAP)) {
    if (key.includes(pattern)) return value;
  }
  return { label: 'Document', color: 'bg-slate-500/20 text-slate-400' };
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


const ANNEX_A_DOMAINS = [
  { id: 'A.5', name: 'Organizational Controls', controlCount: 37 },
  { id: 'A.6', name: 'People Controls', controlCount: 8 },
  { id: 'A.7', name: 'Physical Controls', controlCount: 14 },
  { id: 'A.8', name: 'Technological Controls', controlCount: 34 },
];

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
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [uploadingControlId, setUploadingControlId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: journey, isLoading: journeyLoading, error: journeyError } = useQuery({
    queryKey: ['certification', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getById(journeyId);
      return response.data as CertificationJourney;
    },
  });

  const { data: controls, isLoading: controlsLoading } = useQuery({
    queryKey: ['certification-controls', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getControls(journeyId);
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

  const { data: certificationPhases, isLoading: phasesLoading } = useQuery({
    queryKey: ['framework-phases', journey?.framework_id],
    queryFn: async () => {
      if (!journey?.framework_id) return [];
      const response = await certificationsApi.getFrameworkPhases(journey.framework_id);
      return response.data;
    },
    enabled: !!journey?.framework_id,
  });

  const phases = (certificationPhases || []).map((phase: any) => ({
    id: phase.phase_number,
    name: phase.name,
    description: phase.description,
    tasks: phase.key_tasks || [],
    deliverables: phase.deliverables || [],
  }));

  useEffect(() => {
    if (progress?.by_domain?.length && !selectedDomain) {
      setSelectedDomain(progress.by_domain[0].domain_id);
    }
  }, [progress, selectedDomain]);

  const isLoading = journeyLoading || controlsLoading;
  const completionPercentage = progress?.completion_percentage || 67;

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
    setExpandedControls(prev => 
      prev.includes(controlId) 
        ? prev.filter(id => id !== controlId)
        : [...prev, controlId]
    );
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
  }) || [];

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

  const handleControlClick = (control: ControlImplementation) => {
    setSelectedControl(control);
    setShowControlModal(true);
  };

  const phaseTabs = phases.map((phase, index) => ({
    id: `phase-${phase.id}` as TabType,
    label: `${index + 1}. ${phase.name.split(' ')[0]}`
  }));
  
  const tabs: { id: TabType; label: string; icon?: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'phases', label: 'Phases' },
    ...phaseTabs,
    { id: 'controls', label: 'Controls' },
  ];

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
            className="text-slate-700"
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
            className="text-primary-500 transition-all duration-500"
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-white">{percentage}%</span>
          <span className="text-xs text-slate-400">Ready</span>
        </div>
      </div>
    );
  };

  const renderOverviewTab = () => (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <div className="card">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <Clock className="h-5 w-5 text-primary-400" />
            Certification Timeline
          </h3>
          <div className="space-y-2">
            {phases.length === 0 && phasesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
              </div>
            ) : phases.map((phase) => {
              const isExpanded = expandedPhases.includes(phase.id);
              const isCurrent = journey.current_phase === phase.id;
              const isCompleted = journey.current_phase > phase.id;
              
              return (
                <div key={phase.id} className="rounded-lg border border-slate-700 bg-slate-800/50">
                  <button
                    onClick={() => togglePhase(phase.id)}
                    className="flex w-full items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                        isCompleted ? 'bg-green-500 text-white' : isCurrent ? 'bg-primary-500 text-white' : 'bg-slate-700 text-slate-400'
                      }`}>
                        {isCompleted ? <Check className="h-4 w-4" /> : phase.id}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`font-medium ${isCompleted ? 'text-green-400' : isCurrent ? 'text-white' : 'text-slate-400'}`}>
                            {phase.name}
                          </span>
                          {isCurrent && (
                            <span className="rounded-full bg-primary-500/20 px-2 py-0.5 text-xs font-medium text-primary-400">
                              In Progress
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-500">{phase.description}</p>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="h-5 w-5 text-slate-400" />
                    ) : (
                      <ChevronDown className="h-5 w-5 text-slate-400" />
                    )}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-700 p-4">
                      <div className="mb-3">
                        <h4 className="mb-2 text-sm font-medium text-slate-300">Key Tasks</h4>
                        <ul className="space-y-1">
                          {phase.tasks.map((task, idx) => (
                            <li key={idx} className="flex items-center gap-2 text-sm text-slate-400">
                              <Circle className="h-2 w-2 fill-current" />
                              {task}
                            </li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h4 className="mb-2 text-sm font-medium text-slate-300">Deliverables</h4>
                        <div className="flex flex-wrap gap-2">
                          {phase.deliverables.map((deliverable, idx) => (
                            <span key={idx} className="rounded-full bg-slate-700 px-3 py-1 text-xs text-slate-300">
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
        <div className="card">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            Key Metrics
          </h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">SoA Controls Applicable</span>
              <span className="font-semibold text-white">{progress?.implemented || 0}/{progress?.total_controls || 93}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Risks Assessed</span>
              <span className="font-semibold text-white">24/28</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Evidence Collected</span>
              <span className="font-semibold text-white">156/189</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Training Completion</span>
              <span className="font-semibold text-green-400">87%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Open Findings</span>
              <span className="font-semibold text-orange-400">3</span>
            </div>
          </div>
        </div>

        <div className="card">
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <AlertTriangle className="h-5 w-5 text-orange-400" />
            Attention Required
          </h3>
          <div className="space-y-3">
            <div className="rounded-lg bg-orange-500/10 p-3">
              <p className="text-sm font-medium text-orange-400">3 controls pending implementation</p>
              <p className="text-xs text-slate-400">Review by Dec 15</p>
            </div>
            <div className="rounded-lg bg-yellow-500/10 p-3">
              <p className="text-sm font-medium text-yellow-400">Evidence expiring soon</p>
              <p className="text-xs text-slate-400">5 items need renewal</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderPhasesTab = () => (
    <div className="card">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">Certification Phases</h3>
        <span className="text-sm text-slate-400">
          Phase {journey.current_phase} of {phases.length || '...'}
        </span>
      </div>
      <div className="space-y-3">
        {phases.length === 0 && phasesLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
          </div>
        ) : phases.map((phase) => {
          const isExpanded = expandedPhases.includes(phase.id);
          const isCurrent = journey.current_phase === phase.id;
          const isCompleted = journey.current_phase > phase.id;
          
          return (
            <div key={phase.id} className={`rounded-lg border ${isCurrent ? 'border-primary-500' : 'border-slate-700'} bg-slate-800/50`}>
              <button
                onClick={() => togglePhase(phase.id)}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold ${
                    isCompleted ? 'bg-green-500 text-white' : isCurrent ? 'bg-primary-500 text-white' : 'bg-slate-700 text-slate-400'
                  }`}>
                    {isCompleted ? <Check className="h-5 w-5" /> : phase.id}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`text-lg font-medium ${isCompleted ? 'text-green-400' : isCurrent ? 'text-white' : 'text-slate-400'}`}>
                        {phase.name}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-primary-500/20 px-2 py-0.5 text-xs font-medium text-primary-400">
                          Current
                        </span>
                      )}
                      {isCompleted && (
                        <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                          Completed
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{phase.description}</p>
                  </div>
                </div>
                {isExpanded ? (
                  <ChevronUp className="h-5 w-5 text-slate-400" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-slate-400" />
                )}
              </button>
              {isExpanded && (
                <div className="border-t border-slate-700 p-4">
                  <div className="grid gap-6 md:grid-cols-2">
                    <div>
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
                        <CheckCircle2 className="h-4 w-4" />
                        Key Tasks
                      </h4>
                      <ul className="space-y-2">
                        {phase.tasks.map((task, idx) => (
                          <li key={idx} className="flex items-center gap-2 text-sm text-slate-400">
                            <Circle className="h-2 w-2 fill-slate-600 text-slate-600" />
                            {task}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-300">
                        <FileText className="h-4 w-4" />
                        Deliverables
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {phase.deliverables.map((deliverable, idx) => (
                          <span key={idx} className="rounded-full bg-primary-500/20 px-3 py-1 text-xs text-primary-400">
                            {deliverable}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
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

  const renderControlAccordion = (control: CertificationControl, showUpload = true) => {
    const isExpanded = expandedControls.includes(control.id);
    const category = getCategoryFromDomain(control.domain_name);
    const statusConfig: Record<string, { label: string; color: string }> = {
      not_started: { label: 'Not Implemented', color: 'bg-red-500/20 text-red-400' },
      in_progress: { label: 'Partial', color: 'bg-yellow-500/20 text-yellow-400' },
      implemented: { label: 'Implemented', color: 'bg-green-500/20 text-green-400' },
      verified: { label: 'Verified', color: 'bg-blue-500/20 text-blue-400' },
      not_applicable: { label: 'N/A', color: 'bg-slate-500/20 text-slate-400' },
    };
    const status = statusConfig[control.status] || statusConfig.not_started;
    
    return (
      <div key={control.id} className="rounded-lg border border-slate-700 bg-slate-800/50">
        <button
          onClick={() => toggleControl(control.id)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-primary-400">{control.control_code}</span>
                <span className="font-medium text-white truncate">{control.control_name}</span>
              </div>
              <p className="text-sm text-slate-500 truncate mt-0.5">{control.control_statement}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            <span className="rounded-full bg-slate-700 px-2 py-1 text-xs text-slate-300">{category}</span>
            <span className={`rounded-full px-2 py-1 text-xs ${control.is_applicable ? 'bg-green-500/20 text-green-400' : 'bg-slate-500/20 text-slate-400'}`}>
              {control.is_applicable ? 'Applicable' : 'N/A'}
            </span>
            <span className={`rounded-full px-2 py-1 text-xs ${status.color}`}>{status.label}</span>
            <span className="text-xs text-slate-500">{control.evidence_count}/{control.required_evidence_count}</span>
            <Circle className={`h-4 w-4 ${control.evidence_count > 0 ? 'text-green-400 fill-green-400' : 'text-slate-600'}`} />
          </div>
        </button>
        {isExpanded && (
          <div className="border-t border-slate-700 p-4">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
                  <FileCheck className="h-4 w-4 text-slate-400" />
                  Required Evidence for {control.control_code}
                </h4>
                {control.evidence_requirements?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence_requirements.map((ev: { id: number; title: string; description: string; artifact_type: string; format_guidance?: string; frequency: string; is_required: boolean; sub_control_id: number }, idx: number) => {
                      const typeColors: Record<string, string> = {
                        'policy': 'bg-blue-500/20 text-blue-400',
                        'procedure': 'bg-purple-500/20 text-purple-400',
                        'log': 'bg-orange-500/20 text-orange-400',
                        'report': 'bg-pink-500/20 text-pink-400',
                        'screenshot': 'bg-cyan-500/20 text-cyan-400',
                        'record': 'bg-green-500/20 text-green-400',
                        'configuration': 'bg-indigo-500/20 text-indigo-400',
                        'certificate': 'bg-emerald-500/20 text-emerald-400',
                      };
                      const typeColor = typeColors[ev.artifact_type] || 'bg-slate-500/20 text-slate-400';
                      const typeLabel = ev.artifact_type.charAt(0).toUpperCase() + ev.artifact_type.slice(1);
                      
                      return (
                        <div key={`${ev.id}-${idx}`} className="rounded-lg bg-slate-900/50 p-3">
                          <div className="flex items-start gap-3">
                            <Radio className="h-4 w-4 text-primary-400 mt-1 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-white">{ev.title}</p>
                              <p className="text-xs text-slate-400 mt-1">{ev.description}</p>
                              {ev.format_guidance && (
                                <p className="text-xs text-slate-500 mt-1 italic">Format: {ev.format_guidance}</p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className={`rounded px-1.5 py-0.5 text-xs ${typeColor}`}>
                                  {typeLabel}
                                </span>
                                {ev.frequency !== 'as_needed' && (
                                  <span className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-400 flex items-center gap-1">
                                    <Clock className="h-3 w-3" />
                                    {ev.frequency}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span className={`rounded px-2 py-1 text-xs ${ev.is_required ? 'bg-red-500/20 text-red-400' : 'bg-slate-700 text-slate-400'}`}>
                                {ev.is_required ? 'Required' : 'Optional'}
                              </span>
                              {showUpload && (
                                <label className="cursor-pointer">
                                  <input
                                    type="file"
                                    className="hidden"
                                    onChange={(e) => handleFileUpload(control.id, e)}
                                    disabled={uploadingControlId === control.id}
                                  />
                                  <span className="flex items-center gap-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700">
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
                  <div className="rounded-lg bg-slate-900/50 p-4 text-center">
                    <p className="text-sm text-slate-400">No evidence requirements defined</p>
                  </div>
                )}
              </div>
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-semibold text-white">
                    Linked Evidence ({control.evidence_count})
                  </h4>
                  {showUpload && (
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(control.id, e)}
                        disabled={uploadingControlId === control.id}
                      />
                      <span className="flex items-center gap-1 rounded bg-primary-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-600">
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
                    {control.evidence.map((ev: ControlEvidence) => (
                      <div key={ev.id} className="flex items-center gap-3 rounded-lg bg-slate-900/50 p-3">
                        <Paperclip className="h-4 w-4 text-slate-400" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate">{ev.file_name || 'Evidence file'}</p>
                          <p className="text-xs text-slate-500">{ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}</p>
                        </div>
                        <span className={`rounded px-2 py-0.5 text-xs ${
                          ev.review_status === 'approved' ? 'bg-green-500/20 text-green-400' :
                          ev.review_status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                          'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {ev.review_status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
                    <Paperclip className="mx-auto h-8 w-8 text-slate-600 mb-2" />
                    <p className="text-sm text-slate-400">No evidence linked yet</p>
                    <p className="text-xs text-slate-500 mt-1">Upload evidence to comply</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSoaTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <Layers className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{controlStats.total}</p>
            <p className="text-xs text-slate-400">Total Controls</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-green-500/20 p-2">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">{controlStats.applicable}</p>
            <p className="text-xs text-slate-400">Applicable</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <XCircle className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-400">{controlStats.notApplicable}</p>
            <p className="text-xs text-slate-400">Not Applicable</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <Check className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-400">{controlStats.implemented}</p>
            <p className="text-xs text-slate-400">Implemented</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-yellow-500/20 p-2">
            <Clock className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-400">{controlStats.partial}</p>
            <p className="text-xs text-slate-400">Partial</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-red-500/20 p-2">
            <AlertCircle className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-400">{controlStats.notImplemented}</p>
            <p className="text-xs text-slate-400">Not Implemented</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-slate-700 pb-4">
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
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {cat.label} ({cat.count})
            </button>
          ))}
        </div>

        <div className="mb-4 flex gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search controls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input w-full pl-10"
            />
          </div>
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
              <Shield className="mb-4 h-12 w-12 text-slate-600" />
              <p className="text-slate-400">No controls found</p>
              <p className="text-sm text-slate-500 mt-1">Try adjusting your filters</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const totalEvidence = controls?.reduce((acc: number, c: CertificationControl) => acc + c.evidence_count, 0) || 0;

  const renderControlsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <Layers className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{controlStats.total}</p>
            <p className="text-xs text-slate-400">Total Controls</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-green-500/20 p-2">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">{controlStats.implemented}</p>
            <p className="text-xs text-slate-400">Implemented</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <FileCheck className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-400">{controlStats.partial}</p>
            <p className="text-xs text-slate-400">In Progress</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-purple-500/20 p-2">
            <FileText className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-400">{totalEvidence}</p>
            <p className="text-xs text-slate-400">Evidence Collected</p>
          </div>
        </div>
      </div>

      <div className="card !p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="text-slate-400">Implementation Progress</span>
          <span className="font-medium text-white">{completionPercentage}%</span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-primary-500 transition-all"
            style={{ width: `${completionPercentage}%` }}
          />
        </div>
      </div>

      <div className="card">
        <div className="mb-6 flex items-center justify-between border-b border-slate-700 pb-4">
          <div className="flex gap-4">
            {(['library', 'policies', 'evidence'] as ControlsSubTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setControlsSubTab(tab)}
                className={`text-sm font-medium transition-colors ${
                  controlsSubTab === tab
                    ? 'text-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab === 'library' ? 'Control Library' : tab === 'policies' ? 'Policies & Procedures' : 'Evidence Management'}
              </button>
            ))}
          </div>
          <button className="btn-secondary flex items-center gap-2">
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
                  placeholder="Search controls..."
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
            </div>

            <div className="space-y-3">
              {filteredControls.length > 0 ? (
                filteredControls.map((control: CertificationControl) => renderControlAccordion(control))
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">No controls found</p>
                  <p className="text-sm text-slate-500 mt-1">Try adjusting your filters</p>
                </div>
              )}
            </div>
          </div>
        )}

        {controlsSubTab === 'policies' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BookOpen className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">Policies & Procedures</h3>
            <p className="mt-1 text-slate-400">Manage policies and procedures documentation</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload Policy
            </button>
          </div>
        )}

        {controlsSubTab === 'evidence' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <FileText className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">Evidence Management</h3>
            <p className="mt-1 text-slate-400">Collect and manage implementation evidence</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload Evidence
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderPlaceholderTab = (title: string, icon: React.ReactNode, description: string) => (
    <div className="card">
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 rounded-full bg-slate-800 p-4">
          {icon}
        </div>
        <h3 className="text-xl font-semibold text-white">{title}</h3>
        <p className="mt-2 max-w-md text-slate-400">{description}</p>
        <button className="btn-primary mt-6">
          Get Started
        </button>
      </div>
    </div>
  );

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
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-white">{journey.name}</h1>
              <p className="text-slate-400">{journey?.framework?.name || 'Framework'} certification lifecycle</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn-secondary flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Generate Report
            </button>
            <button className="btn-primary flex items-center gap-2">
              <ExternalLink className="h-4 w-4" />
              Auditor Portal
            </button>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
          <div className="card flex items-center justify-center !p-6">
            <CircularProgress percentage={completionPercentage} />
            <div className="ml-4">
              <p className="text-lg font-semibold text-white">Certification Readiness</p>
              <p className="text-sm text-slate-400">Overall progress</p>
            </div>
          </div>
          <div className="card !p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary-500/20 p-2">
                <Target className="h-5 w-5 text-primary-400" />
              </div>
              <div>
                <p className="text-sm text-slate-400">Current Phase</p>
                <p className="text-lg font-semibold text-white">Phase {journey.current_phase}</p>
                <p className="text-sm text-primary-400">{phases[journey.current_phase - 1]?.name || 'Loading...'}</p>
              </div>
            </div>
          </div>
          <div className="card !p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/20 p-2">
                <Shield className="h-5 w-5 text-blue-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-slate-400">Control Coverage</p>
                <p className="text-lg font-semibold text-white">{progress?.implemented || 0}/{progress?.total_controls || 0}</p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${progress?.total_controls ? (progress.implemented / progress.total_controls) * 100 : 0}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
          <div className="card !p-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-purple-500/20 p-2">
                <Calendar className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-sm text-slate-400">Target Date</p>
                <p className="text-lg font-semibold text-white">
                  {journey.target_date ? new Date(journey.target_date).toLocaleDateString() : 'Not set'}
                </p>
                <p className="text-sm text-slate-500">Stage 2 audit scheduled</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'border-b-2 border-primary-500 text-primary-400'
                  : 'text-slate-400 hover:text-white'
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
