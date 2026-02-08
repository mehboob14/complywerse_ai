'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import apiClient, { controlsApi } from '@/lib/api';
import { 
  Shield, 
  Loader2, 
  AlertCircle, 
  Search, 
  Filter,
  CheckCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  ArrowLeft,
  FileStack,
  Info,
  Paperclip,
  HelpCircle,
  Sparkles,
  ClipboardList,
  FolderOpen,
  AlertTriangle,
  Target
} from 'lucide-react';

interface FrameworkControl {
  id: number;
  control_id: string;
  original_reference: string | null;
  title: string;
  description: string | null;
  full_text: string | null;
  domain: string | null;
  category: string | null;
  is_mandatory: boolean;
  priority: string;
  section_number: string | null;
  parent_section: string | null;
  ai_confidence: number | null;
  is_verified: boolean;
  framework_id: number;
  framework_name: string;
  framework_version: string | null;
  created_at: string | null;
  evidence_count: number;
}

interface FrameworkSummary {
  id: number;
  name: string;
  version: string | null;
  framework_type: string | null;
  status: string;
  control_count: number;
}

interface FrameworkControlsResponse {
  controls: FrameworkControl[];
  total: number;
  skip: number;
  limit: number;
}

interface FrameworkSummaryResponse {
  frameworks: FrameworkSummary[];
  total_frameworks: number;
  total_controls: number;
}

interface TestProcedure {
  procedure_type: string;
  description: string;
  frequency: string;
  sample_size: string;
}

interface EvidenceRequirement {
  evidence_type: string;
  title: string;
  description: string;
  mandatory: boolean;
}

interface AIRecommendations {
  control_id: number;
  test_procedures: TestProcedure[];
  evidence_requirements: EvidenceRequirement[];
  key_risks_addressed: string[];
  audit_focus_areas: string[];
}

export default function ControlsPage() {
  const searchParams = useSearchParams();
  const initialFrameworkId = searchParams.get('framework');
  
  const [searchTerm, setSearchTerm] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState<number | null>(
    initialFrameworkId ? Number(initialFrameworkId) : null
  );
  const [domainFilter, setDomainFilter] = useState('');
  const [expandedControl, setExpandedControl] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [aiRecommendations, setAiRecommendations] = useState<Record<number, AIRecommendations>>({});
  const [loadingAI, setLoadingAI] = useState<number | null>(null);
  const pageSize = 50;

  const aiRecommendationMutation = useMutation({
    mutationFn: (data: { control_id: number; control_title: string; control_description?: string; framework_name?: string }) =>
      controlsApi.getAIRecommendations(data),
    onSuccess: (response, variables) => {
      setAiRecommendations(prev => ({
        ...prev,
        [variables.control_id]: response.data
      }));
      setLoadingAI(null);
    },
    onError: () => {
      setLoadingAI(null);
    }
  });

  const handleGetAIRecommendations = (control: FrameworkControl) => {
    if (aiRecommendations[control.id] || loadingAI === control.id) return;
    setLoadingAI(control.id);
    aiRecommendationMutation.mutate({
      control_id: control.id,
      control_title: control.title,
      control_description: control.description || undefined,
      framework_name: control.framework_name || undefined
    });
  };

  const getProcedureTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      walkthrough: 'bg-blue-500/20 text-blue-400',
      inquiry: 'bg-primary-500/20 text-primary-600',
      observation: 'bg-cyan-500/20 text-cyan-400',
      inspection: 'bg-amber-500/20 text-amber-400',
      reperformance: 'bg-emerald-500/20 text-emerald-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${colors[type] || 'bg-slate-200 text-slate-500'}`}>
        {type}
      </span>
    );
  };

  const getEvidenceTypeIcon = (type: string) => {
    const icons: Record<string, React.ReactNode> = {
      policy: <FileText className="h-4 w-4" />,
      procedure: <ClipboardList className="h-4 w-4" />,
      report: <FolderOpen className="h-4 w-4" />,
      screenshot: <FileText className="h-4 w-4" />,
      log: <FileText className="h-4 w-4" />,
      configuration: <FileText className="h-4 w-4" />,
      certificate: <FileText className="h-4 w-4" />,
      attestation: <FileText className="h-4 w-4" />,
      training: <FileText className="h-4 w-4" />,
    };
    return icons[type] || <FileText className="h-4 w-4" />;
  };

  useEffect(() => {
    if (initialFrameworkId) {
      setFrameworkFilter(Number(initialFrameworkId));
    }
  }, [initialFrameworkId]);

  const { data: summaryData } = useQuery({
    queryKey: ['framework-controls-summary'],
    queryFn: async () => {
      const response = await apiClient.get('/controls/framework-controls/summary');
      return response.data as FrameworkSummaryResponse;
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['framework-controls', frameworkFilter, domainFilter, searchTerm, page],
    queryFn: async () => {
      const params: Record<string, any> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (frameworkFilter) params.framework_id = frameworkFilter;
      if (domainFilter) params.domain = domainFilter;
      if (searchTerm) params.search = searchTerm;
      
      const response = await apiClient.get('/controls/framework-controls', { params });
      return response.data as FrameworkControlsResponse;
    },
  });

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      high: 'bg-rose-500/20 text-rose-400',
      medium: 'bg-amber-500/20 text-amber-400',
      low: 'bg-emerald-500/20 text-emerald-400',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs ${colors[priority] || 'bg-slate-200 text-slate-500'}`}>
        {priority}
      </span>
    );
  };

  const getVerificationBadge = (isVerified: boolean) => {
    if (isVerified) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-400">
          <CheckCircle size={12} /> Verified
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
        <Clock size={12} /> Pending
      </span>
    );
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load controls</p>
      </div>
    );
  }

  const selectedFramework = summaryData?.frameworks.find(f => f.id === frameworkFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          {frameworkFilter && selectedFramework ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Link 
                  href="/frameworks" 
                  className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-900 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Frameworks
                </Link>
              </div>
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <FileStack className="h-6 w-6 text-primary-400" />
                {selectedFramework.name}
              </h1>
              <p className="text-slate-400">
                {selectedFramework.control_count} controls extracted from this framework
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-slate-800">Framework Controls</h1>
              <p className="text-slate-400">Controls extracted from your uploaded regulatory frameworks</p>
            </>
          )}
        </div>
        <button
          onClick={() => setShowInfoModal(true)}
          className="flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-600 transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
          How It Works
        </button>
      </div>

      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-xl bg-white border border-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
                <Info className="h-5 w-5 text-primary-400" />
                Understanding Frameworks & Controls
              </h2>
              <button
                onClick={() => setShowInfoModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-400 font-bold">1</div>
                  <div>
                    <h3 className="font-medium text-slate-800">Upload Framework</h3>
                    <p className="text-slate-400">Upload your regulatory framework document (PDF, Excel). The AI extracts individual controls/requirements.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-bold">2</div>
                  <div>
                    <h3 className="font-medium text-slate-800">Controls Are Extracted</h3>
                    <p className="text-slate-400">Each requirement becomes a control shown here. Controls retain their original reference IDs from the framework document.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 font-bold">3</div>
                  <div>
                    <h3 className="font-medium text-slate-800">Link Evidence</h3>
                    <p className="text-slate-400">Upload evidence documents to prove compliance. Link evidence to specific controls to demonstrate you meet each requirement.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-500/20 flex items-center justify-center text-primary-600 font-bold">4</div>
                  <div>
                    <h3 className="font-medium text-slate-800">Track Compliance</h3>
                    <p className="text-slate-400">Start a certification journey from the Frameworks page to track your progress toward full compliance.</p>
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200">
                <p className="text-xs text-slate-500">
                  <strong>Tip:</strong> Use the Evidence module to upload documents, then link them to controls here. Each control can have multiple pieces of evidence.
                </p>
              </div>
            </div>
            <div className="flex justify-end border-t border-slate-200 p-4">
              <button
                onClick={() => setShowInfoModal(false)}
                className="btn-primary"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {summaryData && summaryData.frameworks.length > 0 && !frameworkFilter && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                <Layers className="h-5 w-5 text-primary-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{summaryData.total_frameworks}</p>
                <p className="text-sm text-slate-400">Frameworks</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20">
                <Shield className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{summaryData.total_controls}</p>
                <p className="text-sm text-slate-400">Total Controls</p>
              </div>
            </div>
          </div>
          {summaryData.frameworks.slice(0, 2).map((fw) => (
            <div key={fw.id} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/20">
                  <FileText className="h-5 w-5 text-blue-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-slate-800 truncate">{fw.name}</p>
                  <p className="text-sm text-slate-400">{fw.control_count} controls</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search controls by ID, title, or description..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(0);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={frameworkFilter || ''}
              onChange={(e) => {
                setFrameworkFilter(e.target.value ? Number(e.target.value) : null);
                setPage(0);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Frameworks</option>
              {summaryData?.frameworks.map((fw) => (
                <option key={fw.id} value={fw.id}>
                  {fw.name} ({fw.control_count})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-white">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Control ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Title</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 md:table-cell">Framework</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 lg:table-cell">Domain</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Priority</th>
              <th className="px-4 py-3 text-center text-sm font-medium text-slate-600">Evidence</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-slate-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {data?.controls.map((control) => {
              const isExpanded = expandedControl === control.id;
              return (
                <>
                  <tr 
                    key={control.id}
                    className="bg-white/50 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedControl(isExpanded ? null : control.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-primary-400 flex-shrink-0" />
                        <span className="font-mono text-sm text-slate-800">
                          {control.original_reference || control.control_id}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-800 line-clamp-1">{control.title}</p>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
                        {control.framework_name}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="text-sm text-slate-400">{control.domain || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {getPriorityBadge(control.priority)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/evidence?control_id=${control.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs transition-colors ${
                          control.evidence_count > 0
                            ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                            : 'bg-slate-200 text-slate-500 hover:bg-slate-600'
                        }`}
                      >
                        <Paperclip className="h-3 w-3" />
                        {control.evidence_count}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      {getVerificationBadge(control.is_verified)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${control.id}-details`} className="bg-slate-50">
                      <td colSpan={8} className="px-4 py-4 border-t border-slate-200">
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Framework</h4>
                              <p className="mt-1 text-sm text-slate-800">
                                {control.framework_name}
                                {control.framework_version && ` (${control.framework_version})`}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Original Reference</h4>
                              <p className="mt-1 text-sm font-mono text-slate-800">
                                {control.original_reference || control.control_id}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Linked Evidence</h4>
                              <div className="mt-1 flex items-center gap-2">
                                <span className={`text-sm font-medium ${control.evidence_count > 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                                  {control.evidence_count} document{control.evidence_count !== 1 ? 's' : ''}
                                </span>
                                <Link
                                  href={`/evidence?control_id=${control.id}`}
                                  className="inline-flex items-center gap-1 rounded bg-primary-500/20 px-2 py-1 text-xs text-primary-400 hover:bg-primary-500/30 transition-colors"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  {control.evidence_count > 0 ? 'View Evidence' : 'Link Evidence'}
                                </Link>
                              </div>
                            </div>
                            {control.section_number && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600">Section</h4>
                                <p className="mt-1 text-sm text-slate-400">{control.section_number}</p>
                              </div>
                            )}
                            {control.parent_section && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600">Parent Section</h4>
                                <p className="mt-1 text-sm text-slate-400">{control.parent_section}</p>
                              </div>
                            )}
                          </div>
                          
                          {control.description && (
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Description</h4>
                              <p className="mt-1 text-sm text-slate-400">{control.description}</p>
                            </div>
                          )}
                          
                          {control.full_text && (
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Full Requirement Text</h4>
                              <p className="mt-1 text-sm text-slate-400 whitespace-pre-wrap">{control.full_text}</p>
                            </div>
                          )}
                          
                          <div className="flex items-center gap-4 pt-2">
                            {control.ai_confidence !== null && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500">AI Confidence:</span>
                                <span className={`text-xs font-medium ${
                                  control.ai_confidence >= 0.8 ? 'text-emerald-400' :
                                  control.ai_confidence >= 0.5 ? 'text-amber-400' : 'text-rose-400'
                                }`}>
                                  {Math.round(control.ai_confidence * 100)}%
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">Mandatory:</span>
                              <span className={`text-xs font-medium ${control.is_mandatory ? 'text-rose-400' : 'text-slate-400'}`}>
                                {control.is_mandatory ? 'Yes' : 'No'}
                              </span>
                            </div>
                          </div>

                          <div className="mt-6 border-t border-slate-200 pt-4">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-primary-600" />
                                <h4 className="text-sm font-semibold text-slate-800">AI Recommendations</h4>
                              </div>
                              {!aiRecommendations[control.id] && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGetAIRecommendations(control);
                                  }}
                                  disabled={loadingAI === control.id}
                                  className="flex items-center gap-2 rounded-lg bg-primary-500/20 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-500/30 transition-colors disabled:opacity-50"
                                >
                                  {loadingAI === control.id ? (
                                    <>
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                      Generating...
                                    </>
                                  ) : (
                                    <>
                                      <Sparkles className="h-4 w-4" />
                                      Get AI Recommendations
                                    </>
                                  )}
                                </button>
                              )}
                            </div>

                            {aiRecommendations[control.id] && (
                              <div className="space-y-6">
                                <div className="rounded-lg border border-primary-500/20 bg-primary-500/5 p-4">
                                  <div className="flex items-center gap-2 mb-3">
                                    <ClipboardList className="h-4 w-4 text-primary-600" />
                                    <h5 className="text-sm font-medium text-primary-500">Test Procedures</h5>
                                  </div>
                                  <div className="space-y-3">
                                    {aiRecommendations[control.id].test_procedures.map((proc, idx) => (
                                      <div key={idx} className="flex gap-3">
                                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary-500/20 flex items-center justify-center text-xs text-primary-600 font-medium">
                                          {idx + 1}
                                        </span>
                                        <div className="flex-1">
                                          <div className="flex items-center gap-2 mb-1">
                                            {getProcedureTypeBadge(proc.procedure_type)}
                                            <span className="text-xs text-slate-500">{proc.frequency}</span>
                                            {proc.sample_size !== 'N/A' && proc.sample_size !== 'N/A for inquiry' && (
                                              <span className="text-xs text-slate-500">| Sample: {proc.sample_size}</span>
                                            )}
                                          </div>
                                          <p className="text-sm text-slate-600">{proc.description}</p>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                                  <div className="flex items-center gap-2 mb-3">
                                    <FolderOpen className="h-4 w-4 text-blue-400" />
                                    <h5 className="text-sm font-medium text-blue-300">Evidence Requirements</h5>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {aiRecommendations[control.id].evidence_requirements.map((ev, idx) => (
                                      <div key={idx} className="rounded-lg border border-slate-200 bg-white/50 p-3">
                                        <div className="flex items-start gap-2">
                                          <div className="flex-shrink-0 mt-0.5 text-blue-400">
                                            {getEvidenceTypeIcon(ev.evidence_type)}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm font-medium text-slate-800">{ev.title}</span>
                                              {ev.mandatory && (
                                                <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xs text-rose-400">Required</span>
                                              )}
                                            </div>
                                            <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-400 mt-1 capitalize">{ev.evidence_type}</span>
                                            <p className="text-xs text-slate-400 mt-1">{ev.description}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                                      <h5 className="text-sm font-medium text-amber-300">Key Risks Addressed</h5>
                                    </div>
                                    <ul className="space-y-1">
                                      {aiRecommendations[control.id].key_risks_addressed.map((risk, idx) => (
                                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                          <span className="text-amber-400 mt-1">•</span>
                                          {risk}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Target className="h-4 w-4 text-emerald-400" />
                                      <h5 className="text-sm font-medium text-emerald-300">Audit Focus Areas</h5>
                                    </div>
                                    <ul className="space-y-1">
                                      {aiRecommendations[control.id].audit_focus_areas.map((area, idx) => (
                                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                          <span className="text-emerald-400 mt-1">•</span>
                                          {area}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                </div>
                              </div>
                            )}

                            {!aiRecommendations[control.id] && loadingAI !== control.id && (
                              <p className="text-sm text-slate-500">
                                Click "Get AI Recommendations" to generate test procedures and evidence requirements for this control.
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, data?.total || 0)} of{' '}
            {data?.total || 0} controls
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-secondary btn-sm"
            >
              Previous
            </button>
            <span className="text-sm text-slate-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary btn-sm"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {(!data?.controls || data.controls.length === 0) && (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-800">No controls found</h3>
          <p className="mt-1 text-slate-400">
            {summaryData?.total_frameworks === 0
              ? 'Upload a regulatory framework to see controls here'
              : 'Try adjusting your search or filters'}
          </p>
        </div>
      )}
    </div>
  );
}
