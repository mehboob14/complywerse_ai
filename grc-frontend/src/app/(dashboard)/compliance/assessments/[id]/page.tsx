'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  Download,
  Edit2,
  Save,
  X,
  Minus,
} from 'lucide-react';

interface AssessmentItem {
  id: number;
  item_number: string;
  area_domain: string | null;
  control_description: string | null;
  compliance_status: string;
  gaps_identified: string | null;
  proposed_solution: string | null;
  responsible_party: string | null;
  timeline: string | null;
  priority: string | null;
  evidence_reference: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string | null;
}

interface Assessment {
  id: number;
  tenant_id: number;
  name: string;
  assessment_type: string;
  source: string | null;
  file_name: string | null;
  status: string;
  due_date: string | null;
  assessor: string | null;
  overall_score: number | null;
  total_items: number | null;
  complied_count: number | null;
  partially_complied_count: number | null;
  not_complied_count: number | null;
  in_progress_count: number | null;
  na_count: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string | null;
  items: AssessmentItem[];
  items_by_domain: Record<string, AssessmentItem[]>;
}

const STATUS_OPTIONS = [
  { value: 'complied', label: 'Complied' },
  { value: 'partially_complied', label: 'Partially Complied' },
  { value: 'not_complied', label: 'Not Complied' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'na', label: 'N/A' },
];

const COMPLIANCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: typeof CheckCircle }> = {
  complied: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Complied', icon: CheckCircle },
  partially_complied: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Partial', icon: AlertTriangle },
  not_complied: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Not Complied', icon: XCircle },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Progress', icon: Clock },
  na: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'N/A', icon: Minus },
};

const ASSESSMENT_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Draft' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Progress' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Completed' },
  archived: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Archived' },
};

function getScoreColor(score: number | null): { bg: string; text: string } {
  if (score === null) return { bg: 'bg-slate-500/20', text: 'text-slate-400' };
  if (score >= 80) return { bg: 'bg-emerald-500/20', text: 'text-emerald-400' };
  if (score >= 50) return { bg: 'bg-amber-500/20', text: 'text-amber-400' };
  return { bg: 'bg-rose-500/20', text: 'text-rose-400' };
}

function getScoreBarColor(score: number | null): string {
  if (score === null) return 'bg-slate-600';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function AssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assessmentId = Number(params.id);
  const queryClient = useQueryClient();

  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set());
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editingStatus, setEditingStatus] = useState<string>('');

  const { data: assessment, isLoading, error } = useQuery<Assessment>({
    queryKey: ['compliance-assessment-detail', assessmentId],
    queryFn: async () => {
      const response = await apiClient.get(`/compliance/assessments/${assessmentId}`);
      return response.data;
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: async ({ itemId, status }: { itemId: number; status: string }) => {
      const response = await apiClient.put(`/compliance/assessments/items/${itemId}`, null, {
        params: { compliance_status: status },
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessment-detail', assessmentId] });
      setEditingItemId(null);
      setEditingStatus('');
    },
  });

  const handleExport = async () => {
    try {
      const response = await apiClient.get(`/compliance/assessments/${assessmentId}/export`, {
        responseType: 'blob',
      });
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${assessment?.name || 'assessment'}_export.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export assessment:', err);
    }
  };

  const toggleDomain = (domain: string) => {
    const newExpanded = new Set(expandedDomains);
    if (newExpanded.has(domain)) {
      newExpanded.delete(domain);
    } else {
      newExpanded.add(domain);
    }
    setExpandedDomains(newExpanded);
  };

  const expandAll = () => {
    if (assessment?.items_by_domain) {
      setExpandedDomains(new Set(Object.keys(assessment.items_by_domain)));
    }
  };

  const collapseAll = () => {
    setExpandedDomains(new Set());
  };

  const startEditing = (item: AssessmentItem) => {
    setEditingItemId(item.id);
    setEditingStatus(item.compliance_status);
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setEditingStatus('');
  };

  const saveEditing = () => {
    if (editingItemId && editingStatus) {
      updateItemMutation.mutate({ itemId: editingItemId, status: editingStatus });
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load assessment details</p>
        <Link href="/compliance/assessments" className="mt-4 text-primary-400 hover:underline">
          Back to Assessments
        </Link>
      </div>
    );
  }

  const statusStyle = ASSESSMENT_STATUS_STYLES[assessment.status] || ASSESSMENT_STATUS_STYLES.draft;
  const scoreColor = getScoreColor(assessment.overall_score);
  const domains = Object.keys(assessment.items_by_domain || {});

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link
          href="/compliance/assessments"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-900/50 text-primary-400">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{assessment.name}</h1>
              <p className="text-slate-400">
                {assessment.assessment_type.replace(/_/g, ' ')} • {assessment.file_name}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
            {statusStyle.label}
          </span>
          <button onClick={handleExport} className="btn-secondary flex items-center gap-2">
            <Download className="h-4 w-4" />
            Export Excel
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
          <p className="stat-value text-emerald-400">{assessment.complied_count || 0}</p>
          <p className="stat-label">Complied</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 p-3">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <p className="stat-value text-amber-400">{assessment.partially_complied_count || 0}</p>
          <p className="stat-label">Partially Complied</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-600/10 p-3">
              <XCircle className="h-5 w-5 text-rose-400" />
            </div>
          </div>
          <p className="stat-value text-rose-400">{assessment.not_complied_count || 0}</p>
          <p className="stat-label">Not Complied</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <Clock className="h-5 w-5 text-blue-400" />
            </div>
          </div>
          <p className="stat-value text-blue-400">{assessment.in_progress_count || 0}</p>
          <p className="stat-label">In Progress</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-2">
            <div className="rounded-xl bg-gradient-to-br from-slate-500/20 to-slate-600/10 p-3">
              <Minus className="h-5 w-5 text-slate-400" />
            </div>
          </div>
          <p className="stat-value text-slate-400">{assessment.na_count || 0}</p>
          <p className="stat-label">N/A</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Overall Compliance Score</h2>
                <p className="card-description">Based on {assessment.total_items || 0} items</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="h-4 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${getScoreBarColor(assessment.overall_score)} transition-all`}
                      style={{ width: `${assessment.overall_score || 0}%` }}
                    />
                  </div>
                </div>
                <span className={`text-2xl font-bold ${scoreColor.text}`}>
                  {assessment.overall_score !== null
                    ? `${Math.round(assessment.overall_score)}%`
                    : '-'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Assessment Details</h2>
          </div>
          <div className="space-y-3">
            {assessment.source && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Source</span>
                <span className="text-white">{assessment.source}</span>
              </div>
            )}
            {assessment.assessor && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Assessor</span>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-slate-500" />
                  <span className="text-white">{assessment.assessor}</span>
                </div>
              </div>
            )}
            {assessment.due_date && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Due Date</span>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-slate-500" />
                  <span className="text-white">{formatDate(assessment.due_date)}</span>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Created</span>
              <span className="text-white">{formatDate(assessment.created_at)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Assessment Items</h2>
            <p className="card-description">
              {domains.length} domain{domains.length !== 1 ? 's' : ''} • {assessment.total_items} items
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={expandAll} className="btn-secondary btn-sm">
              Expand All
            </button>
            <button onClick={collapseAll} className="btn-secondary btn-sm">
              Collapse All
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {domains.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="h-12 w-12 text-slate-500 mx-auto mb-3" />
              <p className="text-slate-400">No assessment items found</p>
            </div>
          ) : (
            domains.map((domain) => {
              const items = assessment.items_by_domain[domain] || [];
              const isExpanded = expandedDomains.has(domain);
              const domainComplied = items.filter((i) => i.compliance_status === 'complied').length;
              const domainPercentage = items.length > 0 ? Math.round((domainComplied / items.length) * 100) : 0;

              return (
                <div
                  key={domain}
                  className="border border-slate-700 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => toggleDomain(domain)}
                    className="w-full flex items-center justify-between p-4 bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-5 w-5 text-slate-400" />
                      ) : (
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                      )}
                      <span className="font-medium text-white">{domain}</span>
                      <span className="text-sm text-slate-500">({items.length} items)</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 min-w-[100px]">
                        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getScoreBarColor(domainPercentage)} transition-all`}
                            style={{ width: `${domainPercentage}%` }}
                          />
                        </div>
                        <span className="text-sm text-slate-400">{domainPercentage}%</span>
                      </div>
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="divide-y divide-slate-700/50">
                      {items.map((item) => {
                        const itemStatusStyle =
                          COMPLIANCE_STATUS_STYLES[item.compliance_status] ||
                          COMPLIANCE_STATUS_STYLES.in_progress;
                        const StatusIcon = itemStatusStyle.icon;
                        const isEditing = editingItemId === item.id;

                        return (
                          <div key={item.id} className="p-4 bg-slate-900/30">
                            <div className="flex items-start gap-4">
                              <span className="text-sm font-mono text-slate-500 mt-1">
                                {item.item_number}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="text-white mb-2">{item.control_description}</p>

                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
                                  {item.gaps_identified && (
                                    <div className="bg-slate-800/50 rounded-lg p-3">
                                      <p className="text-xs text-slate-500 mb-1">Gaps Identified</p>
                                      <p className="text-sm text-slate-300">{item.gaps_identified}</p>
                                    </div>
                                  )}
                                  {item.proposed_solution && (
                                    <div className="bg-slate-800/50 rounded-lg p-3">
                                      <p className="text-xs text-slate-500 mb-1">Proposed Solution</p>
                                      <p className="text-sm text-slate-300">{item.proposed_solution}</p>
                                    </div>
                                  )}
                                  {item.responsible_party && (
                                    <div className="bg-slate-800/50 rounded-lg p-3">
                                      <p className="text-xs text-slate-500 mb-1">Responsible Party</p>
                                      <p className="text-sm text-slate-300">{item.responsible_party}</p>
                                    </div>
                                  )}
                                  {item.timeline && (
                                    <div className="bg-slate-800/50 rounded-lg p-3">
                                      <p className="text-xs text-slate-500 mb-1">Timeline</p>
                                      <p className="text-sm text-slate-300">{item.timeline}</p>
                                    </div>
                                  )}
                                  {item.priority && (
                                    <div className="bg-slate-800/50 rounded-lg p-3">
                                      <p className="text-xs text-slate-500 mb-1">Priority</p>
                                      <p className="text-sm text-slate-300 capitalize">{item.priority}</p>
                                    </div>
                                  )}
                                  {item.remarks && (
                                    <div className="bg-slate-800/50 rounded-lg p-3">
                                      <p className="text-xs text-slate-500 mb-1">Remarks</p>
                                      <p className="text-sm text-slate-300">{item.remarks}</p>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {isEditing ? (
                                  <>
                                    <select
                                      value={editingStatus}
                                      onChange={(e) => setEditingStatus(e.target.value)}
                                      className="select text-sm"
                                    >
                                      {STATUS_OPTIONS.map((opt) => (
                                        <option key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      onClick={saveEditing}
                                      disabled={updateItemMutation.isPending}
                                      className="btn-primary btn-sm"
                                    >
                                      {updateItemMutation.isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Save className="h-4 w-4" />
                                      )}
                                    </button>
                                    <button onClick={cancelEditing} className="btn-ghost btn-sm">
                                      <X className="h-4 w-4" />
                                    </button>
                                  </>
                                ) : (
                                  <>
                                    <span
                                      className={`badge ${itemStatusStyle.bg} ${itemStatusStyle.text} flex items-center gap-1`}
                                    >
                                      <StatusIcon className="h-3 w-3" />
                                      {itemStatusStyle.label}
                                    </span>
                                    <button
                                      onClick={() => startEditing(item)}
                                      className="btn-ghost btn-sm"
                                      title="Edit Status"
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
