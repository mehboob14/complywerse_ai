'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { frameworkUploadApi } from '@/lib/api';
import {
  FileText,
  Loader2,
  AlertCircle,
  Search,
  CheckCircle,
  Shield,
  Edit2,
  Eye,
  X,
  ChevronDown,
  Filter,
  Check,
  Sparkles,
  FileCheck,
} from 'lucide-react';
import Link from 'next/link';
import apiClient from '@/lib/api';

interface ParsedControl {
  id: number;
  uploaded_framework_id: number;
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
  ai_notes: string | null;
  is_verified: boolean;
  verified_by: number | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
  evidence_mappings: Array<{
    id: number;
    evidence_type: string;
    evidence_description: string | null;
    is_required: boolean;
    suggested_by_ai: boolean;
  }>;
}

interface UploadedFramework {
  id: number;
  name: string;
  upload_status: string;
  parsed_controls_count: number;
}

interface ParsedControlsResponse {
  items: ParsedControl[];
  total: number;
  skip: number;
  limit: number;
  framework_id: number;
  framework_name: string;
}

interface FrameworksResponse {
  items: UploadedFramework[];
  total: number;
}

const DOMAINS = [
  'Governance',
  'Risk',
  'Security',
  'Access Control',
  'Incident Management',
  'Business Continuity',
  'Data Protection',
  'Compliance',
  'Operations',
];

const PRIORITIES = [
  { value: 'high', label: 'High', color: 'text-red-600', bgColor: 'bg-red-50' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  { value: 'low', label: 'Low', color: 'text-green-600', bgColor: 'bg-green-50' },
];

const DOMAIN_COLORS: Record<string, { color: string; bgColor: string }> = {
  Governance: { color: 'text-primary-600', bgColor: 'bg-primary-50' },
  Risk: { color: 'text-orange-600', bgColor: 'bg-orange-50' },
  Security: { color: 'text-red-600', bgColor: 'bg-red-50' },
  'Access Control': { color: 'text-blue-600', bgColor: 'bg-blue-50' },
  'Incident Management': { color: 'text-pink-400', bgColor: 'bg-pink-500/20' },
  'Business Continuity': { color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  'Data Protection': { color: 'text-green-600', bgColor: 'bg-green-50' },
  Compliance: { color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  Operations: { color: 'text-slate-600', bgColor: 'bg-slate-50' },
};

const getDomainStyle = (domain: string | null) => {
  if (!domain) return { color: 'text-slate-600', bgColor: 'bg-slate-50' };
  return DOMAIN_COLORS[domain] || { color: 'text-slate-600', bgColor: 'bg-slate-50' };
};

const getPriorityStyle = (priority: string) => {
  return PRIORITIES.find(p => p.value === priority) || PRIORITIES[1];
};

const getConfidenceColor = (confidence: number | null) => {
  if (confidence === null) return 'text-slate-600';
  if (confidence >= 0.9) return 'text-green-600';
  if (confidence >= 0.7) return 'text-yellow-600';
  return 'text-orange-600';
};

export default function ParsedControlsPage() {
  const searchParams = useSearchParams();
  const initialFrameworkId = searchParams.get('framework');
  
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(
    initialFrameworkId ? parseInt(initialFrameworkId) : null
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [verifiedFilter, setVerifiedFilter] = useState<string>('all');
  const [editingControl, setEditingControl] = useState<ParsedControl | null>(null);
  const [viewingControl, setViewingControl] = useState<ParsedControl | null>(null);
  const [editFormData, setEditFormData] = useState({
    title: '',
    description: '',
    domain: '',
    category: '',
    is_mandatory: false,
    priority: 'medium',
  });
  
  const queryClient = useQueryClient();

  const { data: frameworksData } = useQuery({
    queryKey: ['uploaded-frameworks-parsed'],
    queryFn: async () => {
      const response = await frameworkUploadApi.getFrameworks({ limit: 100 });
      return response.data as FrameworksResponse;
    },
  });

  const parsedFrameworks = useMemo(() => {
    if (!frameworksData?.items) return [];
    return frameworksData.items.filter(f => f.upload_status === 'parsed' && f.parsed_controls_count > 0);
  }, [frameworksData]);

  const effectiveFrameworkId = selectedFrameworkId || (parsedFrameworks.length > 0 ? parsedFrameworks[0].id : null);

  const { data: controlsData, isLoading, error } = useQuery({
    queryKey: ['parsed-controls', effectiveFrameworkId, domainFilter, categoryFilter, verifiedFilter],
    queryFn: async () => {
      if (!effectiveFrameworkId) return null;
      const params: Record<string, unknown> = { limit: 500 };
      if (domainFilter !== 'all') params.domain = domainFilter;
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (verifiedFilter !== 'all') params.is_verified = verifiedFilter === 'verified';
      const response = await frameworkUploadApi.getParsedControls(effectiveFrameworkId, params);
      return response.data as ParsedControlsResponse;
    },
    enabled: !!effectiveFrameworkId,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      frameworkUploadApi.updateControl(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parsed-controls'] });
      setEditingControl(null);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: (id: number) => frameworkUploadApi.verifyControl(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['parsed-controls'] });
    },
  });

  const [generatingEvidence, setGeneratingEvidence] = useState(false);
  const [generateSuccess, setGenerateSuccess] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const generateEvidenceRequirementsMutation = useMutation({
    mutationFn: async (frameworkId: number) => {
      setGeneratingEvidence(true);
      return await apiClient.post(`/framework-upload/parser/${frameworkId}/generate-evidence-requirements`);
    },
    onSuccess: (data) => {
      setGeneratingEvidence(false);
      setGenerateSuccess(data.data?.message || 'Evidence requirement generation started successfully.');
      setGenerateError(null);
      setTimeout(() => setGenerateSuccess(null), 8000);
    },
    onError: (error: any) => {
      setGeneratingEvidence(false);
      setGenerateError(error.response?.data?.detail || 'Failed to generate evidence requirements');
      setGenerateSuccess(null);
      setTimeout(() => setGenerateError(null), 8000);
    },
  });

  const controls = controlsData?.items || [];

  const filteredControls = useMemo(() => {
    if (!controls.length) return [];
    return controls.filter((control) => {
      const matchesSearch =
        control.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        control.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        control.control_id.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesSearch;
    });
  }, [controls, searchTerm]);

  const stats = useMemo(() => {
    const byDomain: Record<string, number> = {};
    let verified = 0;
    
    controls.forEach((control) => {
      if (control.domain) {
        byDomain[control.domain] = (byDomain[control.domain] || 0) + 1;
      }
      if (control.is_verified) verified++;
    });
    
    return {
      total: controls.length,
      verified,
      byDomain,
    };
  }, [controls]);

  const uniqueCategories = useMemo(() => {
    const categories = new Set<string>();
    controls.forEach((control) => {
      if (control.category) categories.add(control.category);
    });
    return Array.from(categories).sort();
  }, [controls]);

  const handleEditControl = (control: ParsedControl) => {
    setEditFormData({
      title: control.title,
      description: control.description || '',
      domain: control.domain || '',
      category: control.category || '',
      is_mandatory: control.is_mandatory,
      priority: control.priority,
    });
    setEditingControl(control);
  };

  const handleSaveEdit = () => {
    if (!editingControl) return;
    updateMutation.mutate({
      id: editingControl.id,
      data: editFormData,
    });
  };

  const handleVerifyControl = (control: ParsedControl) => {
    if (!control.is_verified) {
      verifyMutation.mutate(control.id);
    }
  };

  if (parsedFrameworks.length === 0 && !isLoading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-slate-600">
        <FileText className="h-12 w-12" />
        <p>No parsed frameworks available</p>
        <p className="text-sm">Upload and parse a framework document first</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-600">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load parsed controls</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="mb-2 block text-sm font-medium text-slate-600">Select Framework</label>
        <div className="relative">
          <select
            value={effectiveFrameworkId || ''}
            onChange={(e) => setSelectedFrameworkId(e.target.value ? parseInt(e.target.value) : null)}
            className="w-full appearance-none rounded-lg border border-slate-300 bg-slate-200 px-4 py-2.5 pr-10 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {parsedFrameworks.map((framework) => (
              <option key={framework.id} value={framework.id}>
                {framework.name} ({framework.parsed_controls_count} controls)
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-600" />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm text-slate-600">Total Controls</p>
              <p className="text-2xl font-bold text-black">{stats.total}</p>
            </div>
          </div>
        </div>
        
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm text-slate-600">Verified</p>
              <p className="text-2xl font-bold text-black">{stats.verified}</p>
            </div>
          </div>
        </div>
        
        <div className="rounded-xl border border-slate-200 bg-white p-4 md:col-span-2">
          <div className="flex items-center gap-3">
                          <Shield className="h-5 w-5 text-primary-600" />
            <div className="flex-1">
              <p className="mb-2 text-sm text-slate-600">By Domain</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.byDomain).slice(0, 5).map(([domain, count]) => {
                  const style = getDomainStyle(domain);
                  return (
                    <span
                      key={domain}
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.bgColor} ${style.color}`}
                    >
                      {domain}: {count}
                    </span>
                  );
                })}
                {Object.keys(stats.byDomain).length > 5 && (
                  <span className="text-xs text-slate-600">
                    +{Object.keys(stats.byDomain).length - 5} more
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {effectiveFrameworkId && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-primary-600" />
            <div>
              <h3 className="text-sm font-medium text-black">AI Evidence Requirements</h3>
              <p className="text-xs text-slate-600">Generate evidence requirements for all controls using AI</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => generateEvidenceRequirementsMutation.mutate(effectiveFrameworkId)}
              disabled={generatingEvidence || generateEvidenceRequirementsMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {generatingEvidence ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Generate Requirements
                </>
              )}
            </button>
            <Link
              href="/evidence-requirements"
              className="flex items-center gap-2 rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600 transition-colors"
            >
              <FileCheck className="h-4 w-4" />
              View Requirements
            </Link>
          </div>
        </div>
      )}

      {generateSuccess && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-emerald-600 flex-shrink-0" />
          <p className="text-sm text-emerald-600">{generateSuccess}</p>
        </div>
      )}

      {generateError && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 flex-shrink-0" />
          <p className="text-sm text-rose-600">{generateError}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search by title, description, or ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-slate-200 py-2 pl-10 pr-4 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-600" />
            
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Domains</option>
              {DOMAINS.map((domain) => (
                <option key={domain} value={domain}>{domain}</option>
              ))}
            </select>
            
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Categories</option>
              {uniqueCategories.map((category) => (
                <option key={category} value={category}>{category}</option>
              ))}
            </select>
            
            <select
              value={verifiedFilter}
              onChange={(e) => setVerifiedFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-black focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="verified">Verified</option>
              <option value="unverified">Unverified</option>
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-black">
            Parsed Controls
            {controlsData?.framework_name && (
              <span className="ml-2 text-sm font-normal text-slate-600">
                - {controlsData.framework_name}
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-600">
            Showing {filteredControls.length} of {stats.total} controls
          </p>
        </div>

        {isLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : filteredControls.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-600">
            <FileText className="h-12 w-12" />
            <p>No controls found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-200 bg-slate-50/50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">
                    Control ID
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">
                    Title
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">
                    Domain
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">
                    Category
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
                    Mandatory
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
                    Priority
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
                    AI Confidence
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
                    Verified
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
                    Evidence
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredControls.map((control) => {
                  const domainStyle = getDomainStyle(control.domain);
                  const priorityStyle = getPriorityStyle(control.priority);
                  const confidenceColor = getConfidenceColor(control.ai_confidence);
                  
                  return (
                    <tr key={control.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-sm font-mono text-slate-600">
                        {control.control_id}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-sm text-black">
                        {control.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {control.domain ? (
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${domainStyle.bgColor} ${domainStyle.color}`}>
                            {control.domain}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-500">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                        {control.category || '-'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          control.is_mandatory
                            ? 'bg-red-50 text-red-700'
                            : 'bg-slate-50 text-slate-700'
                        }`}>
                          {control.is_mandatory ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${priorityStyle.bgColor} ${priorityStyle.color}`}>
                          {priorityStyle.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className={`text-sm font-medium ${confidenceColor}`}>
                          {control.ai_confidence !== null
                            ? `${Math.round(control.ai_confidence * 100)}%`
                            : '-'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        {control.is_verified ? (
                          <CheckCircle className="mx-auto h-5 w-5 text-green-600" />
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <span className="inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                          {control.evidence_mappings.length}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setViewingControl(control)}
                            className="rounded p-1 text-slate-600 transition-colors hover:bg-slate-600 hover:text-slate-900"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleEditControl(control)}
                            className="rounded p-1 text-slate-600 transition-colors hover:bg-slate-600 hover:text-slate-900"
                            title="Edit"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleVerifyControl(control)}
                            disabled={control.is_verified || verifyMutation.isPending}
                            className={`rounded p-1 transition-colors ${
                              control.is_verified
                                ? 'cursor-not-allowed text-green-500'
                                : 'text-slate-600 hover:bg-green-600 hover:text-slate-900'
                            }`}
                            title={control.is_verified ? 'Verified' : 'Verify'}
                          >
                            <Check className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewingControl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="text-lg font-semibold text-black">Control Details</h3>
              <button
                onClick={() => setViewingControl(null)}
                className="rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <span className="text-sm text-slate-600">Control ID</span>
                <p className="font-mono text-black">{viewingControl.control_id}</p>
              </div>
              <div>
                <span className="text-sm text-slate-600">Title</span>
                <p className="text-black">{viewingControl.title}</p>
              </div>
              {viewingControl.description && (
                <div>
                  <span className="text-sm text-slate-600">Description</span>
                  <p className="text-slate-600">{viewingControl.description}</p>
                </div>
              )}
              {viewingControl.full_text && (
                <div>
                  <span className="text-sm text-slate-600">Full Text</span>
                  <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                    {viewingControl.full_text}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-slate-600">Domain</span>
                  <p className="text-black">{viewingControl.domain || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-600">Category</span>
                  <p className="text-black">{viewingControl.category || '-'}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-600">Mandatory</span>
                  <p className="text-black">{viewingControl.is_mandatory ? 'Yes' : 'No'}</p>
                </div>
                <div>
                  <span className="text-sm text-slate-600">Priority</span>
                  <p className="capitalize text-black">{viewingControl.priority}</p>
                </div>
              </div>
              {viewingControl.evidence_mappings.length > 0 && (
                <div>
                  <span className="mb-2 block text-sm text-slate-600">Expected Evidence Types</span>
                  <div className="flex flex-wrap gap-2">
                    {viewingControl.evidence_mappings.map((em) => (
                      <span
                        key={em.id}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600"
                      >
                        {em.evidence_type}
                        {em.is_required && <span className="text-red-600">*</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {editingControl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="text-lg font-semibold text-black">Edit Control</h3>
              <button
                onClick={() => setEditingControl(null)}
                className="rounded p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Title</label>
                <input
                  type="text"
                  value={editFormData.title}
                  onChange={(e) => setEditFormData({ ...editFormData, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  value={editFormData.description}
                  onChange={(e) => setEditFormData({ ...editFormData, description: e.target.value })}
                  rows={4}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">Domain</label>
                  <select
                    value={editFormData.domain}
                    onChange={(e) => setEditFormData({ ...editFormData, domain: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    <option value="">Select Domain</option>
                    {DOMAINS.map((domain) => (
                      <option key={domain} value={domain}>{domain}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">Category</label>
                  <input
                    type="text"
                    value={editFormData.category}
                    onChange={(e) => setEditFormData({ ...editFormData, category: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">Priority</label>
                  <select
                    value={editFormData.priority}
                    onChange={(e) => setEditFormData({ ...editFormData, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {PRIORITIES.map((priority) => (
                      <option key={priority.value} value={priority.value}>{priority.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">Is Mandatory</label>
                  <button
                    type="button"
                    onClick={() => setEditFormData({ ...editFormData, is_mandatory: !editFormData.is_mandatory })}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 ${
                      editFormData.is_mandatory
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-slate-300 bg-slate-200 text-slate-600'
                    }`}
                  >
                    <span>{editFormData.is_mandatory ? 'Yes' : 'No'}</span>
                    <div className={`h-4 w-8 rounded-full transition-colors ${
                      editFormData.is_mandatory ? 'bg-green-500' : 'bg-slate-600'
                    }`}>
                      <div className={`h-4 w-4 rounded-full bg-white transition-transform ${
                        editFormData.is_mandatory ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </div>
                  </button>
                </div>
              </div>
              {editingControl.evidence_mappings.length > 0 && (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Expected Evidence Types</label>
                  <div className="flex flex-wrap gap-2">
                    {editingControl.evidence_mappings.map((em) => (
                      <span
                        key={em.id}
                        className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600"
                      >
                        {em.evidence_type}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
              <button
                onClick={() => setEditingControl(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
