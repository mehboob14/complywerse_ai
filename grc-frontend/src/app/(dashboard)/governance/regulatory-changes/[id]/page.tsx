'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, governanceApi, regulatoryApi } from '@/lib/api';
import { RightSlidePanel, PageLoader } from '@/components/ui';
import {
  FileWarning,
  Loader2,
  ArrowLeft,
  AlertCircle,
  Clock,
  CheckCircle,
  AlertTriangle,
  FileText,
  Building2,
  Calendar,
  Plus,
  Trash2,
  Sparkles,
  ClipboardList,
  Target,
  BarChart3,
  Edit,
  Lock,
  User,
  Search,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ui/ToastProvider';

interface RegulatoryChange {
  id: number;
  title: string;
  description?: string;
  source: string;
  regulatory_body?: string;
  reference_number?: string;
  effective_date?: string;
  publication_date?: string;
  status: string;
  priority: string;
  impact_summary?: string;
  gap_count?: number;
  created_at: string;
  updated_at?: string;
}

interface Assessment {
  id: number;
  change_id: number;
  assessment_type?: string;
  impacted_item_id?: number | null;
  impacted_item_type?: string | null;
  impacted_item_name?: string | null;
  assessor_id?: number;
  assessor_name?: string;
  impact_level: string;
  impact_description?: string;
  affected_areas?: string;
  gap_identified?: boolean;
  gap_description?: string;
  compliance_gaps?: string;
  recommendations?: string;
  assessment_date: string;
  status: string;
}

interface Task {
  id: number;
  change_id: number;
  title: string;
  description?: string;
  task_type: string;
  status: string;
  priority?: string;
  assigned_to?: number;
  assignee_name?: string;
  assignee_department?: string;
  creator_name?: string;
  due_date?: string;
  completed_at?: string;
  created_at: string;
}

interface GapAnalysis {
  id: number;
  gap_type: string;
  item_name?: string;
  item_id?: number | null;
  description: string;
  current_state?: string;
  required_state?: string;
  severity: string;
  remediation_plan?: string;
  status: string;
  assigned_to?: number | null;
  assignee_name?: string | null;
}

interface IncompleteTask {
  id: number;
  title: string;
  status: string;
  assignee?: string;
}

interface ClosureReadiness {
  ready_to_close: boolean;
  completed_tasks: number;
  total_tasks: number;
  incomplete_tasks?: IncompleteTask[];
}

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'assessments', label: 'Impact Assessments', icon: Target },
  { id: 'tasks', label: 'Implementation Tasks', icon: ClipboardList },
  { id: 'gaps', label: 'Gap Analysis', icon: BarChart3 },
];

const STATUS_OPTIONS = [
  { value: 'identified', label: 'Identified' },
  { value: 'under_assessment', label: 'Under Assessment' },
  { value: 'implementation', label: 'Implementation' },
  { value: 'completed', label: 'Completed' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

const TASK_TYPE_OPTIONS = [
  { value: 'policy_update', label: 'Policy Update' },
  { value: 'control_update', label: 'Control Update' },
  { value: 'process_change', label: 'Process Change' },
  { value: 'training', label: 'Training' },
  { value: 'communication', label: 'Communication' },
];

const TASK_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'blocked', label: 'Blocked' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  identified: { bg: 'bg-teal-50', text: 'text-teal-700', icon: FileText },
  under_assessment: { bg: 'bg-amber-50', text: 'text-amber-700', icon: Clock },
  implementation: { bg: 'bg-violet-50', text: 'text-violet-700', icon: AlertCircle },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: CheckCircle },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-600', icon: FileText },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700' },
  low: { bg: 'bg-teal-50', text: 'text-teal-700' },
};

const TASK_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-600' },
  in_progress: { bg: 'bg-amber-50', text: 'text-amber-700' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  blocked: { bg: 'bg-rose-50', text: 'text-rose-700' },
};

const TASK_TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  policy_update: { bg: 'bg-teal-50', text: 'text-teal-700', icon: FileText },
  control_update: { bg: 'bg-violet-50', text: 'text-violet-700', icon: Target },
  process_change: { bg: 'bg-cyan-50', text: 'text-cyan-700', icon: ClipboardList },
  training: { bg: 'bg-emerald-50', text: 'text-emerald-700', icon: Building2 },
  communication: { bg: 'bg-amber-50', text: 'text-amber-700', icon: FileText },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.identified;
}

function getPriorityStyle(priority: string) {
  return PRIORITY_STYLES[priority?.toLowerCase()] || PRIORITY_STYLES.medium;
}

function getTaskStatusStyle(status: string) {
  return TASK_STATUS_STYLES[status] || TASK_STATUS_STYLES.pending;
}

function getTaskTypeStyle(type: string) {
  return TASK_TYPE_STYLES[type] || TASK_TYPE_STYLES.policy_update;
}

export default function RegulatoryChangeDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const changeId = Number(params.id);

  const [activeTab, setActiveTab] = useState('overview');
  const [showAssessmentModal, setShowAssessmentModal] = useState(false);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [closureReadiness, setClosureReadiness] = useState<ClosureReadiness | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);

  const [showGapModal, setShowGapModal] = useState(false);
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<number[]>([]);
  const [includeAllControls, setIncludeAllControls] = useState(true);
  const [docSearch, setDocSearch] = useState('');
  const [gapSummary, setGapSummary] = useState<string>('');

  const [assessmentForm, setAssessmentForm] = useState({
    impact_level: 'medium',
    affected_areas: '',
    compliance_gaps: '',
    recommendations: '',
  });

  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    task_type: 'policy_update',
    priority: 'medium',
    due_date: '',
    assigned_to: null as number | null,
    impact_assessment_id: null as number | null,
    linked_policy_id: null as number | null,
    linked_control_id: null as number | null,
  });

  const { data: change, isLoading, error } = useQuery({
    queryKey: ['regulatory-change', changeId],
    queryFn: async () => {
      const response = await regulatoryApi.getChange(changeId);
      return response.data as RegulatoryChange;
    },
  });

  const { data: assessments, isLoading: assessmentsLoading, error: assessmentsError } = useQuery({
    queryKey: ['regulatory-assessments', changeId],
    queryFn: async () => {
      const response = await regulatoryApi.getAssessments(changeId);
      return response.data as Assessment[];
    },
    enabled: activeTab === 'assessments' || activeTab === 'overview',
  });

  const { data: tasks, isLoading: tasksLoading, error: tasksError } = useQuery({
    queryKey: ['regulatory-tasks', changeId],
    queryFn: async () => {
      const response = await regulatoryApi.getTasks(changeId);
      return response.data as Task[];
    },
    enabled: activeTab === 'tasks' || activeTab === 'overview',
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => {
      const response = await adminApi.getUsers();
      return (response.data || []) as Array<{ id: number; display_name: string; department?: string | null }>;
    },
    enabled: showTaskModal,
  });

  const { data: documents = [], isLoading: documentsLoading } = useQuery({
    queryKey: ['governance-docs-for-reg-gap'],
    queryFn: async () => {
      type DocRow = { id: number; title: string; status?: string; doc_type?: string };
      const normalize = (payload: unknown): DocRow[] => {
        if (Array.isArray(payload)) return payload as DocRow[];
        if (payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown }).items)) {
          return (payload as { items: DocRow[] }).items;
        }
        return [];
      };

      const response = await governanceApi.getDocuments({
        doc_type: 'policy',
        status: 'approved',
        limit: 200,
      });
      const byId = new Map(normalize(response.data).map((d) => [d.id, d]));

      try {
        const published = await governanceApi.getDocuments({
          doc_type: 'policy',
          status: 'published',
          limit: 200,
        });
        for (const d of normalize(published.data)) byId.set(d.id, d);
      } catch {
        /* approved list is enough */
      }

      // If neither status returned rows, fall back to unfiltered policies.
      if (byId.size === 0) {
        try {
          const anyPolicies = await governanceApi.getDocuments({
            doc_type: 'policy',
            limit: 200,
          });
          for (const d of normalize(anyPolicies.data)) byId.set(d.id, d);
        } catch {
          /* leave empty */
        }
      }

      return Array.from(byId.values()).sort((a, b) =>
        (a.title || '').localeCompare(b.title || ''),
      );
    },
    enabled: showGapModal,
  });

  const selectedTaskAssignee = users.find((u) => u.id === taskForm.assigned_to);

  const emptyTaskForm = {
    title: '',
    description: '',
    task_type: 'policy_update',
    priority: 'medium',
    due_date: '',
    assigned_to: null as number | null,
    impact_assessment_id: null as number | null,
    linked_policy_id: null as number | null,
    linked_control_id: null as number | null,
  };

  const openTaskFromAssessment = (assessment: Assessment) => {
    const itemName =
      assessment.impacted_item_name ||
      assessment.affected_areas ||
      `${assessment.impacted_item_type || assessment.assessment_type || 'item'} #${assessment.id}`;
    const gapText =
      (assessment.gap_description && !/^action needed:/i.test(assessment.gap_description)
        ? assessment.gap_description
        : null) ||
      assessment.compliance_gaps ||
      assessment.impact_description ||
      assessment.affected_areas ||
      '';
    const itemType = (assessment.impacted_item_type || assessment.assessment_type || '').toLowerCase();
    const taskType =
      itemType === 'control' ? 'control_update' :
      itemType === 'policy' ? 'policy_update' :
      'process_change';

    setTaskForm({
      title: `Remediate: ${itemName}`.slice(0, 200),
      description: gapText && !/^action needed:/i.test(gapText) ? gapText : `Review and update ${itemName}`,
      task_type: taskType,
      priority: (assessment.impact_level || 'medium').toLowerCase(),
      due_date: '',
      assigned_to: null,
      impact_assessment_id: assessment.id,
      linked_policy_id: itemType === 'policy' ? assessment.impacted_item_id ?? null : null,
      linked_control_id: itemType === 'control' ? assessment.impacted_item_id ?? null : null,
    });
    setShowTaskModal(true);
  };

  const openTaskFromGap = (gap: GapAnalysis) => {
    const itemType = (gap.gap_type || '').toLowerCase();
    const taskType =
      itemType === 'control' ? 'control_update' :
      itemType === 'policy' ? 'policy_update' :
      'process_change';
    setTaskForm({
      title: `Close gap: ${gap.item_name || gap.gap_type}`.slice(0, 200),
      description: gap.remediation_plan || gap.description || '',
      task_type: taskType,
      priority: (gap.severity || 'medium').toLowerCase(),
      due_date: '',
      assigned_to: gap.assigned_to ?? null,
      impact_assessment_id: typeof gap.id === 'number' ? gap.id : null,
      linked_policy_id: itemType === 'policy' ? gap.item_id ?? null : null,
      linked_control_id: itemType === 'control' ? gap.item_id ?? null : null,
    });
    setShowTaskModal(true);
  };

  const mapGapPayload = (payload: unknown): GapAnalysis[] => {
    const data = payload as
      | GapAnalysis[]
      | {
          analysis_summary?: string;
          identified_gaps?: Array<{
            id?: number;
            area?: string;
            item_name?: string;
            item_id?: number | null;
            description?: string;
            severity?: string;
            current_state?: string;
            required_state?: string;
            remediation_plan?: string;
            status?: string;
            assigned_to?: number | null;
            assignee_name?: string | null;
          }>;
        };

    if (Array.isArray(data)) return data;
    if (data?.analysis_summary) setGapSummary(data.analysis_summary);
    const identifiedGaps = Array.isArray(data?.identified_gaps) ? data.identified_gaps : [];
    return identifiedGaps.map((gap, index) => ({
      id: gap.id ?? index + 1,
      gap_type: gap.area || 'process',
      item_name: gap.item_name,
      item_id: gap.item_id,
      description: gap.description || 'No description provided',
      current_state: gap.current_state,
      required_state: gap.required_state,
      severity: (gap.severity || 'medium').toLowerCase(),
      remediation_plan: gap.remediation_plan,
      status: gap.status || 'identified',
      assigned_to: gap.assigned_to,
      assignee_name: gap.assignee_name,
    }));
  };

  const { data: gaps, isLoading: gapsLoading, error: gapsError } = useQuery({
    queryKey: ['regulatory-gaps', changeId],
    queryFn: async () => {
      const response = await regulatoryApi.getGapAnalysis(changeId);
      return mapGapPayload(response.data);
    },
    enabled: activeTab === 'gaps',
  });

  const runGapMutation = useMutation({
    mutationFn: async () => {
      const response = await regulatoryApi.runGapAnalysis(changeId, {
        document_ids: selectedDocumentIds,
        include_all_controls: includeAllControls,
        assigned_to: null,
      });
      return response.data;
    },
    onSuccess: (data) => {
      const mapped = mapGapPayload(data);
      queryClient.setQueryData(['regulatory-gaps', changeId], mapped);
      queryClient.invalidateQueries({ queryKey: ['regulatory-tasks', changeId] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-assessments', changeId] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      setShowGapModal(false);
      const created = (data as { tasks_created?: number })?.tasks_created || 0;
      toast({
        title: 'Gap analysis complete',
        message: created
          ? `Found ${mapped.length} gap(s). Created ${created} assigned task(s).`
          : `Found ${mapped.length} gap(s).`,
        type: 'success',
      });
    },
    onError: () => {
      toast({
        title: 'Gap analysis failed',
        message: 'Could not run gap analysis. Please try again.',
        type: 'error',
      });
    },
  });

  const visibleDocuments = (() => {
    const list = Array.isArray(documents) ? documents : [];
    const term = docSearch.trim().toLowerCase();
    if (!term) return list;
    return list.filter((d) => (d.title || '').toLowerCase().includes(term));
  })();

  const allVisibleSelected =
    visibleDocuments.length > 0 &&
    visibleDocuments.every((d) => selectedDocumentIds.includes(d.id));

  const toggleDocument = (id: number) => {
    setSelectedDocumentIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleVisibleDocuments = () => {
    const visibleIds = visibleDocuments.map((d) => d.id);
    if (allVisibleSelected) {
      setSelectedDocumentIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedDocumentIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };
  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => regulatoryApi.updateChange(changeId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] });
      setShowStatusModal(false);
    },
  });

  const createAssessmentMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => regulatoryApi.createAssessment(changeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-assessments', changeId] });
      setShowAssessmentModal(false);
      setAssessmentForm({
        impact_level: 'medium',
        affected_areas: '',
        compliance_gaps: '',
        recommendations: '',
      });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => {
      const payload: Record<string, unknown> = {
        title: data.title,
        description: data.description || null,
        task_type: data.task_type,
        priority: data.priority,
        assigned_to: data.assigned_to || null,
        due_date: data.due_date || null,
        impact_assessment_id: data.impact_assessment_id || null,
        linked_policy_id: data.linked_policy_id || null,
        linked_control_id: data.linked_control_id || null,
      };
      return regulatoryApi.createTask(changeId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-tasks', changeId] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      setShowTaskModal(false);
      setTaskForm(emptyTaskForm);
      toast({
        title: 'Task created',
        message: 'Implementation task added successfully',
        type: 'success',
      });
    },
    onError: () => {
      toast({
        title: 'Failed to create task',
        message: 'Could not create the implementation task. Please try again.',
        type: 'error',
      });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: Record<string, unknown> }) => 
      regulatoryApi.updateTask(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-tasks', changeId] });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: number) => regulatoryApi.deleteTask(taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-tasks', changeId] });
    },
  });

  const checkClosureReadiness = async () => {
    setCheckingReadiness(true);
    try {
      const response = await regulatoryApi.getClosureReadiness(changeId);
      setClosureReadiness(response.data as ClosureReadiness);
    } catch (error) {
      toast({
        title: 'Error',
        message: 'Failed to check closure readiness',
        type: 'error',
      });
    } finally {
      setCheckingReadiness(false);
    }
  };

  const closeChangeMutation = useMutation({
    mutationFn: () => regulatoryApi.closeChange(changeId),
    onSuccess: () => {
      toast({
        title: 'Success',
        message: 'Regulatory change has been closed successfully',
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-changes'] });
      setClosureReadiness(null);
    },
    onError: () => {
      toast({
        title: 'Error',
        message: 'Failed to close regulatory change',
        type: 'error',
      });
    },
  });

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error || !change) {
    return (
      <div className="rounded-xl border border-rose-300 bg-white p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-rose-600" />
        <p className="mt-2 text-rose-700">Failed to load regulatory change details</p>
        <Link href="/governance/regulatory-changes" className="mt-4 inline-flex items-center gap-2 text-primary-600 hover:text-primary-700">
          <ArrowLeft size={16} />
          Back to Regulatory Changes
        </Link>
      </div>
    );
  }

  const statusStyle = getStatusStyle(change.status);
  const priorityStyle = getPriorityStyle(change.priority);
  const StatusIcon = statusStyle.icon;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/governance/regulatory-changes" className="text-slate-500 hover:text-slate-900 transition-colors">
          <ArrowLeft size={20} strokeWidth={1.75} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">{change.title}</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              <StatusIcon className="h-3 w-3" />
              {change.status.replace(/_/g, ' ')}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
              {change.priority}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
            <span className="flex items-center gap-1.5">
              <Building2 className="h-4 w-4" />
              {change.source}
            </span>
            {change.reference_number && (
              <span className="font-mono">{change.reference_number}</span>
            )}
          </div>
        </div>
        <button onClick={() => setShowStatusModal(true)} className="btn-secondary">
          Update Status
        </button>
      </div>

      <div className="border-b border-slate-300">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-500 hover:text-slate-900'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-slate-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Description</h2>
              <p className="text-slate-700 whitespace-pre-wrap">
                {change.description || 'No description provided.'}
              </p>
            </div>

            {change.impact_summary && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
                <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-700" />
                  Impact Summary
                </h2>
                <p className="text-slate-700 whitespace-pre-wrap">{change.impact_summary}</p>
              </div>
            )}

            <div className="rounded-xl border border-slate-300 bg-white p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-slate-900">Recent Assessments</h2>
                <button 
                  onClick={() => { setActiveTab('assessments'); setShowAssessmentModal(true); }}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  View All
                </button>
              </div>
              {assessmentsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : assessmentsError ? (
                <p className="text-rose-700 text-center py-8">Failed to load assessments</p>
              ) : (!assessments || assessments.length === 0) ? (
                <p className="text-slate-500 text-center py-8">No assessments yet</p>
              ) : (
                <div className="space-y-3">
                  {assessments.slice(0, 3).map((assessment) => (
                    <div key={assessment.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getPriorityStyle(assessment.impact_level).bg} ${getPriorityStyle(assessment.impact_level).text}`}>
                          {assessment.impact_level} impact
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(assessment.assessment_date).toLocaleDateString()}
                        </span>
                      </div>
                      {assessment.affected_areas && (
                        <p className="text-sm text-slate-700 line-clamp-2">{assessment.affected_areas}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Details</h2>
              <dl className="space-y-3">
                {change.regulatory_body && (
                  <div>
                    <dt className="text-sm text-slate-500">Regulatory Body</dt>
                    <dd className="text-slate-900">{change.regulatory_body}</dd>
                  </div>
                )}
                {change.publication_date && (
                  <div>
                    <dt className="text-sm text-slate-500">Publication Date</dt>
                    <dd className="text-slate-900 flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-500" />
                      {new Date(change.publication_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {change.effective_date && (
                  <div>
                    <dt className="text-sm text-slate-500">Effective Date</dt>
                    <dd className="text-slate-900 flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-500" />
                      {new Date(change.effective_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-slate-500">Gaps Identified</dt>
                  <dd className="text-slate-900 flex items-center gap-1.5">
                    {(change.gap_count || 0) > 0 ? (
                      <span className="text-rose-700 flex items-center gap-1">
                        <AlertTriangle size={14} />
                        {change.gap_count}
                      </span>
                    ) : (
                      <span className="text-slate-500">None</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-500">Created</dt>
                  <dd className="text-slate-900">{new Date(change.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Quick Actions</h2>
              <div className="space-y-2">
                <button 
                  onClick={() => setShowAssessmentModal(true)}
                  className="w-full flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  <Plus size={16} />
                  Add Assessment
                </button>
                <button 
                  onClick={() => {
                    setTaskForm(emptyTaskForm);
                    setShowTaskModal(true);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 transition-colors"
                >
                  <Plus size={16} />
                  Add Task
                </button>
                <button 
                  onClick={() => setActiveTab('gaps')}
                  className="w-full flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-2 text-sm text-teal-700 hover:bg-teal-100 transition-colors"
                >
                  <Sparkles size={16} />
                  View Gap Analysis
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-slate-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Lock size={18} />
                Closure
              </h2>
              <div className="space-y-4">
                <button 
                  onClick={checkClosureReadiness}
                  disabled={checkingReadiness || change.status === 'completed'}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-900 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {checkingReadiness ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ClipboardList size={16} />
                  )}
                  Check Closure Readiness
                </button>

                {closureReadiness && (
                  <div className="space-y-3">
                    <div className={`rounded-lg p-4 ${closureReadiness.ready_to_close ? 'bg-emerald-50 border border-emerald-300' : 'bg-amber-50 border border-amber-300'}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {closureReadiness.ready_to_close ? (
                          <CheckCircle className="h-5 w-5 text-emerald-700" />
                        ) : (
                          <AlertTriangle className="h-5 w-5 text-amber-700" />
                        )}
                        <span className={`font-medium ${closureReadiness.ready_to_close ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {closureReadiness.ready_to_close ? 'Ready to Close' : 'Not Ready'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700">
                        {closureReadiness.completed_tasks} / {closureReadiness.total_tasks} tasks completed
                      </p>
                    </div>

                    {!closureReadiness.ready_to_close && closureReadiness.incomplete_tasks && closureReadiness.incomplete_tasks.length > 0 && (
                      <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                        <h4 className="text-sm font-medium text-slate-700 mb-2">Incomplete Tasks</h4>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {closureReadiness.incomplete_tasks.map((task) => (
                            <div key={task.id} className="flex items-center justify-between text-sm border-b border-slate-200 pb-2 last:border-0 last:pb-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-slate-900 truncate">{task.title}</p>
                                {task.assignee && (
                                  <p className="text-xs text-slate-500 flex items-center gap-1">
                                    <User size={10} />
                                    {task.assignee}
                                  </p>
                                )}
                              </div>
                              <span className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs ${getTaskStatusStyle(task.status).bg} ${getTaskStatusStyle(task.status).text}`}>
                                {task.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <button 
                      onClick={() => closeChangeMutation.mutate()}
                      disabled={!closureReadiness.ready_to_close || closeChangeMutation.isPending}
                      className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed ${
                        closureReadiness.ready_to_close
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50'
                          : 'bg-slate-100 text-slate-400 opacity-70'
                      }`}
                    >
                      {closeChangeMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle size={16} />
                      )}
                      Close Regulatory Change
                    </button>
                  </div>
                )}

                {change.status === 'completed' && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-center">
                    <CheckCircle className="h-8 w-8 text-emerald-600 mx-auto mb-2" strokeWidth={1.75} />
                    <p className="text-sm text-emerald-700 font-medium">This change has been closed</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'assessments' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Impact Assessments</h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Review impacted policies and controls, then create implementation tasks directly.
              </p>
            </div>
            <button onClick={() => setShowAssessmentModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Assessment
            </button>
          </div>
          <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
            {assessmentsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : assessmentsError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4 text-rose-600" />
                <p className="text-lg font-medium text-slate-900 mb-2">Failed to load assessments</p>
                <p className="text-sm text-slate-500">There was an error loading the impact assessments</p>
              </div>
            ) : (!assessments || assessments.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <Target className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No assessments yet</p>
                <p className="text-sm">Add an impact assessment to evaluate this change</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Impact</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Gap</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Summary</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {assessments.map((assessment) => {
                      const itemType = (assessment.impacted_item_type || assessment.assessment_type || 'process').toLowerCase();
                      const itemName =
                        assessment.impacted_item_name ||
                        (assessment.affected_areas && !assessment.affected_areas.toLowerCase().startsWith('control ')
                          ? assessment.affected_areas
                          : null) ||
                        `${itemType} #${assessment.id}`;
                      const summary =
                        (assessment.gap_description && !/^action needed:/i.test(assessment.gap_description)
                          ? assessment.gap_description
                          : null) ||
                        (assessment.compliance_gaps && !/^action needed:/i.test(assessment.compliance_gaps)
                          ? assessment.compliance_gaps
                          : null) ||
                        assessment.impact_description ||
                        assessment.affected_areas ||
                        'No details provided';
                      const hasGap = Boolean(assessment.gap_identified || assessment.gap_description || assessment.compliance_gaps);

                      return (
                        <tr key={assessment.id} className="align-top hover:bg-slate-50/80">
                          <td className="px-4 py-4">
                            <div className="text-sm font-medium text-slate-900 max-w-xs">{itemName}</div>
                            <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">{itemType}</div>
                          </td>
                          <td className="px-4 py-4">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPriorityStyle(assessment.impact_level).bg} ${getPriorityStyle(assessment.impact_level).text}`}>
                              {assessment.impact_level}
                            </span>
                          </td>
                          <td className="px-4 py-4">
                            {hasGap ? (
                              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-50 text-rose-700">
                                Gap
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-50 text-emerald-700">
                                Covered
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-4 max-w-md">
                            <p className="text-sm text-slate-800 line-clamp-3">{summary}</p>
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              type="button"
                              onClick={() => openTaskFromAssessment(assessment)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                            >
                              <ClipboardList className="h-3.5 w-3.5" />
                              Create Task
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-900">Implementation Tasks</h2>
            <button
              onClick={() => {
                setTaskForm(emptyTaskForm);
                setShowTaskModal(true);
              }}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={16} />
              Add Task
            </button>
          </div>
          <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
            {tasksLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : tasksError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4 text-rose-600" />
                <p className="text-lg font-medium text-slate-900 mb-2">Failed to load tasks</p>
                <p className="text-sm text-slate-500">There was an error loading the implementation tasks</p>
              </div>
            ) : (!tasks || tasks.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                <ClipboardList className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No tasks yet</p>
                <p className="text-sm">Add implementation tasks to track progress</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Task</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Assignee</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Department</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Owner</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tasks.map((task) => {
                    const typeStyle = getTaskTypeStyle(task.task_type);
                    const TypeIcon = typeStyle.icon;
                    const taskStatusStyle = getTaskStatusStyle(task.status);

                    return (
                      <tr key={task.id} className="hover:bg-slate-50">
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${typeStyle.bg}`}>
                              <TypeIcon className={`h-4 w-4 ${typeStyle.text}`} />
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{task.title}</p>
                              {task.description && (
                                <p className="text-sm text-slate-500 line-clamp-1">{task.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${typeStyle.bg} ${typeStyle.text}`}>
                            {task.task_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          {task.assignee_name || '-'}
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          {task.assignee_department || '-'}
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          {task.creator_name || '-'}
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${getPriorityStyle(task.priority || 'medium').bg} ${getPriorityStyle(task.priority || 'medium').text}`}>
                            {(task.priority || 'medium').toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={task.status}
                            onChange={(e) => updateTaskMutation.mutate({ taskId: task.id, data: { status: e.target.value } })}
                            className={`rounded-lg border-0 px-2 py-1 text-xs font-medium ${taskStatusStyle.bg} ${taskStatusStyle.text} focus:ring-1 focus:ring-primary-500`}
                          >
                            {TASK_STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4 text-sm text-slate-700">
                          {task.due_date ? new Date(task.due_date).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-4">
                          <button
                            onClick={() => deleteTaskMutation.mutate(task.id)}
                            disabled={deleteTaskMutation.isPending}
                            className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700 transition-colors disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'gaps' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Gap Analysis</h2>
              {gapSummary && (
                <p className="mt-1 text-sm text-slate-500 max-w-2xl">{gapSummary}</p>
              )}
            </div>
            <button
              onClick={() => {
                setShowGapModal(true);
                setDocSearch('');
              }}
              className="btn-primary flex items-center gap-2 self-start"
            >
              <Sparkles size={16} />
              Run Gap Analysis
            </button>
          </div>

          <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
            {gapsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : gapsError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4 text-rose-600" />
                <p className="text-lg font-medium text-slate-900 mb-2">Failed to load gap analysis</p>
                <p className="text-sm text-slate-500">There was an error loading the gap analysis data</p>
              </div>
            ) : (!gaps || gaps.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 px-6 text-center">
                <BarChart3 className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium text-slate-900">No gaps identified yet</p>
                <p className="text-sm mt-1 max-w-md">
                  Select governance documents to analyze against this regulatory change.
                  All controls are included by default. You can assign remediation to a user.
                </p>
                <button
                  onClick={() => setShowGapModal(true)}
                  className="btn-primary mt-5 flex items-center gap-2"
                >
                  <Sparkles size={16} />
                  Run Gap Analysis
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Item</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Gap</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Severity</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Assignee</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {gaps.map((gap) => (
                      <tr key={gap.id} className="align-top hover:bg-slate-50/80">
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-900">
                            {gap.item_name || gap.gap_type.replace(/_/g, ' ')}
                          </div>
                          <div className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">
                            {gap.gap_type.replace(/_/g, ' ')}
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-lg">
                          <p className="text-sm text-slate-800 line-clamp-3">{gap.description}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPriorityStyle(gap.severity).bg} ${getPriorityStyle(gap.severity).text}`}>
                            {gap.severity}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {gap.assignee_name ? (
                            <span className="inline-flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-slate-400" />
                              {gap.assignee_name}
                            </span>
                          ) : (
                            <span className="text-slate-400">Unassigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => openTaskFromGap(gap)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                          >
                            <ClipboardList className="h-3.5 w-3.5" />
                            Create Task
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showGapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-300 bg-white p-6 shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Run Gap Analysis</h3>
                <p className="text-sm text-slate-600">
                  Select documents to analyze against this regulatory change
                </p>
              </div>
              <button
                onClick={() => setShowGapModal(false)}
                className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={docSearch}
                onChange={(e) => setDocSearch(e.target.value)}
                placeholder="Search documents…"
                className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto mb-4">
              {documentsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : documents.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  No approved/published policies found
                </p>
              ) : visibleDocuments.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-4">
                  No documents match &ldquo;{docSearch}&rdquo;.
                </p>
              ) : (
                <>
                  <label className="flex items-center gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3 cursor-pointer hover:bg-slate-100">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleDocuments}
                      className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-slate-900">
                      {docSearch.trim()
                        ? `Select all matching (${visibleDocuments.length})`
                        : `Select all (${documents.length})`}
                    </span>
                  </label>
                  {visibleDocuments.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 cursor-pointer hover:bg-slate-50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDocumentIds.includes(doc.id)}
                        onChange={() => toggleDocument(doc.id)}
                        className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">{doc.title}</p>
                        <p className="text-xs text-slate-500 capitalize">{doc.status || 'policy'}</p>
                      </div>
                    </label>
                  ))}
                </>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-4">
              {selectedDocumentIds.length === 0
                ? 'No documents selected — analysis uses existing gaps plus all controls (default). Select documents to force a review against specific policies.'
                : `${selectedDocumentIds.length} document(s) selected — each will be checked even if not previously flagged.`}
            </p>

            <label className="flex items-start gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3 mb-5 cursor-pointer">
              <input
                type="checkbox"
                checked={includeAllControls}
                onChange={(e) => setIncludeAllControls(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              />
              <div>
                <p className="text-sm font-medium text-slate-900">Include all controls</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  On by default. Evaluates control coverage against this circular (internal controls for SBP).
                </p>
              </div>
            </label>

            <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setShowGapModal(false)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => runGapMutation.mutate()}
                disabled={runGapMutation.isPending}
                className="btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {runGapMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Run analysis
              </button>
            </div>
          </div>
        </div>
      )}

      <RightSlidePanel
        isOpen={showStatusModal}
        onClose={() => setShowStatusModal(false)}
        title="Update Status"
        width="w-full max-w-md"
      >
        <div className="space-y-3">
          {STATUS_OPTIONS.map((option) => {
            const style = getStatusStyle(option.value);
            const Icon = style.icon;
            return (
              <button
                key={option.value}
                onClick={() => updateStatusMutation.mutate(option.value)}
                disabled={updateStatusMutation.isPending}
                className={`w-full flex items-center gap-3 rounded-lg border border-slate-300 px-4 py-3 text-left transition-colors ${
                  change.status === option.value
                    ? `${style.bg} border-primary-500`
                    : 'bg-white hover:bg-slate-50'
                } disabled:opacity-50`}
              >
                <Icon className={`h-5 w-5 ${style.text}`} />
                <span className="text-slate-900 font-medium">{option.label}</span>
                {change.status === option.value && (
                  <CheckCircle className="ml-auto h-5 w-5 text-primary-400" />
                )}
              </button>
            );
          })}
        </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={showAssessmentModal}
        onClose={() => setShowAssessmentModal(false)}
        title="Add Impact Assessment"
        width="w-full max-w-lg"
      >
        <form onSubmit={(e) => { e.preventDefault(); createAssessmentMutation.mutate(assessmentForm); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Impact Level *</label>
                <select
                  value={assessmentForm.impact_level}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, impact_level: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Affected Areas</label>
                <textarea
                  value={assessmentForm.affected_areas}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, affected_areas: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe affected business areas..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Compliance Gaps</label>
                <textarea
                  value={assessmentForm.compliance_gaps}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, compliance_gaps: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe identified compliance gaps..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Recommendations</label>
                <textarea
                  value={assessmentForm.recommendations}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, recommendations: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Provide recommendations..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAssessmentModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createAssessmentMutation.isPending}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {createAssessmentMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add Assessment
                </button>
              </div>
        </form>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={showTaskModal}
        onClose={() => {
          setShowTaskModal(false);
          setTaskForm(emptyTaskForm);
        }}
        title={taskForm.impact_assessment_id ? 'Create Implementation Task' : 'Add Implementation Task'}
        width="w-full max-w-lg"
      >
        <form onSubmit={(e) => { e.preventDefault(); createTaskMutation.mutate(taskForm); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  required
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  placeholder="Enter task title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Task Type *</label>
                  <select
                    value={taskForm.task_type}
                    onChange={(e) => setTaskForm({ ...taskForm, task_type: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                  >
                    {TASK_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Assignee</label>
                <select
                  value={taskForm.assigned_to ?? ''}
                  onChange={(e) => setTaskForm({ ...taskForm, assigned_to: e.target.value ? Number(e.target.value) : null })}
                  disabled={usersLoading}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none disabled:opacity-60"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}
                    </option>
                  ))}
                </select>
                {selectedTaskAssignee?.department && (
                  <p className="mt-1 text-xs text-slate-500">Department: {selectedTaskAssignee.department}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <div className={`inline-flex items-center rounded-lg border px-3 py-2 text-xs font-semibold ${getTaskStatusStyle('pending').bg} ${getTaskStatusStyle('pending').text}`}>
                  Pending
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={taskForm.due_date}
                  onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe the task..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowTaskModal(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createTaskMutation.isPending}
                  className="btn-primary flex items-center gap-2 disabled:opacity-50"
                >
                  {createTaskMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add Task
                </button>
              </div>
        </form>
      </RightSlidePanel>
    </div>
  );
}
