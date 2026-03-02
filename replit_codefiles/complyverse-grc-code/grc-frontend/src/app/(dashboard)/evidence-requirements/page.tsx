'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
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
    draft: 'bg-slate-500/20 text-slate-400',
    submitted: 'bg-blue-500/20 text-blue-400',
    pending_review: 'bg-purple-500/20 text-purple-400',
    approved: 'bg-emerald-500/20 text-emerald-400',
    rejected: 'bg-rose-500/20 text-rose-400',
  };
  const labels: Record<string, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-slate-500/20 text-slate-400'}`}>
      {labels[status] || status}
    </span>
  );
};

const getPriorityBadge = (priority: string) => {
  const styles: Record<string, string> = {
    high: 'bg-rose-500/20 text-rose-400',
    medium: 'bg-amber-500/20 text-amber-400',
    low: 'bg-emerald-500/20 text-emerald-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[priority] || 'bg-slate-500/20 text-slate-400'}`}>
      {priority}
    </span>
  );
};

const getTypeBadge = (type: string) => {
  const styles: Record<string, string> = {
    policy: 'bg-indigo-500/20 text-indigo-400',
    procedure: 'bg-cyan-500/20 text-cyan-400',
    configuration: 'bg-orange-500/20 text-orange-400',
    log: 'bg-yellow-500/20 text-yellow-400',
    report: 'bg-blue-500/20 text-blue-400',
    contract: 'bg-pink-500/20 text-pink-400',
    register: 'bg-teal-500/20 text-teal-400',
    attestation: 'bg-purple-500/20 text-purple-400',
    training: 'bg-green-500/20 text-green-400',
    screenshot: 'bg-slate-500/20 text-slate-400',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${styles[type] || 'bg-slate-500/20 text-slate-400'}`}>
      {type}
    </span>
  );
};

export default function EvidenceRequirementsPage() {
  const queryClient = useQueryClient();
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
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <FileCheck className="h-6 w-6 text-primary-400" />
          Evidence Requirements
        </h1>
        <p className="text-slate-400">AI-generated evidence requirements for compliance controls</p>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={selectedFramework || ''}
              onChange={(e) => {
                setSelectedFramework(e.target.value ? Number(e.target.value) : null);
                setExpandedRow(null);
              }}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
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
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
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
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by control ID or title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none sm:w-80"
            />
          </div>
        )}
      </div>

      {selectedFramework && requirementsData && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-500/20">
                <List className="h-5 w-5 text-primary-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{totalRequirements}</p>
                <p className="text-sm text-slate-400">Total Requirements</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/20">
                <FileText className="h-5 w-5 text-slate-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{draftCount}</p>
                <p className="text-sm text-slate-400">Draft</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-500/20">
                <Clock className="h-5 w-5 text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{pendingReviewCount}</p>
                <p className="text-sm text-slate-400">Pending Review</p>
              </div>
            </div>
          </div>
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/20">
                <CheckCircle className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{approvedCount}</p>
                <p className="text-sm text-slate-400">Approved</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {!selectedFramework && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <FileCheck className="mb-4 h-16 w-16 text-slate-600" />
          <h3 className="text-lg font-medium text-white mb-2">Select a Framework</h3>
          <p className="text-slate-400 max-w-md">
            Choose a framework from the dropdown above to view its AI-generated evidence requirements.
            Evidence requirements help you understand what documentation is needed for each control.
          </p>
        </div>
      )}

      {selectedFramework && requirementsLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
        </div>
      )}

      {selectedFramework && error && (
        <div className="flex h-64 flex-col items-center justify-center text-red-400">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>Failed to load evidence requirements</p>
        </div>
      )}

      {selectedFramework && requirementsData && filteredRequirements.length === 0 && (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <Sparkles className="mb-4 h-16 w-16 text-slate-600" />
          <h3 className="text-lg font-medium text-white mb-2">No Evidence Requirements</h3>
          <p className="text-slate-400 max-w-md">
            {searchTerm || statusFilter || priorityFilter || typeFilter
              ? 'No requirements match your current filters. Try adjusting them.'
              : 'No evidence requirements have been generated for this framework yet. Use the "Generate Evidence Requirements" button on the Framework Controls page.'}
          </p>
        </div>
      )}

      {selectedFramework && filteredRequirements.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-700">
          <table className="w-full">
            <thead className="bg-slate-800">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Control</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Evidence Title</th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 md:table-cell">Type</th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 lg:table-cell">Priority</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-slate-300">Status</th>
                <th className="hidden px-4 py-3 text-left text-sm font-medium text-slate-300 xl:table-cell">Frequency</th>
                <th className="px-4 py-3 text-right text-sm font-medium text-slate-300">Actions</th>
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
                      className="bg-slate-800/50 hover:bg-slate-700/50 cursor-pointer"
                      onClick={() => setExpandedRow(isExpanded ? null : req.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          )}
                          <div className="min-w-0">
                            <p className="font-mono text-sm text-white truncate">
                              {control?.original_reference || control?.control_id || `Control #${req.parsed_control_id}`}
                            </p>
                            <p className="text-xs text-slate-400 truncate max-w-[200px]">
                              {control?.title || 'Unknown Control'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white line-clamp-1">{req.evidence_title}</p>
                          {req.is_mandatory && (
                            <span className="flex-shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-medium text-rose-400">
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
                        <span className="text-sm text-slate-400">{req.collection_frequency || '-'}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          {req.status === 'draft' && (
                            <button
                              onClick={() => submitMutation.mutate(req.id)}
                              disabled={submitMutation.isPending}
                              className="flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                            >
                              <Send className="h-3 w-3" />
                              Submit
                            </button>
                          )}
                          {req.status === 'submitted' && (
                            <button
                              onClick={() => reviewMutation.mutate(req.id)}
                              disabled={reviewMutation.isPending}
                              className="flex items-center gap-1 rounded bg-purple-600 px-2 py-1 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
                            >
                              <Eye className="h-3 w-3" />
                              Review
                            </button>
                          )}
                          {req.status === 'pending_review' && (
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
                      <tr key={`${req.id}-details`} className="bg-slate-900">
                        <td colSpan={7} className="px-4 py-4 border-t border-slate-700">
                          <div className="space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Evidence Type</h4>
                                <p className="text-sm text-white capitalize">{req.evidence_type}</p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Collection Frequency</h4>
                                <p className="text-sm text-white">{req.collection_frequency || 'Not specified'}</p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Retention Period</h4>
                                <p className="text-sm text-white">{req.retention_period || 'Not specified'}</p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">AI Confidence</h4>
                                <p className={`text-sm font-medium ${
                                  req.ai_confidence >= 0.8 ? 'text-emerald-400' :
                                  req.ai_confidence >= 0.5 ? 'text-amber-400' : 'text-rose-400'
                                }`}>
                                  {Math.round((req.ai_confidence || 0) * 100)}%
                                </p>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Mandatory</h4>
                                <p className={`text-sm font-medium ${req.is_mandatory ? 'text-rose-400' : 'text-slate-400'}`}>
                                  {req.is_mandatory ? 'Yes' : 'No'}
                                </p>
                              </div>
                              {req.evidence_format && (
                                <div>
                                  <h4 className="text-sm font-medium text-slate-300 mb-1">Evidence Format</h4>
                                  <p className="text-sm text-white">{req.evidence_format}</p>
                                </div>
                              )}
                            </div>

                            {req.evidence_description && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Description</h4>
                                <p className="text-sm text-slate-400">{req.evidence_description}</p>
                              </div>
                            )}

                            {req.exact_requirements && req.exact_requirements.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-2">Exact Requirements</h4>
                                <ul className="space-y-1">
                                  {req.exact_requirements.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-400">
                                      <Check className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {req.acceptance_criteria && req.acceptance_criteria.length > 0 && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-2">Acceptance Criteria</h4>
                                <ul className="space-y-1">
                                  {req.acceptance_criteria.map((item, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-400">
                                      <span className="text-primary-400 mt-1">•</span>
                                      <span>{item}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {req.sample_evidence && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Sample Evidence</h4>
                                <p className="text-sm text-slate-400">{req.sample_evidence}</p>
                              </div>
                            )}

                            {req.collection_guidance && (
                              <div>
                                <h4 className="text-sm font-medium text-slate-300 mb-1">Collection Guidance</h4>
                                <p className="text-sm text-slate-400">{req.collection_guidance}</p>
                              </div>
                            )}

                            {req.ai_reasoning && (
                              <div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setShowAiReasoning(showAiReasoning === req.id ? null : req.id);
                                  }}
                                  className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
                                >
                                  <Sparkles className="h-4 w-4 text-purple-400" />
                                  <span>AI Reasoning</span>
                                  <ChevronDown className={`h-4 w-4 transition-transform ${showAiReasoning === req.id ? 'rotate-180' : ''}`} />
                                </button>
                                {showAiReasoning === req.id && (
                                  <div className="mt-2 rounded-lg bg-slate-800 p-3 text-sm text-slate-400">
                                    {req.ai_reasoning}
                                  </div>
                                )}
                              </div>
                            )}

                            {req.rejection_reason && (
                              <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3">
                                <h4 className="text-sm font-medium text-rose-400 mb-1 flex items-center gap-2">
                                  <AlertTriangle className="h-4 w-4" />
                                  Rejection Reason
                                </h4>
                                <p className="text-sm text-slate-400">{req.rejection_reason}</p>
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
          <div className="w-full max-w-md mx-4 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 p-4">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <ThumbsDown className="h-5 w-5 text-rose-400" />
                Reject Evidence Requirement
              </h2>
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionReason('');
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Rejection Reason <span className="text-rose-400">*</span>
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Please provide a reason for rejecting this evidence requirement..."
                rows={4}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
              />
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-700 p-4">
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectionReason('');
                }}
                className="rounded-lg bg-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600"
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
