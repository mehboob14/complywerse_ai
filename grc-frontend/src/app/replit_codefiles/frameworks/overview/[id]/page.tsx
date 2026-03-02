'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import apiClient, { certificationsApi } from '@/lib/api';
import { 
  ArrowLeft,
  Shield,
  Award,
  FileText,
  CheckCircle,
  Target,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Play,
  Users,
  BookOpen,
  ClipboardCheck,
  RefreshCw,
  FileStack
} from 'lucide-react';

interface FrameworkOverview {
  id: number;
  name: string;
  version: string;
  framework_type: string;
  upload_status: string;
  controls_count: number;
  is_shared: boolean;
  is_active: boolean;
  created_at: string;
  classification?: string;
  classification_confidence?: number;
  classification_reasoning?: string;
  framework_purpose?: string;
  framework_scope?: string;
  framework_objectives?: string[];
  target_audience?: string;
  certification_body?: string;
  certification_validity_period?: string;
  certification_levels?: any[];
  certification_lifecycle?: any;
  required_artifacts?: any;
  regulatory_authority?: string;
  compliance_deadline?: string;
  penalty_for_non_compliance?: string;
  adoption_approach?: any;
  parsed_controls_count?: number;
}

const lifecyclePhases = [
  { name: 'Preparation', icon: BookOpen, description: 'Document policies and procedures' },
  { name: 'Assessment', icon: ClipboardCheck, description: 'Gap analysis and readiness check' },
  { name: 'Remediation', icon: RefreshCw, description: 'Address identified gaps' },
  { name: 'Certification', icon: Award, description: 'Formal audit and certification' },
  { name: 'Maintenance', icon: Shield, description: 'Ongoing compliance monitoring' },
];

const defaultArtifacts = [
  { name: 'Policies', icon: FileText },
  { name: 'Procedures', icon: BookOpen },
  { name: 'Controls', icon: Shield },
  { name: 'Records', icon: FileStack },
  { name: 'Evidence', icon: ClipboardCheck },
];

export default function FrameworkOverviewPage() {
  const router = useRouter();
  const params = useParams();
  const frameworkId = params.id as string;
  const [showReasoning, setShowReasoning] = useState(false);

  const { data: framework, isLoading, error } = useQuery({
    queryKey: ['framework-overview', frameworkId],
    queryFn: async () => {
      const response = await apiClient.get(`/framework-upload/upload/${frameworkId}`);
      return response.data as FrameworkOverview;
    },
  });

  const startCertificationMutation = useMutation({
    mutationFn: async () => {
      return await certificationsApi.create({
        framework_id: Number(frameworkId),
        name: `${framework?.name} Certification`,
      });
    },
    onSuccess: (response) => {
      router.push(`/frameworks/${response.data.id}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !framework) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertTriangle className="mb-2 h-8 w-8" />
        <p>Failed to load framework overview</p>
        <Link href="/frameworks" className="mt-4 text-primary-400 hover:underline">
          Return to Frameworks
        </Link>
      </div>
    );
  }

  const isCertification = framework.classification === 'certification';
  const isCompliance = framework.classification === 'compliance';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link 
          href="/frameworks"
          className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Frameworks
        </Link>
      </div>

      <div className="card border-slate-700">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className={`rounded-xl p-3 ${
              isCertification ? 'bg-emerald-500/20' : 'bg-blue-500/20'
            }`}>
              {isCertification ? (
                <Award className="h-8 w-8 text-emerald-400" />
              ) : (
                <FileText className="h-8 w-8 text-blue-400" />
              )}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{framework.name}</h1>
              <p className="text-slate-400">Version {framework.version}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-medium ${
                  isCertification 
                    ? 'bg-emerald-500/20 text-emerald-400' 
                    : 'bg-blue-500/20 text-blue-400'
                }`}>
                  {isCertification ? '🏆 Certification Framework' : '📋 Compliance Framework'}
                </span>
                {framework.classification_confidence && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-700 px-3 py-1 text-sm text-slate-300">
                    <Target className="h-3 w-3" />
                    {Math.round(framework.classification_confidence * 100)}% confidence
                  </span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-2">
            <Link
              href={`/controls?framework=${framework.id}`}
              className="btn-secondary flex items-center justify-center gap-2"
            >
              <Shield className="h-4 w-4" />
              View Controls ({framework.controls_count})
            </Link>
            <button
              onClick={() => startCertificationMutation.mutate()}
              disabled={startCertificationMutation.isPending}
              className="btn-primary flex items-center justify-center gap-2"
            >
              {startCertificationMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  {isCertification ? 'Start Certification Journey' : 'Start Compliance Program'}
                </>
              )}
            </button>
          </div>
        </div>

        {(isCertification && framework.certification_body) || (isCompliance && framework.regulatory_authority) ? (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-sm text-slate-400">
              {isCertification ? 'Certification Body:' : 'Regulatory Authority:'}
              <span className="ml-2 text-white font-medium">
                {isCertification ? framework.certification_body : framework.regulatory_authority}
              </span>
            </p>
          </div>
        ) : null}
      </div>

      {framework.classification_reasoning && (
        <div className="card border-slate-700">
          <button
            onClick={() => setShowReasoning(!showReasoning)}
            className="flex w-full items-center justify-between text-left"
          >
            <span className="font-medium text-white">Classification Reasoning</span>
            {showReasoning ? (
              <ChevronUp className="h-5 w-5 text-slate-400" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-400" />
            )}
          </button>
          {showReasoning && (
            <div className="mt-4 rounded-lg bg-slate-800/50 p-4">
              <p className="text-sm text-slate-300 whitespace-pre-wrap">
                {framework.classification_reasoning}
              </p>
            </div>
          )}
        </div>
      )}

      {isCertification && (
        <>
          <div className="card border-slate-700">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-emerald-400" />
              Certification Lifecycle
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              {lifecyclePhases.map((phase, index) => {
                const PhaseIcon = phase.icon;
                return (
                  <div key={phase.name} className="relative">
                    <div className="flex flex-col items-center text-center p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-emerald-500/50 transition-colors">
                      <div className="rounded-full bg-emerald-500/20 p-3 mb-3">
                        <PhaseIcon className="h-6 w-6 text-emerald-400" />
                      </div>
                      <h3 className="font-medium text-white text-sm">{phase.name}</h3>
                      <p className="text-xs text-slate-400 mt-1">{phase.description}</p>
                    </div>
                    {index < lifecyclePhases.length - 1 && (
                      <div className="hidden md:block absolute top-1/2 -right-2 transform -translate-y-1/2 text-slate-600">
                        →
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card border-slate-700">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5 text-emerald-400" />
                Required Artifacts
              </h2>
              <div className="space-y-3">
                {(framework.required_artifacts && typeof framework.required_artifacts === 'object' 
                  ? Object.entries(framework.required_artifacts).map(([key, value]) => ({
                      name: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
                      description: String(value)
                    }))
                  : defaultArtifacts
                ).map((artifact: any, index: number) => (
                  <div key={index} className="flex items-center gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0" />
                    <div>
                      <span className="text-white font-medium">{artifact.name}</span>
                      {artifact.description && artifact.description !== artifact.name && (
                        <p className="text-sm text-slate-400">{artifact.description}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card border-slate-700">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5 text-emerald-400" />
                Certification Details
              </h2>
              <div className="space-y-4">
                {framework.certification_validity_period && (
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-sm text-slate-400">Validity Period</p>
                    <p className="text-white font-medium">{framework.certification_validity_period}</p>
                  </div>
                )}
                {framework.certification_levels && framework.certification_levels.length > 0 && (
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-sm text-slate-400 mb-2">Certification Levels</p>
                    <div className="flex flex-wrap gap-2">
                      {framework.certification_levels.map((level: any, index: number) => (
                        <span key={index} className="rounded-full bg-emerald-500/20 px-3 py-1 text-sm text-emerald-400">
                          {typeof level === 'string' ? level : level.name || `Level ${index + 1}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <p className="text-sm text-slate-400">Total Controls</p>
                  <p className="text-white font-medium">{framework.controls_count} controls to implement</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {isCompliance && (
        <>
          {framework.framework_purpose && (
            <div className="card border-slate-700 bg-gradient-to-br from-slate-800 to-blue-900/20">
              <h2 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                <Target className="h-5 w-5 text-blue-400" />
                Framework Purpose
              </h2>
              <p className="text-slate-300 leading-relaxed">{framework.framework_purpose}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="card border-slate-700">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-400" />
                Scope & Audience
              </h2>
              <div className="space-y-4">
                {framework.framework_scope && (
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-sm text-slate-400">Scope</p>
                    <p className="text-white">{framework.framework_scope}</p>
                  </div>
                )}
                {framework.target_audience && (
                  <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                    <p className="text-sm text-slate-400">Target Audience</p>
                    <p className="text-white flex items-center gap-2">
                      <Users className="h-4 w-4 text-blue-400" />
                      {framework.target_audience}
                    </p>
                  </div>
                )}
                <div className="p-3 rounded-lg bg-slate-800/50 border border-slate-700">
                  <p className="text-sm text-slate-400">Total Controls</p>
                  <p className="text-white font-medium">{framework.controls_count} controls to implement</p>
                </div>
              </div>
            </div>

            {framework.framework_objectives && framework.framework_objectives.length > 0 && (
              <div className="card border-slate-700">
                <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-blue-400" />
                  Framework Objectives
                </h2>
                <ul className="space-y-2">
                  {framework.framework_objectives.map((objective: string, index: number) => (
                    <li key={index} className="flex items-start gap-2 text-slate-300">
                      <CheckCircle className="h-4 w-4 text-blue-400 mt-0.5 flex-shrink-0" />
                      <span>{objective}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {framework.adoption_approach && (
            <div className="card border-slate-700">
              <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-blue-400" />
                Adoption Approach
              </h2>
              <div className="space-y-3">
                {(Array.isArray(framework.adoption_approach) 
                  ? framework.adoption_approach 
                  : typeof framework.adoption_approach === 'object'
                    ? Object.entries(framework.adoption_approach).map(([key, value]) => `${key}: ${value}`)
                    : [String(framework.adoption_approach)]
                ).map((step: any, index: number) => (
                  <div key={index} className="flex items-start gap-4 p-4 rounded-lg bg-slate-800/50 border border-slate-700">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold flex-shrink-0">
                      {index + 1}
                    </div>
                    <p className="text-slate-300 pt-1">{typeof step === 'string' ? step : JSON.stringify(step)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {framework.penalty_for_non_compliance && (
            <div className="card border-red-500/30 bg-gradient-to-br from-slate-800 to-red-900/20">
              <div className="flex items-start gap-4">
                <div className="rounded-full bg-red-500/20 p-3">
                  <AlertTriangle className="h-6 w-6 text-red-400" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-white mb-2">Penalty for Non-Compliance</h2>
                  <p className="text-red-300">{framework.penalty_for_non_compliance}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!isCertification && !isCompliance && (
        <div className="card border-slate-700 text-center py-12">
          <FileStack className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-white">Framework Not Yet Classified</h2>
          <p className="text-slate-400 mt-2">
            This framework has not been classified. Return to the frameworks page to classify it.
          </p>
          <Link
            href="/frameworks"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Frameworks
          </Link>
        </div>
      )}
    </div>
  );
}
