'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Clock,
  CheckCircle,
  FileText,
  AlertTriangle,
  Sparkles,
  Calendar,
  Archive,
  List,
  Eye,
  Send,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
} from 'lucide-react';

interface EvidenceRequirement {
  id: number;
  parsed_control_id: number;
  evidence_title: string;
  evidence_description: string;
  evidence_type: string;
  evidence_format: string;
  exact_requirements: string[] | null;
  acceptance_criteria: string[] | null;
  sample_evidence: string;
  collection_guidance: string;
  collection_frequency: string;
  retention_period: string;
  priority: string;
  is_mandatory: boolean;
  status: string;
  ai_confidence: number;
  ai_reasoning?: string;
  created_at: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  approved_at: string | null;
  rejection_reason?: string | null;
  control_id?: string;
  control_title?: string;
}

interface UploadedFramework {
  id: number;
  name: string;
  version: string;
  upload_status: string;
  parsed_controls_count: number;
}

interface ParsedControl {
  id: number;
  control_id: string;
  title: string;
  original_reference: string | null;
}

interface EvidenceRequirementsResponse {
  framework_id: number;
  framework_name: string;
  total: number;
  status_counts: Record<string, number>;
  requirements: EvidenceRequirement[];
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'pending_review', label: 'Pending Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const EVIDENCE_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'log', label: 'Log' },
  { value: 'report', label: 'Report' },
  { value: 'contract', label: 'Contract' },
  { value: 'register', label: 'Register' },
  { value: 'attestation', label: 'Attestation' },
  { value: 'training', label: 'Training' },
  { value: 'screenshot', label: 'Screenshot' },
];

const getStatusBadge = (status: string) => {
  const styles: Record<string, string> = {
    draft: 'bg-slate-50 text-slate-700',
    submitted: 'bg-blue-50 text-blue-700',
    pending_review: 'bg-primary-50 text-primary-700',
    approved: 'bg-emerald-50 text-emerald-700',
    rejected: 'bg-rose-50 text-rose-700',
  };
  const labels: Record<string, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-slate-50 text-slate-700'}`}>
      {labels[status] || status}
    </span>
  );
};

const getPriorityBadge = (priority: string) => {
  const styles: Record<string, string> = {
    high: 'bg-rose-50 text-rose-700',
    medium: 'bg-amber-50 text-amber-700',
    low: 'bg-emerald-50 text-emerald-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[priority] || 'bg-slate-50 text-slate-700'}`}>
      {priority}
    </span>
  );
};

const getTypeBadge = (type: string) => {
  const styles: Record<string, string> = {
    policy: 'bg-indigo-500/20 text-indigo-400',
    procedure: 'bg-cyan-50 text-cyan-700',
    configuration: 'bg-orange-50 text-orange-700',
    log: 'bg-yellow-50 text-yellow-700',
    report: 'bg-blue-50 text-blue-700',
    contract: 'bg-pink-500/20 text-pink-400',
    register: 'bg-teal-500/20 text-teal-400',
    attestation: 'bg-primary-50 text-primary-700',
    training: 'bg-green-50 text-green-700',
    screenshot: 'bg-slate-50 text-slate-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[type] || 'bg-slate-50 text-slate-700'}`}>
      {type}
    </span>
  );
};

export default function EvidenceRequirementsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('evidence:evidence_library:edit');
  const [selectedFramework, setSelectedFramework] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [showRejectModal, setShowRejectModal] = useState<number | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showAiReasoning, setShowAiReasoning] = useState<number | null>(null);

  const { data: frameworks, isLoading: frameworksLoading } = useQuery({
    queryKey: ['uploaded-frameworks-for-evidence'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const items = response.data?.items || [];
      return items.filter((f: UploadedFramework) => 
        f.upload_status === 'completed' || 
        f.upload_status === 'parsed' || 
        f.upload_status === 'published'
      ) as UploadedFramework[];
    },
  });

  const { data: controls } = useQuery({
    queryKey: ['parsed-controls-for-evidence', selectedFramework],
    queryFn: async () => {
      if (!selectedFramework) return [];
      const response = await apiClient.get(`/framework-upload/parser/${selectedFramework}/controls`, {
        params: { limit: 1000 }
      });
      return (response.data?.items || []) as ParsedControl[];
    },
    enabled: !!selectedFramework,
  });

  const controlMap = useMemo(() => {
    const map: Record<number, ParsedControl> = {};
    controls?.forEach((c: ParsedControl) => {
      map[c.id] = c;
    });
    return map;
  }, [controls]);

  const { data: requirementsData, isLoading: requirementsLoading, error } = useQuery({
    queryKey: ['evidence-requirements', selectedFramework, statusFilter, priorityFilter, typeFilter],
    queryFn: async () => {
      if (!selectedFramework) return null;
      const params: Record<string, any> = { limit: 500 };
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (typeFilter) params.evidence_type = typeFilter;
      
      const response = await apiClient.get(`/framework-upload/parser/${selectedFramework}/evidence-requirements`, { params });
      return response.data as EvidenceRequirementsResponse;
    },
    enabled: !!selectedFramework,
  });

  const filteredRequirements = useMemo(() => {
    if (!requirementsData?.requirements) return [];
    if (!searchTerm) return requirementsData.requirements;
    
    const term = searchTerm.toLowerCase();
    return requirementsData.requirements.filter((req) => {
      const control = controlMap[req.parsed_control_id];
      const controlId = control?.control_id || control?.original_reference || '';
      const controlTitle = control?.title || '';
      return (
        req.evidence_title.toLowerCase().includes(term) ||
        controlId.toLowerCase().includes(term) ||
        controlTitle.toLowerCase().includes(term)
      );
    });
  }, [requirementsData?.requirements, searchTerm, controlMap]);

  const submitMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiClient.post(`/framework-upload/parser/evidence-requirements/${id}/submit`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-requirements'] });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiClient.post(`/framework-upload/parser/evidence-requirements/${id}/review`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-requirements'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async (id: number) => {
      return await apiClient.post(`/framework-upload/parser/evidence-requirements/${id}/approve`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-requirements'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason: string }) => {
      return await apiClient.post(`/framework-upload/parser/evidence-requirements/${id}/reject`, { reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-requirements'] });
      setShowRejectModal(null);
      setRejectionReason('');
    },
  });

  const handleReject = () => {
    if (showRejectModal && rejectionReason.trim()) {
      rejectMutation.mutate({ id: showRejectModal, reason: rejectionReason });
    }
  };

  const statusCounts = requirementsData?.status_counts || {};
  const totalRequirements = requirementsData?.total || 0;
  const draftCount = statusCounts['draft'] || 0;
  const pendingReviewCount = (statusCounts['submitted'] || 0) + (statusCounts['pending_review'] || 0);
  const approvedCount = statusCounts['approved'] || 0;

  if (frameworksLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black flex items-center gap-2">
          <FileCheck className="h-6 w-6 text-primary-600" />
          Evidence Requirements
        </h1>
        <p className="text-slate-600">AI-generated evidence requirements for compliance controls</p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-600" />
            <select
              value={selectedFramework || ''}
              onChange={(e) => {
                setSelectedFramework(e.target.value ? Number(e.target.value) : null);
                setExpandedRow(null);
              }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
            >
              <option value="">Select Framework</option>
              {frameworks?.map((fw) => (
                <option key={fw.id} value={fw.id}>
                  {fw.name}
                </option>
              ))}
            </select>
          </div>

          {selectedFramework && (
            <>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-black focus:border-primary-500 focus:outline-none"
              >
                {EVIDENCE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </>
          )}
        </div>

        {selectedFramework && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search by control ID or title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none sm:w-80"
            />
          </div>
        )}
      </div>

      {selectedFramework && requirementsData && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                <List className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{totalRequirements}</p>
                <p className="text-sm text-slate-600">Total Requirements</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50">
                <FileText className="h-5 w-5 text-slate-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{draftCount}</p>
                <p className="text-sm text-slate-600">Draft</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50">
                <Clock className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{pendingReviewCount}</p>
                <p className="text-sm text-slate-600">Pending Review</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-black">{approvedCount}</p>
                <p className="text-sm text-slate-600">Approved</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedFramework && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <FileCheck className="mb-4 h-16 w-16 text-slate-600" />
          <h3 className="text-lg font-medium text-black mb-2">Select a Framework</h3>
          <p className="text-slate-600 max-w-md">
            Choose a framework from the dropdown above to view its AI-generated evidence requirements.
            Evidence requirements help you understand what documentation is needed for each control.
          </p>
        </div>
      )}

      {selectedFramework && requirementsLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
        </div>
      )}

      {selectedFramework && error && (
        <div className="flex h-64 flex-col items-center justify-center text-red-600">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>Failed to load evidence requirements</p>
        </div>
      )}

      {selectedFramework && requirementsData && filteredRequirements.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Sparkles className="mb-4 h-16 w-16 text-slate-600" />
          <h3 className="text-lg font-medium text-black mb-2">No Evidence Requirements</h3>
          <p className="text-slate-600 max-w-md">
            {searchTerm || statusFilter || priorityFilter || typeFilter
              ? 'No requirements match your current filters. Try adjusting them.'
              : 'No evidence requirements have been generated for this framework yet. Use the "Generate Evidence Requirements" button on the Framework Controls page.'}
          </p>
        </div>
      )}

      {selectedFramework && filteredRequirements.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-white">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Control</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Evidence Title</th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 md:table-cell">Type</th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 lg:table-cell">Priority</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Status</th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-600 xl:table-cell">Frequency</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredRequirements.map((req) => {
                const control = controlMap[req.parsed_control_id];
                const isExpanded = expandedRow === req.id;
                return (
                  <>
                    <tr
                      key={req.id}
                      className="bg-white/50 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : req.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-slate-600 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-600 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-mono text-sm text-black truncate">
                              {control?.original_reference || control?.control_id || `Control #${req.parsed_control_id}`}
                            </p>
                            <p className="text-xs text-slate-600 truncate max-w-[200px]">
                              {control?.title || 'Unknown Control'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-black line-clamp-1">{req.evidence_title}</p>
                          {req.is_mandatory && (
                            <span className="flex-shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                              Required
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        {getTypeBadge(req.evidence_type)}
                      </td>
                      <td className="hidden px-4 py-3 lg:table-cell">
                        {getPriorityBadge(req.priority)}
                      </td>
                      <td className="px-4 py-3">
                        {getStatusBadge(req.status)}
                      </td>
                      <td className="hidden px-4 py-3 xl:table-cell">
                        <span className="text-sm text-slate-600">{req.collection_frequency || '-'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          {req.status === 'draft' && canEdit && (
                            <button
                              onClick={() => submitMutation.mutate(req.id)}
                              disabled={submitMutation.isPending}
                              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Send className="h-3 w-3" />
                              Submit
                            </button>
                          )}
                          {req.status === 'submitted' && canEdit && (
                            <button
                              onClick={() => reviewMutation.mutate(req.id)}
                              disabled={reviewMutation.isPending}
                              className="flex items-center gap-1 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                            >
                              <Eye className="h-3 w-3" />
                              Review
                            </button>
                          )}
                          {req.status === 'pending_review' && canEdit && (
                            <>
                              <button
                                onClick={() => approveMutation.mutate(req.id)}
                                disabled={approveMutation.isPending}
                                className="flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                              >
                                <ThumbsUp className="h-3 w-3" />
                                Approve
                              </button>
                              <button
                                onClick={() => setShowRejectModal(req.id)}
                                className="flex items-center gap-1 rounded bg-rose-600 px-2 py-1 text-xs font-medium text-white hover:bg-rose-700"
                              >
                                <ThumbsDown className="h-3 w-3" />
                                Reject
                              </button>
                            </>
                          )}
                          {(req.status === 'approved' || req.status === 'rejected') && (
                            <span className="text-xs text-slate-500">
                              {req.status === 'approved' ? 'Approved' : 'Rejected'}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${req.id}-details`} className="bg-slate-50">
                        <td colSpan={7} className="px-4 py-4 border-t border-slate-200">
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Evidence Type</h4>
                                <p className="text-sm text-black capitalize">{req.evidence_type}</p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Collection Frequency</h4>
                                <p className="text-sm text-black">{req.collection_frequency || 'Not specified'}</p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Retention Period</h4>
                                <p className="text-sm text-black">{req.retention_period || 'Not specified'}</p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">AI Confidence</h4>
                                <p className={`text-sm font-medium ${
                                  req.ai_confidence >= 0.8 ? 'text-emerald-600' :
                                  req.ai_confidence >= 0.5 ? 'text-amber-600' : 'text-rose-600'
                                }`}>
                                  {Math.round((req.ai_confidence || 0) * 100)}%
                                </p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Mandatory</h4>
                                <p className={`text-sm font-medium ${req.is_mandatory ? 'text-rose-600' : 'text-slate-600'}`}>
                                  {req.is_mandatory ? 'Yes' : 'No'}
                                </p>
                              </div>
                              {req.evidence_format && (
                                <div>
                                  <h4 className="text-sm font-medium text-slate-600 mb-1">Evidence Format</h4>
                                  <p className="text-sm text-black">{req.evidence_format}</p>
                                </div>
                              )}
                            </div>

                            {req.evidence_description && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Description</h4>
                                <p className="text-sm text-slate-600">{req.evidence_description}</p>
                              </div>
                            )}

                            {req.exact_requirements && req.exact_requirements.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-2">Exact Requirements</h4>
                                <ul className="space-y-1">
                                  {req.exact_requirements.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                      <Check className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {req.acceptance_criteria && req.acceptance_criteria.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-2">Acceptance Criteria</h4>
                                <ul className="space-y-1">
                                  {req.acceptance_criteria.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                      <span className="text-primary-600 mt-1">•</span>
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {req.sample_evidence && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Sample Evidence</h4>
                                <p className="text-sm text-slate-600">{req.sample_evidence}</p>
                              </div>
                            )}

                            {req.collection_guidance && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-1">Collection Guidance</h4>
                                <p className="text-sm text-slate-600">{req.collection_guidance}</p>
                              </div>
                            )}

                            {req.ai_reasoning && (
                              <div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAiReasoning(showAiReasoning === req.id ? null : req.id);
                                  }}
                                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 transition-colors"
                                >
                                  <Sparkles className="h-4 w-4 text-primary-600" />
                                  <span>AI Reasoning</span>
                                  <ChevronDown className={`h-4 w-4 transition-transform ${showAiReasoning === req.id ? 'rotate-180' : ''}`} />
                                </button>
                                {showAiReasoning === req.id && (
                                  <div className="mt-2 rounded-lg bg-white p-3 text-sm text-slate-600">
                                    {req.ai_reasoning}
                                  </div>
                                )}
                              </div>
                            )}

                            {req.rejection_reason && (
                              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
                                <h4 className="text-sm font-medium text-rose-600 mb-1 flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4" />
                                  Rejection Reason
                                </h4>
                                <p className="text-sm text-slate-600">{req.rejection_reason}</p>
                              </div>
                            )}

                            <div className="flex items-center gap-4 pt-2 text-xs text-slate-500">
                              {req.created_at && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  Created: {new Date(req.created_at).toLocaleDateString()}
                                </span>
                              )}
                              {req.submitted_at && (
                                <span className="flex items-center gap-1">
                                  <Send className="h-3 w-3" />
                                  Submitted: {new Date(req.submitted_at).toLocaleDateString()}
                                </span>
                              )}
                              {req.approved_at && (
                                <span className="flex items-center gap-1">
                                  <CheckCircle className="h-3 w-3" />
                                  Approved: {new Date(req.approved_at).toLocaleDateString()}
                                </span>
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
      )}

      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-xl bg-white border border-slate-200 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <ThumbsDown className="h-5 w-5 text-rose-600" />
                Reject Evidence Requirement
              </h2>
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionReason('');
                }}
                className="rounded-lg p-1 text-slate-600 hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-medium text-slate-600 mb-2">
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Please provide a reason for rejecting this evidence requirement..."
                rows={4}
                className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionReason('');
                }}
                className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectionReason.trim() || rejectMutation.isPending}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
