'use client';

// /frameworks/manage
// ─────────────────────────────────────────────────────────────────────────
// Management surface for the frameworks library:
//   • Processing frameworks (uploads still being parsed / classified)
//   • Active certification journeys (the gauge cards)
//   • Available frameworks (the full library, with Start Journey actions)
// All sections + mutations preserved verbatim from the legacy /frameworks
// page. The new /frameworks dashboard surface lives in ../page.tsx and only
// hosts the posture dashboard + journey launcher.

import { useState } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import apiClient, { certificationsApi } from '@/lib/api';
import { CertificationJourney } from '@/types';
import { SearchInput, PageLoader } from '@/components/ui';
import {
  FileStack, Loader2, AlertCircle, Shield, Play, ArrowRight,
  Calendar, Target, CheckCircle2, Clock, Trash2, X, Tag,
  RefreshCw, FileText, Sparkles, CheckCircle, Eye,
} from 'lucide-react';
import Link from 'next/link';
import { usePermissions } from '@/hooks/usePermissions';
import { FrameworksTabs } from '../_components/FrameworksTabs';
import {
  UploadedFramework,
  stripCertificationPostfix,
  dedupeFrameworks,
} from '../_components/shared';

export default function FrameworksManagePage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canDelete = hasPermission('frameworks:framework_library:delete');
  const queryClient = useQueryClient();
  const [deleteConfirm, setDeleteConfirm] = useState<UploadedFramework | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [journeyDeleteConfirm, setJourneyDeleteConfirm] = useState<CertificationJourney | null>(null);
  const [journeyDeleteError, setJourneyDeleteError] = useState<string | null>(null);
  const [enhancingFrameworkId, setEnhancingFrameworkId] = useState<number | null>(null);
  const [classifyingFrameworkId, setClassifyingFrameworkId] = useState<number | null>(null);
  const [frameworkSearch, setFrameworkSearch] = useState('');

  const deleteMutation = useMutation({
    mutationFn: async (frameworkId: number) => {
      return await apiClient.delete(`/framework-upload/upload/${frameworkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
      setDeleteConfirm(null);
      setDeleteError(null);
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setDeleteError(error.response?.data?.detail || 'Failed to delete framework');
    },
  });

  const journeyDeleteMutation = useMutation({
    mutationFn: async (journeyId: number) => certificationsApi.delete(journeyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certifications'] });
      setJourneyDeleteConfirm(null);
      setJourneyDeleteError(null);
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setJourneyDeleteError(error.response?.data?.detail || 'Failed to delete certification journey');
    },
  });

  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrySuccess, setRetrySuccess] = useState<string | null>(null);

  const retryParseMutation = useMutation({
    mutationFn: async (frameworkId: number) =>
      apiClient.post(`/framework-upload/parser/${frameworkId}/retry-parse`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
      setRetryError(null);
      setRetrySuccess(data.data?.message || 'Parsing restarted successfully');
      setTimeout(() => setRetrySuccess(null), 5000);
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setRetryError(error.response?.data?.detail || 'Failed to retry parsing');
      setRetrySuccess(null);
      setTimeout(() => setRetryError(null), 5000);
    },
  });

  const enhanceMutation = useMutation({
    mutationFn: async (frameworkId: number) =>
      apiClient.post(`/framework-upload/parser/frameworks/${frameworkId}/enhance`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
      setEnhancingFrameworkId(null);
      setRetrySuccess(
        `Enhancement started for ${data.data?.total_controls || 0} controls. Estimated time: ${data.data?.estimated_time_minutes || 1} minutes.`,
      );
      setTimeout(() => setRetrySuccess(null), 8000);
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setRetryError(error.response?.data?.detail || 'Failed to start enhancement');
      setEnhancingFrameworkId(null);
      setTimeout(() => setRetryError(null), 5000);
    },
  });

  const classifyMutation = useMutation({
    mutationFn: async (frameworkId: number) =>
      apiClient.post(`/framework-upload/parser/${frameworkId}/classify`),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['uploaded-frameworks'] });
      setClassifyingFrameworkId(null);
      setRetrySuccess(data.data?.message || 'Framework classification started');
      setTimeout(() => setRetrySuccess(null), 5000);
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setRetryError(error.response?.data?.detail || 'Failed to classify framework');
      setClassifyingFrameworkId(null);
      setTimeout(() => setRetryError(null), 5000);
    },
  });

  const { data: frameworks, isLoading: frameworksLoading, isFetching } = useQuery({
    queryKey: ['uploaded-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const items = response.data?.items;
      return Array.isArray(items) ? (items as UploadedFramework[]) : [];
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!Array.isArray(data)) return false;
      const hasProcessing = data.some((f: UploadedFramework) =>
        ['draft', 'text_extracted', 'parsing'].includes(f.upload_status),
      );
      return hasProcessing ? 3000 : false;
    },
  });

  const { data: certifications, isLoading: certificationsLoading } = useQuery({
    queryKey: ['certifications'],
    queryFn: async () => {
      const response = await certificationsApi.getAll();
      const d = response.data;
      if (Array.isArray(d)) return d as CertificationJourney[];
      if (d && typeof d === 'object') {
        const o = d as Record<string, unknown>;
        for (const k of ['items', 'data', 'results', 'certifications'] as const) {
          if (Array.isArray(o[k])) return o[k] as CertificationJourney[];
        }
      }
      return [];
    },
  });

  if (frameworksLoading || certificationsLoading) {
    return <PageLoader className="h-64" />;
  }

  const activeCertificationsRaw = (Array.isArray(certifications) ? certifications : []).filter(
    (c: CertificationJourney) => c.status === 'in_progress' || c.status === 'not_started',
  );

  const activeCertifications = Object.values(
    activeCertificationsRaw.reduce((acc, cert) => {
      const key = String(cert.framework_id || cert.uploaded_framework_id || cert.id);
      const existing = acc[key];
      if (!existing) { acc[key] = cert; return acc; }
      const existingTs = new Date(existing.started_at || 0).getTime();
      const candidateTs = new Date(cert.started_at || 0).getTime();
      if (candidateTs >= existingTs) acc[key] = cert;
      return acc;
    }, {} as Record<string, CertificationJourney>),
  );

  const activeCertificationFrameworkIds = new Set(
    activeCertifications.map((c: CertificationJourney) =>
      String(c.framework_id || c.uploaded_framework_id),
    ),
  );

  const frameworksArray = Array.isArray(frameworks) ? frameworks : [];
  const dedupedFrameworks = dedupeFrameworks(frameworksArray);

  const processingFrameworks = dedupedFrameworks.filter(
    (f: UploadedFramework) =>
      ['draft', 'text_extracted', 'parsing', 'classifying'].includes(f.upload_status),
  );
  const completedFrameworks = dedupedFrameworks.filter(
    (f: UploadedFramework) =>
      ['completed', 'published', 'parsed', 'classified'].includes(f.upload_status),
  );

  const getUploadStatusInfo = (status: string) => {
    switch (status) {
      case 'draft':
        return { label: 'Uploaded', color: 'bg-slate-50 text-slate-700', icon: FileText, description: 'File uploaded, waiting for text extraction' };
      case 'text_extracted':
        return { label: 'Text Extracted', color: 'bg-slate-100 text-slate-700', icon: FileText, description: 'Text extracted, waiting for AI parsing' };
      case 'parsing':
        return { label: 'Parsing Controls', color: 'bg-primary-50 text-primary-700', icon: Sparkles, description: 'AI is extracting controls and requirements' };
      case 'completed':
        return { label: 'Ready', color: 'bg-emerald-50 text-emerald-700', icon: CheckCircle, description: 'Framework ready to use' };
      case 'parsed':
        return { label: 'Parsed', color: 'bg-primary-50 text-primary-700', icon: CheckCircle, description: 'Framework parsed, ready to publish or start certification' };
      case 'published':
        return { label: 'Published', color: 'bg-emerald-50 text-emerald-700', icon: CheckCircle, description: 'Framework published and active' };
      case 'error':
        return { label: 'Error', color: 'bg-rose-50 text-rose-700', icon: AlertCircle, description: 'An error occurred during processing' };
      case 'classifying':
        return { label: 'Classifying Framework', color: 'bg-amber-50 text-amber-700', icon: Sparkles, description: 'AI is analyzing framework type' };
      case 'classified':
        return { label: 'Classified', color: 'bg-primary-50 text-primary-700', icon: Tag, description: 'Framework classified, ready to view overview' };
      default:
        return { label: status, color: 'bg-slate-50 text-slate-700', icon: FileStack, description: 'Processing' };
    }
  };

  const availableFrameworks = completedFrameworks.filter(
    (f: UploadedFramework) => !activeCertificationFrameworkIds.has(String(f.id)),
  );

  const normalizedSearch = frameworkSearch.trim().toLowerCase();

  const frameworkMatchesSearch = (framework: UploadedFramework) => {
    if (!normalizedSearch) return true;
    return [
      framework.name,
      stripCertificationPostfix(framework.name),
      framework.version,
      framework.framework_type,
      framework.classification,
      framework.regulatory_authority,
      framework.certification_body,
      framework.framework_purpose,
    ]
      .filter(Boolean)
      .some((value) => value!.toString().toLowerCase().includes(normalizedSearch));
  };

  const certificationMatchesSearch = (cert: CertificationJourney) => {
    if (!normalizedSearch) return true;
    return [cert.name, cert.framework?.name, cert.status]
      .filter(Boolean)
      .some((value) => value!.toString().toLowerCase().includes(normalizedSearch));
  };

  const filteredProcessingFrameworks = processingFrameworks.filter(frameworkMatchesSearch);
  const filteredActiveCertifications = activeCertifications.filter(certificationMatchesSearch);
  const filteredAvailableFrameworks = availableFrameworks.filter(frameworkMatchesSearch);
  const hasVisibleResults =
    filteredProcessingFrameworks.length > 0 ||
    filteredActiveCertifications.length > 0 ||
    filteredAvailableFrameworks.length > 0;

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-emerald-50 text-emerald-700';
      case 'in_progress': return 'bg-primary-50 text-primary-700';
      case 'on_hold': return 'bg-amber-50 text-amber-700';
      default: return 'bg-slate-50 text-slate-700';
    }
  };

  const getFrameworkTypeLabel = (type?: string | null) => {
    if (!type) return 'Custom';
    const labels: Record<string, string> = {
      iso: 'ISO', nist: 'NIST', pci_dss: 'PCI DSS', soc2: 'SOC 2',
      gdpr: 'GDPR', hipaa: 'HIPAA', cobit: 'COBIT', other: 'Custom',
    };
    return labels[type] || type.toUpperCase();
  };

  const handleStartCertification = async (framework: UploadedFramework) => {
    try {
      const cleanName = stripCertificationPostfix(framework.name);
      const response = await certificationsApi.create({
        framework_id: framework.id,
        name: cleanName || framework.name,
      });
      router.push(`/frameworks/${response.data.id}`);
    } catch (error) {
      console.error('Failed to start certification:', error);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <FrameworksTabs />

      {/* Search bar for filtering library + journeys */}
      <div className="flex items-center justify-end">
        <div className="w-full sm:w-72">
          <SearchInput
            value={frameworkSearch}
            onChange={setFrameworkSearch}
            placeholder="Search frameworks…"
            size="md"
          />
        </div>
      </div>

      {normalizedSearch && !hasVisibleResults && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No frameworks match your search.
        </div>
      )}

      {filteredProcessingFrameworks.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <RefreshCw className={`h-5 w-5 text-primary-600 ${isFetching ? 'animate-spin' : ''}`} strokeWidth={1.75} />
            Processing Frameworks
            <span className="ml-2 text-sm font-normal text-slate-500">Auto-refreshing every 3s</span>
          </h2>

          {retryError && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">
              <AlertCircle className="h-4 w-4" />
              {retryError}
            </div>
          )}
          {retrySuccess && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-700">
              <CheckCircle className="h-4 w-4" />
              {retrySuccess}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredProcessingFrameworks.map((framework: UploadedFramework) => {
              const statusInfo = getUploadStatusInfo(framework.upload_status);
              const StatusIcon = statusInfo.icon;
              return (
                <div key={framework.id} className="rounded-xl border border-primary-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-primary-50 p-2">
                      <Sparkles className="h-6 w-6 text-primary-600 animate-pulse" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-slate-900 truncate">{stripCertificationPostfix(framework.name)}</h3>
                      <p className="text-sm text-slate-500">v{framework.version}</p>
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
                    <p className="text-sm text-slate-500">{statusInfo.description}</p>

                    {framework.upload_status === 'parsing' && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-500">
                          <span>AI parsing in progress…</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full w-full rounded-full bg-primary-500 animate-pulse" />
                        </div>
                      </div>
                    )}

                    {framework.controls_count > 0 && (
                      <div className="flex items-center gap-1 text-xs text-slate-500">
                        <Shield className="h-3 w-3" />
                        {framework.controls_count} controls extracted so far
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-3">
                    <div className="flex items-center gap-1 text-xs text-slate-500">
                      <Clock className="h-3 w-3" />
                      Started: {new Date(framework.created_at).toLocaleTimeString()}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); retryParseMutation.mutate(framework.id); }}
                      disabled={retryParseMutation.isPending}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-orange-600 hover:bg-orange-50 transition-colors disabled:opacity-50"
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

      {filteredActiveCertifications.length > 0 && (
        <section>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Target className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            Active Certification Journeys
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredActiveCertifications.map((cert: CertificationJourney) => {
              const progressData = cert.progress as { readiness_percentage?: number; completion_percentage?: number; implemented_count?: number; implemented?: number; in_progress_count?: number; in_progress?: number } | undefined;
              const progress = progressData?.readiness_percentage ?? progressData?.completion_percentage ?? 0;
              const implemented = progressData?.implemented_count ?? progressData?.implemented ?? 0;
              const inProgress = progressData?.in_progress_count ?? progressData?.in_progress ?? 0;
              return (
                <div
                  key={cert.id}
                  className="cw-card p-6 shadow-sm group cursor-pointer transition-all hover:border-primary-300 hover:shadow-lg"
                  onClick={() => router.push(`/frameworks/${cert.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary-50 p-2">
                        <Shield className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-900">{stripCertificationPostfix(cert.name)}</h3>
                        <p className="text-sm text-slate-500">{cert.framework?.name || 'Framework'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap ${getStatusColor(cert.status)}`}>
                        {cert.status.replace('_', ' ')}
                      </span>
                      {canDelete && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setJourneyDeleteConfirm(cert); setJourneyDeleteError(null); }}
                          className="rounded-lg bg-rose-50 p-1.5 text-rose-600 hover:bg-rose-100 transition-colors opacity-0 group-hover:opacity-100"
                          title="Delete Certification Journey"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4">
                    {(() => {
                      const gaugeData = [
                        { name: 'done', value: progress, fill: progress >= 80 ? '#22c55e' : progress >= 50 ? '#f59e0b' : progress >= 25 ? '#f97316' : '#ef4444' },
                        { name: 'rem',  value: 100 - progress, fill: '#e2e8f0' },
                      ];
                      return (
                        <div className="flex items-center gap-4">
                          <div className="relative h-[72px] w-[72px] flex-shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie data={gaugeData} cx="50%" cy="50%" startAngle={225} endAngle={-45}
                                  innerRadius={24} outerRadius={34} dataKey="value" paddingAngle={0} stroke="none">
                                  {gaugeData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                                </Pie>
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <span className="text-xs font-bold" style={{ color: gaugeData[0].fill }}>{progress}%</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 text-xs text-slate-500">
                            <span className="font-medium text-slate-900">Readiness</span>
                            <span>{implemented} implemented</span>
                            <span>{inProgress} in progress</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-200 pt-4">
                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {implemented} implemented
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {inProgress} in progress
                      </span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
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
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900">
          <FileStack className="h-5 w-5 text-slate-500" />
          Available Frameworks
        </h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredAvailableFrameworks?.map((framework: UploadedFramework) => (
            <div key={framework.id} className="cw-card p-6 shadow-sm group transition-all hover:border-slate-300 hover:shadow-md">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary-50 p-2 transition-colors group-hover:bg-primary-100">
                  <FileStack className="h-6 w-6 text-primary-600" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-900 truncate">{stripCertificationPostfix(framework.name)}</h3>
                  <p className="text-sm text-slate-500">v{framework.version}</p>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/controls?framework=${framework.id}`}
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200 transition-colors"
                >
                  <Shield className="h-3 w-3" />
                  {framework.controls_count} controls
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>

              <div className="mt-3 flex items-center gap-1 text-xs text-slate-500">
                <Tag className="h-3 w-3" />
                {getFrameworkTypeLabel(framework.framework_type)}
              </div>

              {framework.classification && (
                <div className="mt-2">
                  <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap ${
                    framework.classification === 'certification'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-primary-50 text-primary-700'
                  }`}>
                    {framework.classification === 'certification' ? '🏆 Certification' : '📋 Compliance'}
                    <span className="text-slate-500 ml-1">(0%)</span>
                  </span>
                </div>
              )}

              <div className="mt-4 border-t border-slate-200 pt-4 flex flex-col gap-2">
                {(framework.classification === 'certification' || framework.classification === 'compliance') && (
                  <Link
                    href={`/frameworks/overview/${framework.id}`}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-50 px-3 py-2 text-primary-700 hover:bg-primary-100 transition-colors"
                  >
                    <Eye className="h-4 w-4" strokeWidth={1.75} />
                    View Overview
                  </Link>
                )}

                {(['uploaded', 'parsed', 'completed', 'published'].includes(framework.upload_status)) && !framework.classification && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setClassifyingFrameworkId(framework.id); classifyMutation.mutate(framework.id); }}
                    disabled={classifyMutation.isPending && classifyingFrameworkId === framework.id}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-700 hover:bg-amber-100 transition-colors disabled:opacity-50"
                    title="Classify framework as certification or compliance"
                  >
                    {classifyMutation.isPending && classifyingFrameworkId === framework.id ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> Classifying…</>
                    ) : (
                      <><Sparkles className="h-4 w-4" /> Classify Framework</>
                    )}
                  </button>
                )}

                <div className="flex gap-2 flex-wrap">
                  <Link
                    href={`/controls?framework=${framework.id}`}
                    className="cw-btn-secondary whitespace-nowrap flex flex-1 items-center justify-center gap-2 px-3 py-2"
                  >
                    <Shield className="h-4 w-4" />
                    View Controls
                  </Link>
                  <button
                    onClick={() => handleStartCertification(framework)}
                    className="cw-btn-primary whitespace-nowrap flex flex-1 items-center justify-center gap-2 px-3 py-2"
                  >
                    <Play className="h-4 w-4" />
                    Start Journey
                  </button>
                  {canDelete && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(framework); setDeleteError(null); }}
                      className="rounded-lg bg-rose-50 px-3 py-2 text-rose-600 hover:bg-rose-100 transition-colors"
                      title="Delete Framework"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); setEnhancingFrameworkId(framework.id); enhanceMutation.mutate(framework.id); }}
                  disabled={enhanceMutation.isPending && enhancingFrameworkId === framework.id}
                  className="border-2 rounded-lg flex flex-1 items-center justify-center gap-2 px-3 py-2"
                  title="Generate AI evidence recommendations for all controls"
                >
                  {enhanceMutation.isPending && enhancingFrameworkId === framework.id ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Enhancing…</>
                  ) : (
                    <><Sparkles className="h-6 w-6" /> Generate Evidence Recommendations</>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

        {(!completedFrameworks || completedFrameworks.length === 0) && (
          <div className="cw-card p-12 shadow-sm flex flex-col items-center justify-center text-center">
            <FileStack className="mb-4 h-12 w-12 text-slate-400" />
            <h3 className="text-lg font-medium text-slate-900">No frameworks available</h3>
            <p className="mt-1 text-slate-500">No frameworks uploaded yet. Use Upload New Framework to add your first framework.</p>
          </div>
        )}

        {completedFrameworks.length > 0 && filteredAvailableFrameworks.length === 0 && normalizedSearch && (
          <div className="cw-card p-10 shadow-sm flex flex-col items-center justify-center text-center">
            <FileStack className="mb-3 h-10 w-10 text-slate-400" />
            <h3 className="text-base font-medium text-slate-900">No available frameworks found</h3>
            <p className="mt-1 text-sm text-slate-500">Try a different keyword.</p>
          </div>
        )}
      </section>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                Delete Framework
              </h3>
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteError(null); }}
                className="text-slate-500 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-slate-900 mb-2">
              Are you sure you want to delete <span className="font-semibold">{deleteConfirm.name}</span>?
            </p>
            <p className="text-sm text-slate-500 mb-4">
              This will permanently remove the framework and all associated controls. This action cannot be undone.
            </p>

            {deleteError && (
              <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{deleteError}</div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setDeleteConfirm(null); setDeleteError(null); }}
                className="cw-btn-secondary px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm.id)}
                disabled={deleteMutation.isPending}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deleteMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
                ) : (
                  <><Trash2 className="h-4 w-4" /> Delete Framework</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {journeyDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600" />
                Delete Certification Journey
              </h3>
              <button
                onClick={() => { setJourneyDeleteConfirm(null); setJourneyDeleteError(null); }}
                className="text-slate-500 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <p className="text-slate-900 mb-2">
              Are you sure you want to delete <span className="font-semibold">{journeyDeleteConfirm.name}</span>?
            </p>
            <p className="text-sm text-slate-500 mb-4">
              This will permanently remove the certification journey and all associated progress data, control implementations, and evidence attachments. This action cannot be undone.
            </p>

            {journeyDeleteError && (
              <div className="mb-4 rounded-lg bg-rose-50 border border-rose-200 p-3 text-sm text-rose-700">{journeyDeleteError}</div>
            )}

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setJourneyDeleteConfirm(null); setJourneyDeleteError(null); }}
                className="cw-btn-secondary px-4 py-2 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={() => journeyDeleteMutation.mutate(journeyDeleteConfirm.id)}
                disabled={journeyDeleteMutation.isPending}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 flex items-center gap-2"
              >
                {journeyDeleteMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>
                ) : (
                  <><Trash2 className="h-4 w-4" /> Delete Journey</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
