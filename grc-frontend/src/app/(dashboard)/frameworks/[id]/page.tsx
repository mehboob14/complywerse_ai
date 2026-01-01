'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { certificationsApi } from '@/lib/api';
import { CertificationJourney, ControlImplementation, ProgressSummary } from '@/types';
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
  TrendingUp
} from 'lucide-react';

const CERTIFICATION_PHASES = [
  { id: 1, name: 'ISMS Scoping', description: 'Define the scope and boundaries of the ISMS', tasks: ['Define organizational scope', 'Identify key stakeholders', 'Document scope boundaries', 'Identify exclusions'], deliverables: ['Scope Statement', 'Stakeholder Register', 'Scope Boundaries Document'] },
  { id: 2, name: 'Context of Organization', description: 'Understand internal and external context', tasks: ['Analyze internal context', 'Analyze external context', 'Identify interested parties', 'Determine requirements'], deliverables: ['Context Analysis', 'Interested Parties Register', 'Requirements Matrix'] },
  { id: 3, name: 'Risk Assessment & Treatment', description: 'Identify and assess information security risks', tasks: ['Develop risk methodology', 'Identify assets and risks', 'Assess risk likelihood and impact', 'Develop treatment plan'], deliverables: ['Risk Methodology', 'Risk Register', 'Risk Treatment Plan'] },
  { id: 4, name: 'Statement of Applicability', description: 'Define applicable controls from Annex A', tasks: ['Review all Annex A controls', 'Determine applicability', 'Document justifications', 'Map to existing controls'], deliverables: ['SoA Document', 'Control Mapping', 'Justification Records'] },
  { id: 5, name: 'Control Implementation', description: 'Implement required security controls', tasks: ['Implement technical controls', 'Implement organizational controls', 'Develop policies and procedures', 'Collect implementation evidence'], deliverables: ['Policy Documents', 'Procedure Guides', 'Implementation Evidence'] },
  { id: 6, name: 'Training & Awareness', description: 'Train staff on ISMS and security awareness', tasks: ['Develop training program', 'Conduct awareness sessions', 'Track completion', 'Assess effectiveness'], deliverables: ['Training Materials', 'Attendance Records', 'Competency Assessments'] },
  { id: 7, name: 'Internal Audit', description: 'Conduct internal ISMS audit', tasks: ['Plan internal audit', 'Execute audit procedures', 'Document findings', 'Track corrective actions'], deliverables: ['Audit Plan', 'Audit Report', 'Corrective Action Log'] },
  { id: 8, name: 'Management Review', description: 'Executive review of ISMS performance', tasks: ['Prepare review materials', 'Conduct review meeting', 'Document decisions', 'Assign action items'], deliverables: ['Review Agenda', 'Meeting Minutes', 'Action Items'] },
  { id: 9, name: 'Certification Audit', description: 'External certification body audit', tasks: ['Stage 1 documentation review', 'Address Stage 1 findings', 'Stage 2 implementation audit', 'Address non-conformities'], deliverables: ['Stage 1 Report', 'Stage 2 Report', 'Certificate'] },
  { id: 10, name: 'Surveillance & Improvement', description: 'Ongoing monitoring and continuous improvement', tasks: ['Schedule surveillance audits', 'Monitor ISMS performance', 'Implement improvements', 'Maintain certification'], deliverables: ['Surveillance Schedule', 'Performance Reports', 'Improvement Log'] },
];

const ANNEX_A_DOMAINS = [
  { id: 'A.5', name: 'Organizational Controls', controlCount: 37 },
  { id: 'A.6', name: 'People Controls', controlCount: 8 },
  { id: 'A.7', name: 'Physical Controls', controlCount: 14 },
  { id: 'A.8', name: 'Technological Controls', controlCount: 34 },
];

type TabType = 'overview' | 'phases' | 'scoping' | 'context' | 'risk' | 'soa' | 'controls' | 'training' | 'audit' | 'review' | 'certification';
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

  const { data: journey, isLoading: journeyLoading, error: journeyError } = useQuery({
    queryKey: ['certification', journeyId],
    queryFn: async () => {
      const response = await certificationsApi.getById(journeyId);
      return response.data as CertificationJourney;
    },
  });

  const { data: controls, isLoading: controlsLoading } = useQuery({
    queryKey: ['certification-controls', journeyId, selectedDomain],
    queryFn: async () => {
      const params = selectedDomain ? { domain_id: selectedDomain } : undefined;
      const response = await certificationsApi.getControls(journeyId, params);
      return response.data as ControlImplementation[];
    },
    enabled: !!journeyId,
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

  const handleControlClick = (control: ControlImplementation) => {
    setSelectedControl(control);
    setShowControlModal(true);
  };

  const tabs: { id: TabType; label: string; icon?: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'phases', label: 'Phases' },
    { id: 'scoping', label: '1. Scoping' },
    { id: 'context', label: '2. Context' },
    { id: 'risk', label: '3. Risk' },
    { id: 'soa', label: '4. SoA' },
    { id: 'controls', label: '5. Controls' },
    { id: 'training', label: '6. Training' },
    { id: 'audit', label: '7. Audit' },
    { id: 'review', label: '8. Review' },
    { id: 'certification', label: 'Certification' },
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
            {CERTIFICATION_PHASES.map((phase) => {
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
          Phase {journey.current_phase} of 10
        </span>
      </div>
      <div className="space-y-3">
        {CERTIFICATION_PHASES.map((phase) => {
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

  const renderSoaTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <Layers className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{progress?.total_controls || 93}</p>
            <p className="text-xs text-slate-400">Total Controls</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-green-500/20 p-2">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">{progress?.implemented || 0}</p>
            <p className="text-xs text-slate-400">Applicable</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <XCircle className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-400">{progress?.not_applicable || 0}</p>
            <p className="text-xs text-slate-400">Not Applicable</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <Check className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-400">{progress?.verified || 0}</p>
            <p className="text-xs text-slate-400">Implemented</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-yellow-500/20 p-2">
            <Clock className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-400">{progress?.in_progress || 0}</p>
            <p className="text-xs text-slate-400">Partial</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-red-500/20 p-2">
            <AlertCircle className="h-5 w-5 text-red-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-red-400">{progress?.not_started || 0}</p>
            <p className="text-xs text-slate-400">Not Implemented</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-6 flex items-center justify-between border-b border-slate-700 pb-4">
          <div className="flex gap-4">
            {(['controls', 'summary', 'export'] as SoaSubTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setSoaSubTab(tab)}
                className={`text-sm font-medium transition-colors ${
                  soaSubTab === tab
                    ? 'text-primary-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search controls..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-10"
            />
          </div>
        </div>

        {soaSubTab === 'controls' && (
          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Annex A Controls
            </h4>
            {ANNEX_A_DOMAINS.map((domain) => {
              const isExpanded = expandedDomains.includes(domain.id);
              return (
                <div key={domain.id} className="rounded-lg border border-slate-700 bg-slate-800/50">
                  <button
                    onClick={() => toggleDomain(domain.id)}
                    className="flex w-full items-center justify-between p-4 text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-primary-400">{domain.id}</span>
                      <span className="font-medium text-white">{domain.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded-full bg-slate-700 px-2 py-1 text-xs text-slate-300">
                        {domain.controlCount} controls
                      </span>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-slate-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-slate-400" />
                      )}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-slate-700 p-4">
                      <div className="space-y-2">
                        {Array.from({ length: Math.min(5, domain.controlCount) }).map((_, idx) => (
                          <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-700/50 p-3">
                            <div>
                              <span className="font-mono text-sm text-primary-400">{domain.id}.{idx + 1}</span>
                              <span className="ml-2 text-sm text-slate-300">Control {idx + 1}</span>
                            </div>
                            <span className="rounded-full bg-slate-600 px-2 py-1 text-xs text-slate-300">
                              Not Set
                            </span>
                          </div>
                        ))}
                        {domain.controlCount > 5 && (
                          <p className="text-center text-sm text-slate-500">
                            + {domain.controlCount - 5} more controls
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {soaSubTab === 'summary' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">SoA Summary</h3>
            <p className="mt-1 text-slate-400">Statement of Applicability summary will appear here</p>
          </div>
        )}

        {soaSubTab === 'export' && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Download className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">Export SoA</h3>
            <p className="mt-1 text-slate-400">Export Statement of Applicability document</p>
            <button className="btn-primary mt-4 flex items-center gap-2">
              <Download className="h-4 w-4" />
              Download SoA
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderControlsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <Layers className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-white">{progress?.total_controls || 0}</p>
            <p className="text-xs text-slate-400">Total Controls</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-green-500/20 p-2">
            <CheckCircle2 className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-green-400">{progress?.implemented || 0}</p>
            <p className="text-xs text-slate-400">Implemented</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <FileCheck className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-400">0</p>
            <p className="text-xs text-slate-400">Policies Approved</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-purple-500/20 p-2">
            <FileText className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-purple-400">0</p>
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
                  className="input w-full pl-10"
                />
              </div>
              <select className="input w-48">
                <option>All Categories</option>
                <option>Organizational</option>
                <option>People</option>
                <option>Physical</option>
                <option>Technological</option>
              </select>
              <select className="input w-48">
                <option>All Statuses</option>
                <option>Implemented</option>
                <option>In Progress</option>
                <option>Not Started</option>
              </select>
            </div>

            <div className="divide-y divide-slate-700">
              {controls?.slice(0, 10).map((control: ControlImplementation) => (
                <div
                  key={control.id}
                  onClick={() => handleControlClick(control)}
                  className="flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-700/50"
                >
                  <div className={`h-2 w-2 rounded-full ${
                    control.status === 'verified' ? 'bg-green-400' :
                    control.status === 'implemented' ? 'bg-blue-400' :
                    control.status === 'in_progress' ? 'bg-yellow-400' :
                    'bg-slate-400'
                  }`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-primary-400">
                        {control.framework_control?.code}
                      </span>
                    </div>
                    <p className="truncate text-sm text-slate-300">
                      {control.framework_control?.name}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                    control.status === 'verified' ? 'bg-green-500/20 text-green-400' :
                    control.status === 'implemented' ? 'bg-blue-500/20 text-blue-400' :
                    control.status === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {control.status.replace('_', ' ')}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-500" />
                </div>
              ))}
              {(!controls || controls.length === 0) && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">No controls found</p>
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
              <p className="text-slate-400">Information Security Management System certification lifecycle</p>
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
                <p className="text-sm text-primary-400">{CERTIFICATION_PHASES[journey.current_phase - 1]?.name}</p>
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
