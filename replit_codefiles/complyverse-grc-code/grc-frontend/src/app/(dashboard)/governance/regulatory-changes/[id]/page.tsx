'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { regulatoryApi } from '@/lib/api';
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
  X,
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
  identified: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)', icon: FileText },
  under_assessment: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)', icon: Clock },
  implementation: { bg: 'rgba(28, 43, 58, 0.06)', text: 'var(--color-base)', icon: AlertCircle },
  completed: { bg: 'rgba(45, 106, 79, 0.1)', text: 'var(--color-success)', icon: CheckCircle },
  not_applicable: { bg: 'rgba(28, 43, 58, 0.06)', text: 'var(--color-muted)', icon: FileText },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'rgba(155, 28, 28, 0.1)', text: 'var(--color-danger)' },
  high: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)' },
  medium: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)' },
  low: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)' },
};

const TASK_STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'rgba(28, 43, 58, 0.06)', text: 'var(--color-muted)' },
  in_progress: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)' },
  completed: { bg: 'rgba(45, 106, 79, 0.1)', text: 'var(--color-success)' },
  cancelled: { bg: 'rgba(155, 28, 28, 0.1)', text: 'var(--color-danger)' },
};

const TASK_TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  policy_update: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)', icon: FileText },
  control_update: { bg: 'rgba(28, 43, 58, 0.06)', text: 'var(--color-base)', icon: Target },
  process_change: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)', icon: ClipboardList },
  training: { bg: 'rgba(45, 106, 79, 0.1)', text: 'var(--color-success)', icon: Building2 },
  communication: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)', icon: FileText },
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
      return response.data as GapAnalysis[];
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
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !change) {
    return (
      <div className="rounded-xl p-6 text-center" style={{ border: '1px solid var(--color-danger)', backgroundColor: 'rgba(155, 28, 28, 0.1)' }}>
        <AlertCircle className="mx-auto h-8 w-8" style={{ color: 'var(--color-danger)' }} />
        <p className="mt-2" style={{ color: 'var(--color-danger)' }}>Failed to load regulatory change details</p>
        <Link href="/governance/regulatory-changes" className="mt-4 inline-flex items-center gap-2 text-primary-400 hover:text-primary-300">
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
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/governance/regulatory-changes" className="transition-colors" style={{ color: 'var(--color-muted)' }}>
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>{change.title}</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>
              <StatusIcon className="h-3 w-3" />
              {change.status.replace(/_/g, ' ')}
            </span>
            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: priorityStyle.bg, color: priorityStyle.text }}>
              {change.priority}
            </span>
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
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

      <div style={{ borderBottom: '1px solid var(--color-border)' }}>
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-400'
                  : 'border-transparent'
              }`}
              style={activeTab !== tab.id ? { color: 'var(--color-muted)' } : undefined}
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
            <div className="rounded-xl p-6" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Description</h2>
              <p className="whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
                {change.description || 'No description provided.'}
              </p>
            </div>

            {change.impact_summary && (
              <div className="rounded-xl p-6" style={{ border: '1px solid rgba(146, 87, 14, 0.3)', backgroundColor: 'rgba(146, 87, 14, 0.05)' }}>
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                  <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                  Impact Summary
                </h2>
                <p className="whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{change.impact_summary}</p>
              </div>
            )}

            <div className="rounded-xl p-6" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Recent Assessments</h2>
                <button 
                  onClick={() => { setActiveTab('assessments'); setShowAssessmentModal(true); }}
                  className="text-sm text-primary-400 hover:text-primary-300"
                >
                  View All
                </button>
              </div>
              {assessmentsLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : assessmentsError ? (
                <p className="text-center py-8" style={{ color: 'var(--color-danger)' }}>Failed to load assessments</p>
              ) : (!assessments || assessments.length === 0) ? (
                <p className="text-center py-8" style={{ color: 'var(--color-muted)' }}>No assessments yet</p>
              ) : (
                <div className="space-y-3">
                  {assessments.slice(0, 3).map((assessment) => (
                    <div key={assessment.id} className="rounded-lg p-4" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)' }}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: getPriorityStyle(assessment.impact_level).bg, color: getPriorityStyle(assessment.impact_level).text }}>
                          {assessment.impact_level} impact
                        </span>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                          {new Date(assessment.assessment_date).toLocaleDateString()}
                        </span>
                      </div>
                      {assessment.affected_areas && (
                        <p className="text-sm line-clamp-2" style={{ color: 'var(--color-text)' }}>{assessment.affected_areas}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl p-6" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Details</h2>
              <dl className="space-y-3">
                {change.regulatory_body && (
                  <div>
                    <dt className="text-sm" style={{ color: 'var(--color-muted)' }}>Regulatory Body</dt>
                    <dd style={{ color: 'var(--color-text)' }}>{change.regulatory_body}</dd>
                  </div>
                )}
                {change.publication_date && (
                  <div>
                    <dt className="text-sm" style={{ color: 'var(--color-muted)' }}>Publication Date</dt>
                    <dd className="flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      <Calendar size={14} style={{ color: 'var(--color-muted)' }} />
                      {new Date(change.publication_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {change.effective_date && (
                  <div>
                    <dt className="text-sm" style={{ color: 'var(--color-muted)' }}>Effective Date</dt>
                    <dd className="flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      <Calendar size={14} style={{ color: 'var(--color-muted)' }} />
                      {new Date(change.effective_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm" style={{ color: 'var(--color-muted)' }}>Gaps Identified</dt>
                  <dd className="flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                    {(change.gap_count || 0) > 0 ? (
                      <span className="flex items-center gap-1" style={{ color: 'var(--color-danger)' }}>
                        <AlertTriangle size={14} />
                        {change.gap_count}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--color-muted)' }}>None</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm" style={{ color: 'var(--color-muted)' }}>Created</dt>
                  <dd style={{ color: 'var(--color-text)' }}>{new Date(change.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl p-6" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Quick Actions</h2>
              <div className="space-y-2">
                <button 
                  onClick={() => setShowAssessmentModal(true)}
                  className="w-full flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                >
                  <Plus size={16} />
                  Add Assessment
                </button>
                <button 
                  onClick={() => setShowTaskModal(true)}
                  className="w-full flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                >
                  <Plus size={16} />
                  Add Task
                </button>
                <button 
                  onClick={() => setActiveTab('gaps')}
                  className="w-full flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
                  style={{ border: '1px solid rgba(28, 43, 58, 0.3)', backgroundColor: 'rgba(28, 43, 58, 0.06)', color: 'var(--color-base)' }}
                >
                  <Sparkles size={16} />
                  View Gap Analysis
                </button>
              </div>
            </div>

            <div className="rounded-xl p-6" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Lock size={18} />
                Closure
              </h2>
              <div className="space-y-4">
                <button 
                  onClick={checkClosureReadiness}
                  disabled={checkingReadiness || change.status === 'completed'}
                  className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
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
                    <div className="rounded-lg p-4" style={closureReadiness.ready_to_close ? { backgroundColor: 'rgba(45, 106, 79, 0.1)', border: '1px solid rgba(45, 106, 79, 0.3)' } : { backgroundColor: 'rgba(146, 87, 14, 0.05)', border: '1px solid rgba(146, 87, 14, 0.3)' }}>
                      <div className="flex items-center gap-2 mb-2">
                        {closureReadiness.ready_to_close ? (
                          <CheckCircle className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
                        ) : (
                          <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                        )}
                        <span className="font-medium" style={{ color: closureReadiness.ready_to_close ? 'var(--color-success)' : 'var(--color-warning)' }}>
                          {closureReadiness.ready_to_close ? 'Ready to Close' : 'Not Ready'}
                        </span>
                      </div>
                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                        {closureReadiness.completed_tasks} / {closureReadiness.total_tasks} tasks completed
                      </p>
                    </div>

                    {!closureReadiness.ready_to_close && closureReadiness.incomplete_tasks && closureReadiness.incomplete_tasks.length > 0 && (
                      <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-subtle)' }}>
                        <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Incomplete Tasks</h4>
                        <div className="space-y-2 max-h-40 overflow-y-auto">
                          {closureReadiness.incomplete_tasks.map((task) => (
                            <div key={task.id} className="flex items-center justify-between text-sm pb-2 last:pb-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
                              <div className="flex-1 min-w-0">
                                <p className="truncate" style={{ color: 'var(--color-text)' }}>{task.title}</p>
                                {task.assignee && (
                                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--color-muted)' }}>
                                    <User size={10} />
                                    {task.assignee}
                                  </p>
                                )}
                              </div>
                              <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: getTaskStatusStyle(task.status).bg, color: getTaskStatusStyle(task.status).text }}>
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
                      className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed"
                      style={closureReadiness.ready_to_close 
                        ? { backgroundColor: 'var(--color-success)', color: 'var(--color-surface)' } 
                        : { backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)', opacity: 0.5 }}
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
                  <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)', border: '1px solid rgba(45, 106, 79, 0.3)' }}>
                    <CheckCircle className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-success)' }} />
                    <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>This change has been closed</p>
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
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Impact Assessments</h2>
            <button onClick={() => setShowAssessmentModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Assessment
            </button>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            {assessmentsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : assessmentsError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4" style={{ color: 'var(--color-danger)' }} />
                <p className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>Failed to load assessments</p>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>There was an error loading the impact assessments</p>
              </div>
            ) : (!assessments || assessments.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--color-muted)' }}>
                <Target className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No assessments yet</p>
                <p className="text-sm">Add an impact assessment to evaluate this change</p>
              </div>
            ) : (
              <div>
                {assessments.map((assessment, idx) => (
                  <div key={assessment.id} className="p-6" style={{ borderBottom: idx < assessments.length - 1 ? '1px solid var(--color-border)' : undefined }}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium" style={{ backgroundColor: getPriorityStyle(assessment.impact_level).bg, color: getPriorityStyle(assessment.impact_level).text }}>
                          {assessment.impact_level} impact
                        </span>
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: getTaskStatusStyle(assessment.status).bg, color: getTaskStatusStyle(assessment.status).text }}>
                          {assessment.status}
                        </span>
                      </div>
                      <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                        {new Date(assessment.assessment_date).toLocaleDateString()}
                      </span>
                    </div>
                    {assessment.affected_areas && (
                      <div className="mb-3">
                        <h4 className="text-sm font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Affected Areas</h4>
                        <p style={{ color: 'var(--color-text)' }}>{assessment.affected_areas}</p>
                      </div>
                    )}
                    {assessment.compliance_gaps && (
                      <div className="mb-3">
                        <h4 className="text-sm font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Compliance Gaps</h4>
                        <p style={{ color: 'var(--color-text)' }}>{assessment.compliance_gaps}</p>
                      </div>
                    )}
                    {assessment.recommendations && (
                      <div>
                        <h4 className="text-sm font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Recommendations</h4>
                        <p style={{ color: 'var(--color-text)' }}>{assessment.recommendations}</p>
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
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Implementation Tasks</h2>
            <button onClick={() => setShowTaskModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Task
            </button>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            {tasksLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : tasksError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4" style={{ color: 'var(--color-danger)' }} />
                <p className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>Failed to load tasks</p>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>There was an error loading the implementation tasks</p>
              </div>
            ) : (!tasks || tasks.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--color-muted)' }}>
                <ClipboardList className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No tasks yet</p>
                <p className="text-sm">Add implementation tasks to track progress</p>
              </div>
            ) : (
              <table className="w-full">
                <thead style={{ backgroundColor: 'var(--color-subtle)' }}>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>Task</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase" style={{ color: 'var(--color-muted)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task, idx) => {
                    const typeStyle = getTaskTypeStyle(task.task_type);
                    const TypeIcon = typeStyle.icon;
                    const taskStatusStyle = getTaskStatusStyle(task.status);

                    return (
                      <tr key={task.id} style={{ borderBottom: idx < tasks.length - 1 ? '1px solid var(--color-border)' : undefined }}>
                        <td className="px-4 py-4">
                          <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: typeStyle.bg }}>
                              <TypeIcon className="h-4 w-4" style={{ color: typeStyle.text }} />
                            </div>
                            <div>
                              <p className="font-medium" style={{ color: 'var(--color-text)' }}>{task.title}</p>
                              {task.description && (
                                <p className="text-sm line-clamp-1" style={{ color: 'var(--color-muted)' }}>{task.description}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: typeStyle.bg, color: typeStyle.text }}>
                            {task.task_type.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <select
                            value={task.status}
                            onChange={(e) => updateTaskMutation.mutate({ taskId: task.id, data: { status: e.target.value } })}
                            className="rounded-lg border-0 px-2 py-1 text-xs font-medium focus:ring-1 focus:ring-primary-500"
                            style={{ backgroundColor: taskStatusStyle.bg, color: taskStatusStyle.text }}
                          >
                            {TASK_STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4 text-sm" style={{ color: 'var(--color-text)' }}>
                          {task.due_date ? new Date(task.due_date).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-4">
                          <button
                            onClick={() => deleteTaskMutation.mutate(task.id)}
                            disabled={deleteTaskMutation.isPending}
                            className="rounded-lg p-2 transition-colors disabled:opacity-50"
                            style={{ color: 'var(--color-muted)' }}
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
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Gap Analysis</h2>
            <button 
              onClick={() => refetchGaps()}
              className="btn-primary flex items-center gap-2"
            >
              <Sparkles size={16} />
              Run AI Analysis
            </button>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            {gapsLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : gapsError ? (
              <div className="flex flex-col items-center justify-center py-16">
                <AlertCircle className="h-12 w-12 mb-4" style={{ color: 'var(--color-danger)' }} />
                <p className="text-lg font-medium mb-2" style={{ color: 'var(--color-text)' }}>Failed to load gap analysis</p>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>There was an error loading the gap analysis data</p>
              </div>
            ) : (!gaps || gaps.length === 0) ? (
              <div className="flex flex-col items-center justify-center py-16" style={{ color: 'var(--color-muted)' }}>
                <BarChart3 className="h-12 w-12 mb-4" />
                <p className="text-lg font-medium">No gaps identified</p>
                <p className="text-sm">Run AI analysis to identify compliance gaps</p>
              </div>
            ) : (
              <div>
                {gaps.map((gap, idx) => (
                  <div key={gap.id} className="p-6" style={{ borderBottom: idx < gaps.length - 1 ? '1px solid var(--color-border)' : undefined }}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center rounded-full px-3 py-1 text-sm font-medium" style={{ backgroundColor: getPriorityStyle(gap.severity).bg, color: getPriorityStyle(gap.severity).text }}>
                          {gap.severity}
                        </span>
                        <span className="text-sm" style={{ color: 'var(--color-muted)' }}>{gap.gap_type.replace(/_/g, ' ')}</span>
                      </div>
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: getTaskStatusStyle(gap.status).bg, color: getTaskStatusStyle(gap.status).text }}>
                        {gap.status}
                      </span>
                    </div>
                    <p className="mb-4" style={{ color: 'var(--color-text)' }}>{gap.description}</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      {gap.current_state && (
                        <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)' }}>
                          <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Current State</h4>
                          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{gap.current_state}</p>
                        </div>
                      )}
                      {gap.required_state && (
                        <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)' }}>
                          <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Required State</h4>
                          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{gap.required_state}</p>
                        </div>
                      )}
                    </div>
                    {gap.remediation_plan && (
                      <div className="mt-4 rounded-lg p-4" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)', border: '1px solid rgba(45, 106, 79, 0.3)' }}>
                        <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-success)' }}>Remediation Plan</h4>
                        <p className="text-sm" style={{ color: 'var(--color-text)' }}>{gap.remediation_plan}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl p-6 shadow-2xl" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Update Status</h2>
              <button
                onClick={() => setShowStatusModal(false)}
                className="rounded-lg p-2 transition-colors"
                style={{ color: 'var(--color-muted)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              {STATUS_OPTIONS.map((option) => {
                const style = getStatusStyle(option.value);
                const Icon = style.icon;
                return (
                  <button
                    key={option.value}
                    onClick={() => updateStatusMutation.mutate(option.value)}
                    disabled={updateStatusMutation.isPending}
                    className="w-full flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors disabled:opacity-50"
                    style={change.status === option.value
                      ? { backgroundColor: style.bg, border: '1px solid var(--color-base)' }
                      : { backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                  >
                    <Icon className="h-5 w-5" style={{ color: style.text }} />
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>{option.label}</span>
                    {change.status === option.value && (
                      <CheckCircle className="ml-auto h-5 w-5 text-primary-400" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showAssessmentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Add Impact Assessment</h2>
              <button
                onClick={() => setShowAssessmentModal(false)}
                className="rounded-lg p-2 transition-colors"
                style={{ color: 'var(--color-muted)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); createAssessmentMutation.mutate(assessmentForm); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Impact Level *</label>
                <select
                  value={assessmentForm.impact_level}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, impact_level: e.target.value })}
                  className="w-full rounded-lg px-4 py-2 focus:outline-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Affected Areas</label>
                <textarea
                  value={assessmentForm.affected_areas}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, affected_areas: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg px-4 py-2 focus:outline-none resize-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  placeholder="Describe affected business areas..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Compliance Gaps</label>
                <textarea
                  value={assessmentForm.compliance_gaps}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, compliance_gaps: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg px-4 py-2 focus:outline-none resize-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  placeholder="Describe identified compliance gaps..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Recommendations</label>
                <textarea
                  value={assessmentForm.recommendations}
                  onChange={(e) => setAssessmentForm({ ...assessmentForm, recommendations: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg px-4 py-2 focus:outline-none resize-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  placeholder="Provide recommendations..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  onClick={() => setShowAssessmentModal(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
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
          </div>
        </div>
      )}

      {showTaskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Add Implementation Task</h2>
              <button
                onClick={() => setShowTaskModal(false)}
                className="rounded-lg p-2 transition-colors"
                style={{ color: 'var(--color-muted)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={(e) => { e.preventDefault(); createTaskMutation.mutate(taskForm); }} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Title *</label>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                  required
                  className="w-full rounded-lg px-4 py-2 focus:outline-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  placeholder="Enter task title"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Task Type *</label>
                  <select
                    value={taskForm.task_type}
                    onChange={(e) => setTaskForm({ ...taskForm, task_type: e.target.value })}
                    className="w-full rounded-lg px-4 py-2 focus:outline-none"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  >
                    {TASK_TYPE_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Priority</label>
                  <select
                    value={taskForm.priority}
                    onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
                    className="w-full rounded-lg px-4 py-2 focus:outline-none"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Due Date</label>
                <input
                  type="date"
                  value={taskForm.due_date}
                  onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
                  className="w-full rounded-lg px-4 py-2 focus:outline-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>Description</label>
                <textarea
                  value={taskForm.description}
                  onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg px-4 py-2 focus:outline-none resize-none"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
                  placeholder="Describe the task..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                <button
                  type="button"
                  onClick={() => setShowTaskModal(false)}
                  className="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)' }}
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
          </div>
        </div>
      )}
    </div>
  );
}
