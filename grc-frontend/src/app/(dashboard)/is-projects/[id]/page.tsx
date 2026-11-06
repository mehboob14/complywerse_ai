'use client';

// One project: its header, eleven tabs, and the record forms. This file is the data flow of the page and keeps it: the same requests with the same keys and payloads
// (the project, the tenant's users and risks for the pickers, the four lazy lists, the milestone evidence, the AI actions), now every write reported by useReportedMutation
// (said only once the server has answered, in its own words when it refused, a Retry where trying again can help) and every delete asked first with useConfirm.
// What changed is how it is drawn: the kit's PageHeader and Tabs (the open tab is in the address, ?tab=tasks; the plain address is Overview), the tabs' bodies in the
// pieces beside this file, one drawer for the ten record forms and one for the project, and the AI result in the kit's dialog. No permission check is added or removed:
// the page never had one (the server asks only for the projects view), and the Edit, Delete and Add buttons are drawn for everyone who can open the page, as before.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pencil, SearchX, Trash2 } from 'lucide-react';
import { assetsApi, isProjectsApi, risksApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Skeleton, StatusPill, TabPanel, Tabs, useConfirm, useNotify, useReportedMutation, useTabParam } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { truncate } from '@/lib/format';
import { priority as priorityStatus, statusPill } from '@/lib/status';
import { projectHealth, projectStatus } from '@/lib/projectStatus';
import { DETAIL_TABS, DETAIL_TAB_KEYS, PROJECT_KEYS, documentFields, recordPayload, tenantRisksOf, tenantUsersOf, type DetailTab, type RecordForm, type RecordKind } from '../_model';
import { retryRead } from '../_ui';
import { AiResultDialog } from './_AiResult';
import { DependenciesTab, BudgetTab, ComplianceTab } from './_Planning';
import { MilestonesTab, TasksTab, TeamTab } from './_Delivery';
import { EditProjectDrawer } from './_EditProject';
import { OverviewTab } from './_Overview';
import { RecordDrawer } from './_RecordDrawer';
import { DocumentsTab, LessonsTab, RisksTab, UpdatesTab } from './_Records';
import type { AiKey, EditableKind, Handlers } from './_parts';
import type { BudgetData, Dependency, Lesson, Mapping, ProjectDetail } from './_types';

const DELETE_COPY: Record<RecordKind, { title: string; confirm: string }> = {
  milestone: { title: 'Delete this milestone?', confirm: 'Delete milestone' },
  task: { title: 'Delete this task?', confirm: 'Delete task' },
  team: { title: 'Remove this team member?', confirm: 'Remove member' },
  risk: { title: 'Delete this risk or issue?', confirm: 'Delete risk' },
  update: { title: 'Delete this status update?', confirm: 'Delete update' },
  document: { title: 'Remove this document?', confirm: 'Remove document' },
  budget: { title: 'Delete this budget item?', confirm: 'Delete item' },
  compliance: { title: 'Delete this compliance mapping?', confirm: 'Delete mapping' },
  lesson: { title: 'Delete this lesson?', confirm: 'Delete lesson' },
  dependency: { title: 'Delete this dependency?', confirm: 'Delete dependency' },
};

type Drawer = { kind: RecordKind; editing: Record<string, unknown> | null; id: number };

export default function ProjectDetailPage() {
  const router = useRouter();
  const params = useParams();
  const projectId = Number(params.id);
  const queryClient = useQueryClient();
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useTabParam('tab', DETAIL_TAB_KEYS, { fallback: 'overview' });
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [editingProject, setEditingProject] = useState(false);

  // ── what is read (the same requests and keys as before) ──
  const projectQuery = useQuery({
    queryKey: ['is-project', projectId],
    queryFn: async () => (await isProjectsApi.getById(projectId)).data as ProjectDetail,
    retry: retryRead,
  });
  const project = projectQuery.data;

  const { data: tenantUsersRaw = [] } = useQuery({
    queryKey: ['is-project-tenant-users', projectId],
    queryFn: async () => { const res = await assetsApi.getTenantUsers(); return Array.isArray(res.data) ? res.data : []; },
    retry: retryRead,
  });
  const tenantUsers = useMemo(() => tenantUsersOf(tenantUsersRaw), [tenantUsersRaw]);
  const tenantUsersById = useMemo(() => new Map(tenantUsers.map((u) => [u.id, u])), [tenantUsers]);

  const { data: tenantRisksRaw = [] } = useQuery({
    queryKey: ['is-project-tenant-risks', projectId],
    queryFn: async () => { const res = await risksApi.getAll(); return Array.isArray(res.data) ? res.data : []; },
    retry: retryRead,
  });
  const tenantRisks = useMemo(() => tenantRisksOf(tenantRisksRaw as unknown as Array<Record<string, unknown>>, tenantUsersById), [tenantRisksRaw, tenantUsersById]);

  // the four lists that load when their tab is opened
  const budgetQuery = useQuery({ queryKey: ['is-project-budget', projectId], queryFn: async () => (await isProjectsApi.getBudgetItems(projectId)).data as BudgetData, enabled: tab === 'budget', retry: retryRead });
  const complianceQuery = useQuery({ queryKey: ['is-project-compliance', projectId], queryFn: async () => (await isProjectsApi.getComplianceMappings(projectId)).data as Mapping[], enabled: tab === 'compliance', retry: retryRead });
  const lessonsQuery = useQuery({ queryKey: ['is-project-lessons', projectId], queryFn: async () => (await isProjectsApi.getLessonsLearned(projectId)).data as Lesson[], enabled: tab === 'lessons', retry: retryRead });
  const depsQuery = useQuery({ queryKey: ['is-project-deps', projectId], queryFn: async () => (await isProjectsApi.getDependencies(projectId)).data as Dependency[], enabled: tab === 'dependencies', retry: retryRead });

  // ── what is written: every write says what happened. A create offers no Retry (a second try could make a second record: the drawer is still open to press Save again). ──
  const CHANGED = [['is-project', projectId], ...PROJECT_KEYS];                      // the project and what lists and counts it (the old pages refreshed the project alone)
  const closeDrawer = () => setDrawer(null);
  const lazy = (key: string) => [[key, projectId]];

  const updateProjectMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.update(projectId, data), success: 'Project saved', failure: "Couldn't save the project", invalidate: CHANGED, onSuccess: () => setEditingProject(false) });
  const deleteProjectMut = useReportedMutation({ mutationFn: () => isProjectsApi.delete(projectId), success: 'Project deleted', failure: "Couldn't delete the project", invalidate: PROJECT_KEYS, onSuccess: () => router.push('/is-projects') });

  const createMilestoneMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createMilestone(projectId, data), success: 'Milestone added', failure: "Couldn't add the milestone", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const updateMilestoneMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateMilestone(projectId, id, data), success: 'Milestone updated', failure: "Couldn't update the milestone", invalidate: CHANGED });
  const deleteMilestoneMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteMilestone(projectId, id), success: 'Milestone deleted', failure: "Couldn't delete the milestone", invalidate: CHANGED });

  const createTaskMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createTask(projectId, data), success: 'Task added', failure: "Couldn't add the task", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const updateTaskMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateTask(projectId, id, data), success: 'Task updated', failure: "Couldn't update the task", invalidate: CHANGED });
  const deleteTaskMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteTask(projectId, id), success: 'Task deleted', failure: "Couldn't delete the task", invalidate: CHANGED });

  const addTeamMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.addTeamMember(projectId, data), success: 'Team member added', failure: "Couldn't add the team member", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const removeTeamMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.removeTeamMember(projectId, id), success: 'Team member removed', failure: "Couldn't remove the team member", invalidate: CHANGED });

  const createRiskMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createRisk(projectId, data), success: 'Risk added', failure: "Couldn't add the risk", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const updateRiskMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateRisk(projectId, id, data), success: 'Risk updated', failure: "Couldn't update the risk", invalidate: CHANGED });
  const deleteRiskMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteRisk(projectId, id), success: 'Risk deleted', failure: "Couldn't delete the risk", invalidate: CHANGED });

  const createUpdateMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createUpdate(projectId, data), success: 'Status update added', failure: "Couldn't add the status update", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const deleteUpdateMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteUpdate(projectId, id), success: 'Status update deleted', failure: "Couldn't delete the status update", invalidate: CHANGED });

  const addDocMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.addDocument(projectId, data), success: 'Document added', failure: "Couldn't add the document", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const addDocUploadMut = useReportedMutation({ mutationFn: (formData: FormData) => isProjectsApi.uploadDocument(projectId, formData), success: 'Document uploaded', failure: "Couldn't upload the document", retryable: false, invalidate: CHANGED, onSuccess: closeDrawer });
  const removeDocMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.removeDocument(projectId, id), success: 'Document removed', failure: "Couldn't remove the document", invalidate: CHANGED });

  const createBudgetMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createBudgetItem(projectId, data), success: 'Budget item added', failure: "Couldn't add the budget item", retryable: false, invalidate: lazy('is-project-budget'), onSuccess: closeDrawer });
  const updateBudgetMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateBudgetItem(projectId, id, data), success: 'Budget item saved', failure: "Couldn't save the budget item", invalidate: lazy('is-project-budget'), onSuccess: closeDrawer });
  const deleteBudgetMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteBudgetItem(projectId, id), success: 'Budget item deleted', failure: "Couldn't delete the budget item", invalidate: lazy('is-project-budget') });

  const createComplianceMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createComplianceMapping(projectId, data), success: 'Compliance mapping added', failure: "Couldn't add the compliance mapping", retryable: false, invalidate: lazy('is-project-compliance'), onSuccess: closeDrawer });
  const updateComplianceMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateComplianceMapping(projectId, id, data), success: 'Compliance mapping saved', failure: "Couldn't save the compliance mapping", invalidate: lazy('is-project-compliance'), onSuccess: closeDrawer });
  const deleteComplianceMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteComplianceMapping(projectId, id), success: 'Compliance mapping deleted', failure: "Couldn't delete the compliance mapping", invalidate: lazy('is-project-compliance') });

  const createLessonMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createLessonLearned(projectId, data), success: 'Lesson added', failure: "Couldn't add the lesson", retryable: false, invalidate: lazy('is-project-lessons'), onSuccess: closeDrawer });
  const updateLessonMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateLessonLearned(projectId, id, data), success: 'Lesson saved', failure: "Couldn't save the lesson", invalidate: lazy('is-project-lessons'), onSuccess: closeDrawer });
  const deleteLessonMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteLessonLearned(projectId, id), success: 'Lesson deleted', failure: "Couldn't delete the lesson", invalidate: lazy('is-project-lessons') });

  const createDepMut = useReportedMutation({ mutationFn: (data: Record<string, unknown>) => isProjectsApi.createDependency(projectId, data), success: 'Dependency added', failure: "Couldn't add the dependency", retryable: false, invalidate: lazy('is-project-deps'), onSuccess: closeDrawer });
  const updateDepMut = useReportedMutation({ mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => isProjectsApi.updateDependency(projectId, id, data), success: 'Dependency saved', failure: "Couldn't save the dependency", invalidate: lazy('is-project-deps'), onSuccess: closeDrawer });
  const deleteDepMut = useReportedMutation({ mutationFn: (id: number) => isProjectsApi.deleteDependency(projectId, id), success: 'Dependency deleted', failure: "Couldn't delete the dependency", invalidate: lazy('is-project-deps') });

  const saving = [createMilestoneMut, createTaskMut, addTeamMut, createRiskMut, createUpdateMut, addDocMut, addDocUploadMut, createBudgetMut, updateBudgetMut, createComplianceMut, updateComplianceMut, createLessonMut, updateLessonMut, createDepMut, updateDepMut].some((m) => m.isPending);

  /** The save of the record drawer: the old save buttons' routing (a new line is created, an existing budget line, mapping, lesson or dependency is updated). */
  const submitRecord = (form: RecordForm, file: File | null) => {
    if (!drawer) return;
    const payload = recordPayload(drawer.kind, form, tenantUsersById);
    const id = drawer.editing ? Number((drawer.editing as { id: number }).id) : null;
    switch (drawer.kind) {
      case 'milestone': createMilestoneMut.mutate(payload); break;
      case 'task': createTaskMut.mutate(payload); break;
      case 'team': addTeamMut.mutate(payload); break;
      case 'risk': createRiskMut.mutate(payload); break;
      case 'update': createUpdateMut.mutate(payload); break;
      case 'document': {
        if (file) {
          const formData = new FormData();
          formData.append('file', file);
          documentFields(form).forEach(([k, v]) => formData.append(k, v));
          addDocUploadMut.mutate(formData);
        } else addDocMut.mutate(payload);
        break;
      }
      case 'budget': if (id) updateBudgetMut.mutate({ id, data: payload }); else createBudgetMut.mutate(payload); break;
      case 'compliance': if (id) updateComplianceMut.mutate({ id, data: payload }); else createComplianceMut.mutate(payload); break;
      case 'lesson': if (id) updateLessonMut.mutate({ id, data: payload }); else createLessonMut.mutate(payload); break;
      default: if (id) updateDepMut.mutate({ id, data: payload }); else createDepMut.mutate(payload);
    }
  };

  const REMOVERS: Record<RecordKind, (id: number) => void> = {
    milestone: (id) => deleteMilestoneMut.mutate(id), task: (id) => deleteTaskMut.mutate(id), team: (id) => removeTeamMut.mutate(id), risk: (id) => deleteRiskMut.mutate(id),
    update: (id) => deleteUpdateMut.mutate(id), document: (id) => removeDocMut.mutate(id), budget: (id) => deleteBudgetMut.mutate(id), compliance: (id) => deleteComplianceMut.mutate(id),
    lesson: (id) => deleteLessonMut.mutate(id), dependency: (id) => deleteDepMut.mutate(id),
  };
  const remove = async (kind: RecordKind, id: number, label: string) => {
    const copy = DELETE_COPY[kind];
    if (await confirm({ title: copy.title, message: truncate(label, 120).text, confirmLabel: copy.confirm, tone: 'danger' })) REMOVERS[kind](id);
  };

  const askDeleteProject = async () => {
    if (!project) return;
    const ok = await confirm({
      title: 'Delete this project?',
      message: `${truncate(project.name, 100).text}: its milestones, tasks, team, risks, status updates, documents, budget items, compliance mappings, lessons and dependencies are deleted with it.`,
      confirmLabel: 'Delete project',
      tone: 'danger',
    });
    if (ok) deleteProjectMut.mutate();
  };

  const handleDownloadDocument = async (docId: number, fileName?: string): Promise<void> => {
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
    } catch (err) {
      notify.error(err, { title: "Couldn't download the file", retry: () => { void handleDownloadDocument(docId, fileName); } });
    }
  };

  // ── the AI actions: asked for, shown, and only then applied (nothing is created until Apply) ──
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ title: string; data: unknown; aiKey: string } | null>(null);
  const AI: Record<AiKey, [() => Promise<{ data: unknown }>, string]> = {
    'generate-plan': [() => isProjectsApi.aiGeneratePlan(projectId), 'AI-Generated Plan'],
    'assess-risks': [() => isProjectsApi.aiAssessRisks(projectId), 'AI Risk Assessment'],
    'draft-status-report': [() => isProjectsApi.aiDraftStatusReport(projectId), 'AI Status Report'],
    'suggest-team': [() => isProjectsApi.aiSuggestTeam(projectId), 'AI Team Suggestions'],
    'estimate-budget': [() => isProjectsApi.aiEstimateBudget(projectId), 'AI Budget Estimate'],
  };
  const runAi = async (key: AiKey): Promise<void> => {
    const [fn, title] = AI[key];
    setAiBusy(key);
    try {
      const res = await fn();
      setAiResult({ title, data: res.data, aiKey: key });
    } catch (err) {
      notify.error(err, { title: `${title} failed`, fallback: 'AI request failed. Please try again.', retry: () => { void runAi(key); } });
    } finally {
      setAiBusy(null);
    }
  };

  /** Apply what the AI suggested: the old routine, call for call (plan: milestones, tasks, an update; risks; a status report; budget lines; team roles). */
  const applyAi = async (): Promise<void> => {
    if (!aiResult?.data || !aiResult.aiKey) return;
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
    } else if (aiResult.aiKey === 'assess-risks' && d.assessment) {
      const assessment = d.assessment as Record<string, unknown>;
      const risks = (assessment.risks || assessment.risk_areas || []) as Array<Record<string, string>>;
      for (const r of risks) {
        await isProjectsApi.createRisk(projectId, { title: r.title || r.risk || r.name, description: r.description || r.details || '', severity: r.severity || r.impact || 'Medium', status: 'Open' });
      }
    } else if (aiResult.aiKey === 'draft-status-report' && d.report) {
      const report = d.report as Record<string, string>;
      await isProjectsApi.createUpdate(projectId, {
        what_was_done: report.accomplishments || report.summary || report.what_was_done || '',
        whats_planned: report.next_steps || report.planned || report.whats_planned || '',
        blockers: report.blockers || report.risks || report.issues || '',
        notes: report.recommendations || report.notes || '',
        health_status: report.overall_health || report.health_status || 'On Track',
      });
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
    }
  };
  const applyAiMut = useReportedMutation({
    mutationFn: applyAi,
    success: 'Applied to the project',
    failure: "Couldn't finish applying: some items may already be added",
    fallback: 'Some items may have been partially created.',
    retryable: false,                                              // a second try would add the items that were created a second time
    invalidate: [...CHANGED, ['is-project-budget', projectId]],
    onSuccess: () => setAiResult(null),
    onError: () => { setAiResult(null); void queryClient.invalidateQueries({ queryKey: ['is-project', projectId] }); },   // what was created before it failed is shown
  });
  const canApplyAi = !!aiResult?.aiKey && ['generate-plan', 'assess-risks', 'draft-status-report', 'estimate-budget', 'suggest-team'].indexOf(aiResult.aiKey) >= 0 && !(aiResult.data as Record<string, unknown>)?.error;

  const h: Handlers = {
    add: (kind) => setDrawer({ kind, editing: null, id: Date.now() }),
    edit: (kind: EditableKind, item) => setDrawer({ kind, editing: item as Record<string, unknown>, id: Date.now() }),
    remove: (kind, id, label) => { void remove(kind, id, label); },
    ai: (key) => { void runAi(key); },
    aiBusy,
    change: {
      milestone: (id, data) => updateMilestoneMut.mutateAsync({ id, data }),
      task: (id, data) => updateTaskMut.mutateAsync({ id, data }),
      risk: (id, data) => updateRiskMut.mutateAsync({ id, data }),
    },
    download: (id, fileName) => { void handleDownloadDocument(id, fileName); },
  };

  // ── the page ──
  if (projectQuery.isLoading) {
    return (
      <div role="status" aria-busy="true" className="flex flex-col gap-[16px]">
        <span className="sr-only">Loading the project</span>
        <Skeleton className="h-[28px] w-[120px]" /><Skeleton className="h-[32px] w-[60%]" /><Skeleton className="h-[40px] w-full" /><Skeleton className="h-[240px] w-full" />
      </div>
    );
  }
  if (projectQuery.isError || !project) {
    const notFound = statusOf(projectQuery.error) === 404;
    return (
      <div className="flex flex-col gap-[16px]">
        <div><Button href="/is-projects" variant="ghost" leftIcon={<ArrowLeft aria-hidden />}>Back to projects</Button></div>
        {notFound ? (
          <EmptyState kind="firstUse" icon={SearchX} title="Project not found" description="It may have been deleted, or the address is wrong." action={<Button variant="primary" href="/is-projects">Go to projects</Button>} />
        ) : (
          <ErrorState title="Couldn't load the project" message={errorMessage(projectQuery.error)} onRetry={canRetry(projectQuery.error) ? () => { void projectQuery.refetch(); } : undefined} />
        )}
      </div>
    );
  }

  const counts: Partial<Record<DetailTab, number>> = {
    milestones: project.milestones?.length, tasks: project.tasks?.length, team: project.team_members?.length, risks: project.risks_issues?.length,
    updates: project.status_updates?.length, documents: project.documents?.length,
  };
  const tabs = DETAIL_TABS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }));

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={project.name || 'Untitled project'}
        back={{ href: '/is-projects', label: 'Back to projects' }}
        chips={(
          <>
            <StatusPill {...statusPill(projectStatus, project.status)} />
            <StatusPill {...statusPill(projectHealth, project.health)} />
            <StatusPill {...statusPill(priorityStatus, project.priority)} />
            {project.category && <span className="text-ds-label text-ds-fg-muted">{project.category}</span>}
          </>
        )}
        actions={(
          <>
            <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditingProject(true)}>Edit</Button>
            <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={deleteProjectMut.isPending} onClick={() => { void askDeleteProject(); }}>Delete</Button>
          </>
        )}
      />

      <Tabs tabs={tabs} value={tab} onChange={(key) => setTab(key as DetailTab)} ariaLabel="Project sections">
        <TabPanel tabKey="overview" lazy className="pt-[16px]"><OverviewTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="milestones" lazy className="pt-[16px]"><MilestonesTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="tasks" lazy className="pt-[16px]"><TasksTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="team" lazy className="pt-[16px]"><TeamTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="risks" lazy className="pt-[16px]"><RisksTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="updates" lazy className="pt-[16px]"><UpdatesTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="documents" lazy className="pt-[16px]"><DocumentsTab project={project} h={h} /></TabPanel>
        <TabPanel tabKey="budget" lazy className="pt-[16px]"><BudgetTab q={budgetQuery} h={h} /></TabPanel>
        <TabPanel tabKey="compliance" lazy className="pt-[16px]"><ComplianceTab q={complianceQuery} h={h} /></TabPanel>
        <TabPanel tabKey="lessons" lazy className="pt-[16px]"><LessonsTab q={lessonsQuery} h={h} /></TabPanel>
        <TabPanel tabKey="dependencies" lazy className="pt-[16px]"><DependenciesTab q={depsQuery} h={h} /></TabPanel>
      </Tabs>

      {drawer && (
        <RecordDrawer
          key={drawer.id}
          kind={drawer.kind}
          editing={drawer.editing}
          health={project.health}
          users={tenantUsers}
          risks={tenantRisks}
          saving={saving}
          onSubmit={submitRecord}
          onClose={closeDrawer}
        />
      )}
      {editingProject && <EditProjectDrawer project={project} saving={updateProjectMut.isPending} onSubmit={(payload) => updateProjectMut.mutate(payload)} onClose={() => setEditingProject(false)} />}
      {aiResult && <AiResultDialog title={aiResult.title} data={aiResult.data} canApply={canApplyAi} applying={applyAiMut.isPending} onApply={() => applyAiMut.mutate()} onClose={() => setAiResult(null)} />}
      {confirmDialog}
    </div>
  );
}
