'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useParams } from 'next/navigation';
import { isProjectsApi } from '@/lib/api';
import {
  Loader2,
  AlertCircle,
  ArrowLeft,
  Calendar,
  Users,
  Target,
  DollarSign,
  Milestone,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Clock,
  Plus,
  X,
  Trash2,
  Edit,
  Save,
  MessageSquare,
  Link2,
  ChevronRight,
  Sparkles,
  BookOpen,
  GitBranch,
  Shield,
  Receipt,
  Paperclip,
  Upload,
  Download,
} from 'lucide-react';

const TABS = [
  { key: 'overview', label: 'Overview', icon: Target },
  { key: 'milestones', label: 'Milestones', icon: Milestone },
  { key: 'tasks', label: 'Tasks', icon: CheckCircle2 },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'risks', label: 'Risks & Issues', icon: AlertTriangle },
  { key: 'updates', label: 'Updates', icon: MessageSquare },
  { key: 'documents', label: 'Documents', icon: FileText },
  { key: 'budget', label: 'Budget & Financials', icon: Receipt },
  { key: 'compliance', label: 'Compliance Mapping', icon: Shield },
  { key: 'lessons', label: 'Lessons Learned', icon: BookOpen },
  { key: 'dependencies', label: 'Dependencies', icon: GitBranch },
];

const STATUSES = ['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'];
const HEALTH_OPTIONS = ['On Track', 'At Risk', 'Off Track'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const TASK_STATUSES = ['To Do', 'In Progress', 'In Review', 'Done', 'Blocked'];
const TEAM_ROLES = ['Project Manager', 'Lead', 'Member', 'Reviewer'];
const RISK_TYPES = ['Risk', 'Issue', 'Blocker', 'Dependency'];
const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'];
const MILESTONE_STATUSES = ['Pending', 'In Progress', 'Completed', 'Delayed'];

const healthColor = (h: string) => {
  if (h === 'On Track') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
  if (h === 'At Risk') return 'bg-amber-100 text-amber-700 border-amber-200';
  return 'bg-red-100 text-red-700 border-red-200';
};
const healthDot = (h: string) => {
  if (h === 'On Track') return 'bg-emerald-500';
  if (h === 'At Risk') return 'bg-amber-500';
  return 'bg-red-500';
};
const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    'Planning': 'bg-blue-50 text-blue-700 border-blue-200',
    'In Progress': 'bg-indigo-50 text-indigo-700 border-indigo-200',
    'On Hold': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    'Completed': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Cancelled': 'bg-gray-50 text-gray-500 border-gray-200',
    'To Do': 'bg-gray-50 text-gray-600 border-gray-200',
    'In Review': 'bg-purple-50 text-purple-700 border-purple-200',
    'Done': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'Blocked': 'bg-red-50 text-red-700 border-red-200',
    'Pending': 'bg-gray-50 text-gray-600 border-gray-200',
    'Delayed': 'bg-red-50 text-red-600 border-red-200',
    'Open': 'bg-amber-50 text-amber-700 border-amber-200',
    'Mitigated': 'bg-blue-50 text-blue-700 border-blue-200',
    'Closed': 'bg-gray-50 text-gray-500 border-gray-200',
    'Resolved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return map[s] || 'bg-gray-50 text-gray-600 border-gray-200';
};
const priorityBadge = (p: string) => {
  const map: Record<string, string> = {
    'Critical': 'bg-red-50 text-red-700 border-red-200',
    'High': 'bg-orange-50 text-orange-700 border-orange-200',
    'Medium': 'bg-yellow-50 text-yellow-700 border-yellow-200',
    'Low': 'bg-green-50 text-green-700 border-green-200',
  };
  return map[p] || 'bg-gray-50 text-gray-600 border-gray-200';
};

const formatDate = (d: string | null) => {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatCurrency = (n: number | null) => {
  if (!n) return '$0';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

type MilestoneEvidence = {
  id: number;
  evidence_id: number;
  name: string;
  file_name: string;
  file_type: string;
  file_path: string;
  uploaded_by_name: string;
  created_at: string;
  status: string;
};

function MilestoneEvidencePanel({ projectId, milestoneId }: { projectId: number; milestoneId: number }) {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: evidence = [] } = useQuery<MilestoneEvidence[]>({
    queryKey: ['is-project-milestone-evidence', projectId, milestoneId],
    queryFn: async () => {
      const res = await isProjectsApi.getMilestoneEvidence(projectId, milestoneId);
      return res.data || [];
    },
  });

  const uploadEvidenceMut = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return isProjectsApi.uploadMilestoneEvidence(projectId, milestoneId, formData);
    },
    onSuccess: () => {
      setSelectedFile(null);
      queryClient.invalidateQueries({ queryKey: ['is-project-milestone-evidence', projectId, milestoneId] });
    },
  });

  const deleteEvidenceMut = useMutation({
    mutationFn: (linkId: number) => isProjectsApi.deleteMilestoneEvidence(projectId, milestoneId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-project-milestone-evidence', projectId, milestoneId] });
    },
  });

  return (
    <div className="mt-3 border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-subtle)]/30">
      <div className="flex items-center justify-between gap-2">
        <h5 className="text-xs font-semibold text-[var(--color-text)] flex items-center gap-1.5">
          <Paperclip size={12} /> Evidence
        </h5>
        <div className="flex items-center gap-2">
          <input
            type="file"
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            className="text-[10px] text-[var(--color-muted)] max-w-[180px]"
          />
          <button
            type="button"
            onClick={() => selectedFile && uploadEvidenceMut.mutate(selectedFile)}
            disabled={!selectedFile || uploadEvidenceMut.isPending}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {uploadEvidenceMut.isPending ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
            Upload
          </button>
        </div>
      </div>

      {evidence.length === 0 ? (
        <p className="text-[10px] text-[var(--color-muted)] mt-2">No evidence uploaded for this milestone.</p>
      ) : (
        <div className="mt-2 space-y-1">
          {evidence.map((ev) => (
            <div key={ev.id} className="flex items-center justify-between gap-2 rounded border border-[var(--color-border)] px-2 py-1 bg-white">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-[var(--color-text)] truncate">{ev.file_name || ev.name}</p>
                <p className="text-[10px] text-[var(--color-muted)]">{ev.uploaded_by_name || 'Unknown'} • {formatDate(ev.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => deleteEvidenceMut.mutate(ev.id)}
                className="p-1 hover:bg-red-50 rounded text-red-500"
                title="Delete evidence"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = Number(params.id);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [showModal, setShowModal] = useState<string | null>(null);
  const [documentUploadFile, setDocumentUploadFile] = useState<File | null>(null);
  const [editingProject, setEditingProject] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});

  const { data: project, isLoading, error } = useQuery({
    queryKey: ['is-project', projectId],
    queryFn: async () => {
      const res = await isProjectsApi.getById(projectId);
      return res.data;
    },
  });

  const updateProjectMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.update(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-project', projectId] });
      setEditingProject(false);
    },
  });

  const deleteProjectMut = useMutation({
    mutationFn: () => isProjectsApi.delete(projectId),
    onSuccess: () => router.push('/is-projects'),
  });

  const createMilestoneMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createMilestone(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); setShowModal(null); },
  });

  const deleteMilestoneMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteMilestone(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const updateMilestoneMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateMilestone(projectId, id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const createTaskMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createTask(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); setShowModal(null); },
  });

  const deleteTaskMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteTask(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const updateTaskMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateTask(projectId, id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const addTeamMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.addTeamMember(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); setShowModal(null); },
  });

  const removeTeamMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.removeTeamMember(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const createRiskMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createRisk(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); setShowModal(null); },
  });

  const updateRiskMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateRisk(projectId, id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const deleteRiskMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteRisk(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const createUpdateMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createUpdate(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); setShowModal(null); },
  });

  const deleteUpdateMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteUpdate(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const addDocMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.addDocument(projectId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); setDocumentUploadFile(null); setShowModal(null); },
  });
  const addDocUploadMut = useMutation({
    mutationFn: (formData: FormData) => isProjectsApi.uploadDocument(projectId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-project', projectId] });
      setDocumentUploadFile(null);
      setShowModal(null);
    },
  });

  const removeDocMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.removeDocument(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }),
  });

  const handleDownloadDocument = async (docId: number, fileName?: string) => {
    try {
      const response = await isProjectsApi.downloadDocument(projectId, docId);
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = fileName || `project-document-${docId}`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch {
      // noop: keep UI stable; backend error is reflected in network panel
    }
  };

  const { data: budgetData, refetch: refetchBudget } = useQuery({
    queryKey: ['is-project-budget', projectId],
    queryFn: async () => { const r = await isProjectsApi.getBudgetItems(projectId); return r.data; },
    enabled: activeTab === 'budget',
  });
  const budgetItems: Array<{id: number; category: string; description: string; amount: number; status: string; approved_by: string; notes: string; date: string; created_at: string}> = budgetData?.items || [];
  const createBudgetMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createBudgetItem(projectId, data),
    onSuccess: () => { refetchBudget(); setShowModal(null); setEditingId(null); },
  });
  const updateBudgetMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateBudgetItem(projectId, id, data),
    onSuccess: () => { refetchBudget(); setShowModal(null); setEditingId(null); },
  });
  const deleteBudgetMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteBudgetItem(projectId, id),
    onSuccess: () => refetchBudget(),
  });

  const { data: complianceMappings = [], refetch: refetchCompliance } = useQuery({
    queryKey: ['is-project-compliance', projectId],
    queryFn: async () => { const r = await isProjectsApi.getComplianceMappings(projectId); return r.data; },
    enabled: activeTab === 'compliance',
  });
  const createComplianceMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createComplianceMapping(projectId, data),
    onSuccess: () => { refetchCompliance(); setShowModal(null); setEditingId(null); },
  });
  const updateComplianceMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateComplianceMapping(projectId, id, data),
    onSuccess: () => { refetchCompliance(); setShowModal(null); setEditingId(null); },
  });
  const deleteComplianceMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteComplianceMapping(projectId, id),
    onSuccess: () => refetchCompliance(),
  });

  const { data: lessonsLearned = [], refetch: refetchLessons } = useQuery({
    queryKey: ['is-project-lessons', projectId],
    queryFn: async () => { const r = await isProjectsApi.getLessonsLearned(projectId); return r.data; },
    enabled: activeTab === 'lessons',
  });
  const createLessonMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createLessonLearned(projectId, data),
    onSuccess: () => { refetchLessons(); setShowModal(null); setEditingId(null); },
  });
  const updateLessonMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateLessonLearned(projectId, id, data),
    onSuccess: () => { refetchLessons(); setShowModal(null); setEditingId(null); },
  });
  const deleteLessonMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteLessonLearned(projectId, id),
    onSuccess: () => refetchLessons(),
  });

  const { data: dependencies = [], refetch: refetchDeps } = useQuery({
    queryKey: ['is-project-deps', projectId],
    queryFn: async () => { const r = await isProjectsApi.getDependencies(projectId); return r.data; },
    enabled: activeTab === 'dependencies',
  });
  const createDepMut = useMutation({
    mutationFn: (data: Record<string, unknown>) => isProjectsApi.createDependency(projectId, data),
    onSuccess: () => { refetchDeps(); setShowModal(null); setEditingId(null); },
  });
  const updateDepMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateDependency(projectId, id, data),
    onSuccess: () => { refetchDeps(); setShowModal(null); setEditingId(null); },
  });
  const deleteDepMut = useMutation({
    mutationFn: (id: number) => isProjectsApi.deleteDependency(projectId, id),
    onSuccess: () => refetchDeps(),
  });

  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ title: string; data: unknown; aiKey?: string } | null>(null);
  const [aiApplying, setAiApplying] = useState(false);

  const runAi = async (key: string, fn: () => Promise<{ data: unknown }>, title: string) => {
    setAiLoading(key);
    try {
      const res = await fn();
      setAiResult({ title, data: res.data, aiKey: key });
    } catch {
      setAiResult({ title: `${title} — Error`, data: { error: 'AI request failed. Please try again.' } });
    } finally {
      setAiLoading(null);
    }
  };

  const applyAiResult = async () => {
    if (!aiResult?.data || !aiResult.aiKey) return;
    setAiApplying(true);
    try {
      const d = aiResult.data as Record<string, unknown>;
      if (aiResult.aiKey === 'generate-plan' && d.plan) {
        const plan = d.plan as Record<string, unknown>;
        const milestones = (plan.milestones || []) as Array<Record<string, unknown>>;
        const tasks = (plan.tasks || []) as Array<Record<string, unknown>>;
        const startDate = project?.start_date ? new Date(project.start_date as string) : new Date();
        for (const ms of milestones) {
          let targetDate = '';
          if (ms.target_week) {
            const dt = new Date(startDate);
            dt.setDate(dt.getDate() + (Number(ms.target_week) * 7));
            targetDate = dt.toISOString().split('T')[0];
          }
          await isProjectsApi.createMilestone(projectId, {
            name: (ms.name || ms.title || 'Milestone') as string,
            description: (ms.description || '') as string,
            target_date: targetDate,
            status: 'Not Started',
            deliverables: Array.isArray(ms.deliverables) ? ms.deliverables : [],
            completion_percentage: 0,
          });
        }
        for (const task of tasks) {
          await isProjectsApi.createTask(projectId, {
            title: (task.title || task.name || 'Task') as string,
            description: (task.description || '') as string,
            priority: (task.priority || 'Medium') as string,
            status: 'Not Started',
            assigned_role: (task.suggested_role || '') as string,
          });
        }
        if (plan.timeline_narrative) {
          await isProjectsApi.createUpdate(projectId, {
            what_was_done: 'AI-Generated Project Plan applied',
            whats_planned: plan.timeline_narrative as string,
            notes: `Created ${milestones.length} milestones and ${tasks.length} tasks from AI plan`,
            health_status: 'On Track',
          });
        }
        queryClient.invalidateQueries({ queryKey: ['is-project', projectId] });
      } else if (aiResult.aiKey === 'assess-risks' && d.assessment) {
        const assessment = d.assessment as Record<string, unknown>;
        const risks = (assessment.risks || assessment.risk_areas || []) as Array<Record<string, string>>;
        for (const r of risks) {
          await isProjectsApi.createRisk(projectId, { title: r.title || r.risk || r.name, description: r.description || r.details || '', severity: r.severity || r.impact || 'Medium', status: 'Open' });
        }
        queryClient.invalidateQueries({ queryKey: ['is-project', projectId] });
      } else if (aiResult.aiKey === 'draft-status-report' && d.report) {
        const report = d.report as Record<string, string>;
        await isProjectsApi.createUpdate(projectId, {
          what_was_done: report.accomplishments || report.summary || report.what_was_done || '',
          whats_planned: report.next_steps || report.planned || report.whats_planned || '',
          blockers: report.blockers || report.risks || report.issues || '',
          notes: report.recommendations || report.notes || '',
          health_status: report.overall_health || report.health_status || 'On Track',
        });
        queryClient.invalidateQueries({ queryKey: ['is-project', projectId] });
      } else if (aiResult.aiKey === 'estimate-budget' && d.budget_estimate) {
        const estimate = d.budget_estimate as Record<string, unknown>;
        const items = (estimate.line_items || []) as Array<Record<string, unknown>>;
        for (const item of items) {
          await isProjectsApi.createBudgetItem(projectId, {
            category: (item.category || 'Other') as string,
            description: (item.description || '') as string,
            amount: Number(item.estimated_amount || item.amount || 0),
            status: 'Pending',
            notes: (item.notes || '') as string,
          });
        }
        refetchBudget();
      } else if (aiResult.aiKey === 'suggest-team' && d.team_suggestion) {
        const suggestion = d.team_suggestion as Record<string, unknown>;
        const roles = (suggestion.recommended_roles || []) as Array<Record<string, unknown>>;
        for (const r of roles) {
          await isProjectsApi.addTeamMember(projectId, {
            user_name: (r.role || 'TBD') as string,
            role: (r.role || 'Team Member') as string,
            email: '',
            responsibilities: (r.responsibilities || '') as string,
          });
        }
        queryClient.invalidateQueries({ queryKey: ['is-project', projectId] });
      }
      setAiResult(null);
    } catch (err) {
      setAiResult({ title: 'Apply Failed', data: { error: 'Failed to apply AI results. Some items may have been partially created.' } });
    } finally {
      setAiApplying(false);
    }
  };

  const canApplyAi = aiResult?.aiKey && ['generate-plan', 'assess-risks', 'draft-status-report', 'estimate-budget', 'suggest-team'].includes(aiResult.aiKey) && !(aiResult.data as Record<string, unknown>)?.error;

  const [modalForm, setModalForm] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="animate-spin text-blue-600" size={32} /></div>;
  }

  if (error || !project) {
    return (
      <div className="space-y-4">
        <button onClick={() => router.push('/is-projects')} className="flex items-center gap-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft size={16} /> Back to Projects
        </button>
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertCircle size={16} /> Project not found
        </div>
      </div>
    );
  }

  const budgetUtil = project.budget_estimated > 0 ? Math.round((project.budget_actual / project.budget_estimated) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/is-projects')} className="cw-btn-secondary rounded-lg p-2 transition-colors">
            <ArrowLeft size={18} className="text-[var(--color-text)]" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{project.name}</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(project.status)}`}>{project.status}</span>
              <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${healthColor(project.health)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${healthDot(project.health)}`} />{project.health}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadge(project.priority)}`}>{project.priority}</span>
              <span className="text-xs text-[var(--color-muted)]">{project.category}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEditingProject(true); setEditForm({ name: project.name, description: project.description || '', status: project.status, health: project.health, priority: project.priority, category: project.category, project_owner_name: project.project_owner_name || '', sponsor: project.sponsor || '', department: project.department || '', budget_estimated: project.budget_estimated || 0, budget_actual: project.budget_actual || 0, completion_percentage: project.completion_percentage || 0, business_justification: project.business_justification || '', start_date: project.start_date ? project.start_date.split('T')[0] : '', target_end_date: project.target_end_date ? project.target_end_date.split('T')[0] : '', linked_risks_text: (project.linked_risks || []).join('\n'), linked_controls_text: (project.linked_controls || []).join('\n'), linked_frameworks_text: (project.linked_frameworks || []).join('\n') }); }} className="cw-btn-secondary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors">
            <Edit size={14} /> Edit
          </button>
          <button onClick={() => { if (confirm('Delete this project?')) deleteProjectMut.mutate(); }} className="cw-btn-danger flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--color-border)] overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap cw-tab ${activeTab === tab.key ? 'cw-tab-active' : ''}`}
          >
            <tab.icon size={15} /> {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="cw-card p-5">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">Project Summary</h3>
              <p className="text-sm text-[var(--color-muted)] whitespace-pre-wrap">{project.description || 'No description provided'}</p>
            </div>
            {project.business_justification && (
              <div className="cw-card p-5">
                <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">Business Justification</h3>
                <p className="text-sm text-[var(--color-muted)] whitespace-pre-wrap">{project.business_justification}</p>
              </div>
            )}
            {((project.linked_risks && project.linked_risks.length > 0) || (project.linked_controls && project.linked_controls.length > 0) || (project.linked_frameworks && project.linked_frameworks.length > 0)) && (
              <div className="cw-card p-5">
                <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3 flex items-center gap-2"><Link2 size={14} /> Linked GRC Entities</h3>
                <div className="space-y-3">
                  {project.linked_risks && project.linked_risks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1">Linked Risks</p>
                      <div className="flex flex-wrap gap-1">
                        {project.linked_risks.map((r: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded text-xs">{r}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {project.linked_controls && project.linked_controls.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1">Linked Controls</p>
                      <div className="flex flex-wrap gap-1">
                        {project.linked_controls.map((c: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs">{c}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {project.linked_frameworks && project.linked_frameworks.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1">Linked Frameworks</p>
                      <div className="flex flex-wrap gap-1">
                        {project.linked_frameworks.map((f: string, i: number) => (
                          <span key={i} className="px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-200 rounded text-xs">{f}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="cw-card p-5">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-3">Progress</h3>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="cw-progress-track w-full rounded-full h-3">
                    <div className="cw-progress-fill-success h-3 rounded-full transition-all" style={{ width: `${Math.min(project.completion_percentage, 100)}%` }} />
                  </div>
                </div>
                <span className="text-lg font-bold text-[var(--color-text)]">{Math.round(project.completion_percentage)}%</span>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="cw-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Key Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Owner</span><span className="font-medium text-[var(--color-text)]">{project.project_owner_name || '—'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Sponsor</span><span className="font-medium text-[var(--color-text)]">{project.sponsor || '—'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Department</span><span className="font-medium text-[var(--color-text)]">{project.department || '—'}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Start Date</span><span className="font-medium text-[var(--color-text)]">{formatDate(project.start_date)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Target End</span><span className="font-medium text-[var(--color-text)]">{formatDate(project.target_end_date)}</span></div>
              </div>
            </div>
            <div className="cw-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Budget</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Estimated</span><span className="font-medium text-[var(--color-text)]">{formatCurrency(project.budget_estimated)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Actual</span><span className="font-medium text-[var(--color-text)]">{formatCurrency(project.budget_actual)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--color-muted)]">Utilization</span><span className={`font-medium ${budgetUtil > 100 ? 'text-red-600' : 'text-[var(--color-text)]'}`}>{budgetUtil}%</span></div>
              </div>
              <div className="cw-progress-track w-full rounded-full h-2">
                <div className={`h-2 rounded-full ${budgetUtil > 100 ? 'bg-red-500' : budgetUtil > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${Math.min(budgetUtil, 100)}%` }} />
              </div>
            </div>
            <div className="cw-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)]">Quick Stats</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-center p-2 bg-[var(--color-subtle)] rounded-lg">
                  <p className="text-lg font-bold text-[var(--color-text)]">{project.milestones?.length || 0}</p>
                  <p className="text-xs text-[var(--color-muted)]">Milestones</p>
                </div>
                <div className="text-center p-2 bg-[var(--color-subtle)] rounded-lg">
                  <p className="text-lg font-bold text-[var(--color-text)]">{project.tasks?.length || 0}</p>
                  <p className="text-xs text-[var(--color-muted)]">Tasks</p>
                </div>
                <div className="text-center p-2 bg-[var(--color-subtle)] rounded-lg">
                  <p className="text-lg font-bold text-[var(--color-text)]">{project.team_members?.length || 0}</p>
                  <p className="text-xs text-[var(--color-muted)]">Team</p>
                </div>
                <div className="text-center p-2 bg-[var(--color-subtle)] rounded-lg">
                  <p className="text-lg font-bold text-amber-600">{project.risks_issues?.filter((r: { status: string }) => r.status === 'Open').length || 0}</p>
                  <p className="text-xs text-[var(--color-muted)]">Open Risks</p>
                </div>
              </div>
            </div>
            <div className="cw-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2"><Sparkles size={14} className="text-purple-600" /> AI Assistant</h3>
              <div className="space-y-2">
                <button onClick={() => runAi('generate-plan', () => isProjectsApi.aiGeneratePlan(projectId), 'AI-Generated Plan')} disabled={!!aiLoading} className="w-full flex items-center gap-2 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                  {aiLoading === 'generate-plan' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Generate Plan
                </button>
                <button onClick={() => runAi('assess-risks', () => isProjectsApi.aiAssessRisks(projectId), 'AI Risk Assessment')} disabled={!!aiLoading} className="w-full flex items-center gap-2 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                  {aiLoading === 'assess-risks' ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />} Assess Risks
                </button>
                <button onClick={() => runAi('draft-status-report', () => isProjectsApi.aiDraftStatusReport(projectId), 'AI Status Report')} disabled={!!aiLoading} className="w-full flex items-center gap-2 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                  {aiLoading === 'draft-status-report' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />} Draft Status Report
                </button>
                <button onClick={() => runAi('suggest-team', () => isProjectsApi.aiSuggestTeam(projectId), 'AI Team Suggestions')} disabled={!!aiLoading} className="w-full flex items-center gap-2 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                  {aiLoading === 'suggest-team' ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />} Suggest Team
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'milestones' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Milestones</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => runAi('generate-plan', () => isProjectsApi.aiGeneratePlan(projectId), 'AI-Generated Plan')} disabled={!!aiLoading} className="flex items-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                {aiLoading === 'generate-plan' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Generate
              </button>
              <button onClick={() => { setShowModal('milestone'); setModalForm({ name: '', description: '', target_date: '', status: 'Pending', completion_percentage: '0' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={14} /> Add Milestone
              </button>
            </div>
          </div>
          {(project.milestones || []).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <Milestone size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No milestones yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {project.milestones.map((m: { id: number; name: string; description: string; target_date: string; actual_completion_date: string; status: string; completion_percentage: number; deliverables: string[] }) => (
                <div key={m.id} className="cw-card p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-[var(--color-text)]">{m.name}</h4>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(m.status)}`}>{m.status}</span>
                      </div>
                      {m.description && <p className="text-xs text-[var(--color-muted)] mb-2">{m.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-[var(--color-muted)]">
                        <span className="flex items-center gap-1"><Calendar size={12} />Target: {formatDate(m.target_date)}</span>
                        {m.actual_completion_date && <span className="flex items-center gap-1"><CheckCircle2 size={12} />Completed: {formatDate(m.actual_completion_date)}</span>}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="cw-progress-track w-32 rounded-full h-1.5">
                          <div className="cw-progress-fill-success h-1.5 rounded-full" style={{ width: `${m.completion_percentage}%` }} />
                        </div>
                        <span className="text-xs text-[var(--color-muted)]">{Math.round(m.completion_percentage)}%</span>
                      </div>
                      {m.deliverables && m.deliverables.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {m.deliverables.map((d: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 bg-[var(--color-subtle)] rounded text-xs text-[var(--color-muted)]">{d}</span>
                          ))}
                        </div>
                      )}
                      <MilestoneEvidencePanel projectId={projectId} milestoneId={m.id} />
                    </div>
                    <div className="flex items-center gap-2 ml-3">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={m.completion_percentage}
                        onChange={(e) => updateMilestoneMut.mutate({ id: m.id, data: { completion_percentage: parseInt(e.target.value) || 0 } })}
                        className="cw-field w-14 text-xs px-1 py-0.5 text-center"
                        title="Completion %"
                      />
                      <select
                        value={m.status}
                        onChange={(e) => updateMilestoneMut.mutate({ id: m.id, data: { status: e.target.value } })}
                        className="cw-field text-xs px-1 py-0.5"
                      >
                        {MILESTONE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => deleteMilestoneMut.mutate(m.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'tasks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Tasks</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => runAi('generate-plan', () => isProjectsApi.aiGeneratePlan(projectId), 'AI-Generated Plan')} disabled={!!aiLoading} className="flex items-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                {aiLoading === 'generate-plan' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Generate
              </button>
              <button onClick={() => { setShowModal('task'); setModalForm({ title: '', description: '', assignee_name: '', priority: 'Medium', status: 'To Do', due_date: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={14} /> Add Task
              </button>
            </div>
          </div>
          {(project.tasks || []).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <CheckCircle2 size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No tasks yet</p>
            </div>
          ) : (
            <div className="cw-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-subtle)]">
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Task</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Assignee</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Priority</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Due Date</th>
                    <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Progress</th>
                    <th className="w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {project.tasks.map((t: { id: number; title: string; assignee_name: string; status: string; priority: string; due_date: string; progress: number; dependencies: string[] }) => (
                    <tr key={t.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-[var(--color-text)]">{t.title}</div>
                        {t.dependencies && t.dependencies.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {t.dependencies.map((dep: string, i: number) => (
                              <span key={i} className="px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded text-[10px]">depends: {dep}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{t.assignee_name || '—'}</td>
                      <td className="px-4 py-3">
                        <select
                          value={t.status}
                          onChange={(e) => updateTaskMut.mutate({ id: t.id, data: { status: e.target.value } })}
                          className="cw-field text-xs px-2 py-1"
                        >
                          {TASK_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadge(t.priority)}`}>{t.priority}</span></td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{formatDate(t.due_date)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={t.progress}
                            onChange={(e) => updateTaskMut.mutate({ id: t.id, data: { progress: parseInt(e.target.value) } })}
                            className="w-16 h-1.5 accent-[var(--color-base)]"
                          />
                          <span className="text-xs w-8">{Math.round(t.progress)}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteTaskMut.mutate(t.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Team Members</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => runAi('suggest-team', () => isProjectsApi.aiSuggestTeam(projectId), 'AI Team Suggestions')} disabled={!!aiLoading} className="flex items-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                {aiLoading === 'suggest-team' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Suggest
              </button>
              <button onClick={() => { setShowModal('team'); setModalForm({ user_name: '', email: '', role: 'Member', responsibilities: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={14} /> Add Member
              </button>
            </div>
          </div>
          {(project.team_members || []).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <Users size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No team members yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {project.team_members.map((tm: { id: number; user_name: string; email: string; role: string; responsibilities: string; joined_at: string }) => (
                <div key={tm.id} className="cw-card p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-medium text-[var(--color-text)]">{tm.user_name}</h4>
                      <p className="text-xs text-[var(--color-muted)]">{tm.email || '—'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">{tm.role}</span>
                      <button onClick={() => removeTeamMut.mutate(tm.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {tm.responsibilities && <p className="text-xs text-[var(--color-muted)] mt-2">{tm.responsibilities}</p>}
                  <p className="text-xs text-[var(--color-muted)] mt-2 flex items-center gap-1"><Clock size={10} />Joined {formatDate(tm.joined_at)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'risks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Risks & Issues</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => runAi('assess-risks', () => isProjectsApi.aiAssessRisks(projectId), 'AI Risk Assessment')} disabled={!!aiLoading} className="flex items-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                {aiLoading === 'assess-risks' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Assess
              </button>
              <button onClick={() => { setShowModal('risk'); setModalForm({ title: '', description: '', type: 'Risk', severity: 'Medium', mitigation: '', owner_name: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={14} /> Add Risk/Issue
              </button>
            </div>
          </div>
          {(project.risks_issues || []).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <AlertTriangle size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No risks or issues recorded</p>
            </div>
          ) : (
            <div className="space-y-3">
              {project.risks_issues.map((r: { id: number; title: string; description: string; type: string; severity: string; status: string; mitigation: string; owner_name: string; identified_date: string }) => (
                <div key={r.id} className="cw-card p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-medium text-[var(--color-text)]">{r.title}</h4>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadge(r.severity)}`}>{r.severity}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(r.status)}`}>{r.status}</span>
                        <span className="px-2 py-0.5 bg-[var(--color-subtle)] rounded text-xs text-[var(--color-muted)]">{r.type}</span>
                      </div>
                      {r.description && <p className="text-xs text-[var(--color-muted)] mb-2">{r.description}</p>}
                      {r.mitigation && <p className="text-xs text-[var(--color-muted)]"><strong>Mitigation:</strong> {r.mitigation}</p>}
                      <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-muted)]">
                        {r.owner_name && <span>Owner: {r.owner_name}</span>}
                        <span>Identified: {formatDate(r.identified_date)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      <select
                        value={r.status}
                        onChange={(e) => updateRiskMut.mutate({ id: r.id, data: { status: e.target.value } })}
                        className="cw-field text-xs px-1 py-0.5"
                      >
                        {['Open', 'Mitigated', 'Closed', 'Resolved'].map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <button onClick={() => deleteRiskMut.mutate(r.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'updates' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Status Updates</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => runAi('draft-status-report', () => isProjectsApi.aiDraftStatusReport(projectId), 'AI Status Report')} disabled={!!aiLoading} className="flex items-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors disabled:opacity-50">
                {aiLoading === 'draft-status-report' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Draft
              </button>
              <button onClick={() => { setShowModal('update'); setModalForm({ health_status: project.health, what_was_done: '', whats_planned: '', blockers: '', notes: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={14} /> Add Update
              </button>
            </div>
          </div>
          {(project.status_updates || []).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <MessageSquare size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No status updates yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {project.status_updates.map((su: { id: number; author_name: string; update_date: string; health_status: string; what_was_done: string; whats_planned: string; blockers: string; notes: string }) => (
                <div key={su.id} className="cw-card p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
                        <MessageSquare size={14} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[var(--color-text)]">{su.author_name || 'Unknown'}</p>
                        <p className="text-xs text-[var(--color-muted)]">{formatDate(su.update_date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border ${healthColor(su.health_status)}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${healthDot(su.health_status)}`} />{su.health_status}
                      </span>
                      <button onClick={() => deleteUpdateMut.mutate(su.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="space-y-3 text-sm">
                    {su.what_was_done && (
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1">What Was Done</p>
                        <p className="text-[var(--color-text)] whitespace-pre-wrap">{su.what_was_done}</p>
                      </div>
                    )}
                    {su.whats_planned && (
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1">What&apos;s Planned</p>
                        <p className="text-[var(--color-text)] whitespace-pre-wrap">{su.whats_planned}</p>
                      </div>
                    )}
                    {su.blockers && (
                      <div>
                        <p className="text-xs font-semibold text-red-500 uppercase mb-1">Blockers</p>
                        <p className="text-[var(--color-text)] whitespace-pre-wrap">{su.blockers}</p>
                      </div>
                    )}
                    {su.notes && (
                      <div>
                        <p className="text-xs font-semibold text-[var(--color-muted)] uppercase mb-1">Notes</p>
                        <p className="text-[var(--color-text)] whitespace-pre-wrap">{su.notes}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Documents</h3>
            <button onClick={() => { setShowModal('document'); setDocumentUploadFile(null); setModalForm({ title: '', description: '', document_type: 'Reference', url: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
              <Plus size={14} /> Add Document
            </button>
          </div>
          {(project.documents || []).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <FileText size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No documents linked yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {project.documents.map((d: { id: number; title: string; description: string; document_type: string; url: string; is_uploaded_file?: boolean; file_name?: string; created_by_name: string; created_at: string }) => (
                <div key={d.id} className="cw-card p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={18} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-[var(--color-text)]">{d.title}</h4>
                    {d.description && <p className="text-xs text-[var(--color-muted)] truncate">{d.description}</p>}
                    <div className="flex items-center gap-3 mt-1 text-xs text-[var(--color-muted)]">
                      <span>{d.document_type}</span>
                      {d.created_by_name && <span>Added by {d.created_by_name}</span>}
                      <span>{formatDate(d.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.is_uploaded_file ? (
                      <button onClick={() => handleDownloadDocument(d.id, d.file_name || d.title)} className="p-2 hover:bg-[var(--color-subtle)] rounded text-blue-600" title="Download file">
                        <Download size={14} />
                      </button>
                    ) : d.url ? (
                      <a href={d.url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-[var(--color-subtle)] rounded text-blue-600">
                        <Link2 size={14} />
                      </a>
                    ) : null}
                    <button onClick={() => removeDocMut.mutate(d.id)} className="p-2 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'budget' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Budget & Financials</h3>
            <div className="flex items-center gap-2">
              <button onClick={() => runAi('estimate-budget', () => isProjectsApi.aiEstimateBudget(projectId), 'AI Budget Estimate')} disabled={aiLoading === 'estimate-budget'} className="flex items-center gap-1.5 px-3 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50 transition-colors">
                {aiLoading === 'estimate-budget' ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} AI Estimate
              </button>
              <button onClick={() => { setEditingId(null); setShowModal('budget'); setModalForm({ category: 'Hardware', description: '', amount: '', status: 'Pending', approved_by: '', notes: '', date: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
                <Plus size={14} /> Add Item
              </button>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div className="cw-card p-4">
              <p className="text-xs text-[var(--color-muted)]">Budget Estimated</p>
              <p className="text-xl font-bold text-[var(--color-text)]">{formatCurrency(budgetData?.budget_estimated || 0)}</p>
            </div>
            <div className="cw-card p-4">
              <p className="text-xs text-[var(--color-muted)]">Total Spent (Approved)</p>
              <p className="text-xl font-bold text-[var(--color-text)]">{formatCurrency(budgetData?.total_spent || 0)}</p>
            </div>
            <div className="cw-card p-4">
              <p className="text-xs text-[var(--color-muted)]">Variance</p>
              {(() => {
                const variance = (budgetData?.budget_estimated || 0) - (budgetData?.total_spent || 0);
                const pct = budgetData?.budget_estimated ? Math.round((variance / budgetData.budget_estimated) * 100) : 0;
                return <p className={`text-xl font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(Math.abs(variance))} <span className="text-sm font-normal">({pct}%)</span></p>;
              })()}
            </div>
            <div className="cw-card p-4">
              <p className="text-xs text-[var(--color-muted)]">Line Items</p>
              <p className="text-xl font-bold text-[var(--color-text)]">{budgetItems.length}</p>
            </div>
          </div>
          {budgetData?.budget_estimated > 0 && (
            <div className="cw-card p-4">
              <p className="text-xs font-medium text-[var(--color-muted)] mb-3">Budget vs Actual by Category</p>
              <div className="space-y-3">
                {Object.entries(budgetItems.reduce((acc: Record<string, { approved: number; pending: number }>, item) => {
                  if (!acc[item.category]) acc[item.category] = { approved: 0, pending: 0 };
                  if (item.status === 'Approved') acc[item.category].approved += item.amount;
                  else acc[item.category].pending += item.amount;
                  return acc;
                }, {})).map(([cat, vals]) => (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium text-[var(--color-text)]">{cat}</span>
                      <span className="text-[var(--color-muted)]">{formatCurrency(vals.approved + vals.pending)}</span>
                    </div>
                    <div className="h-3 cw-progress-track rounded-full overflow-hidden flex">
                      <div className="bg-blue-500 h-full" style={{ width: `${Math.min(100, (vals.approved / (budgetData?.budget_estimated || 1)) * 100)}%` }} />
                      <div className="bg-blue-200 h-full" style={{ width: `${Math.min(100, (vals.pending / (budgetData?.budget_estimated || 1)) * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 mt-3 text-xs text-[var(--color-muted)]">
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded-sm inline-block" /> Approved</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-200 rounded-sm inline-block" /> Pending</span>
              </div>
            </div>
          )}
          {budgetItems.length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <Receipt size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No budget items yet</p>
            </div>
          ) : (
            <div className="cw-card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-[var(--color-border)] bg-[var(--color-subtle)]">
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Category</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Description</th>
                  <th className="text-right px-4 py-3 font-medium text-[var(--color-muted)]">Amount</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-[var(--color-muted)]">Approved By</th>
                  <th className="px-4 py-3"></th>
                </tr></thead>
                <tbody>
                  {budgetItems.map(item => (
                    <tr key={item.id} className="border-b border-[var(--color-border)] last:border-0">
                      <td className="px-4 py-3 font-medium">{item.category}</td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{item.description || '—'}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(item.amount)}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(item.status)}`}>{item.status}</span></td>
                      <td className="px-4 py-3 text-[var(--color-muted)]">{item.approved_by || '—'}</td>
                      <td className="px-4 py-3 flex items-center gap-1">
                        <button onClick={() => { setEditingId(item.id); setShowModal('budget'); setModalForm({ category: item.category, description: item.description || '', amount: String(item.amount), status: item.status, approved_by: item.approved_by || '', notes: item.notes || '', date: item.date || '' }); }} className="p-1 hover:bg-blue-50 rounded text-blue-500"><Edit size={14} /></button>
                        <button onClick={() => deleteBudgetMut.mutate(item.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'compliance' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Compliance Mapping</h3>
            <button onClick={() => { setEditingId(null); setShowModal('compliance'); setModalForm({ framework_name: '', control_id: '', control_name: '', coverage_status: 'Planned', requirement_description: '', deliverable: '', notes: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
              <Plus size={14} /> Add Mapping
            </button>
          </div>
          {(complianceMappings as Array<unknown>).length > 0 && (() => {
            const mappings = complianceMappings as Array<{coverage_status: string; framework_name: string}>;
            const statusCounts = mappings.reduce((acc: Record<string, number>, m) => { acc[m.coverage_status] = (acc[m.coverage_status] || 0) + 1; return acc; }, {});
            const frameworkCounts = mappings.reduce((acc: Record<string, Record<string, number>>, m) => {
              if (!acc[m.framework_name]) acc[m.framework_name] = {};
              acc[m.framework_name][m.coverage_status] = (acc[m.framework_name][m.coverage_status] || 0) + 1;
              return acc;
            }, {});
            const total = mappings.length;
            const colors: Record<string, string> = { 'Verified': 'bg-green-500', 'Implemented': 'bg-blue-500', 'In Progress': 'bg-yellow-500', 'Planned': 'bg-gray-300', 'Not Applicable': 'bg-gray-100' };
            return (
              <div className="cw-card p-4 space-y-4">
                <div>
                  <p className="text-xs font-medium text-[var(--color-muted)] mb-2">Overall Coverage</p>
                  <div className="h-4 rounded-full overflow-hidden flex cw-progress-track">
                    {['Verified', 'Implemented', 'In Progress', 'Planned', 'Not Applicable'].map(s => statusCounts[s] ? (
                      <div key={s} className={`${colors[s]} h-full`} style={{ width: `${(statusCounts[s] / total) * 100}%` }} title={`${s}: ${statusCounts[s]}`} />
                    ) : null)}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-2 text-xs text-[var(--color-muted)]">
                    {['Verified', 'Implemented', 'In Progress', 'Planned', 'Not Applicable'].filter(s => statusCounts[s]).map(s => (
                      <span key={s} className="flex items-center gap-1"><span className={`w-2.5 h-2.5 ${colors[s]} rounded-sm inline-block`} /> {s}: {statusCounts[s]}</span>
                    ))}
                  </div>
                </div>
                {Object.keys(frameworkCounts).length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-[var(--color-muted)] mb-2">By Framework</p>
                    <div className="space-y-2">
                      {Object.entries(frameworkCounts).map(([fw, counts]) => {
                        const fwTotal = Object.values(counts).reduce((a, b) => a + b, 0);
                        return (
                          <div key={fw}>
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span className="font-medium">{fw}</span>
                              <span className="text-[var(--color-muted)]">{fwTotal} controls</span>
                            </div>
                            <div className="h-2.5 rounded-full overflow-hidden flex cw-progress-track">
                              {['Verified', 'Implemented', 'In Progress', 'Planned', 'Not Applicable'].map(s => counts[s] ? (
                                <div key={s} className={`${colors[s]} h-full`} style={{ width: `${(counts[s] / fwTotal) * 100}%` }} />
                              ) : null)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
          {(complianceMappings as Array<unknown>).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <Shield size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No compliance mappings yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(complianceMappings as Array<{id: number; framework_name: string; control_id: string; control_name: string; coverage_status: string; requirement_description: string; deliverable: string; notes: string}>).map(m => (
                <div key={m.id} className="cw-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs font-medium">{m.framework_name}</span>
                      <span className="font-medium text-[var(--color-text)]">{m.control_id} — {m.control_name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(m.coverage_status)}`}>{m.coverage_status}</span>
                      <button onClick={() => { setEditingId(m.id); setShowModal('compliance'); setModalForm({ framework_name: m.framework_name, control_id: m.control_id, control_name: m.control_name, coverage_status: m.coverage_status, requirement_description: m.requirement_description || '', deliverable: m.deliverable || '', notes: m.notes || '' }); }} className="p-1 hover:bg-blue-50 rounded text-blue-500"><Edit size={14} /></button>
                      <button onClick={() => deleteComplianceMut.mutate(m.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {m.requirement_description && <p className="text-xs text-[var(--color-muted)]">Requirement: {m.requirement_description}</p>}
                  {m.deliverable && <p className="text-xs text-[var(--color-muted)] mt-1">Deliverable: {m.deliverable}</p>}
                  {m.notes && <p className="text-xs text-[var(--color-muted)] mt-1">{m.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'lessons' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Lessons Learned</h3>
            <button onClick={() => { setEditingId(null); setShowModal('lesson'); setModalForm({ title: '', description: '', category: 'Recommendation', impact: 'Medium' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
              <Plus size={14} /> Add Lesson
            </button>
          </div>
          {(lessonsLearned as Array<unknown>).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <BookOpen size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No lessons recorded yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(lessonsLearned as Array<{id: number; title: string; description: string; category: string; impact: string; author_name: string; created_at: string}>).map(l => (
                <div key={l.id} className="cw-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-[var(--color-text)]">{l.title}</h4>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-medium">{l.category}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${priorityBadge(l.impact)}`}>{l.impact}</span>
                      <button onClick={() => { setEditingId(l.id); setShowModal('lesson'); setModalForm({ title: l.title, description: l.description || '', category: l.category || 'Recommendation', impact: l.impact || 'Medium' }); }} className="p-1 hover:bg-blue-50 rounded text-blue-500"><Edit size={14} /></button>
                      <button onClick={() => deleteLessonMut.mutate(l.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {l.description && <p className="text-sm text-[var(--color-muted)]">{l.description}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-muted)]">
                    {l.author_name && <span>By {l.author_name}</span>}
                    <span>{formatDate(l.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'dependencies' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Dependencies</h3>
            <button onClick={() => { setEditingId(null); setShowModal('dependency'); setModalForm({ dependency_type: 'internal', dependent_project_name: '', external_dependency: '', description: '', status: 'Active', direction: 'depends_on', impact_if_delayed: '', expected_date: '' }); }} className="cw-btn-primary flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium">
              <Plus size={14} /> Add Dependency
            </button>
          </div>
          {(dependencies as Array<unknown>).length > 0 && (() => {
            const deps = dependencies as Array<{status: string; dependency_type: string; direction: string; impact_if_delayed: string}>;
            const byType = deps.reduce((acc: Record<string, number>, d) => { acc[d.dependency_type] = (acc[d.dependency_type] || 0) + 1; return acc; }, {});
            const blocked = deps.filter(d => d.status === 'Blocked').length;
            const criticalImpact = deps.filter(d => d.impact_if_delayed === 'Critical' || d.impact_if_delayed === 'High').length;
            return (
              <div className="grid grid-cols-4 gap-4">
                <div className="cw-card p-4">
                  <p className="text-xs text-[var(--color-muted)]">Total Dependencies</p>
                  <p className="text-xl font-bold text-[var(--color-text)]">{deps.length}</p>
                </div>
                <div className="cw-card p-4">
                  <p className="text-xs text-[var(--color-muted)]">Blocked</p>
                  <p className={`text-xl font-bold ${blocked > 0 ? 'text-red-600' : 'text-green-600'}`}>{blocked}</p>
                </div>
                <div className="cw-card p-4">
                  <p className="text-xs text-[var(--color-muted)]">High/Critical Impact</p>
                  <p className={`text-xl font-bold ${criticalImpact > 0 ? 'text-amber-600' : 'text-[var(--color-text)]'}`}>{criticalImpact}</p>
                </div>
                <div className="cw-card p-4">
                  <p className="text-xs text-[var(--color-muted)]">By Type</p>
                  <div className="flex items-center gap-2 mt-1">
                    {Object.entries(byType).map(([t, c]) => (
                      <span key={t} className={`px-2 py-0.5 rounded text-xs font-medium border ${t === 'external' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{t}: {c}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
          {(dependencies as Array<unknown>).length > 0 && (() => {
            const deps = dependencies as Array<{id: number; direction: string; status: string; dependent_project_name: string; external_dependency: string}>;
            const directions = ['depends_on', 'blocks', 'related_to'];
            const dirLabels: Record<string, string> = { depends_on: 'Depends On', blocks: 'Blocks', related_to: 'Related To' };
            const dirColors: Record<string, string> = { depends_on: 'border-l-blue-500', blocks: 'border-l-red-500', related_to: 'border-l-gray-400' };
            const grouped = directions.filter(d => deps.some(dep => dep.direction === d));
            if (grouped.length <= 1) return null;
            return (
              <div className="cw-card p-4">
                <p className="text-xs font-medium text-[var(--color-muted)] mb-3">Dependency Map</p>
                <div className="grid grid-cols-3 gap-4">
                  {grouped.map(dir => (
                    <div key={dir}>
                      <p className="text-xs font-semibold text-[var(--color-text)] mb-2">{dirLabels[dir]}</p>
                      <div className="space-y-1">
                        {deps.filter(d => d.direction === dir).map(d => (
                          <div key={d.id} className={`border-l-2 ${dirColors[dir]} pl-2 py-1 text-xs text-[var(--color-muted)]`}>
                            {d.dependent_project_name || d.external_dependency || 'Unnamed'}
                            <span className={`ml-1 px-1 rounded ${d.status === 'Blocked' ? 'bg-red-100 text-red-700' : d.status === 'Resolved' ? 'bg-green-100 text-green-700' : ''}`}>{d.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
          {(dependencies as Array<unknown>).length === 0 ? (
            <div className="cw-card text-center py-12 text-[var(--color-muted)]">
              <GitBranch size={40} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm">No dependencies tracked yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(dependencies as Array<{id: number; dependency_type: string; dependent_project_name: string; external_dependency: string; description: string; status: string; direction: string; impact_if_delayed: string; expected_date: string}>).map(dep => (
                <div key={dep.id} className="cw-card p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${dep.dependency_type === 'external' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>{dep.dependency_type}</span>
                      <h4 className="font-medium text-[var(--color-text)]">{dep.dependent_project_name || dep.external_dependency || 'Unnamed'}</h4>
                      <span className="text-xs text-[var(--color-muted)]">({dep.direction})</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium border ${statusBadge(dep.status)}`}>{dep.status}</span>
                      <button onClick={() => { setEditingId(dep.id); setShowModal('dependency'); setModalForm({ dependency_type: dep.dependency_type, dependent_project_name: dep.dependent_project_name || '', external_dependency: dep.external_dependency || '', description: dep.description || '', status: dep.status, direction: dep.direction || 'depends_on', impact_if_delayed: dep.impact_if_delayed || '', expected_date: dep.expected_date || '' }); }} className="p-1 hover:bg-blue-50 rounded text-blue-500"><Edit size={14} /></button>
                      <button onClick={() => deleteDepMut.mutate(dep.id)} className="p-1 hover:bg-red-50 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {dep.description && <p className="text-sm text-[var(--color-muted)]">{dep.description}</p>}
                  <div className="flex items-center gap-4 mt-2 text-xs text-[var(--color-muted)]">
                    {dep.expected_date && <span>Expected: {formatDate(dep.expected_date)}</span>}
                    {dep.impact_if_delayed && <span className="text-amber-600">Impact: {dep.impact_if_delayed}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {aiResult && (
        <div className="fixed inset-0 cw-overlay flex items-center justify-center z-50 p-4" onClick={() => setAiResult(null)}>
          <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-purple-600" />
                <h2 className="text-lg font-semibold text-[var(--color-text)]">{aiResult.title}</h2>
              </div>
              <button onClick={() => setAiResult(null)} className="p-1 hover:bg-[var(--color-subtle)] rounded"><X size={18} /></button>
            </div>
            <div className="p-5 overflow-y-auto flex-1">
              <pre className="text-sm text-[var(--color-muted)] whitespace-pre-wrap font-sans leading-relaxed">{JSON.stringify(aiResult.data, null, 2)}</pre>
            </div>
            {canApplyAi && (
              <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--color-border)]">
                <button onClick={() => setAiResult(null)} className="cw-btn-secondary px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                  Discard
                </button>
                <button onClick={applyAiResult} disabled={aiApplying} className="cw-btn-primary flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
                  {aiApplying ? <><Loader2 size={14} className="animate-spin" /> Applying...</> : <><CheckCircle2 size={14} /> Apply to Project</>}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 cw-overlay flex items-center justify-center z-50 p-4" onClick={() => { setShowModal(null); setEditingId(null); setDocumentUploadFile(null); }}>
          <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">
                {showModal === 'milestone' && 'Add Milestone'}
                {showModal === 'task' && 'Add Task'}
                {showModal === 'team' && 'Add Team Member'}
                {showModal === 'risk' && 'Add Risk/Issue'}
                {showModal === 'update' && 'Add Status Update'}
                {showModal === 'document' && 'Add Document'}
                {showModal === 'budget' && (editingId ? 'Edit Budget Item' : 'Add Budget Item')}
                {showModal === 'compliance' && (editingId ? 'Edit Compliance Mapping' : 'Add Compliance Mapping')}
                {showModal === 'lesson' && (editingId ? 'Edit Lesson Learned' : 'Add Lesson Learned')}
                {showModal === 'dependency' && (editingId ? 'Edit Dependency' : 'Add Dependency')}
              </h2>
              <button onClick={() => { setShowModal(null); setEditingId(null); setDocumentUploadFile(null); }} className="p-1 hover:bg-[var(--color-subtle)] rounded"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              {showModal === 'milestone' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Name <span className="cw-required">*</span></label><input type="text" value={modalForm.name || ''} onChange={e => setModalForm({ ...modalForm, name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description</label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Target Date</label><input type="date" value={modalForm.target_date || ''} onChange={e => setModalForm({ ...modalForm, target_date: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Status</label><select value={modalForm.status || 'Pending'} onChange={e => setModalForm({ ...modalForm, status: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{MILESTONE_STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Completion %</label><input type="number" min="0" max="100" value={modalForm.completion_percentage || '0'} onChange={e => setModalForm({ ...modalForm, completion_percentage: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Deliverables</label><textarea value={modalForm.deliverables || ''} onChange={e => setModalForm({ ...modalForm, deliverables: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" placeholder="One deliverable per line" /></div>
                </>
              )}
              {showModal === 'task' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Title <span className="cw-required">*</span></label><input type="text" value={modalForm.title || ''} onChange={e => setModalForm({ ...modalForm, title: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description</label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Assignee</label><input type="text" value={modalForm.assignee_name || ''} onChange={e => setModalForm({ ...modalForm, assignee_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Priority</label><select value={modalForm.priority || 'Medium'} onChange={e => setModalForm({ ...modalForm, priority: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Due Date</label><input type="date" value={modalForm.due_date || ''} onChange={e => setModalForm({ ...modalForm, due_date: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Progress %</label><input type="number" min="0" max="100" value={modalForm.progress || '0'} onChange={e => setModalForm({ ...modalForm, progress: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Dependencies</label><textarea value={modalForm.dependencies || ''} onChange={e => setModalForm({ ...modalForm, dependencies: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" placeholder="One dependency per line (e.g., task names or IDs)" /></div>
                </>
              )}
              {showModal === 'team' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Name <span className="cw-required">*</span></label><input type="text" value={modalForm.user_name || ''} onChange={e => setModalForm({ ...modalForm, user_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Email</label><input type="email" value={modalForm.email || ''} onChange={e => setModalForm({ ...modalForm, email: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Role</label><select value={modalForm.role || 'Member'} onChange={e => setModalForm({ ...modalForm, role: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{TEAM_ROLES.map(r => <option key={r}>{r}</option>)}</select></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Responsibilities</label><textarea value={modalForm.responsibilities || ''} onChange={e => setModalForm({ ...modalForm, responsibilities: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                </>
              )}
              {showModal === 'risk' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Title <span className="cw-required">*</span></label><input type="text" value={modalForm.title || ''} onChange={e => setModalForm({ ...modalForm, title: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description</label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Type</label><select value={modalForm.type || 'Risk'} onChange={e => setModalForm({ ...modalForm, type: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{RISK_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Severity</label><select value={modalForm.severity || 'Medium'} onChange={e => setModalForm({ ...modalForm, severity: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{SEVERITY_LEVELS.map(s => <option key={s}>{s}</option>)}</select></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Mitigation</label><textarea value={modalForm.mitigation || ''} onChange={e => setModalForm({ ...modalForm, mitigation: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Owner</label><input type="text" value={modalForm.owner_name || ''} onChange={e => setModalForm({ ...modalForm, owner_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                </>
              )}
              {showModal === 'update' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Health Assessment</label><select value={modalForm.health_status || 'On Track'} onChange={e => setModalForm({ ...modalForm, health_status: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{HEALTH_OPTIONS.map(h => <option key={h}>{h}</option>)}</select></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">What Was Done</label><textarea value={modalForm.what_was_done || ''} onChange={e => setModalForm({ ...modalForm, what_was_done: e.target.value })} rows={3} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">What&apos;s Planned</label><textarea value={modalForm.whats_planned || ''} onChange={e => setModalForm({ ...modalForm, whats_planned: e.target.value })} rows={3} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Blockers</label><textarea value={modalForm.blockers || ''} onChange={e => setModalForm({ ...modalForm, blockers: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Notes</label><textarea value={modalForm.notes || ''} onChange={e => setModalForm({ ...modalForm, notes: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                </>
              )}
              {showModal === 'document' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Title <span className="cw-required">*</span></label><input type="text" value={modalForm.title || ''} onChange={e => setModalForm({ ...modalForm, title: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description</label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Type</label><input type="text" value={modalForm.document_type || ''} onChange={e => setModalForm({ ...modalForm, document_type: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="e.g., Policy, Deliverable, Reference" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">URL (Optional)</label><input type="url" value={modalForm.url || ''} onChange={e => setModalForm({ ...modalForm, url: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="https://..." /></div>
                  <div>
                    <label className="cw-label block text-sm font-medium mb-1">Browse File (Optional)</label>
                    <input
                      type="file"
                      onChange={e => setDocumentUploadFile(e.target.files?.[0] || null)}
                      className="cw-field w-full px-3 py-2 text-sm"
                    />
                    <p className="mt-1 text-xs text-[var(--color-muted)]">If a file is selected, it will be uploaded and stored with this project document.</p>
                  </div>
                </>
              )}
              {showModal === 'budget' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description <span className="cw-required">*</span></label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Category</label><select value={modalForm.category || 'Hardware'} onChange={e => setModalForm({ ...modalForm, category: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['Hardware', 'Software', 'Licenses', 'Consulting', 'Personnel', 'Training', 'Infrastructure', 'Other'].map(c => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Amount</label><input type="number" value={modalForm.amount || ''} onChange={e => setModalForm({ ...modalForm, amount: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Status</label><select value={modalForm.status || 'Pending'} onChange={e => setModalForm({ ...modalForm, status: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['Pending', 'Approved', 'Rejected', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Date</label><input type="date" value={modalForm.date || ''} onChange={e => setModalForm({ ...modalForm, date: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Approved By</label><input type="text" value={modalForm.approved_by || ''} onChange={e => setModalForm({ ...modalForm, approved_by: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Notes</label><textarea value={modalForm.notes || ''} onChange={e => setModalForm({ ...modalForm, notes: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                </>
              )}
              {showModal === 'compliance' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Framework <span className="cw-required">*</span></label><input type="text" value={modalForm.framework_name || ''} onChange={e => setModalForm({ ...modalForm, framework_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="e.g., ISO 27001, PCI DSS" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Control ID</label><input type="text" value={modalForm.control_id || ''} onChange={e => setModalForm({ ...modalForm, control_id: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="e.g., A.5.1" /></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Control Name</label><input type="text" value={modalForm.control_name || ''} onChange={e => setModalForm({ ...modalForm, control_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Requirement Description</label><textarea value={modalForm.requirement_description || ''} onChange={e => setModalForm({ ...modalForm, requirement_description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Deliverable</label><input type="text" value={modalForm.deliverable || ''} onChange={e => setModalForm({ ...modalForm, deliverable: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Coverage Status</label><select value={modalForm.coverage_status || 'Planned'} onChange={e => setModalForm({ ...modalForm, coverage_status: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['Planned', 'In Progress', 'Implemented', 'Verified', 'Not Applicable'].map(s => <option key={s}>{s}</option>)}</select></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Notes</label><textarea value={modalForm.notes || ''} onChange={e => setModalForm({ ...modalForm, notes: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                </>
              )}
              {showModal === 'lesson' && (
                <>
                  <div><label className="cw-label block text-sm font-medium mb-1">Title <span className="cw-required">*</span></label><input type="text" value={modalForm.title || ''} onChange={e => setModalForm({ ...modalForm, title: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description</label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={3} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Category</label><select value={modalForm.category || 'Recommendation'} onChange={e => setModalForm({ ...modalForm, category: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['Recommendation', 'Process', 'Technical', 'People', 'Vendor', 'Communication', 'Planning'].map(c => <option key={c}>{c}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Impact</label><select value={modalForm.impact || 'Medium'} onChange={e => setModalForm({ ...modalForm, impact: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['Critical', 'High', 'Medium', 'Low'].map(i => <option key={i}>{i}</option>)}</select></div>
                  </div>
                </>
              )}
              {showModal === 'dependency' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Type</label><select value={modalForm.dependency_type || 'internal'} onChange={e => setModalForm({ ...modalForm, dependency_type: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['internal', 'external'].map(t => <option key={t}>{t}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Direction</label><select value={modalForm.direction || 'depends_on'} onChange={e => setModalForm({ ...modalForm, direction: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['depends_on', 'blocks', 'related_to'].map(d => <option key={d}>{d}</option>)}</select></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Dependent Project Name</label><input type="text" value={modalForm.dependent_project_name || ''} onChange={e => setModalForm({ ...modalForm, dependent_project_name: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="Name of the project this depends on" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">External Dependency</label><input type="text" value={modalForm.external_dependency || ''} onChange={e => setModalForm({ ...modalForm, external_dependency: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" placeholder="External vendor, system, or process" /></div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Description</label><textarea value={modalForm.description || ''} onChange={e => setModalForm({ ...modalForm, description: e.target.value })} rows={2} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="cw-label block text-sm font-medium mb-1">Status</label><select value={modalForm.status || 'Active'} onChange={e => setModalForm({ ...modalForm, status: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['Active', 'Resolved', 'Blocked', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></div>
                    <div><label className="cw-label block text-sm font-medium mb-1">Expected Date</label><input type="date" value={modalForm.expected_date || ''} onChange={e => setModalForm({ ...modalForm, expected_date: e.target.value })} className="cw-field w-full px-3 py-2 text-sm" /></div>
                  </div>
                  <div><label className="cw-label block text-sm font-medium mb-1">Impact if Delayed</label><select value={modalForm.impact_if_delayed || ''} onChange={e => setModalForm({ ...modalForm, impact_if_delayed: e.target.value })} className="cw-field w-full px-3 py-2 text-sm">{['', 'Critical', 'High', 'Medium', 'Low'].map(i => <option key={i} value={i}>{i || 'Select...'}</option>)}</select></div>
                </>
              )}
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--color-border)]">
              <button onClick={() => { setShowModal(null); setEditingId(null); setDocumentUploadFile(null); }} className="cw-btn-secondary px-4 py-2 rounded-lg text-sm">Cancel</button>
              <button
                onClick={() => {
                  if (showModal === 'milestone') {
                    const payload = { ...modalForm, completion_percentage: parseFloat(modalForm.completion_percentage || '0'), deliverables: (modalForm.deliverables || '').split('\n').map((s: string) => s.trim()).filter(Boolean) };
                    createMilestoneMut.mutate(payload);
                  }
                  if (showModal === 'task') {
                    const payload = { ...modalForm, progress: parseFloat(modalForm.progress || '0'), dependencies: (modalForm.dependencies || '').split('\n').map((s: string) => s.trim()).filter(Boolean) };
                    createTaskMut.mutate(payload);
                  }
                  if (showModal === 'team') addTeamMut.mutate(modalForm);
                  if (showModal === 'risk') createRiskMut.mutate(modalForm);
                  if (showModal === 'update') createUpdateMut.mutate(modalForm);
                  if (showModal === 'document') {
                    if (documentUploadFile) {
                      const formData = new FormData();
                      formData.append('file', documentUploadFile);
                      if (modalForm.title) formData.append('title', String(modalForm.title));
                      if (modalForm.description) formData.append('description', String(modalForm.description));
                      if (modalForm.document_type) formData.append('document_type', String(modalForm.document_type));
                      addDocUploadMut.mutate(formData);
                    } else {
                      addDocMut.mutate(modalForm);
                    }
                  }
                  if (showModal === 'budget') {
                    const payload = { ...modalForm, amount: parseFloat(modalForm.amount || '0') };
                    editingId ? updateBudgetMut.mutate({ id: editingId, data: payload }) : createBudgetMut.mutate(payload);
                  }
                  if (showModal === 'compliance') {
                    editingId ? updateComplianceMut.mutate({ id: editingId, data: modalForm }) : createComplianceMut.mutate(modalForm);
                  }
                  if (showModal === 'lesson') {
                    editingId ? updateLessonMut.mutate({ id: editingId, data: modalForm }) : createLessonMut.mutate(modalForm);
                  }
                  if (showModal === 'dependency') {
                    editingId ? updateDepMut.mutate({ id: editingId, data: modalForm }) : createDepMut.mutate(modalForm);
                  }
                }}
                className="cw-btn-primary px-4 py-2 rounded-lg text-sm font-medium"
              >
                {editingId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingProject && (
        <div className="fixed inset-0 cw-overlay flex items-center justify-center z-50 p-4" onClick={() => setEditingProject(false)}>
          <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">Edit Project</h2>
              <button onClick={() => setEditingProject(false)} className="p-1 hover:bg-[var(--color-subtle)] rounded"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium mb-1">Name</label><input type="text" value={String(editForm.name || '')} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">Description</label><textarea value={String(editForm.description || '')} onChange={e => setEditForm({ ...editForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-sm font-medium mb-1">Status</label><select value={String(editForm.status || '')} onChange={e => setEditForm({ ...editForm, status: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
                <div><label className="block text-sm font-medium mb-1">Health</label><select value={String(editForm.health || '')} onChange={e => setEditForm({ ...editForm, health: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">{HEALTH_OPTIONS.map(h => <option key={h}>{h}</option>)}</select></div>
                <div><label className="block text-sm font-medium mb-1">Priority</label><select value={String(editForm.priority || '')} onChange={e => setEditForm({ ...editForm, priority: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm">{PRIORITIES.map(p => <option key={p}>{p}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">Owner</label><input type="text" value={String(editForm.project_owner_name || '')} onChange={e => setEditForm({ ...editForm, project_owner_name: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Sponsor</label><input type="text" value={String(editForm.sponsor || '')} onChange={e => setEditForm({ ...editForm, sponsor: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Department</label><input type="text" value={String(editForm.department || '')} onChange={e => setEditForm({ ...editForm, department: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium mb-1">Start Date</label><input type="date" value={String(editForm.start_date || '')} onChange={e => setEditForm({ ...editForm, start_date: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Target End Date</label><input type="date" value={String(editForm.target_end_date || '')} onChange={e => setEditForm({ ...editForm, target_end_date: e.target.value })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div><label className="block text-sm font-medium mb-1">Budget Est.</label><input type="number" value={String(editForm.budget_estimated || '')} onChange={e => setEditForm({ ...editForm, budget_estimated: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Budget Actual</label><input type="number" value={String(editForm.budget_actual || '')} onChange={e => setEditForm({ ...editForm, budget_actual: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
                <div><label className="block text-sm font-medium mb-1">Completion %</label><input type="number" min="0" max="100" value={String(editForm.completion_percentage || '')} onChange={e => setEditForm({ ...editForm, completion_percentage: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              </div>
              <div><label className="block text-sm font-medium mb-1">Business Justification</label><textarea value={String(editForm.business_justification || '')} onChange={e => setEditForm({ ...editForm, business_justification: e.target.value })} rows={3} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" /></div>
              <div><label className="block text-sm font-medium mb-1">Linked Risks</label><textarea value={String(editForm.linked_risks_text || '')} onChange={e => setEditForm({ ...editForm, linked_risks_text: e.target.value })} rows={2} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="One risk per line" /></div>
              <div><label className="block text-sm font-medium mb-1">Linked Controls</label><textarea value={String(editForm.linked_controls_text || '')} onChange={e => setEditForm({ ...editForm, linked_controls_text: e.target.value })} rows={2} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="One control per line" /></div>
              <div><label className="block text-sm font-medium mb-1">Linked Frameworks</label><textarea value={String(editForm.linked_frameworks_text || '')} onChange={e => setEditForm({ ...editForm, linked_frameworks_text: e.target.value })} rows={2} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm" placeholder="One framework per line" /></div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-[var(--color-border)]">
              <button onClick={() => setEditingProject(false)} className="cw-btn-secondary px-4 py-2 rounded-lg text-sm">Cancel</button>
              <button onClick={() => { const { linked_risks_text, linked_controls_text, linked_frameworks_text, ...rest } = editForm as Record<string, unknown>; const payload = { ...rest, linked_risks: String(linked_risks_text || '').split('\n').map((s: string) => s.trim()).filter(Boolean), linked_controls: String(linked_controls_text || '').split('\n').map((s: string) => s.trim()).filter(Boolean), linked_frameworks: String(linked_frameworks_text || '').split('\n').map((s: string) => s.trim()).filter(Boolean) }; updateProjectMut.mutate(payload); }} disabled={updateProjectMut.isPending} className="cw-btn-primary px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2">
                {updateProjectMut.isPending && <Loader2 size={14} className="animate-spin" />} Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
