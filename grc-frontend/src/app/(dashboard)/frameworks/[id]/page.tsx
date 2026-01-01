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
  ChevronLeft,
  Calendar,
  Target,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  Check,
  XCircle,
  Pause,
  ArrowLeft,
  Layers,
  FileWarning
} from 'lucide-react';

const PHASES = [
  { id: 1, name: 'Planning', description: 'Define scope and timeline' },
  { id: 2, name: 'Gap Analysis', description: 'Identify compliance gaps' },
  { id: 3, name: 'Implementation', description: 'Implement controls' },
  { id: 4, name: 'Evidence Collection', description: 'Gather supporting evidence' },
  { id: 5, name: 'Review', description: 'Internal review and verification' },
  { id: 6, name: 'Certification', description: 'External audit and certification' },
];

export default function CertificationJourneyPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const journeyId = parseInt(params.id as string);
  
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

  const updateJourneyMutation = useMutation({
    mutationFn: (data: { status?: string; notes?: string }) => 
      certificationsApi.update(journeyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certification', journeyId] });
    },
  });

  useEffect(() => {
    if (progress?.by_domain?.length && !selectedDomain) {
      setSelectedDomain(progress.by_domain[0].domain_id);
    }
  }, [progress, selectedDomain]);

  const isLoading = journeyLoading || controlsLoading;

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'verified': return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case 'implemented': return <Check className="h-4 w-4 text-blue-400" />;
      case 'in_progress': return <Clock className="h-4 w-4 text-yellow-400" />;
      case 'not_applicable': return <XCircle className="h-4 w-4 text-slate-500" />;
      default: return <Play className="h-4 w-4 text-slate-400" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      verified: 'bg-green-500/20 text-green-400',
      implemented: 'bg-blue-500/20 text-blue-400',
      in_progress: 'bg-yellow-500/20 text-yellow-400',
      not_applicable: 'bg-slate-500/20 text-slate-400',
      not_started: 'bg-slate-700 text-slate-400',
    };
    return styles[status] || styles.not_started;
  };

  const getPriorityColor = (priority: number) => {
    if (priority >= 4) return 'text-red-400';
    if (priority >= 3) return 'text-orange-400';
    if (priority >= 2) return 'text-yellow-400';
    return 'text-slate-400';
  };

  const completionPercentage = progress?.completion_percentage || 0;

  const handleControlClick = (control: ControlImplementation) => {
    setSelectedControl(control);
    setShowControlModal(true);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mb-6 flex items-center gap-4">
        <button 
          onClick={() => router.push('/frameworks')}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{journey.name}</h1>
          <p className="text-slate-400">{journey.framework?.name || 'Certification Journey'}</p>
        </div>
        <div className="flex items-center gap-3">
          {journey.target_date && (
            <div className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-sm">
              <Calendar className="h-4 w-4 text-slate-400" />
              <span className="text-slate-300">
                Target: {new Date(journey.target_date).toLocaleDateString()}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2 rounded-lg bg-primary-500/20 px-4 py-2">
            <Target className="h-5 w-5 text-primary-400" />
            <span className="text-lg font-bold text-primary-400">{completionPercentage}%</span>
          </div>
        </div>
      </div>

      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max items-center gap-2 rounded-lg bg-slate-800 p-2">
          {PHASES.map((phase, index) => {
            const isActive = journey.current_phase === phase.id;
            const isCompleted = journey.current_phase > phase.id;
            return (
              <div key={phase.id} className="flex items-center">
                <div
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 transition-colors ${
                    isActive
                      ? 'bg-primary-500/20 text-primary-400'
                      : isCompleted
                      ? 'bg-green-500/10 text-green-400'
                      : 'text-slate-500'
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    isActive ? 'bg-primary-500 text-white' : isCompleted ? 'bg-green-500 text-white' : 'bg-slate-700'
                  }`}>
                    {isCompleted ? <Check className="h-3 w-3" /> : phase.id}
                  </div>
                  <div className="hidden md:block">
                    <div className="text-sm font-medium">{phase.name}</div>
                  </div>
                </div>
                {index < PHASES.length - 1 && (
                  <ChevronRight className="mx-1 h-4 w-4 text-slate-600" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
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
            <p className="text-2xl font-bold text-green-400">{progress?.verified || 0}</p>
            <p className="text-xs text-slate-400">Verified</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-blue-500/20 p-2">
            <Check className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-400">{progress?.implemented || 0}</p>
            <p className="text-xs text-slate-400">Implemented</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-yellow-500/20 p-2">
            <Clock className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-yellow-400">{progress?.in_progress || 0}</p>
            <p className="text-xs text-slate-400">In Progress</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-slate-700 p-2">
            <Pause className="h-5 w-5 text-slate-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-400">{progress?.not_started || 0}</p>
            <p className="text-xs text-slate-400">Not Started</p>
          </div>
        </div>
        <div className="card flex items-center gap-3 !p-4">
          <div className="rounded-lg bg-orange-500/20 p-2">
            <FileWarning className="h-5 w-5 text-orange-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-orange-400">
              {(gaps?.missing_evidence?.length || 0) + (gaps?.not_implemented?.length || 0)}
            </p>
            <p className="text-xs text-slate-400">Gaps</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-6 overflow-hidden">
        <aside className="w-64 flex-shrink-0 overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-4">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Domains
          </h3>
          <nav className="space-y-1">
            {progress?.by_domain?.map((domain) => {
              const isSelected = selectedDomain === domain.domain_id;
              const percentage = domain.total > 0 
                ? Math.round((domain.completed / domain.total) * 100) 
                : 0;
              return (
                <button
                  key={domain.domain_id}
                  onClick={() => setSelectedDomain(domain.domain_id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-primary-500/20 text-primary-400'
                      : 'text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  <span className="truncate text-sm">{domain.domain_name}</span>
                  <span className={`ml-2 text-xs font-medium ${
                    percentage === 100 ? 'text-green-400' : 'text-slate-500'
                  }`}>
                    {percentage}%
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 overflow-y-auto">
          <div className="rounded-lg border border-slate-700 bg-slate-800">
            <div className="border-b border-slate-700 px-4 py-3">
              <h3 className="font-semibold text-white">
                Controls
                {selectedDomain && progress?.by_domain && (
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    - {progress.by_domain.find(d => d.domain_id === selectedDomain)?.domain_name}
                  </span>
                )}
              </h3>
            </div>
            <div className="divide-y divide-slate-700">
              {controls?.map((control: ControlImplementation) => (
                <div
                  key={control.id}
                  onClick={() => handleControlClick(control)}
                  className="flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors hover:bg-slate-700/50"
                >
                  {getStatusIcon(control.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-primary-400">
                        {control.framework_control?.code}
                      </span>
                      {control.framework_control?.is_mandatory && (
                        <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-xs text-red-400">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="truncate text-sm text-slate-300">
                      {control.framework_control?.name}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1 text-xs ${getPriorityColor(control.priority)}`}>
                      <AlertTriangle className="h-3 w-3" />
                      P{control.priority}
                    </div>
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusBadge(control.status)}`}>
                      {control.status.replace('_', ' ')}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-500" />
                  </div>
                </div>
              ))}
              {(!controls || controls.length === 0) && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Shield className="mb-4 h-12 w-12 text-slate-600" />
                  <p className="text-slate-400">No controls found for this domain</p>
                </div>
              )}
            </div>
          </div>
        </main>
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
