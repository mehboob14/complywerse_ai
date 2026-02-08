'use client';

import { useState, useCallback, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { frameworkUploadApi } from '@/lib/api';
import {
  Loader2,
  AlertCircle,
  Plus,
  X,
  CheckCircle,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Upload,
  FileText,
  Wrench,
  ChevronDown,
  Search,
  Filter,
  Clock,
  User,
  BarChart3,
} from 'lucide-react';

interface UploadedFramework {
  id: number;
  name: string;
  parsed_controls_count: number;
  upload_status: string;
}

interface Assessment {
  id: number;
  name: string;
  description: string | null;
  uploaded_framework_id: number;
  framework_name?: string;
  status: string;
  target_completion_date: string | null;
  overall_compliance_score: number | null;
  items_count: number;
  compliance_summary: {
    total: number;
    not_assessed: number;
    compliant: number;
    partially_compliant: number;
    non_compliant: number;
    not_applicable: number;
  };
  created_at: string;
}

interface AssessmentItem {
  id: number;
  assessment_id: number;
  parsed_control_id: number;
  control_id: string | null;
  control_title: string | null;
  control_description: string | null;
  control_domain: string | null;
  control_category: string | null;
  compliance_status: string;
  owner_id: number | null;
  owner_name: string | null;
  department: string | null;
  assessment_notes: string | null;
  gap_description: string | null;
  evidence_count: number;
  remediation_count: number;
}

interface AssessmentDashboard {
  assessment_id: number;
  assessment_name: string;
  overall_compliance_score: number | null;
  compliance_breakdown: {
    not_assessed: number;
    compliant: number;
    partially_compliant: number;
    non_compliant: number;
    not_applicable: number;
  };
  items_by_domain: Record<string, { total: number; compliant: number; partially_compliant: number; non_compliant: number; not_assessed: number; not_applicable: number }>;
  gap_count: number;
  progress_percentage: number;
  total_items: number;
  assessed_items: number;
  remediation_stats: { open: number; in_progress: number; completed: number; deferred: number };
}

const COMPLIANCE_STATUSES = [
  { value: 'not_assessed', label: 'Not Assessed', color: 'text-slate-400', bgColor: 'bg-slate-500/20', icon: HelpCircle },
  { value: 'compliant', label: 'Compliant', color: 'text-green-400', bgColor: 'bg-green-500/20', icon: CheckCircle },
  { value: 'partially_compliant', label: 'Partially Compliant', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', icon: AlertTriangle },
  { value: 'non_compliant', label: 'Non-Compliant', color: 'text-red-400', bgColor: 'bg-red-500/20', icon: XCircle },
  { value: 'not_applicable', label: 'Not Applicable', color: 'text-slate-500', bgColor: 'bg-slate-600/20', icon: X },
];

const EVIDENCE_TYPES = [
  { value: 'policy', label: 'Policy' },
  { value: 'procedure', label: 'Procedure' },
  { value: 'configuration', label: 'Configuration' },
  { value: 'log', label: 'Log' },
  { value: 'report', label: 'Report' },
  { value: 'contract', label: 'Contract' },
];

const PRIORITY_OPTIONS = [
  { value: 'critical', label: 'Critical', color: 'text-red-400' },
  { value: 'high', label: 'High', color: 'text-orange-400' },
  { value: 'medium', label: 'Medium', color: 'text-yellow-400' },
  { value: 'low', label: 'Low', color: 'text-green-400' },
];

const getStatusStyle = (status: string) => {
  return COMPLIANCE_STATUSES.find(s => s.value === status) || COMPLIANCE_STATUSES[0];
};

export default function AssessmentPage() {
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<number | null>(null);
  const [isNewAssessmentModalOpen, setIsNewAssessmentModalOpen] = useState(false);
  const [isStatusModalOpen, setIsStatusModalOpen] = useState(false);
  const [isEvidenceModalOpen, setIsEvidenceModalOpen] = useState(false);
  const [isRemediationModalOpen, setIsRemediationModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<AssessmentItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  
  const [newAssessmentForm, setNewAssessmentForm] = useState({
    uploaded_framework_id: 0,
    name: '',
    description: '',
    target_completion_date: '',
  });
  
  const [statusUpdateForm, setStatusUpdateForm] = useState({
    compliance_status: 'not_assessed',
    assessment_notes: '',
    gap_description: '',
  });
  
  const [evidenceForm, setEvidenceForm] = useState({
    evidence_type: 'policy',
    description: '',
    file: null as File | null,
  });
  
  const [remediationForm, setRemediationForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    due_date: '',
    owner_id: undefined as number | undefined,
    estimated_effort: '',
  });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: frameworksData } = useQuery({
    queryKey: ['uploaded-frameworks-parsed'],
    queryFn: async () => {
      const response = await frameworkUploadApi.listFrameworks({ status: 'parsed' });
      return response.data;
    },
  });

  const { data: assessmentsData, isLoading: assessmentsLoading } = useQuery({
    queryKey: ['assessments'],
    queryFn: async () => {
      const response = await frameworkUploadApi.getAssessments({});
      return response.data;
    },
  });

  const { data: assessmentDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['assessment', selectedAssessmentId],
    queryFn: async () => {
      if (!selectedAssessmentId) return null;
      const response = await frameworkUploadApi.getAssessment(selectedAssessmentId);
      return response.data;
    },
    enabled: !!selectedAssessmentId,
  });

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['assessment-dashboard', selectedAssessmentId],
    queryFn: async () => {
      if (!selectedAssessmentId) return null;
      const response = await frameworkUploadApi.getAssessmentDashboard(selectedAssessmentId);
      return response.data as AssessmentDashboard;
    },
    enabled: !!selectedAssessmentId,
  });

  const createAssessmentMutation = useMutation({
    mutationFn: (data: { uploaded_framework_id: number; name: string; description?: string; target_completion_date?: string }) =>
      frameworkUploadApi.createAssessment(data),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['assessments'] });
      setSelectedAssessmentId(response.data.id);
      setIsNewAssessmentModalOpen(false);
      setNewAssessmentForm({ uploaded_framework_id: 0, name: '', description: '', target_completion_date: '' });
    },
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      frameworkUploadApi.updateAssessmentItem(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment', selectedAssessmentId] });
      queryClient.invalidateQueries({ queryKey: ['assessment-dashboard', selectedAssessmentId] });
      setIsStatusModalOpen(false);
      setSelectedItem(null);
    },
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: async ({ itemId, formData }: { itemId: number; formData: FormData }) => {
      return frameworkUploadApi.uploadEvidence(itemId, formData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment', selectedAssessmentId] });
      setIsEvidenceModalOpen(false);
      setSelectedItem(null);
      setEvidenceForm({ evidence_type: 'policy', description: '', file: null });
    },
  });

  const createRemediationMutation = useMutation({
    mutationFn: ({ itemId, data }: { itemId: number; data: { title: string; description?: string; priority?: string; due_date?: string; owner_id?: number; estimated_effort?: string } }) =>
      frameworkUploadApi.createRemediation(itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment', selectedAssessmentId] });
      queryClient.invalidateQueries({ queryKey: ['assessment-dashboard', selectedAssessmentId] });
      setIsRemediationModalOpen(false);
      setSelectedItem(null);
      setRemediationForm({ title: '', description: '', priority: 'medium', due_date: '', owner_id: undefined, estimated_effort: '' });
    },
  });

  const frameworks = (frameworksData?.items || []) as UploadedFramework[];
  const assessments = (assessmentsData?.items || []) as Assessment[];
  const items = (assessmentDetail?.items || []) as AssessmentItem[];

  const domains = useMemo(() => {
    const domainSet = new Set<string>();
    items.forEach((item: AssessmentItem) => {
      if (item.control_domain) domainSet.add(item.control_domain);
    });
    return Array.from(domainSet).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item: AssessmentItem) => {
      const matchesStatus = statusFilter === 'all' || item.compliance_status === statusFilter;
      const matchesDomain = domainFilter === 'all' || item.control_domain === domainFilter;
      const matchesSearch = !searchTerm || 
        item.control_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.control_title?.toLowerCase().includes(searchTerm.toLowerCase());
      return matchesStatus && matchesDomain && matchesSearch;
    });
  }, [items, statusFilter, domainFilter, searchTerm]);

  const handleOpenStatusModal = (item: AssessmentItem) => {
    setSelectedItem(item);
    setStatusUpdateForm({
      compliance_status: item.compliance_status || 'not_assessed',
      assessment_notes: item.assessment_notes || '',
      gap_description: item.gap_description || '',
    });
    setIsStatusModalOpen(true);
  };

  const handleOpenEvidenceModal = (item: AssessmentItem) => {
    setSelectedItem(item);
    setEvidenceForm({ evidence_type: 'policy', description: '', file: null });
    setIsEvidenceModalOpen(true);
  };

  const handleOpenRemediationModal = (item: AssessmentItem) => {
    setSelectedItem(item);
    setRemediationForm({ title: '', description: '', priority: 'medium', due_date: '', owner_id: undefined, estimated_effort: '' });
    setIsRemediationModalOpen(true);
  };

  const handleStatusUpdate = () => {
    if (!selectedItem) return;
    updateItemMutation.mutate({
      id: selectedItem.id,
      data: statusUpdateForm,
    });
  };

  const handleEvidenceUpload = () => {
    if (!selectedItem || !evidenceForm.file) return;
    const formData = new FormData();
    formData.append('file', evidenceForm.file);
    formData.append('evidence_type', evidenceForm.evidence_type);
    if (evidenceForm.description) formData.append('description', evidenceForm.description);
    uploadEvidenceMutation.mutate({ itemId: selectedItem.id, formData });
  };

  const handleRemediationCreate = () => {
    if (!selectedItem || !remediationForm.title.trim()) return;
    createRemediationMutation.mutate({
      itemId: selectedItem.id,
      data: {
        title: remediationForm.title,
        description: remediationForm.description || undefined,
        priority: remediationForm.priority,
        due_date: remediationForm.due_date || undefined,
        owner_id: remediationForm.owner_id,
        estimated_effort: remediationForm.estimated_effort || undefined,
      },
    });
  };

  const handleCreateAssessment = () => {
    if (!newAssessmentForm.uploaded_framework_id || !newAssessmentForm.name.trim()) return;
    createAssessmentMutation.mutate({
      uploaded_framework_id: newAssessmentForm.uploaded_framework_id,
      name: newAssessmentForm.name,
      description: newAssessmentForm.description || undefined,
      target_completion_date: newAssessmentForm.target_completion_date || undefined,
    });
  };

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      setEvidenceForm(prev => ({ ...prev, file }));
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setEvidenceForm(prev => ({ ...prev, file }));
    }
  };

  const complianceScore = dashboard?.overall_compliance_score ?? 0;
  const progressPercentage = dashboard?.progress_percentage ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-4">
          <div className="relative">
            <select
              value={selectedAssessmentId ?? ''}
              onChange={(e) => setSelectedAssessmentId(e.target.value ? Number(e.target.value) : null)}
              className="w-64 appearance-none rounded-lg border border-slate-300 bg-slate-200 py-2 pl-3 pr-10 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="">Select an assessment...</option>
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {assessment.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
          {assessmentsLoading && <Loader2 className="h-5 w-5 animate-spin text-primary-500" />}
        </div>
        <button
          onClick={() => setIsNewAssessmentModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          New Assessment
        </button>
      </div>

      {selectedAssessmentId && dashboard && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-200 p-2">
                  <BarChart3 className="h-5 w-5 text-slate-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Total Controls</p>
                  <p className="text-2xl font-bold text-slate-800">{dashboard.total_items}</p>
                </div>
              </div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-green-500/20 p-2">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Compliant</p>
                  <p className="text-2xl font-bold text-green-400">{dashboard.compliance_breakdown.compliant}</p>
                </div>
              </div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-yellow-500/20 p-2">
                  <AlertTriangle className="h-5 w-5 text-yellow-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Partial</p>
                  <p className="text-2xl font-bold text-yellow-400">{dashboard.compliance_breakdown.partially_compliant}</p>
                </div>
              </div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-red-500/20 p-2">
                  <XCircle className="h-5 w-5 text-red-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Non-Compliant</p>
                  <p className="text-2xl font-bold text-red-400">{dashboard.compliance_breakdown.non_compliant}</p>
                </div>
              </div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-slate-500/20 p-2">
                  <HelpCircle className="h-5 w-5 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Not Assessed</p>
                  <p className="text-2xl font-bold text-slate-400">{dashboard.compliance_breakdown.not_assessed}</p>
                </div>
              </div>
            </div>
            
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-500/20 p-2">
                  <BarChart3 className="h-5 w-5 text-primary-400" />
                </div>
                <div>
                  <p className="text-sm text-slate-400">Compliance Score</p>
                  <p className="text-2xl font-bold text-primary-400">{complianceScore?.toFixed(1) || 0}%</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">Assessment Progress</span>
              <span className="text-sm text-slate-400">{progressPercentage.toFixed(1)}% Complete</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-gradient-to-r from-primary-600 to-primary-400 transition-all duration-500"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>{dashboard.assessed_items} of {dashboard.total_items} controls assessed</span>
              <span>{dashboard.gap_count} gaps identified</span>
            </div>
          </div>
        </>
      )}

      {selectedAssessmentId && (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search controls..."
                className="w-full rounded-lg border border-slate-300 bg-slate-200 py-2 pl-10 pr-4 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-400" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              >
                <option value="all">All Statuses</option>
                {COMPLIANCE_STATUSES.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
            
            <select
              value={domainFilter}
              onChange={(e) => setDomainFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              <option value="all">All Domains</option>
              {domains.map((domain) => (
                <option key={domain} value={domain}>{domain}</option>
              ))}
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Control</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Domain</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Owner</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Gap</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-400">Evidence</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-400">Remediation</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {detailLoading ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center">
                        <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-500" />
                      </td>
                    </tr>
                  ) : filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                        No controls found matching your filters
                      </td>
                    </tr>
                  ) : (
                    filteredItems.map((item: AssessmentItem) => {
                      const statusStyle = getStatusStyle(item.compliance_status);
                      const StatusIcon = statusStyle.icon;
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="max-w-xs">
                              <p className="truncate font-medium text-slate-800">{item.control_id || `Control ${item.parsed_control_id}`}</p>
                              <p className="truncate text-sm text-slate-400">{item.control_title || 'Untitled'}</p>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-slate-600">{item.control_domain || '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                              <StatusIcon className="h-3.5 w-3.5" />
                              {statusStyle.label}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-sm text-slate-600">{item.owner_name || '-'}</span>
                          </td>
                          <td className="px-4 py-3">
                            <p className="max-w-xs truncate text-sm text-slate-400">{item.gap_description || '-'}</p>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${item.evidence_count > 0 ? 'bg-green-500/20 text-green-400' : 'bg-slate-600/50 text-slate-400'}`}>
                              {item.evidence_count}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${item.remediation_count > 0 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-600/50 text-slate-400'}`}>
                              {item.remediation_count}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenStatusModal(item)}
                                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-600 hover:text-slate-900"
                                title="Update Status"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleOpenEvidenceModal(item)}
                                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-600 hover:text-slate-900"
                                title="Upload Evidence"
                              >
                                <Upload className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleOpenRemediationModal(item)}
                                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-600 hover:text-slate-900"
                                title="Add Remediation"
                              >
                                <Wrench className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!selectedAssessmentId && !assessmentsLoading && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16">
          <FileText className="mb-4 h-16 w-16 text-slate-600" />
          <h3 className="mb-2 text-lg font-medium text-slate-800">No Assessment Selected</h3>
          <p className="mb-4 text-slate-400">Select an existing assessment or create a new one to get started</p>
          <button
            onClick={() => setIsNewAssessmentModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Create New Assessment
          </button>
        </div>
      )}

      {isNewAssessmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h2 className="text-lg font-semibold text-slate-800">New Assessment</h2>
              <button
                onClick={() => setIsNewAssessmentModalOpen(false)}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Framework <span className="text-red-400">*</span>
                </label>
                <select
                  value={newAssessmentForm.uploaded_framework_id || ''}
                  onChange={(e) => setNewAssessmentForm({ ...newAssessmentForm, uploaded_framework_id: Number(e.target.value) })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  <option value="">Select a framework...</option>
                  {frameworks.filter((f: UploadedFramework) => f.upload_status === 'parsed' && f.parsed_controls_count > 0).map((f: UploadedFramework) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.parsed_controls_count} controls)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Assessment Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={newAssessmentForm.name}
                  onChange={(e) => setNewAssessmentForm({ ...newAssessmentForm, name: e.target.value })}
                  placeholder="e.g., Q1 2026 SOC 2 Assessment"
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  value={newAssessmentForm.description}
                  onChange={(e) => setNewAssessmentForm({ ...newAssessmentForm, description: e.target.value })}
                  placeholder="Brief description of the assessment scope and objectives"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Target Completion Date</label>
                <input
                  type="date"
                  value={newAssessmentForm.target_completion_date}
                  onChange={(e) => setNewAssessmentForm({ ...newAssessmentForm, target_completion_date: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
              <button
                onClick={() => setIsNewAssessmentModalOpen(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateAssessment}
                disabled={!newAssessmentForm.uploaded_framework_id || !newAssessmentForm.name.trim() || createAssessmentMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createAssessmentMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Assessment
              </button>
            </div>
          </div>
        </div>
      )}

      {isStatusModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Update Compliance Status</h2>
                <p className="text-sm text-slate-400">{selectedItem.control_id || `Control ${selectedItem.parsed_control_id}`}</p>
              </div>
              <button
                onClick={() => { setIsStatusModalOpen(false); setSelectedItem(null); }}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Compliance Status</label>
                <select
                  value={statusUpdateForm.compliance_status}
                  onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, compliance_status: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {COMPLIANCE_STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Assessment Notes</label>
                <textarea
                  value={statusUpdateForm.assessment_notes}
                  onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, assessment_notes: e.target.value })}
                  placeholder="Notes about the assessment findings..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Gap Description</label>
                <textarea
                  value={statusUpdateForm.gap_description}
                  onChange={(e) => setStatusUpdateForm({ ...statusUpdateForm, gap_description: e.target.value })}
                  placeholder="Describe any gaps or deficiencies identified..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
              <button
                onClick={() => { setIsStatusModalOpen(false); setSelectedItem(null); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleStatusUpdate}
                disabled={updateItemMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {updateItemMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Update Status
              </button>
            </div>
          </div>
        </div>
      )}

      {isEvidenceModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Upload Evidence</h2>
                <p className="text-sm text-slate-400">{selectedItem.control_id || `Control ${selectedItem.parsed_control_id}`}</p>
              </div>
              <button
                onClick={() => { setIsEvidenceModalOpen(false); setSelectedItem(null); }}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleFileDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                  evidenceForm.file
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {evidenceForm.file ? (
                  <>
                    <FileText className="mb-2 h-10 w-10 text-green-400" />
                    <p className="text-center text-slate-800">{evidenceForm.file.name}</p>
                    <button
                      onClick={(e) => { e.stopPropagation(); setEvidenceForm(prev => ({ ...prev, file: null })); }}
                      className="mt-2 text-sm text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </>
                ) : (
                  <>
                    <Upload className="mb-2 h-10 w-10 text-slate-400" />
                    <p className="text-center text-slate-800">Drag and drop a file here, or click to browse</p>
                    <p className="mt-1 text-sm text-slate-400">PDF, DOCX, images, or other documents</p>
                  </>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Evidence Type</label>
                <select
                  value={evidenceForm.evidence_type}
                  onChange={(e) => setEvidenceForm({ ...evidenceForm, evidence_type: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {EVIDENCE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  value={evidenceForm.description}
                  onChange={(e) => setEvidenceForm({ ...evidenceForm, description: e.target.value })}
                  placeholder="Brief description of the evidence..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
              <button
                onClick={() => { setIsEvidenceModalOpen(false); setSelectedItem(null); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleEvidenceUpload}
                disabled={!evidenceForm.file || uploadEvidenceMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadEvidenceMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Upload Evidence
              </button>
            </div>
          </div>
        </div>
      )}

      {isRemediationModalOpen && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Add Remediation</h2>
                <p className="text-sm text-slate-400">{selectedItem.control_id || `Control ${selectedItem.parsed_control_id}`}</p>
              </div>
              <button
                onClick={() => { setIsRemediationModalOpen(false); setSelectedItem(null); }}
                className="rounded p-1 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">
                  Title <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={remediationForm.title}
                  onChange={(e) => setRemediationForm({ ...remediationForm, title: e.target.value })}
                  placeholder="e.g., Implement access control policy"
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  value={remediationForm.description}
                  onChange={(e) => setRemediationForm({ ...remediationForm, description: e.target.value })}
                  placeholder="Detailed description of the remediation action..."
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">Priority</label>
                  <select
                    value={remediationForm.priority}
                    onChange={(e) => setRemediationForm({ ...remediationForm, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  >
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority.value} value={priority.value}>{priority.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-600">Due Date</label>
                  <input
                    type="date"
                    value={remediationForm.due_date}
                    onChange={(e) => setRemediationForm({ ...remediationForm, due_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-600">Estimated Effort</label>
                <input
                  type="text"
                  value={remediationForm.estimated_effort}
                  onChange={(e) => setRemediationForm({ ...remediationForm, estimated_effort: e.target.value })}
                  placeholder="e.g., 2 weeks, 40 hours"
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 p-4">
              <button
                onClick={() => { setIsRemediationModalOpen(false); setSelectedItem(null); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 transition-colors hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleRemediationCreate}
                disabled={!remediationForm.title.trim() || createRemediationMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {createRemediationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Create Remediation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
