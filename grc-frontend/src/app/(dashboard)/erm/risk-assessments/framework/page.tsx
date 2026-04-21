'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClipboardCheck, Loader2, Plus, Sparkles, ListTodo, ChevronRight, Trash2 } from 'lucide-react';

interface FrameworkOption {
  id: number;
  name: string;
  short_code: string;
  version?: string | null;
}

interface FrameworkRiskAssessment {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  framework_id: number;
  framework_name?: string | null;
  created_at?: string | null;
  questions_count?: number;
}

interface AssignedQuestion {
  id: number;
  assessment_id: number;
  assessment_name?: string | null;
  framework_name?: string | null;
  question_text: string;
  status: string;
  order_index?: number;
  evidence_count?: number;
}

const QUESTION_COUNT_OPTIONS = [10, 15, 20, 25, 30, 40, 50];

const STATUS_BADGES: Record<string, string> = {
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  archived: 'bg-gray-50 text-gray-600 border-gray-200',
  not_started: 'bg-gray-50 text-gray-600 border-gray-200',
  blocked: 'bg-rose-50 text-rose-700 border-rose-200',
};

export default function FrameworkRiskAssessmentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreatePermission = hasPermission('erm:risk_assessments:create');
  const canDelete = hasPermission('erm:risk_assessments:delete');
  const [activeTab, setActiveTab] = useState<'assessments' | 'assigned'>('assessments');
  const [frameworkId, setFrameworkId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [questionCount, setQuestionCount] = useState('20');

  const { data: frameworks, isLoading: frameworksLoading } = useQuery({
    queryKey: ['erm-available-frameworks'],
    queryFn: async () => {
      const res = await ermApi.frameworkRiskAssessments.getAvailableFrameworks();
      return res.data as FrameworkOption[];
    },
  });

  const { data: assessments, isLoading: assessmentsLoading } = useQuery({
    queryKey: ['framework-risk-assessments'],
    queryFn: async () => {
      const res = await ermApi.frameworkRiskAssessments.getAll();
      return res.data as FrameworkRiskAssessment[];
    },
  });

  const { data: assignedQuestions, isLoading: assignedLoading } = useQuery({
    queryKey: ['framework-risk-assessment-assigned-questions'],
    queryFn: async () => {
      const res = await ermApi.frameworkRiskAssessments.getMyAssignedQuestions();
      return res.data as AssignedQuestion[];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      return ermApi.frameworkRiskAssessments.create({
        uploaded_framework_id: Number(frameworkId),
        name: name || undefined,
        description: description || undefined,
      });
    },
    onSuccess: async (res) => {
      const assessmentId = res.data.id as number;
      await ermApi.frameworkRiskAssessments.generateQuestions(assessmentId, {
        count: Number(questionCount) || 20,
        replace_existing: true,
      });
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment-assigned-questions'] });
      router.push(`/erm/risk-assessments/framework/${assessmentId}`);
    },
  });

  const deleteAssessmentMutation = useMutation({
    mutationFn: (assessmentId: number) => ermApi.frameworkRiskAssessments.delete(assessmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment-assigned-questions'] });
    },
  });

  const canCreate = !!frameworkId && !createMutation.isPending;

  const sortedAssessments = useMemo(() => {
    return (assessments || []).slice().sort((a, b) => {
      const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
      const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
      return bDate - aDate;
    });
  }, [assessments]);

  return (
    <div className="space-y-6 text-[var(--color-text)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Framework Risk Assessments</h1>
          <p className="text-sm text-[var(--color-muted)]">Generate framework-specific assessment questions, assign reviewers, and track completion with tenant-scoped ownership.</p>
        </div>
        <Link href="/erm/risk-assessments" className="cw-btn-secondary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium">
          Back to Risk Assessments
        </Link>
      </div>

      <div className="cw-card p-6 space-y-5">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
          <Sparkles size={16} /> New Framework Assessment
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Framework</label>
            <select
              className="cw-field w-full rounded-lg px-3 py-2"
              value={frameworkId}
              onChange={(e) => setFrameworkId(e.target.value)}
              disabled={frameworksLoading}
            >
              <option value="">Select a framework</option>
              {(frameworks || []).map((fw) => (
                <option key={fw.id} value={fw.id}>
                  {fw.name}{fw.version ? ` (${fw.version})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Assessment Name</label>
            <input
              className="cw-field w-full rounded-lg px-3 py-2"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Question Count</label>
            <select
              className="cw-field w-full rounded-lg px-3 py-2"
              value={questionCount}
              onChange={(e) => setQuestionCount(e.target.value)}
            >
              {QUESTION_COUNT_OPTIONS.map((count) => (
                <option key={count} value={count}>{count} questions</option>
              ))}
            </select>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-4 py-3 text-xs text-[var(--color-muted)]">
            Default is 20. AI generation is now framework-grounded and uses the selected framework's control context instead of generic security prompts.
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Description</label>
          <textarea
            className="cw-field w-full rounded-lg px-3 py-2"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional context for this assessment, such as business scope, environment, critical systems, or areas of concern. This context helps shape higher-quality questions."
          />
        </div>
        <div className="flex flex-col gap-3 border-t border-[var(--color-border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-[var(--color-muted)]">
            The generator produces focused questions about implementation, ownership, evidence, exceptions, monitoring, and control effectiveness for the chosen framework.
          </div>
          <button
            className="cw-btn-primary inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium"
            onClick={() => createMutation.mutate()}
            disabled={!canCreate || !canCreatePermission}
          >
            {createMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            Create & Generate {Number(questionCount) || 20} Questions
          </button>
        </div>
      </div>

      <div className="cw-card overflow-hidden">
        <div className="flex gap-1 border-b border-[var(--color-border)] bg-[var(--color-surface)] p-2">
          <button
            onClick={() => setActiveTab('assessments')}
            className={`cw-tab rounded-lg px-4 py-2 text-sm font-medium ${activeTab === 'assessments' ? 'cw-tab-active' : ''}`}
          >
            <span className="inline-flex items-center gap-2"><ClipboardCheck size={15} /> Saved Assessments</span>
          </button>
          <button
            onClick={() => setActiveTab('assigned')}
            className={`cw-tab rounded-lg px-4 py-2 text-sm font-medium ${activeTab === 'assigned' ? 'cw-tab-active' : ''}`}
          >
            <span className="inline-flex items-center gap-2"><ListTodo size={15} /> Assigned To Me</span>
          </button>
        </div>

        <div className="p-6">
          {activeTab === 'assessments' && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Saved Assessments</h2>
                {(assessmentsLoading || frameworksLoading) && <Loader2 className="animate-spin" size={16} />}
              </div>
              {sortedAssessments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-subtle)] p-8 text-sm text-[var(--color-muted)]">No framework assessments yet.</div>
              ) : (
                <div className="grid gap-3">
                  {sortedAssessments.map((assessment) => (
                    <button
                      key={assessment.id}
                      onClick={() => router.push(`/erm/risk-assessments/framework/${assessment.id}`)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-subtle)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-semibold text-[var(--color-text)]">{assessment.name}</div>
                          <div className="mt-1 text-xs text-[var(--color-muted)]">
                            {assessment.framework_name || 'Framework'}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {canDelete && <button
                            type="button"
                            className="cw-btn-danger inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs"
                            disabled={deleteAssessmentMutation.isPending}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (confirm(`Delete assessment "${assessment.name}"? This will remove all generated questions and uploaded evidence.`)) {
                                deleteAssessmentMutation.mutate(assessment.id);
                              }
                            }}
                          >
                            <Trash2 size={13} /> Delete
                          </button>}
                          <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGES[assessment.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {assessment.status.replace(/_/g, ' ')}
                          </span>
                          <div className="text-right text-xs text-[var(--color-muted)]">
                            <div>{assessment.questions_count || 0} questions</div>
                          </div>
                          <ChevronRight size={16} className="text-[var(--color-muted)]" />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'assigned' && (
            <>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Questions Assigned To You</h2>
                {assignedLoading && <Loader2 className="animate-spin" size={16} />}
              </div>
              {(assignedQuestions || []).length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-subtle)] p-8 text-sm text-[var(--color-muted)]">No framework assessment questions are currently assigned to you.</div>
              ) : (
                <div className="space-y-3">
                  {(assignedQuestions || []).map((question) => (
                    <button
                      key={question.id}
                      onClick={() => router.push(`/erm/risk-assessments/framework/${question.assessment_id}`)}
                      className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-left transition-colors hover:bg-[var(--color-subtle)]"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-xs text-[var(--color-muted)]">
                          {question.framework_name || 'Framework'} · {question.assessment_name || 'Assessment'}
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGES[question.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                          {question.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-[var(--color-text)]">Q{question.order_index || 0}. {question.question_text}</div>
                      <div className="mt-2 flex items-center justify-between text-xs text-[var(--color-muted)]">
                        <span>{question.evidence_count || 0} evidence file(s)</span>
                        <span className="inline-flex items-center gap-1">Open assessment <ChevronRight size={14} /></span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
