'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { frameworkUploadApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  GitCompare,
  Loader2,
  AlertCircle,
  Search,
  CheckCircle,
  ChevronDown,
  Play,
  Check,
  Edit2,
  X,
  Plus,
  Percent,
  Link2,
} from 'lucide-react';

interface ParsedControl {
  id: number;
  control_id: string;
  original_reference: string | null;
  title: string;
  description: string | null;
  domain: string | null;
  category: string | null;
  is_mandatory: boolean;
  priority: string;
}

interface MatchedControl {
  id: number;
  code: string;
  name: string;
  statement: string | null;
}

interface Alignment {
  id: number;
  parsed_control_id: number;
  normalized_control_id: number | null;
  framework_control_id: number | null;
  alignment_type: 'exact' | 'partial' | 'new';
  match_score: number;
  match_reason: string | null;
  is_confirmed: boolean;
  confirmed_by: number | null;
  confirmed_at: string | null;
  created_at: string | null;
  parsed_control: ParsedControl | null;
  normalized_control: MatchedControl | null;
  framework_control: MatchedControl | null;
}

interface AlignmentsResponse {
  items: Alignment[];
  grouped: {
    exact: Alignment[];
    partial: Alignment[];
    new: Alignment[];
  } | null;
  total: number;
  skip: number;
  limit: number;
  framework_id: number;
  framework_name: string;
}

interface AlignmentSummary {
  framework_id: number;
  framework_name: string;
  total_alignments: number;
  exact_matches: number;
  partial_matches: number;
  new_controls: number;
  confirmed_alignments: number;
  unconfirmed_alignments: number;
  percentages: {
    exact: number;
    partial: number;
    new: number;
    confirmed: number;
  };
}

interface UploadedFramework {
  id: number;
  name: string;
  upload_status: string;
  parsed_controls_count: number;
}

interface FrameworksResponse {
  items: UploadedFramework[];
  total: number;
}

type TabType = 'all' | 'exact' | 'partial' | 'new';

const ALIGNMENT_TYPE_STYLES: Record<string, { label: string; color: string; bgColor: string }> = {
  exact: { label: 'Exact Match', color: 'text-green-600', bgColor: 'bg-green-50' },
  partial: { label: 'Partial Match', color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  new: { label: 'New Control', color: 'text-blue-600', bgColor: 'bg-blue-50' },
};

const getAlignmentTypeStyle = (type: string) => {
  return ALIGNMENT_TYPE_STYLES[type] || ALIGNMENT_TYPE_STYLES.new;
};

const getScoreColor = (score: number) => {
  if (score >= 0.9) return 'text-green-600';
  if (score >= 0.7) return 'text-yellow-600';
  if (score >= 0.5) return 'text-orange-600';
  return 'text-red-600';
};

export default function AlignmentPage() {
  const searchParams = useSearchParams();
  const initialFrameworkId = searchParams.get('framework');
  
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(
    initialFrameworkId ? parseInt(initialFrameworkId) : null
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<TabType>('all');
  const [confirmModal, setConfirmModal] = useState<Alignment | null>(null);
  const [editModal, setEditModal] = useState<Alignment | null>(null);
  const [editFormData, setEditFormData] = useState({
    alignment_type: 'exact' as 'exact' | 'partial' | 'new',
    match_reason: '',
  });
  
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('frameworks:framework_upload:create');
  const canEdit = hasPermission('frameworks:framework_upload:edit');
    queryKey: ['uploaded-frameworks-parsed'],
    queryFn: async () => {
      const response = await frameworkUploadApi.listFrameworks({ limit: 100 });
      return response.data as FrameworksResponse;
    },
  });

  const parsedFrameworks = useMemo(() => {
    if (!frameworksData?.items) return [];
    return frameworksData.items.filter(f => f.upload_status === 'parsed' && f.parsed_controls_count > 0);
  }, [frameworksData]);

  const effectiveFrameworkId = selectedFrameworkId || (parsedFrameworks.length > 0 ? parsedFrameworks[0].id : null);

  const { data: alignmentsData, isLoading: alignmentsLoading, error: alignmentsError } = useQuery({
    queryKey: ['alignments', effectiveFrameworkId, activeTab],
    queryFn: async () => {
      if (!effectiveFrameworkId) return null;
      const params: Record<string, unknown> = { limit: 500 };
      if (activeTab !== 'all') params.alignment_type = activeTab;
      const response = await frameworkUploadApi.getAlignments(effectiveFrameworkId, params);
      return response.data as AlignmentsResponse;
    },
    enabled: !!effectiveFrameworkId,
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['alignment-summary', effectiveFrameworkId],
    queryFn: async () => {
      if (!effectiveFrameworkId) return null;
      const response = await frameworkUploadApi.getAlignmentSummary(effectiveFrameworkId);
      return response.data as AlignmentSummary;
    },
    enabled: !!effectiveFrameworkId,
  });

  const analyzeMutation = useMutation({
    mutationFn: (frameworkId: number) => frameworkUploadApi.analyzeAlignment(frameworkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alignments'] });
      queryClient.invalidateQueries({ queryKey: ['alignment-summary'] });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: (alignmentId: number) => frameworkUploadApi.confirmAlignment(alignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alignments'] });
      queryClient.invalidateQueries({ queryKey: ['alignment-summary'] });
      setConfirmModal(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: { alignment_type?: string; match_reason?: string } }) =>
      frameworkUploadApi.updateAlignment(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alignments'] });
      queryClient.invalidateQueries({ queryKey: ['alignment-summary'] });
      setEditModal(null);
    },
  });

  const createNewControlsMutation = useMutation({
    mutationFn: (frameworkId: number) => frameworkUploadApi.createNewControls(frameworkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alignments'] });
      queryClient.invalidateQueries({ queryKey: ['alignment-summary'] });
    },
  });

  const alignments = alignmentsData?.items || [];

  const filteredAlignments = useMemo(() => {
    if (!alignments.length) return [];
    return alignments.filter((alignment) => {
      const parsed = alignment.parsed_control;
      if (!parsed) return false;
      const matchesSearch =
        parsed.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        parsed.control_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (parsed.domain?.toLowerCase().includes(searchTerm.toLowerCase()) || false);
      return matchesSearch;
    });
  }, [alignments, searchTerm]);

  const handleAnalyze = () => {
    if (effectiveFrameworkId) {
      analyzeMutation.mutate(effectiveFrameworkId);
    }
  };

  const handleConfirmAlignment = (alignment: Alignment) => {
    setConfirmModal(alignment);
  };

  const handleDoConfirm = () => {
    if (confirmModal) {
      confirmMutation.mutate(confirmModal.id);
    }
  };

  const handleEditAlignment = (alignment: Alignment) => {
    setEditFormData({
      alignment_type: alignment.alignment_type,
      match_reason: alignment.match_reason || '',
    });
    setEditModal(alignment);
  };

  const handleSaveEdit = () => {
    if (editModal) {
      updateMutation.mutate({
        id: editModal.id,
        data: editFormData,
      });
    }
  };

  const handleCreateNewControls = () => {
    if (effectiveFrameworkId) {
      createNewControlsMutation.mutate(effectiveFrameworkId);
    }
  };

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: summaryData?.total_alignments || 0 },
    { key: 'exact', label: 'Exact Matches', count: summaryData?.exact_matches || 0 },
    { key: 'partial', label: 'Partial Matches', count: summaryData?.partial_matches || 0 },
    { key: 'new', label: 'New Controls', count: summaryData?.new_controls || 0 },
  ];

  if (parsedFrameworks.length === 0 && !alignmentsLoading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-slate-600">
        <GitCompare className="h-12 w-12" />
        <p>No parsed frameworks available</p>
        <p className="text-sm">Upload and parse a framework document first</p>
      </div>
    );
  }

  if (alignmentsError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-600">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load alignment data</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex-1">
          <label className="mb-2 block text-sm font-medium text-slate-600">Select Framework</label>
          <div className="relative max-w-md">
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

        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleAnalyze}
            disabled={!effectiveFrameworkId || analyzeMutation.isPending || !canCreate}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Analyze Alignment
          </button>

          {summaryData && summaryData.new_controls > 0 && (
            <button
              onClick={handleCreateNewControls}
              disabled={createNewControlsMutation.isPending || !canCreate}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createNewControlsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create New Controls ({summaryData.new_controls})
            </button>
          )}
        </div>
      </div>

      {analyzeMutation.isSuccess && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-600">
          Alignment analysis completed successfully!
        </div>
      )}

      {createNewControlsMutation.isSuccess && (
        <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-600">
          New controls created successfully in the normalized library!
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <p className="text-sm text-slate-600">Exact Matches</p>
              <p className="text-2xl font-bold text-green-600">
                {summaryLoading ? '-' : summaryData?.exact_matches || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Link2 className="h-5 w-5 text-yellow-600" />
            <div>
              <p className="text-sm text-slate-600">Partial Matches</p>
              <p className="text-2xl font-bold text-yellow-600">
                {summaryLoading ? '-' : summaryData?.partial_matches || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Plus className="h-5 w-5 text-blue-600" />
            <div>
              <p className="text-sm text-slate-600">New Controls</p>
              <p className="text-2xl font-bold text-blue-600">
                {summaryLoading ? '-' : summaryData?.new_controls || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Check className="h-5 w-5 text-primary-600" />
            <div>
              <p className="text-sm text-slate-600">Confirmed</p>
              <p className="text-2xl font-bold text-primary-600">
                {summaryLoading ? '-' : summaryData?.confirmed_alignments || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
                          <Percent className="h-5 w-5 text-cyan-600" />
            <div>
              <p className="text-sm text-slate-600">Completion</p>
              <p className="text-2xl font-bold text-cyan-600">
                {summaryLoading ? '-' : `${summaryData?.percentages.confirmed || 0}%`}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-white p-1">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-primary-600 text-white'
                : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
            }`}
          >
            {tab.label}
            <span className={`rounded-full px-2 py-0.5 text-xs ${
              activeTab === tab.key ? 'bg-white/20' : 'bg-slate-600'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
          <input
            type="text"
            placeholder="Search by control ID, title, or domain..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-slate-200 py-2 pl-10 pr-4 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <h2 className="text-lg font-semibold text-black">
            Control Alignments
            {alignmentsData?.framework_name && (
              <span className="ml-2 text-sm font-normal text-slate-600">
                - {alignmentsData.framework_name}
              </span>
            )}
          </h2>
          <p className="text-sm text-slate-600">
            Showing {filteredAlignments.length} of {alignments.length} alignments
          </p>
        </div>

        {alignmentsLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
          </div>
        ) : filteredAlignments.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-slate-600">
            <GitCompare className="h-12 w-12" />
            <p>No alignments found</p>
            <p className="text-sm">Click "Analyze Alignment" to analyze parsed controls</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {filteredAlignments.map((alignment) => {
              const parsed = alignment.parsed_control;
              const matched = alignment.normalized_control || alignment.framework_control;
              const typeStyle = getAlignmentTypeStyle(alignment.alignment_type);
              const scoreColor = getScoreColor(alignment.match_score);
              
              return (
                <div key={alignment.id} className="p-4 hover:bg-slate-50">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex-1 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-slate-600">
                          {parsed?.control_id}
                        </span>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${typeStyle.bgColor} ${typeStyle.color}`}>
                          {typeStyle.label}
                        </span>
                        <span className={`text-sm font-medium ${scoreColor}`}>
                          {Math.round(alignment.match_score * 100)}%
                        </span>
                        {alignment.is_confirmed && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                            <Check className="h-3 w-3" />
                            Confirmed
                          </span>
                        )}
                      </div>
                      
                      <div>
                        <h4 className="font-medium text-black">{parsed?.title}</h4>
                        {parsed?.domain && (
                          <span className="mt-1 inline-block rounded-full bg-slate-600 px-2 py-0.5 text-xs text-slate-600">
                            {parsed.domain}
                          </span>
                        )}
                      </div>

                      {matched && (
                        <div className="rounded-lg bg-slate-50/50 p-3">
                          <p className="text-xs text-slate-600 mb-1">Matched Control</p>
                          <p className="text-sm text-black">
                            <span className="font-mono text-slate-600">{matched.code}</span>
                            {' - '}
                            {matched.name}
                          </p>
                        </div>
                      )}

                      {alignment.match_reason && (
                        <p className="text-sm text-slate-600">
                          <span className="text-slate-500">Reason:</span> {alignment.match_reason}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {!alignment.is_confirmed && canCreate && (
                        <button
                          onClick={() => handleConfirmAlignment(alignment)}
                          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-green-700"
                        >
                          <Check className="h-4 w-4" />
                          Confirm
                        </button>
                      )}
                      {canEdit && <button
                        onClick={() => handleEditAlignment(alignment)}
                        className="flex items-center gap-1.5 rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-600 hover:text-slate-900"
                      >
                        <Edit2 className="h-4 w-4" />
                        Edit
                      </button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="text-lg font-semibold text-black">Confirm Alignment</h3>
              <button
                onClick={() => setConfirmModal(null)}
                className="rounded p-1 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="rounded-lg bg-slate-50/50 p-3">
                <p className="text-xs text-slate-600 mb-1">Parsed Control</p>
                <p className="font-mono text-sm text-black">{confirmModal.parsed_control?.control_id}</p>
                <p className="text-sm text-slate-600">{confirmModal.parsed_control?.title}</p>
              </div>

              {(confirmModal.normalized_control || confirmModal.framework_control) && (
                <div className="rounded-lg bg-slate-50/50 p-3">
                  <p className="text-xs text-slate-600 mb-1">Matched Control</p>
                  <p className="font-mono text-sm text-black">
                    {(confirmModal.normalized_control || confirmModal.framework_control)?.code}
                  </p>
                  <p className="text-sm text-slate-600">
                    {(confirmModal.normalized_control || confirmModal.framework_control)?.name}
                  </p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${getAlignmentTypeStyle(confirmModal.alignment_type).bgColor} ${getAlignmentTypeStyle(confirmModal.alignment_type).color}`}>
                  {getAlignmentTypeStyle(confirmModal.alignment_type).label}
                </span>
                <span className={`text-sm font-medium ${getScoreColor(confirmModal.match_score)}`}>
                  {Math.round(confirmModal.match_score * 100)}% match score
                </span>
              </div>

              <p className="text-sm text-slate-600">
                Are you sure you want to confirm this alignment? This action indicates the match is correct.
              </p>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
              <button
                onClick={() => setConfirmModal(null)}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={handleDoConfirm}
                disabled={confirmMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
              >
                {confirmMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Confirm Alignment
              </button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="text-lg font-semibold text-black">Edit Alignment</h3>
              <button
                onClick={() => setEditModal(null)}
                className="rounded p-1 text-slate-600 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="p-4 space-y-4">
              <div className="rounded-lg bg-slate-50/50 p-3">
                <p className="text-xs text-slate-600 mb-1">Parsed Control</p>
                <p className="font-mono text-sm text-black">{editModal.parsed_control?.control_id}</p>
                <p className="text-sm text-slate-600">{editModal.parsed_control?.title}</p>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Alignment Type
                </label>
                <select
                  value={editFormData.alignment_type}
                  onChange={(e) => setEditFormData({ ...editFormData, alignment_type: e.target.value as 'exact' | 'partial' | 'new' })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="exact">Exact Match</option>
                  <option value="partial">Partial Match</option>
                  <option value="new">New Control</option>
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Match Reason
                </label>
                <textarea
                  value={editFormData.match_reason}
                  onChange={(e) => setEditFormData({ ...editFormData, match_reason: e.target.value })}
                  rows={3}
                  placeholder="Explain why this alignment is correct..."
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
              <button
                onClick={() => setEditModal(null)}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Check className="h-4 w-4" />
                )}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
