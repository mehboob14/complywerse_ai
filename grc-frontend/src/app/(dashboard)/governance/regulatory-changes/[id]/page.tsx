'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { regulatoryApi } from '@/lib/api';
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
  assessor_id?: number;
  assessor_name?: string;
  impact_level: string;
  affected_areas?: string;
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
  assigned_user_name?: string;
  due_date?: string;
  completed_at?: string;
  created_at: string;
}

interface GapAnalysis {
  id: number;
  gap_type: string;
  description: string;
  current_state?: string;
  required_state?: string;
  severity: string;
  remediation_plan?: string;
  status: string;
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
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  identified: { bg: 'bg-blue-100', text: 'text-blue-800', icon: FileText },
  under_assessment: { bg: 'bg-amber-100', text: 'text-amber-800', icon: Clock },
  implementation: { bg: 'bg-violet-100', text: 'text-violet-800', icon: AlertCircle },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: CheckCircle },
  not_applicable: { bg: 'bg-gray-100', text: 'text-gray-800', icon: FileText },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-100', text: 'text-red-800' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-800' },
  low: { bg: 'bg-blue-100', text: 'text-blue-800' },
};

const TASK_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-gray-100', text: 'text-gray-800' },
  in_progress: { bg: 'bg-amber-100', text: 'text-amber-800' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-800' },
  cancelled: { bg: 'bg-red-100', text: 'text-red-800' },
};

const TASK_TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  policy_update: { bg: 'bg-blue-100', text: 'text-blue-800', icon: FileText },
  control_update: { bg: 'bg-violet-100', text: 'text-violet-800', icon: Target },
  process_change: { bg: 'bg-cyan-100', text: 'text-cyan-800', icon: ClipboardList },
  training: { bg: 'bg-emerald-100', text: 'text-emerald-800', icon: Building2 },
  communication: { bg: 'bg-amber-100', text: 'text-amber-800', icon: FileText },
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

  const { data: gaps, isLoading: gapsLoading, error: gapsError, refetch: refetchGaps } = useQuery({
    queryKey: ['regulatory-gaps', changeId],
    queryFn: async () => {
      const response = await regulatoryApi.getGapAnalysis(changeId);
      const payload = response.data as
        | GapAnalysis[]
        | {
            identified_gaps?: Array<{
              id?: number;
              area?: string;
              description?: string;
              severity?: string;
              current_state?: string;
              required_state?: string;
              remediation_plan?: string;
              status?: string;
            }>;
          };

      if (Array.isArray(payload)) {
        return payload;
      }

      const identifiedGaps = Array.isArray(payload?.identified_gaps) ? payload.identified_gaps : [];
      return identifiedGaps.map((gap, index) => ({
        id: gap.id ?? index + 1,
        gap_type: gap.area || 'process',
        description: gap.description || 'No description provided',
        current_state: gap.current_state,
        required_state: gap.required_state,
        severity: (gap.severity || 'medium').toLowerCase(),
        remediation_plan: gap.remediation_plan,
        status: gap.status || 'identified',
      })) as GapAnalysis[];
    },
    enabled: activeTab === 'gaps',
  });

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
    mutationFn: (data: Record<string, unknown>) => regulatoryApi.createTask(changeId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-tasks', changeId] });
      setShowTaskModal(false);
      setTaskForm({
        title: '',
        description: '',
        task_type: 'policy_update',
        priority: 'medium',
        due_date: '',
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
      <div className="rounded-xl border border-red-300 bg-white p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-700">Failed to load regulatory change details</p>
        <Link href="/governance/regulatory-changes" className="mt-4 inline-flex items-center gap-2 text-blue-700 hover:text-blue-800">
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
        <Link href="/governance/regulatory-changes" className="text-gray-600 hover:text-black transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold text-black">{change.title}</h1>
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              <StatusIcon className="h-3 w-3" />
              {change.status.replace(/_/g, ' ')}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
              {change.priority}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-gray-600">
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

      <div className="border-b border-gray-300">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-600 hover:text-black'
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
            <div className="rounded-xl border border-gray-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4">Description</h2>
              <p className="text-gray-800 whitespace-pre-wrap">
                {change.description || 'No description provided.'}
              </p>
            </div>

            {change.impact_summary && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-6">
                <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-700" />
                  Impact Summary
                </h2>
                <p className="text-gray-800 whitespace-pre-wrap">{change.impact_summary}</p>
              </div>
            )}

            <div className="rounded-xl border border-gray-300 bg-white p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-black">Recent Assessments</h2>
                <button 
                  onClick={() => { setActiveTab('assessments'); setShowAssessmentModal(true); }}
                  className="text-sm text-blue-700 hover:text-blue-800"
                >
                  View All
                </button>
              </div>
              {assessmentsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : assessmentsError ? (
                <p className="text-red-700 text-center py-8">Failed to load assessments</p>
              ) : (!assessments || assessments.length === 0) ? (
                <p className="text-gray-600 text-center py-8">No assessments yet</p>
              ) : (
                <div className="space-y-3">
                  {assessments.slice(0, 3).map((assessment) => (
                    <div key={assessment.id} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getPriorityStyle(assessment.impact_level).bg} ${getPriorityStyle(assessment.impact_level).text}`}>
                          {assessment.impact_level} impact
                        </span>
                        <span className="text-xs text-gray-600">
                          {new Date(assessment.assessment_date).toLocaleDateString()}
                        </span>
                      </div>
                      {assessment.affected_areas && (
                        <p className="text-sm text-gray-800 line-clamp-2">{assessment.affected_areas}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-gray-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4">Details</h2>
              <dl className="space-y-3">
                {change.regulatory_body && (
                  <div>
                    <dt className="text-sm text-gray-600">Regulatory Body</dt>
                    <dd className="text-black">{change.regulatory_body}</dd>
                  </div>
                )}
                {change.publication_date && (
                  <div>
                    <dt className="text-sm text-gray-600">Publication Date</dt>
                    <dd className="text-black flex items-center gap-1.5">
                      <Calendar size={14} className="text-gray-600" />
                      {new Date(change.publication_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {change.effective_date && (
                  <div>
                    <dt className="text-sm text-gray-600">Effective Date</dt>
                    <dd className="text-black flex items-center gap-1.5">
                      <Calendar size={14} className="text-gray-600" />
                      {new Date(change.effective_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-gray-600">Gaps Identified</dt>
                  <dd className="text-black flex items-center gap-1.5">
                    {(change.gap_count || 0) > 0 ? (
                      <span className="text-red-700 flex items-center gap-1">
                        <AlertTriangle size={14} />
                        {change.gap_count}
                      </span>
                    ) : (
                      <span className="text-gray-600">None</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-gray-600">Created</dt>
                  <dd className="text-black">{new Date(change.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-gray-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4">Quick Actions</h2>
              <div className="space-y-2">
                <button 
                  onClick={() => setShowAssessmentModal(true)}
                  className="w-full flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-black hover:bg-gray-50 transition-colors"
                >
                  <Plus size={16} />
                  Add Assessment
                </button>
                <button 
                  onClick={() => setShowTaskModal(true)}
                  className="w-full flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-black hover:bg-gray-50 transition-colors"
                >
                  <Plus size={16} />
                  Add Task
                </button>
                <button 
                  onClick={() => setActiveTab('gaps')}
                  className="w-full flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-4 py-2 text-sm text-blue-800 hover:bg-blue-100 transition-colors"
                >
                  <Sparkles size={16} />
                  View Gap Analysis
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-300 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                <Lock size={18} />
                Closure
              </h2>
              <div className="space-y-4">
                <button 
                  onClick={checkClosureReadiness}
                  disabled={checkingReadiness || change.status === 'completed'}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-black hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                      <p className="text-sm text-gray-800">
                        {closureReadiness.completed_tasks} / {closureReadiness.total_tasks} tasks completed
                      </p>
                    </div>

                    {!closureReadiness.ready_to_close && closureReadiness.incomplete_tasks && closureReadiness.incomplete_tasks.length > 0 && (
                      <div className="rounded-lg bg-gray-50 p-3 border border-gray-200">
                        <h4 className="text-sm font-medium text-gray-700 mb-2">Incomplete Tasks</h4>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {closureReadiness.incomplete_tasks.map((task) => (
                            <div key={task.id} className="flex items-center justify-between text-sm border-b border-gray-200 pb-2 last:border-0 last:pb-0">
                              <div className="flex-1 min-w-0">
                                <p className="text-black truncate">{task.title}</p>
                                {task.assignee && (
                                  <p className="text-xs text-gray-600 flex items-center gap-1">
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
                          : 'bg-slate-600 text-slate-400 opacity-50'
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
                  <div className="rounded-lg bg-emerald-900/20 border border-emerald-700/50 p-4 text-center">
                    <CheckCircle className="h-8 w-8 text-emerald-400 mx-auto mb-2" />
                    <p className="text-sm text-emerald-400 font-medium">This change has been closed</p>
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
            <h2 className="text-lg font-semibold text-black">Impact Assessments</h2>
            <button onClick={() => setShowAssessmentModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Assessment
            </button>
          </div>
          <div className="rounded-xl border border-gray-300 bg-white overflow-hidden">
            {assessmentsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : assessmentsError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4 text-red-600" />
                <p className="text-lg font-medium text-black mb-2">Failed to load assessments</p>
                <p className="text-sm text-gray-600">There was an error loading the impact assessments</p>
              </div>
            ) : (!assessments || assessments.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <Target className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No assessments yet</p>
                <p className="text-sm">Add an impact assessment to evaluate this change</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {assessments.map((assessment) => (
                  <div key={assessment.id} className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getPriorityStyle(assessment.impact_level).bg} ${getPriorityStyle(assessment.impact_level).text}`}>
                          {assessment.impact_level} impact
                        </span>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${getTaskStatusStyle(assessment.status).bg} ${getTaskStatusStyle(assessment.status).text}`}>
                          {assessment.status}
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {new Date(assessment.assessment_date).toLocaleDateString()}
                      </span>
                    </div>
                    {assessment.affected_areas && (
                      <div className="mb-3">
                        <h4 className="text-sm font-medium text-gray-700 mb-1">Affected Areas</h4>
                        <p className="text-black">{assessment.affected_areas}</p>
                      </div>
                    )}
                    {assessment.compliance_gaps && (
                      <div className="mb-3">
                        <h4 className="text-sm font-medium text-gray-700 mb-1">Compliance Gaps</h4>
                        <p className="text-black">{assessment.compliance_gaps}</p>
                      </div>
                    )}
                    {assessment.recommendations && (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-1">Recommendations</h4>
                        <p className="text-black">{assessment.recommendations}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Implementation Tasks</h2>
            <button onClick={() => setShowTaskModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Task
            </button>
          </div>
          <div className="rounded-xl border border-gray-300 bg-white overflow-hidden">
            {tasksLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : tasksError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4 text-red-600" />
                <p className="text-lg font-medium text-black mb-2">Failed to load tasks</p>
                <p className="text-sm text-gray-600">There was an error loading the implementation tasks</p>
              </div>
            ) : (!tasks || tasks.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <ClipboardList className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No tasks yet</p>
                <p className="text-sm">Add implementation tasks to track progress</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Task</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {tasks.map((task) => {
                    const typeStyle = getTaskTypeStyle(task.task_type);
                    const TypeIcon = typeStyle.icon;
                    const taskStatusStyle = getTaskStatusStyle(task.status);

                    return (
                      <tr key={task.id} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${typeStyle.bg}`}>
                              <TypeIcon className={`h-4 w-4 ${typeStyle.text}`} />
                            </div>
                            <div>
                              <p className="font-medium text-black">{task.title}</p>
                              {task.description && (
                                <p className="text-sm text-gray-600 line-clamp-1">{task.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${typeStyle.bg} ${typeStyle.text}`}>
                            {task.task_type.replace(/_/g, ' ')}
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
                        <td className="px-4 py-4 text-sm text-gray-700">
                          {task.due_date ? new Date(task.due_date).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-4">
                          <button
                            onClick={() => deleteTaskMutation.mutate(task.id)}
                            disabled={deleteTaskMutation.isPending}
                            className="rounded-lg p-2 text-gray-600 hover:bg-red-50 hover:text-red-700 transition-colors disabled:opacity-50"
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
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Gap Analysis</h2>
            <button 
              onClick={() => refetchGaps()}
              className="btn-primary flex items-center gap-2"
            >
              <Sparkles size={16} />
              Run AI Analysis
            </button>
          </div>
          <div className="rounded-xl border border-gray-300 bg-white overflow-hidden">
            {gapsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : gapsError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4 text-red-600" />
                <p className="text-lg font-medium text-black mb-2">Failed to load gap analysis</p>
                <p className="text-sm text-gray-600">There was an error loading the gap analysis data</p>
              </div>
            ) : (!gaps || gaps.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <BarChart3 className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No gaps identified</p>
                <p className="text-sm">Run AI analysis to identify compliance gaps</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {gaps.map((gap) => (
                  <div key={gap.id} className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${getPriorityStyle(gap.severity).bg} ${getPriorityStyle(gap.severity).text}`}>
                          {gap.severity}
                        </span>
                        <span className="text-sm text-gray-600">{gap.gap_type.replace(/_/g, ' ')}</span>
                      </div>
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${getTaskStatusStyle(gap.status).bg} ${getTaskStatusStyle(gap.status).text}`}>
                        {gap.status}
                      </span>
                    </div>
                    <p className="text-black mb-4">{gap.description}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {gap.current_state && (
                        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Current State</h4>
                          <p className="text-sm text-gray-800">{gap.current_state}</p>
                        </div>
                      )}
                      {gap.required_state && (
                        <div className="rounded-lg bg-gray-50 border border-gray-200 p-4">
                          <h4 className="text-sm font-medium text-gray-700 mb-2">Required State</h4>
                          <p className="text-sm text-gray-800">{gap.required_state}</p>
                        </div>
                      )}
                    </div>
                    {gap.remediation_plan && (
                      <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-300 p-4">
                        <h4 className="text-sm font-medium text-emerald-700 mb-2">Remediation Plan</h4>
                        <p className="text-sm text-gray-800">{gap.remediation_plan}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
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
                className={`w-full flex items-center gap-3 rounded-lg border border-gray-300 px-4 py-3 text-left transition-colors ${
                  change.status === option.value
                    ? `${style.bg} border-primary-500`
                    : 'bg-white hover:bg-gray-50'
                } disabled:opacity-50`}
              >
                <Icon className={`h-5 w-5 ${style.text}`} />
                <span className="text-black font-medium">{option.label}</span>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Impact Level *</label>
                <select
                  value={assessmentForm.impact_level}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, impact_level: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Affected Areas</label>
                <textarea
                  value={assessmentForm.affected_areas}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, affected_areas: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe affected business areas..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Compliance Gaps</label>
                <textarea
                  value={assessmentForm.compliance_gaps}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, compliance_gaps: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe identified compliance gaps..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Recommendations</label>
                <textarea
                  value={assessmentForm.recommendations}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, recommendations: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Provide recommendations..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowAssessmentModal(false)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
        onClose={() => setShowTaskModal(false)}
        title="Add Implementation Task"
        width="w-full max-w-lg"
      >
        <form onSubmit={(e) => { e.preventDefault(); createTaskMutation.mutate(taskForm); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  required
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none"
                  placeholder="Enter task title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Task Type *</label>
                  <select
                    value={taskForm.task_type}
                    onChange={(e) => setTaskForm({ ...taskForm, task_type: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    {TASK_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={taskForm.due_date}
                  onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black focus:border-primary-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2 text-black placeholder-gray-500 focus:border-primary-500 focus:outline-none resize-none"
                  placeholder="Describe the task..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setShowTaskModal(false)}
                  className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
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
