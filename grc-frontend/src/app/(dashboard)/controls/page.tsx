'use client';

import { Fragment, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { controlsApi, evidenceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, InlineLinkPicker, PageLoader } from '@/components/ui';
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
  Link2,
  Link2Off,
  ExternalLink,
  Upload,
  ArrowUpDown,
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
  ai_notes: string | null;
  is_verified: boolean;
  framework_id: number;
  framework_name: string;
  framework_version: string | null;
  created_at: string | null;
  evidence_count: number;
  evidence_requirements: Array<{
    title: string;
    description?: string;
    artifact_type?: string;
  }>;
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

type SortField =
  | 'control_id'
  | 'title'
  | 'framework_name'
  | 'domain'
  | 'priority'
  | 'evidence_count'
  | 'status';

interface FrameworkControlEvidenceLink {
  id: number;
  evidence_id: number;
  title?: string;
  description?: string;
  evidence_type?: string;
  status?: string;
  file_name?: string;
  linked_at?: string;
}

interface EvidenceOption {
  id: number;
  name?: string;
  title?: string;
  file_name?: string;
  evidence_type?: string;
  status?: string;
}

function FrameworkControlEvidenceLinkSection({ controlId }: { controlId: number }) {
  const queryClient = useQueryClient();
  const [showPicker, setShowPicker] = useState(false);
  const [showUploader, setShowUploader] = useState(false);
  const [searchEv, setSearchEv] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');

  const { data: linkedEvidence, isLoading: loadingLinked } = useQuery({
    queryKey: ['framework-control-evidence', controlId],
    queryFn: async () => {
      const res = await controlsApi.getFrameworkControlEvidence(controlId);
      return res.data as FrameworkControlEvidenceLink[];
    },
  });

  const { data: allEvidence, isLoading: evidenceLoading } = useQuery({
    queryKey: ['evidence-all'],
    queryFn: async () => {
      const res = await evidenceApi.getAll();
      return res.data as EvidenceOption[];
    },
  });

  const linkMutation = useMutation({
    mutationFn: (evidenceId: number) =>
      controlsApi.linkFrameworkControlEvidence(controlId, { evidence_id: evidenceId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-control-evidence', controlId] });
      queryClient.invalidateQueries({ queryKey: ['framework-controls'] });
      setShowPicker(false);
      setSearchEv('');
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (linkId: number) => controlsApi.unlinkFrameworkControlEvidence(controlId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-control-evidence', controlId] });
      queryClient.invalidateQueries({ queryKey: ['framework-controls'] });
    },
  });

  const uploadAndLinkMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) {
        throw new Error('Please select a file to upload.');
      }

      const formData = new FormData();
      formData.append('name', uploadName.trim() || uploadFile.name);
      if (uploadDescription.trim()) {
        formData.append('description', uploadDescription.trim());
      }
      formData.append('file', uploadFile);

      const uploadRes = await evidenceApi.create(formData);
      const uploadedEvidenceId = uploadRes.data?.id;
      if (!uploadedEvidenceId) {
        throw new Error('Evidence uploaded but no evidence ID was returned.');
      }

      await controlsApi.linkFrameworkControlEvidence(controlId, { evidence_id: uploadedEvidenceId });
      return uploadedEvidenceId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-control-evidence', controlId] });
      queryClient.invalidateQueries({ queryKey: ['framework-controls'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-all'] });
      setShowUploader(false);
      setUploadError('');
      setUploadName('');
      setUploadDescription('');
      setUploadFile(null);
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail;
      setUploadError(typeof detail === 'string' ? detail : (error?.message || 'Failed to upload and link evidence.'));
    },
  });

  const linkedIds = new Set((linkedEvidence ?? []).map((l) => l.evidence_id));
  const evidencePickerItems = (allEvidence ?? [])
    .filter((ev) => !linkedIds.has(ev.id))
    .map((ev) => ({
      value: String(ev.id),
      label: ev.name || ev.title || ev.file_name || `Evidence #${ev.id}`,
      subLabel: ev.evidence_type,
    }));
  void searchEv; void setSearchEv; void showPicker; void setShowPicker;

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-slate-800">Linked Evidence</h3>
        <div className="flex items-center gap-2">
          <InlineLinkPicker
            triggerLabel="Link Existing"
            triggerIcon={<Link2 className="h-3 w-3" />}
            triggerClassName="flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
            items={evidencePickerItems}
            isLoading={evidenceLoading || linkMutation.isPending}
            emptyText="No evidence available"
            searchPlaceholder="Search evidence"
            popoverWidth={320}
            onSelect={(value) => linkMutation.mutate(Number(value))}
          />
          <button
            type="button"
            onClick={() => {
              setShowUploader(!showUploader);
              setUploadError('');
            }}
            className="flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
          >
            <Upload className="h-3 w-3" />
            {showUploader ? 'Close Upload' : 'Upload New'}
          </button>
        </div>
      </div>

      {showUploader && (
        <form
          className="mb-4 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setUploadError('');
            uploadAndLinkMutation.mutate();
          }}
        >
          <input
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="Evidence name (optional, file name will be used)"
            className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <textarea
            value={uploadDescription}
            onChange={(e) => setUploadDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={2}
            className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none"
          />
          <input
            type="file"
            required
            onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
            className="w-full text-xs text-slate-600 file:mr-2 file:rounded file:border file:border-slate-300 file:bg-white file:px-2 file:py-1 file:text-xs file:text-slate-700"
          />
          {uploadError && <p className="text-xs text-red-600">{uploadError}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploadAndLinkMutation.isPending}
              className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {uploadAndLinkMutation.isPending ? 'Uploading...' : 'Upload & Link'}
            </button>
          </div>
        </form>
      )}

      {loadingLinked ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
        </div>
      ) : (linkedEvidence ?? []).length === 0 ? (
        <p className="text-xs text-slate-500">No evidence linked yet.</p>
      ) : (
        <div className="space-y-2">
          {(linkedEvidence ?? []).map((lnk) => (
            <div
              key={lnk.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
            >
              <div className="min-w-0">
                <Link
                  href={`/evidence/${lnk.evidence_id}`}
                  className="block truncate text-xs font-medium text-blue-600 hover:underline"
                >
                  {lnk.title || lnk.file_name || `Evidence #${lnk.evidence_id}`}
                </Link>
                {lnk.evidence_type && (
                  <span className="text-[11px] text-slate-500">{lnk.evidence_type}</span>
                )}
              </div>
              <div className="ml-2 flex flex-shrink-0 items-center gap-1">
                <Link
                  href={`/evidence/${lnk.evidence_id}`}
                  className="rounded p-1 text-slate-400 hover:text-blue-600"
                  title="View evidence"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <button
                  type="button"
                  onClick={() => unlinkMutation.mutate(lnk.id)}
                  disabled={unlinkMutation.isPending}
                  className="rounded p-1 text-slate-400 hover:text-red-500"
                  title="Unlink"
                >
                  {unlinkMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2Off className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ControlsPage() {
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('controls:control_library:create');
  const initialFrameworkId = searchParams.get('framework');
  
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState<number | null>(
    initialFrameworkId ? Number(initialFrameworkId) : null
  );
  const [domainFilter, setDomainFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('control_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
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
      walkthrough: 'bg-blue-50 text-blue-700',
      inquiry: 'bg-primary-50 text-primary-700',
      observation: 'bg-cyan-50 text-cyan-700',
      inspection: 'bg-amber-50 text-amber-700',
      reperformance: 'bg-emerald-50 text-emerald-700',
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(0);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data: summaryData } = useQuery({
    queryKey: ['framework-controls-summary'],
    queryFn: async () => {
      const response = await controlsApi.getFrameworkControlsSummary();
      return response.data as FrameworkSummaryResponse;
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['framework-controls', frameworkFilter, domainFilter, searchTerm, sortBy, sortOrder, page],
    queryFn: async () => {
      const params: {
        skip: number;
        limit: number;
        framework_id?: number;
        domain?: string;
        search?: string;
        sort_by?: string;
        sort_order?: 'asc' | 'desc';
      } = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (frameworkFilter) params.framework_id = frameworkFilter;
      if (domainFilter) params.domain = domainFilter;
      if (searchTerm) params.search = searchTerm;
      params.sort_by = sortBy;
      params.sort_order = sortOrder;
      
      const response = await controlsApi.getFrameworkControls(params);
      return response.data as FrameworkControlsResponse;
    },
    placeholderData: (previousData) => previousData,
  });

  const handleSort = (field: SortField) => {
    setPage(0);
    if (sortBy === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortBy(field);
    setSortOrder(field === 'evidence_count' ? 'desc' : 'asc');
  };

  const renderSortHeader = (
    label: string,
    field: SortField,
    align: 'left' | 'center' | 'right' = 'left'
  ) => {
    const justifyClass =
      align === 'center' ? 'justify-center' :
      align === 'right' ? 'justify-end' :
      'justify-start';
    const isActive = sortBy === field;

    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className={`inline-flex w-full items-center gap-1 ${justifyClass} text-slate-600 hover:text-black`}
      >
        <span>{label}</span>
        {isActive ? (
          <span className="text-xs">{sortOrder === 'asc' ? '^' : 'v'}</span>
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 text-slate-400" />
        )}
      </button>
    );
  };

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      high: 'bg-rose-50 text-black',
      medium: 'bg-amber-50 text-black',
      low: 'bg-emerald-50 text-black',
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
        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-text">
          <CheckCircle size={12} /> Verified
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-text">
        <Clock size={12} /> Pending
      </span>
    );
  };

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  if (isLoading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <PageLoader size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-600">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load controls</p>
      </div>
    );
  }

  const selectedFramework = summaryData?.frameworks.find(f => f.id === frameworkFilter);

  // Fallback: derive framework name from loaded controls when not in summaryData (e.g. status=draft/classified)
  const fallbackFrameworkName = !selectedFramework && frameworkFilter && data?.controls?.length
    ? data.controls[0]?.framework_name
    : null;
  const effectiveFrameworkName = selectedFramework?.name || fallbackFrameworkName;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          {frameworkFilter && (selectedFramework || effectiveFrameworkName) ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <Link 
                  href="/frameworks" 
                  className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Frameworks
                </Link>
              </div>
              <h1 className="text-2xl font-bold text-black flex items-center gap-2">
                <FileStack className="h-6 w-6 text-black" />
                {effectiveFrameworkName}
              </h1>
              <p className="text-slate-600">
                {selectedFramework ? `${selectedFramework.control_count} controls extracted from this framework` : `Controls for this framework`}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-bold text-black">Framework Controls</h1>
              <p className="text-slate-600">Controls extracted from your uploaded regulatory frameworks</p>
            </>
          )}
        </div>
        {/* <button
          onClick={() => setShowInfoModal(true)}
          className="flex items-center gap-2 rounded-lg bg-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-600 transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
          How It Works
        </button> */}
      </div>

      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-xl bg-white border border-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <Info className="h-5 w-5 text-primary-600" />
                Understanding Frameworks & Controls
              </h2>
              <button
                onClick={() => setShowInfoModal(false)}
                className="rounded-lg p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              >
                <ChevronDown className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4 space-y-4 text-sm">
              <div className="space-y-3">
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-600 font-bold">1</div>
                  <div>
                    <h3 className="font-medium text-black">Upload Framework</h3>
                    <p className="text-slate-600">Upload your regulatory framework document (PDF, Excel). The AI extracts individual controls/requirements.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold">2</div>
                  <div>
                    <h3 className="font-medium text-black">Controls Are Extracted</h3>
                    <p className="text-slate-600">Each requirement becomes a control shown here. Controls retain their original reference IDs from the framework document.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold">3</div>
                  <div>
                    <h3 className="font-medium text-black">Link Evidence</h3>
                    <p className="text-slate-600">Upload evidence documents to prove compliance. Link evidence to specific controls to demonstrate you meet each requirement.</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary-50 flex items-center justify-center text-primary-600 font-bold">4</div>
                  <div>
                    <h3 className="font-medium text-black">Track Compliance</h3>
                    <p className="text-slate-600">Start a certification journey from the Frameworks page to track your progress toward full compliance.</p>
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
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                <Layers className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{summaryData.total_frameworks}</p>
                <p className="text-sm text-slate-600">Frameworks</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <Shield className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{summaryData.total_controls}</p>
                <p className="text-sm text-slate-600">Total Controls</p>
              </div>
            </div>
          </div>
          {summaryData.frameworks.slice(0, 2).map((fw) => (
            <div key={fw.id} className="card p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                  <FileText className="h-5 w-5 text-blue-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-black truncate">{fw.name}</p>
                  <p className="text-sm text-slate-600">{fw.control_count} controls</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-[180px] sm:min-w-[280px]">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search controls by ID, title, or description..."
            size="md"
          />
        </div>
        <MultiSelectDropdown
          title="Framework"
          items={(() => {
            const list = summaryData?.frameworks?.map((fw) => ({
              value: String(fw.id),
              label: `${fw.name} (${fw.control_count})`,
            })) || [];
            if (frameworkFilter && !summaryData?.frameworks?.find((f) => f.id === frameworkFilter) && effectiveFrameworkName) {
              list.unshift({ value: String(frameworkFilter), label: effectiveFrameworkName });
            }
            return list;
          })()}
          selectedValues={frameworkFilter ? [String(frameworkFilter)] : []}
          onApply={(v) => {
            setFrameworkFilter(v[0] ? Number(v[0]) : null);
            setPage(0);
          }}
          multiSelect={false}
          autoApply
          forceSearch
          placeholder="All Frameworks"
          searchPlaceholder="Search frameworks"
          size="md"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full">
          <thead className="bg-white">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium">{renderSortHeader('Control ID', 'control_id')}</th>
              <th className="px-4 py-3 text-left text-sm font-medium">{renderSortHeader('Title', 'title')}</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium md:table-cell">{renderSortHeader('Framework', 'framework_name')}</th>
              <th className="hidden px-4 py-3 text-left text-sm font-medium lg:table-cell">{renderSortHeader('Domain', 'domain')}</th>
              <th className="px-4 py-3 text-left text-sm font-medium">{renderSortHeader('Priority', 'priority')}</th>
              <th className="px-4 py-3 text-center text-sm font-medium">{renderSortHeader('Evidence', 'evidence_count', 'center')}</th>
              <th className="px-4 py-3 text-left text-sm font-medium">{renderSortHeader('Status', 'status')}</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-slate-600"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700">
            {data?.controls.map((control) => {
              const isExpanded = expandedControl === control.id;
              return (
                <Fragment key={control.id}>
                  <tr 
                    className="bg-white/50 hover:bg-slate-50 cursor-pointer"
                    onClick={() => setExpandedControl(isExpanded ? null : control.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {/* <Shield className="h-4 w-4 text-primary-600 flex-shrink-0" /> */}
                        <span className="font-mono text-sm text-black">
                          {control.original_reference || control.control_id}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-black line-clamp-1">{control.title}</p>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      <span className="rounded-full whitespace-nowrap bg-blue-50 px-2 py-1 text-xs text-blue-900!">
                        {control.framework_name}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 lg:table-cell">
                      <span className="text-sm text-slate-600">{control.domain || '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {getPriorityBadge(control.priority)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/evidence?control_id=${control.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors ${
                          control.evidence_count > 0
                            ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-500/30'
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
                        <ChevronDown className="h-5 w-5 text-slate-600" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-slate-600" />
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-50">
                      <td colSpan={8} className="px-4 py-4 border-t border-slate-200">
                        <div className="space-y-4">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Framework</h4>
                              <p className="mt-1 text-sm text-black">
                                {control.framework_name}
                                {control.framework_version && ` (${control.framework_version})`}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Original Reference</h4>
                              <p className="mt-1 text-sm font-mono text-black">
                                {control.original_reference || control.control_id}
                              </p>
                            </div>
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Linked Evidence</h4>
                              <div className="mt-1 flex items-center gap-2">
                                <span className={`text-sm font-medium ${control.evidence_count > 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                                  {control.evidence_count} document{control.evidence_count !== 1 ? 's' : ''}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded bg-primary-50 px-2 py-1 text-xs text-text">
                                  <Paperclip className="h-3 w-3" />
                                  Manage Below
                                </span>
                              </div>
                            </div>
                            {control.section_number && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600">Section</h4>
                                <p className="mt-1 text-sm text-slate-600">{control.section_number}</p>
                              </div>
                            )}
                            {control.parent_section && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600">Parent Control</h4>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSearchInput(control.parent_section || '');
                                    setSearchTerm(control.parent_section || '');
                                    setPage(0);
                                  }}
                                  className="mt-1 inline-flex items-center gap-1 rounded bg-blue-50 px-2.5 py-1 text-sm text-blue-900! hover:bg-blue-100 transition-colors"
                                >
                                  <ChevronRight className="h-4 w-4" />
                                  {control.parent_section}
                                </button>
                              </div>
                            )}
                          </div>
                          
                          {control.description && (
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Description</h4>
                              <p className="mt-1 text-sm text-slate-600">{control.description}</p>
                            </div>
                          )}
                          
                          {control.full_text && (
                            <div>
                              <h4 className="text-sm font-medium text-slate-600">Full Requirement Text</h4>
                              <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{control.full_text}</p>
                            </div>
                          )}

                          <FrameworkControlEvidenceLinkSection controlId={control.id} />

                          {control.evidence_requirements && control.evidence_requirements.length > 0 && (
                            <div>
                              {/* <h4 className="text-sm font-medium text-slate-600 mb-3 flex items-center gap-2">
                                <FileText className="h-4 w-4 text-amber-600" />
                                Recommended Evidence
                              </h4> */}
                              {/* <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                {control.evidence_requirements.map((evidence, idx) => (
                                  <div key={idx} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                                    <div className="flex items-start gap-2">
                                      <div className="flex-shrink-0 mt-0.5 text-amber-600">
                                        {getEvidenceTypeIcon(evidence.artifact_type || 'document')}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h5 className="text-sm font-medium text-black">{evidence.title}</h5>
                                        {evidence.description && (
                                          <p className="text-xs text-slate-600 mt-1">{evidence.description}</p>
                                        )}
                                        {evidence.artifact_type && (
                                          <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700 mt-2 capitalize">
                                            {evidence.artifact_type}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div> */}
                            </div>
                          )}
                          
                          <div className="flex items-center gap-4 pt-2">
                            {control.ai_confidence !== null && (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-500">AI Confidence:</span>
                                <span className={`text-xs font-medium ${
                                  control.ai_confidence >= 0.8 ? 'text-emerald-600' :
                                  control.ai_confidence >= 0.5 ? 'text-amber-600' : 'text-rose-600'
                                }`}>
                                  {Math.round(control.ai_confidence * 100)}%
                                </span>
                              </div>
                            )}
                            <div className="flex items-center gap-2">
                              {/* <span className="text-xs text-slate-500">Mandatory:</span>
                              <span className={`text-xs font-medium ${control.is_mandatory ? 'text-rose-600' : 'text-slate-600'}`}>
                                {control.is_mandatory ? 'Yes' : 'No'}
                              </span> */}
                            </div>
                          </div>

                          <div className="mt-6 border-t border-slate-200 pt-4">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-5 w-5 text-primary-600" />
                                <h4 className="text-sm font-semibold text-black">AI Recommendations</h4>
                              </div>
                              {!aiRecommendations[control.id] && canCreate && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleGetAIRecommendations(control);
                                  }}
                                  disabled={loadingAI === control.id}
                                  className="flex items-center gap-2 rounded-lg bg-primary-50 px-3 py-1.5 text-sm text-black hover:bg-primary-100 transition-colors disabled:opacity-50"
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
                                <div className="rounded-lg border border-primary-200 bg-primary-500/5 p-4">
                                  <div className="flex items-center gap-2 mb-3">
                                    <ClipboardList className="h-4 w-4 text-primary-600" />
                                    <h5 className="text-sm font-medium text-primary-500">Test Procedures</h5>
                                  </div>
                                  <div className="space-y-3">
                                    {aiRecommendations[control.id].test_procedures.map((proc, idx) => (
                                      <div key={idx} className="flex gap-3">
                                        <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary-50 flex items-center justify-center text-xs text-primary-600 font-medium">
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
                                    <FolderOpen className="h-4 w-4 text-blue-600" />
                                    <h5 className="text-sm font-medium text-blue-300">Evidence Requirements</h5>
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {aiRecommendations[control.id].evidence_requirements.map((ev, idx) => (
                                      <div key={idx} className="rounded-lg border border-slate-200 bg-white/50 p-3">
                                        <div className="flex items-start gap-2">
                                          <div className="flex-shrink-0 mt-0.5 text-blue-600">
                                            {getEvidenceTypeIcon(ev.evidence_type)}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                              <span className="text-sm font-medium text-black">{ev.title}</span>
                                              {ev.mandatory && (
                                                <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs text-rose-600">Required</span>
                                              )}
                                            </div>
                                            <span className="inline-block rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 mt-1 capitalize">{ev.evidence_type}</span>
                                            <p className="text-xs text-slate-600 mt-1">{ev.description}</p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                                      <h5 className="text-sm font-medium text-amber-300">Key Risks Addressed</h5>
                                    </div>
                                    <ul className="space-y-1">
                                      {aiRecommendations[control.id].key_risks_addressed.map((risk, idx) => (
                                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                          <span className="text-amber-600 mt-1">•</span>
                                          {risk}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>

                                  <div className="rounded-lg border border-emerald-200 bg-emerald-500/5 p-4">
                                    <div className="flex items-center gap-2 mb-2">
                                      <Target className="h-4 w-4 text-emerald-600" />
                                      <h5 className="text-sm font-medium text-emerald-300">Audit Focus Areas</h5>
                                    </div>
                                    <ul className="space-y-1">
                                      {aiRecommendations[control.id].audit_focus_areas.map((area, idx) => (
                                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                          <span className="text-emerald-600 mt-1">•</span>
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
                                
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-600">
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
            <span className="text-sm text-slate-600">
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
          <h3 className="text-lg font-medium text-black">No controls found</h3>
          <p className="mt-1 text-slate-600">
            {summaryData?.total_frameworks === 0
              ? 'Upload a regulatory framework to see controls here'
              : 'Try adjusting your search or filters'}
          </p>
        </div>
      )}
    </div>
  );
}
