'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ermApi, tenantApi } from '@/lib/api';
import { ArrowLeft, Loader2, Plus, RefreshCw, Trash2, Upload, CheckCircle2, Sparkles } from 'lucide-react';
import Link from 'next/link';

interface EvidenceItem {
  id: number;
  file_name: string;
  description?: string | null;
  uploaded_at?: string | null;
  uploader_name?: string | null;
}

interface QuestionItem {
  id: number;
  question_text: string;
  status: string;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
  inherent_likelihood?: number | null;
  inherent_impact?: number | null;
  inherent_score?: number | null;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  residual_score?: number | null;
  is_risk_accepted?: boolean;
  acceptance_notes?: string | null;
  linked_risk_id?: number | null;
  moved_to_risk_register_at?: string | null;
  evidence?: EvidenceItem[];
}

interface AssessmentDetail {
  id: number;
  tenant_id: number;
  name: string;
  description?: string | null;
  status: string;
  framework_name?: string | null;
  questions: QuestionItem[];
}

interface UserOption {
  id: number;
  username: string;
  display_name: string;
  email: string;
}

interface TenantUserApiItem {
  id?: number;
  user_id?: number;
  username?: string;
  display_name?: string;
  email?: string;
  user?: {
    id?: number;
    username?: string;
    display_name?: string;
    email?: string;
  } | null;
}

const STATUS_OPTIONS = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'blocked', label: 'Blocked' },
];

const ASSESSMENT_STATUS = [
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const RISK_SCALE_OPTIONS = [1, 2, 3, 4, 5];

export default function FrameworkRiskAssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const assessmentId = Number(params.id);

  const [newQuestion, setNewQuestion] = useState('');
  const [generateCount, setGenerateCount] = useState('20');
  const [uploadingQuestionId, setUploadingQuestionId] = useState<number | null>(null);
  const [movingQuestionId, setMovingQuestionId] = useState<number | null>(null);

  const { data: assessment, isLoading } = useQuery({
    queryKey: ['framework-risk-assessment', assessmentId],
    queryFn: async () => {
      const res = await ermApi.frameworkRiskAssessments.getById(assessmentId);
      return res.data as AssessmentDetail;
    },
    enabled: Number.isFinite(assessmentId),
  });

  const { data: users } = useQuery({
    queryKey: ['tenant-users', assessment?.tenant_id],
    queryFn: async () => {
      try {
        const res = await tenantApi.getTenantUsers(assessment?.tenant_id);
        const data = res.data;
        const rows = Array.isArray(data) ? (data as TenantUserApiItem[]) : [];
        return rows
          .map((row) => {
            const user = row.user || row;
            const id = Number(user.id ?? row.user_id ?? row.id);
            if (!Number.isFinite(id)) return null;
            const displayName = String(
              user.display_name || user.username || user.email || `User ${id}`
            );
            return {
              id,
              username: String(user.username || `user_${id}`),
              display_name: displayName,
              email: String(user.email || ''),
            } as UserOption;
          })
          .filter((u): u is UserOption => !!u);
      } catch {
        return [] as UserOption[];
      }
    },
    enabled: !!assessment?.tenant_id,
  });

  const updateAssessmentMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      ermApi.frameworkRiskAssessments.update(assessmentId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] }),
  });

  const deleteAssessmentMutation = useMutation({
    mutationFn: () => ermApi.frameworkRiskAssessments.delete(assessmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment-assigned-questions'] });
      router.push('/erm/risk-assessments/framework');
    },
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      ermApi.frameworkRiskAssessments.generateQuestions(assessmentId, { count: Number(generateCount) || 20, replace_existing: true }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] }),
  });

  const addQuestionMutation = useMutation({
    mutationFn: (question_text: string) =>
      ermApi.frameworkRiskAssessments.addQuestion(assessmentId, { question_text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] });
      setNewQuestion('');
    },
  });

  const updateQuestionMutation = useMutation({
    mutationFn: ({ questionId, data }: { questionId: number; data: Record<string, unknown> }) =>
      ermApi.frameworkRiskAssessments.updateQuestion(assessmentId, questionId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] }),
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: (questionId: number) =>
      ermApi.frameworkRiskAssessments.deleteQuestion(assessmentId, questionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] }),
  });

  const moveToRiskRegisterMutation = useMutation({
    mutationFn: ({ questionId }: { questionId: number }) =>
      ermApi.frameworkRiskAssessments.moveQuestionToRiskRegister(assessmentId, questionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
    },
    onSettled: () => {
      setMovingQuestionId(null);
    },
  });

  const uploadEvidenceMutation = useMutation({
    mutationFn: async ({ questionId, file }: { questionId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return ermApi.frameworkRiskAssessments.uploadEvidence(assessmentId, questionId, formData);
    },
    onSuccess: () => {
      setUploadingQuestionId(null);
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] });
    },
    onError: () => setUploadingQuestionId(null),
  });

  const deleteEvidenceMutation = useMutation({
    mutationFn: (evidenceId: number) =>
      ermApi.frameworkRiskAssessments.deleteEvidence(assessmentId, evidenceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['framework-risk-assessment', assessmentId] }),
  });

  const questionList = useMemo(() => assessment?.questions || [], [assessment]);

  const updateQuestionRiskValues = (questionId: number, data: Record<string, unknown>) => {
    updateQuestionMutation.mutate({ questionId, data });
  };

  if (isLoading || !assessment) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-[var(--color-text)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/erm/risk-assessments/framework')} className="cw-btn-secondary rounded-lg p-2">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">{assessment.name}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {assessment.framework_name || 'Framework'} · {assessment.questions.length} questions
            </p>
          </div>
        </div>
        <div className="cw-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Assessment Status</label>
            <select
              className="cw-field rounded-lg px-3 py-2 text-sm"
              value={assessment.status}
              onChange={(e) => updateAssessmentMutation.mutate({ status: e.target.value })}
            >
              {ASSESSMENT_STATUS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Generate Questions</label>
            <div className="flex items-center gap-2">
              <select
                className="cw-field rounded-lg px-3 py-2 text-sm"
                value={generateCount}
                onChange={(e) => setGenerateCount(e.target.value)}
              >
                {[10, 15, 20, 25, 30, 40, 50].map((count) => (
                  <option key={count} value={count}>{count}</option>
                ))}
              </select>
              <button
                className="cw-btn-secondary flex items-center gap-2 rounded-lg px-3 py-2"
                onClick={() => {
                  if (confirm(`Regenerate ${Number(generateCount) || 20} framework-specific questions? This will replace existing questions.`)) {
                    generateMutation.mutate();
                  }
                }}
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}
                Regenerate
              </button>
            </div>
          </div>
          <div className="sm:ml-auto">
            <button
              className="cw-btn-danger inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
              disabled={deleteAssessmentMutation.isPending}
              onClick={() => {
                if (confirm(`Delete assessment \"${assessment.name}\"? This will remove all questions and evidence.`)) {
                  deleteAssessmentMutation.mutate();
                }
              }}
            >
              {deleteAssessmentMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Trash2 size={16} />}
              Delete Assessment
            </button>
          </div>
        </div>
      </div>

      <div className="cw-card p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
          <Sparkles size={16} /> Question Workspace
        </div>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-4 py-3 text-xs text-[var(--color-muted)]">
          AI-generated questions are now framework-specific and grounded in the selected framework&apos;s control set, implementation requirements, evidence expectations, ownership, monitoring, and exception handling.
        </div>
        <div className="text-sm font-semibold text-[var(--color-text)]">Add Manual Question</div>
        <div className="flex items-center gap-2">
          <input
            className="cw-field flex-1 rounded-lg px-3 py-2"
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Type a framework-specific manual question"
          />
          <button
            className="cw-btn-primary flex items-center gap-2 rounded-lg px-4 py-2"
            onClick={() => newQuestion.trim() && addQuestionMutation.mutate(newQuestion.trim())}
            disabled={!newQuestion.trim() || addQuestionMutation.isPending}
          >
            {addQuestionMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
            Add
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {questionList.map((question, index) => (
          <div key={question.id} className="cw-card space-y-4 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-xs text-[var(--color-muted)]">Question {index + 1}</div>
                <div className="text-sm font-semibold text-[var(--color-text)]">{question.question_text}</div>
                {question.assigned_user_name && (
                  <div className="text-xs text-[var(--color-muted)]">Assigned to {question.assigned_user_name}</div>
                )}
              </div>
              <button
                className="cw-btn-danger flex items-center gap-1 rounded-lg px-3 py-2 text-sm"
                onClick={() => deleteQuestionMutation.mutate(question.id)}
              >
                <Trash2 size={14} /> Delete
              </button>
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Status</label>
                <select
                  className="cw-field w-full rounded-lg px-3 py-2"
                  value={question.status}
                  onChange={(e) => updateQuestionMutation.mutate({ questionId: question.id, data: { status: e.target.value } })}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Assignee</label>
                <select
                  className="cw-field w-full rounded-lg bg-white px-3 py-2 text-gray-900"
                  value={question.assigned_user_id || ''}
                  onChange={(e) => updateQuestionMutation.mutate({
                    questionId: question.id,
                    data: { assigned_user_id: e.target.value ? Number(e.target.value) : null },
                  })}
                >
                  <option value="" className="bg-white text-gray-900">Unassigned</option>
                  {(users || []).map((u) => (
                    <option key={u.id} value={u.id} className="bg-white text-gray-900">{u.display_name || u.username}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Evidence Upload</label>
                <label className="cw-btn-secondary flex cursor-pointer items-center justify-center gap-2 rounded-lg px-3 py-2">
                  <Upload size={14} /> Upload File
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setUploadingQuestionId(question.id);
                      uploadEvidenceMutation.mutate({ questionId: question.id, file });
                      e.currentTarget.value = '';
                    }}
                  />
                </label>
                {uploadingQuestionId === question.id && (
                  <div className="mt-1 text-xs text-[var(--color-muted)] flex items-center gap-1">
                    <Loader2 className="animate-spin" size={12} /> Uploading...
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                Question Risk Assessment
              </div>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Inherent Likelihood</label>
                  <select
                    className="cw-field w-full rounded-lg px-2 py-2 text-sm"
                    value={question.inherent_likelihood || ''}
                    onChange={(e) => updateQuestionRiskValues(question.id, { inherent_likelihood: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">-</option>
                    {RISK_SCALE_OPTIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Inherent Impact</label>
                  <select
                    className="cw-field w-full rounded-lg px-2 py-2 text-sm"
                    value={question.inherent_impact || ''}
                    onChange={(e) => updateQuestionRiskValues(question.id, { inherent_impact: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">-</option>
                    {RISK_SCALE_OPTIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Inherent Score</label>
                  <div className="cw-field w-full rounded-lg px-3 py-2 text-sm bg-white/70">{question.inherent_score ?? '-'}</div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Residual Likelihood</label>
                  <select
                    className="cw-field w-full rounded-lg px-2 py-2 text-sm"
                    value={question.residual_likelihood || ''}
                    onChange={(e) => updateQuestionRiskValues(question.id, { residual_likelihood: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">-</option>
                    {RISK_SCALE_OPTIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Residual Impact</label>
                  <select
                    className="cw-field w-full rounded-lg px-2 py-2 text-sm"
                    value={question.residual_impact || ''}
                    onChange={(e) => updateQuestionRiskValues(question.id, { residual_impact: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">-</option>
                    {RISK_SCALE_OPTIONS.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Residual Score</label>
                  <div className="cw-field w-full rounded-lg px-3 py-2 text-sm bg-white/70">{question.residual_score ?? '-'}</div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text)]">
                    <input
                      type="checkbox"
                      checked={!!question.is_risk_accepted}
                      onChange={(e) => updateQuestionRiskValues(question.id, { is_risk_accepted: e.target.checked })}
                    />
                    Accept Risk
                  </label>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    Mark accepted risk before moving to Risk Register.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Acceptance Notes</label>
                  <textarea
                    className="cw-field w-full rounded-lg px-3 py-2 text-sm"
                    rows={2}
                    defaultValue={question.acceptance_notes || ''}
                    placeholder="Add acceptance rationale or treatment notes"
                    onBlur={(e) => updateQuestionRiskValues(question.id, { acceptance_notes: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {question.linked_risk_id ? (
                  <div className="inline-flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700">
                    Moved to Risk Register: #{question.linked_risk_id}
                    <Link className="underline" href={`/erm/risks`}>Open Register</Link>
                  </div>
                ) : (
                  <button
                    className="cw-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                    disabled={!question.is_risk_accepted || moveToRiskRegisterMutation.isPending}
                    onClick={() => {
                      setMovingQuestionId(question.id);
                      moveToRiskRegisterMutation.mutate({ questionId: question.id });
                    }}
                  >
                    {movingQuestionId === question.id ? (
                      <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Moving...</span>
                    ) : (
                      'Move to Risk Register'
                    )}
                  </button>
                )}
                {!question.is_risk_accepted && !question.linked_risk_id && (
                  <span className="text-xs text-[var(--color-muted)]">Accept risk to enable move.</span>
                )}
              </div>
              {movingQuestionId === question.id && moveToRiskRegisterMutation.isError && (
                <div className="text-xs text-red-600">
                  {(moveToRiskRegisterMutation.error as any)?.response?.data?.detail || 'Failed to move question to risk register.'}
                </div>
              )}
            </div>

            <div className="border-t border-[var(--color-border)] pt-3">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--color-muted)]">
                <CheckCircle2 size={12} /> Evidence ({question.evidence?.length || 0})
              </div>
              {(question.evidence || []).length === 0 ? (
                <div className="text-xs text-[var(--color-muted)] mt-2">No evidence uploaded yet.</div>
              ) : (
                <div className="mt-2 space-y-2">
                  {(question.evidence || []).map((evidence) => (
                    <div key={evidence.id} className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2">
                      <div>
                        <div className="text-xs font-medium text-[var(--color-text)]">{evidence.file_name}</div>
                        <div className="text-[10px] text-[var(--color-muted)]">
                          {evidence.uploader_name || 'User'} · {evidence.uploaded_at ? new Date(evidence.uploaded_at).toLocaleString() : ''}
                        </div>
                      </div>
                      <button
                        className="cw-btn-danger text-xs"
                        onClick={() => deleteEvidenceMutation.mutate(evidence.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
