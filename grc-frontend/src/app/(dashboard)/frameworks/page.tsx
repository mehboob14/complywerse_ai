'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  Building2
} from 'lucide-react';

export default function FrameworksPage() {
  const router = useRouter();
  const [showCreateModal, setShowCreateModal] = useState(false);

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
        <button 
          onClick={() => setShowCreateModal(true)}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Create Custom Framework
        </button>
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
                  className="card cursor-pointer transition-all hover:border-primary-500/50 hover:shadow-lg hover:shadow-primary-500/10"
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
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${getStatusColor(cert.status)}`}>
                      {cert.status.replace('_', ' ')}
                    </span>
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
          {frameworks?.map((framework: Framework) => {
            const journey = getJourneyForFramework(framework.id);
            const hasActiveJourney = !!journey;
            const domainCount = framework.domains?.length || 0;
            const controlCount = countControls(framework);
            
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

                <div className="mt-4 border-t border-slate-700 pt-4">
                  {hasActiveJourney ? (
                    <button
                      onClick={() => router.push(`/frameworks/${journey.id}`)}
                      className="btn-secondary flex w-full items-center justify-center gap-2"
                    >
                      <ArrowRight className="h-4 w-4" />
                      View Journey
                    </button>
                  ) : (
                    <button
                      onClick={() => handleStartCertification(framework)}
                      className="btn-primary flex w-full items-center justify-center gap-2"
                    >
                      <Play className="h-4 w-4" />
                      Start Certification
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
    </div>
  );
}
