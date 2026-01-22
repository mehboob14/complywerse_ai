'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import apiClient, { certificationsApi } from '@/lib/api';
import { CertificationJourney } from '@/types';
import { 
  FileStack, 
  Loader2, 
  AlertCircle,
  Shield,
  Play,
  ArrowRight,
  Calendar,
  Target,
  CheckCircle2,
  Clock,
  Upload,
  Trash2,
  X,
  Tag,
  RefreshCw,
  FileText,
  Sparkles,
  CheckCircle
} from 'lucide-react';
import Link from 'next/link';

interface UploadedFramework {
  id: number;
  name: string;
  version: string;
  framework_type: string;
  upload_status: string;
  controls_count: number;
  is_shared: boolean;
  is_active: boolean;
  created_at: string;
}

export default function FrameworksPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<UploadedFramework | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [journeyDeleteConfirm, setJourneyDeleteConfirm] = useState<CertificationJourney | null>(null);
  const [journeyDeleteError, setJourneyDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: async (frameworkId: number) => {
      return await apiClient.delete(`/framework-upload/upload/${frameworkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
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

  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrySuccess, setRetrySuccess] = useState<string | null>(null);

  const retryParseMutation = useMutation({
    mutationFn: async (frameworkId: number) => {
      return await apiClient.post(`/framework-upload/parser/${frameworkId}/retry-parse`);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
      setRetryError(null);
      setRetrySuccess(data.data?.message || 'Parsing restarted successfully');
      setTimeout(() => setRetrySuccess(null), 5000);
    },
    onError: (error: any) => {
      const errorMsg = error.response?.data?.detail || 'Failed to retry parsing';
      setRetryError(errorMsg);
      setRetrySuccess(null);
      setTimeout(() => setRetryError(null), 5000);
    }
  });

  const { data: frameworks, isLoading: frameworksLoading, isFetching } = useQuery({
    queryKey: ['uploaded-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const items = response.data?.items;
      return Array.isArray(items) ? items as UploadedFramework[] : [];
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!Array.isArray(data)) return false;
      const hasProcessing = data.some((f: UploadedFramework) => 
        f.upload_status === 'draft' || 
        f.upload_status === 'text_extracted' || 
        f.upload_status === 'parsing'
      );
      return hasProcessing ? 3000 : false;
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
    activeCertifications.map((c: CertificationJourney) => String(c.framework_id || c.uploaded_framework_id))
  );

  const frameworksArray = Array.isArray(frameworks) ? frameworks : [];
  
  const processingFrameworks = frameworksArray.filter(
    (f: UploadedFramework) => 
      f.upload_status === 'draft' || 
      f.upload_status === 'text_extracted' || 
      f.upload_status === 'parsing'
  );

  const completedFrameworks = frameworksArray.filter(
    (f: UploadedFramework) => f.upload_status === 'completed' || f.upload_status === 'published' || f.upload_status === 'parsed'
  );

  const getUploadStatusInfo = (status: string) => {
    switch (status) {
      case 'draft':
        return { 
          label: 'Uploaded', 
          color: 'bg-slate-500/20 text-slate-400',
          icon: FileText,
          description: 'File uploaded, waiting for text extraction'
        };
      case 'text_extracted':
        return { 
          label: 'Text Extracted', 
          color: 'bg-blue-500/20 text-blue-400',
          icon: FileText,
          description: 'Text extracted, waiting for AI parsing'
        };
      case 'parsing':
        return { 
          label: 'Parsing Controls', 
          color: 'bg-purple-500/20 text-purple-400',
          icon: Sparkles,
          description: 'AI is extracting controls and requirements'
        };
      case 'completed':
        return { 
          label: 'Ready', 
          color: 'bg-green-500/20 text-green-400',
          icon: CheckCircle,
          description: 'Framework ready to use'
        };
      case 'parsed':
        return { 
          label: 'Parsed', 
          color: 'bg-blue-500/20 text-blue-400',
          icon: CheckCircle,
          description: 'Framework parsed, ready to publish or start certification'
        };
      case 'published':
        return { 
          label: 'Published', 
          color: 'bg-green-500/20 text-green-400',
          icon: CheckCircle,
          description: 'Framework published and active'
        };
      case 'error':
        return { 
          label: 'Error', 
          color: 'bg-red-500/20 text-red-400',
          icon: AlertCircle,
          description: 'An error occurred during processing'
        };
      default:
        return { 
          label: status, 
          color: 'bg-slate-500/20 text-slate-400',
          icon: FileStack,
          description: 'Processing'
        };
    }
  };

  const availableFrameworks = completedFrameworks.filter(
    (f: UploadedFramework) => !activeCertificationFrameworkIds.has(String(f.id))
  );

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

  const getFrameworkTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'iso': 'ISO',
      'nist': 'NIST',
      'pci_dss': 'PCI DSS',
      'soc2': 'SOC 2',
      'gdpr': 'GDPR',
      'hipaa': 'HIPAA',
      'cobit': 'COBIT',
      'other': 'Custom'
    };
    return labels[type] || type.toUpperCase();
  };

  const handleStartCertification = async (framework: UploadedFramework) => {
    try {
      const response = await certificationsApi.create({
        framework_id: framework.id,
        name: `${framework.name} Certification`,
      });
      router.push(`/frameworks/${response.data.id}`);
    } catch (error) {
      console.error('Failed to start certification:', error);
    }
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
        </div>
      </div>

      {processingFrameworks.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <RefreshCw className={`h-5 w-5 text-purple-400 ${isFetching ? 'animate-spin' : ''}`} />
            Processing Frameworks
            <span className="ml-2 text-sm font-normal text-slate-400">
              Auto-refreshing every 3s
            </span>
          </h2>
          
          {retryError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-500/20 p-3 text-sm text-red-400">
              <AlertCircle className="h-4 w-4" />
              {retryError}
            </div>
          )}
          
          {retrySuccess && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-500/20 p-3 text-sm text-green-400">
              <CheckCircle className="h-4 w-4" />
              {retrySuccess}
            </div>
          )}
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {processingFrameworks.map((framework: UploadedFramework) => {
              const statusInfo = getUploadStatusInfo(framework.upload_status);
              const StatusIcon = statusInfo.icon;
              return (
                <div 
                  key={framework.id} 
                  className="card border-purple-500/30 bg-gradient-to-br from-slate-800 to-slate-800/50"
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-purple-500/20 p-2">
                      <Sparkles className="h-6 w-6 text-purple-400 animate-pulse" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate">{framework.name}</h3>
                      <p className="text-sm text-slate-400">v{framework.version}</p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${statusInfo.color}`}>
                        {framework.upload_status === 'parsing' ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <StatusIcon className="h-3 w-3" />
                        )}
                        {statusInfo.label}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">{statusInfo.description}</p>

                    {framework.upload_status === 'parsing' && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-400">
                          <span>AI parsing in progress...</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-700">
                          <div className="h-full w-full rounded-full bg-gradient-to-r from-purple-500 to-blue-500 animate-pulse" />
                        </div>
                      </div>
                    )}

                    {framework.controls_count > 0 && (
                      <div className="flex items-center gap-1 text-xs text-slate-400">
                        <Shield className="h-3 w-3" />
                        {framework.controls_count} controls extracted so far
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-700 pt-3">
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="h-3 w-3" />
                      Started: {new Date(framework.created_at).toLocaleTimeString()}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        retryParseMutation.mutate(framework.id);
                      }}
                      disabled={retryParseMutation.isPending}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-orange-400 hover:bg-orange-500/20 transition-colors disabled:opacity-50"
                      title="Retry parsing if stuck"
                    >
                      <RefreshCw className={`h-3 w-3 ${retryParseMutation.isPending ? 'animate-spin' : ''}`} />
                      Retry
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

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
          {availableFrameworks?.map((framework: UploadedFramework) => {
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
                    <Shield className="h-3 w-3" />
                    {framework.controls_count} controls
                  </span>
                </div>

                <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                  <Tag className="h-3 w-3" />
                  {getFrameworkTypeLabel(framework.framework_type)}
                </div>

                <div className="mt-4 border-t border-slate-700 pt-4 flex gap-2">
                  <button
                    onClick={() => handleStartCertification(framework)}
                    className="btn-primary flex flex-1 items-center justify-center gap-2"
                  >
                    <Play className="h-4 w-4" />
                    Start Certification
                  </button>
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
                </div>
              </div>
            );
          })}
        </div>

        {(!completedFrameworks || completedFrameworks.length === 0) && (
          <div className="card flex flex-col items-center justify-center py-12 text-center">
            <FileStack className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No frameworks available</h3>
            <p className="mt-1 text-slate-400">Upload a compliance framework to get started with certification</p>
            <Link 
              href="/framework-upload"
              className="mt-4 flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700 transition-colors"
            >
              <Upload className="h-4 w-4" />
              Upload Framework
            </Link>
          </div>
        )}
      </section>

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
              This will permanently remove the framework and all associated controls. This action cannot be undone.
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
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
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
