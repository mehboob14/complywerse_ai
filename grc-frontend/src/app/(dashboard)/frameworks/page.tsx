'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { frameworksApi, certificationsApi } from '@/lib/api';
import { Framework, CertificationJourney, Domain } from '@/types';
import CreateFrameworkModal from '@/components/CreateFrameworkModal';
import { 
  FileStack, 
  ChevronRight, 
  Loader2, 
  AlertCircle,
  Shield,
  Plus,
  Play,
  ArrowRight,
  Calendar,
  Target,
  CheckCircle2,
  Clock,
  Layers,
  Building2,
  Upload,
  Trash2,
  X
} from 'lucide-react';
import Link from 'next/link';

export default function FrameworksPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Framework | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [journeyDeleteConfirm, setJourneyDeleteConfirm] = useState<CertificationJourney | null>(null);
  const [journeyDeleteError, setJourneyDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (frameworkId: string) => {
      return await frameworksApi.delete(frameworkId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['frameworks'] });
      setDeleteConfirm(null);
      setDeleteError(null);
    },
    onError: (error: any) => {
      setDeleteError(error.response?.data?.detail || 'Failed to delete framework');
    }
  });

  const journeyDeleteMutation = useMutation({
    mutationFn: async (journeyId: number) => {
      return await certificationsApi.delete(journeyId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certifications'] });
      setJourneyDeleteConfirm(null);
      setJourneyDeleteError(null);
    },
    onError: (error: any) => {
      setJourneyDeleteError(error.response?.data?.detail || 'Failed to delete certification journey');
    }
  });

  const { data: frameworks, isLoading: frameworksLoading } = useQuery({
    queryKey: ['frameworks'],
    queryFn: async () => {
      const response = await frameworksApi.getAll();
      return response.data;
    },
  });

  const { data: certifications, isLoading: certificationsLoading } = useQuery({
    queryKey: ['certifications'],
    queryFn: async () => {
      const response = await certificationsApi.getAll();
      return response.data;
    },
  });

  const isLoading = frameworksLoading || certificationsLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  const activeCertifications = (certifications as CertificationJourney[] || []).filter(
    (c: CertificationJourney) => c.status === 'in_progress' || c.status === 'not_started'
  );

  const activeCertificationFrameworkIds = new Set(
    activeCertifications.map((c: CertificationJourney) => String(c.framework_id))
  );

  const availableFrameworks = (frameworks || []).filter(
    (f: Framework) => !activeCertificationFrameworkIds.has(String(f.id))
  );

  const getJourneyForFramework = (frameworkId: string) => {
    return (certifications as CertificationJourney[] || []).find(
      (c: CertificationJourney) => String(c.framework_id) === frameworkId
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-500/20 text-green-400';
      case 'in_progress': return 'bg-blue-500/20 text-blue-400';
      case 'on_hold': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-slate-500/20 text-slate-400';
    }
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 80) return 'bg-green-500';
    if (progress >= 50) return 'bg-yellow-500';
    if (progress >= 25) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const handleStartCertification = async (framework: Framework) => {
    try {
      const response = await certificationsApi.create({
        framework_id: parseInt(framework.id),
        name: `${framework.name} Certification`,
      });
      router.push(`/frameworks/${response.data.id}`);
    } catch (error) {
      console.error('Failed to start certification:', error);
    }
  };

  const countControls = (framework: Framework) => {
    let count = 0;
    framework.domains?.forEach((domain: Domain) => {
      domain.control_objectives?.forEach((obj) => {
        count += obj.controls?.length || 0;
      });
    });
    return count;
  };

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Frameworks</h1>
          <p className="text-slate-400">Manage frameworks and track certification journeys</p>
        </div>
        <div className="flex items-center gap-3">
          <Link 
            href="/framework-upload"
            className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700 transition-colors"
          >
            <Upload className="h-4 w-4" />
            Upload Framework
          </Link>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Create Custom Framework
          </button>
        </div>
      </div>

      {activeCertifications.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <Target className="h-5 w-5 text-primary-400" />
            Active Certification Journeys
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeCertifications.map((cert: CertificationJourney) => {
              const progress = cert.progress?.completion_percentage || 0;
              return (
                <div 
                  key={cert.id} 
                  className="card group cursor-pointer transition-all hover:border-primary-500/50 hover:shadow-lg hover:shadow-primary-500/10"
                  onClick={() => router.push(`/frameworks/${cert.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary-500/20 p-2">
                        <Shield className="h-5 w-5 text-primary-400" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white">{cert.name}</h3>
                        <p className="text-sm text-slate-400">
                          {cert.framework?.name || 'Framework'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(cert.status)}`}>
                        {cert.status.replace('_', ' ')}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setJourneyDeleteConfirm(cert);
                          setJourneyDeleteError(null);
                        }}
                        className="rounded-lg bg-red-500/20 p-1.5 text-red-400 hover:bg-red-500/30 transition-colors opacity-0 group-hover:opacity-100"
                        title="Delete Certification Journey"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <span className="text-slate-400">Progress</span>
                      <span className="font-medium text-white">{progress}%</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                      <div
                        className={`h-full rounded-full transition-all ${getProgressColor(progress)}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-700 pt-4">
                    <div className="flex items-center gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {cert.progress?.implemented || 0} implemented
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {cert.progress?.in_progress || 0} in progress
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary-400" />
                  </div>

                  {cert.target_date && (
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
                      <Calendar className="h-3 w-3" />
                      Target: {new Date(cert.target_date).toLocaleDateString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
          <FileStack className="h-5 w-5 text-slate-400" />
          Available Frameworks
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {availableFrameworks?.map((framework: Framework) => {
            const domainCount = framework.domain_count || framework.domains?.length || 0;
            const controlCount = framework.control_count || countControls(framework);
            
            return (
              <div 
                key={framework.id} 
                className="card group transition-all hover:border-slate-600"
              >
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-700 p-2 transition-colors group-hover:bg-slate-600">
                    <FileStack className="h-6 w-6 text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate">{framework.name}</h3>
                    <p className="text-sm text-slate-400">v{framework.version}</p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2 py-1 text-xs text-slate-300">
                    <Layers className="h-3 w-3" />
                    {domainCount} domains
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2 py-1 text-xs text-slate-300">
                    <Shield className="h-3 w-3" />
                    {controlCount} controls
                  </span>
                </div>

                {framework.source && (
                  <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                    <Building2 className="h-3 w-3" />
                    {framework.source}
                  </div>
                )}

                <div className="mt-4 border-t border-slate-700 pt-4 flex gap-2">
                  <button
                    onClick={() => handleStartCertification(framework)}
                    className="btn-primary flex flex-1 items-center justify-center gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Start Certification
                  </button>
                  {framework.is_custom && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(framework);
                        setDeleteError(null);
                      }}
                      className="rounded-lg bg-red-500/20 px-3 py-2 text-red-400 hover:bg-red-500/30 transition-colors"
                      title="Delete Framework"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {(!frameworks || frameworks.length === 0) && (
          <div className="card flex flex-col items-center justify-center py-12 text-center">
            <FileStack className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No frameworks found</h3>
            <p className="mt-1 text-slate-400">Get started by adding a compliance framework</p>
            <button 
              onClick={() => setShowCreateModal(true)}
              className="btn-primary mt-4 flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Create Framework
            </button>
          </div>
        )}
      </section>

      <CreateFrameworkModal 
        isOpen={showCreateModal} 
        onClose={() => setShowCreateModal(false)} 
      />

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-xl border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-400" />
                Delete Framework
              </h3>
              <button
                onClick={() => {
                  setDeleteConfirm(null);
                  setDeleteError(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <p className="text-slate-300 mb-2">
              Are you sure you want to delete <span className="font-semibold text-white">{deleteConfirm.name}</span>?
            </p>
            <p className="text-sm text-slate-400 mb-4">
              This will permanently remove the framework and all associated domains, objectives, and controls. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 rounded-lg bg-red-500/20 border border-red-500/30 p-3 text-sm text-red-400">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setDeleteConfirm(null);
                  setDeleteError(null);
                }}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(String(deleteConfirm.id))}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Framework
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {journeyDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-slate-800 p-6 shadow-xl border border-slate-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-red-400" />
                Delete Certification Journey
              </h3>
              <button
                onClick={() => {
                  setJourneyDeleteConfirm(null);
                  setJourneyDeleteError(null);
                }}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <p className="text-slate-300 mb-2">
              Are you sure you want to delete <span className="font-semibold text-white">{journeyDeleteConfirm.name}</span>?
            </p>
            <p className="text-sm text-slate-400 mb-4">
              This will permanently remove the certification journey and all associated progress data, control implementations, and evidence attachments. This action cannot be undone.
            </p>

            {journeyDeleteError && (
              <div className="mb-4 rounded-lg bg-red-500/20 border border-red-500/30 p-3 text-sm text-red-400">
                {journeyDeleteError}
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setJourneyDeleteConfirm(null);
                  setJourneyDeleteError(null);
                }}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={() => journeyDeleteMutation.mutate(journeyDeleteConfirm.id)}
                disabled={journeyDeleteMutation.isPending}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {journeyDeleteMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete Journey
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
