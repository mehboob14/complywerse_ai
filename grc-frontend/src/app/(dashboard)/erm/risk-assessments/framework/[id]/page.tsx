'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { ermApi, tenantApi } from '@/lib/api';
import { ArrowLeft, Loader2, Plus, RefreshCw, Trash2, Upload, CheckCircle2, Sparkles, BookOpen, Wand2, Check, X } from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import type { FrameworkMethodology } from '@/types';

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
  // Methodology metadata — populated for methodology-driven questions only.
  methodology_code?: string | null;
  phase_code?: string | null;
  clause_reference?: string | null;
  methodology_fields?: Record<string, string> | null;
  source_quote?: string | null;
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
  const [generateScope, setGenerateScope] = useState<'full' | 'sample'>('full');
  const [uploadingQuestionId, setUploadingQuestionId] = useState<number | null>(null);
  const [movingQuestionId, setMovingQuestionId] = useState<number | null>(null);

  const { data: assessment, isLoading } = useQuery({
    queryKey: ['framework-risk-assessment', assessmentId],
    queryFn: async () => {
      const res = await ermApi.frameworkRiskAssessments.getById(assessmentId);
      return res.data as AssessmentDetail;
    },
    enabled: Number.isFinite(assessmentId),
    refetchOnMount: 'always',
    staleTime: 0,
  });

  // Methodology registry — used to resolve scale labels, phase names, and
  // per-field labels for any methodology-driven question on this assessment.
  // Cached aggressively because the registry is static.
  const { data: methodologies } = useQuery({
    queryKey: ['framework-methodologies'],
    queryFn: async () => {
      const res = await ermApi.frameworkRiskAssessments.getMethodologies();
      return res.data.methodologies;
    },
    staleTime: 60 * 60 * 1000,
  });

  // Resolve the active methodology for this assessment by looking at the
  // first methodology-driven question. If none exist, methodology stays
  // undefined and the legacy AI question card is rendered.
  const activeMethodology: FrameworkMethodology | undefined = useMemo(() => {
    if (!methodologies || !assessment) return undefined;
    const code = assessment.questions.find((q) => q.methodology_code)?.methodology_code;
    if (!code) return undefined;
    return methodologies.find((m) => m.code === code);
  }, [methodologies, assessment]);

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
      ermApi.frameworkRiskAssessments.generateQuestions(assessmentId, {
        count: Number(generateCount) || 20,
        replace_existing: true,
        // Pass scope only when a methodology is active — backend ignores it
        // for the AI fallback path so this is safe either way.
        scope: activeMethodology ? generateScope : undefined,
        // Lock regeneration to the methodology already in use on this
        // assessment so the user doesn't accidentally fall back to AI.
        methodology_code: activeMethodology?.code,
      }),
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
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6 text-[var(--color-text)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push('/erm/risk-assessments/framework')} className="cw-btn-secondary rounded-lg p-2">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-[var(--color-text)]">{assessment.name}</h1>
            <p className="text-sm text-[var(--color-muted)]">
              {assessment.framework_name || 'Framework'} · {assessment.questions.length} questions
            </p>
          </div>
        </div>
        <div className="cw-card flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Assessment Status</label>
            <MultiSelectDropdown
              title="Assessment Status"
              triggerVariant="input"
              multiSelect={false}
              selectedValues={[assessment.status]}
              onApply={(vals) => vals[0] && updateAssessmentMutation.mutate({ status: vals[0] })}
              items={ASSESSMENT_STATUS.map((s) => ({ value: s.value, label: s.label }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
              {activeMethodology ? `Regenerate (${activeMethodology.display_name})` : 'Regenerate Questions'}
            </label>
            <div className="flex items-center gap-2">
              {activeMethodology ? (
                <>
                  <MultiSelectDropdown
                    title="Coverage"
                    triggerVariant="input"
                    multiSelect={false}
                    selectedValues={[generateScope]}
                    onApply={(vals) => setGenerateScope((vals[0] as 'full' | 'sample') || 'full')}
                    items={[
                      { value: 'full', label: 'Full coverage' },
                      { value: 'sample', label: 'Sampled' },
                    ]}
                  />
                  {generateScope === 'sample' && (
                    <MultiSelectDropdown
                      title="Sample size"
                      triggerVariant="input"
                      multiSelect={false}
                      selectedValues={[generateCount]}
                      onApply={(vals) => setGenerateCount(vals[0] || '20')}
                      items={[10, 15, 20, 25, 30, 40, 50].map((count) => ({
                        value: String(count),
                        label: String(count),
                      }))}
                    />
                  )}
                </>
              ) : (
                <MultiSelectDropdown
                  title="Count"
                  triggerVariant="input"
                  multiSelect={false}
                  selectedValues={[generateCount]}
                  onApply={(vals) => setGenerateCount(vals[0] || '20')}
                  items={[10, 15, 20, 25, 30, 40, 50].map((count) => ({
                    value: String(count),
                    label: String(count),
                  }))}
                />
              )}
              <button
                className="cw-btn-secondary flex items-center gap-2 rounded-lg px-3 py-2"
                onClick={() => {
                  const desc = activeMethodology
                    ? generateScope === 'full'
                      ? `full ${activeMethodology.display_name} coverage`
                      : `${Number(generateCount) || 20} sampled questions`
                    : `${Number(generateCount) || 20} questions`;
                  if (confirm(`Regenerate ${desc}? This will replace existing questions and evidence.`)) {
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
        {!activeMethodology && (
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-4 py-3 text-xs text-[var(--color-muted)]">
            No methodology mapped for this framework — questions were AI-generated using the framework&apos;s parsed control text as context. Use the regenerate panel above to switch the assessment over to a specific methodology.
          </div>
        )}
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
                <MultiSelectDropdown
                  title="Status"
                  triggerVariant="input"
                  multiSelect={false}
                  selectedValues={[question.status]}
                  onApply={(vals) => vals[0] && updateQuestionMutation.mutate({ questionId: question.id, data: { status: vals[0] } })}
                  items={STATUS_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Assignee</label>
                <MultiSelectDropdown
                  title="Assignee"
                  triggerVariant="input"
                  multiSelect={false}
                  forceSearch
                  selectedValues={question.assigned_user_id ? [String(question.assigned_user_id)] : []}
                  onApply={(vals) => updateQuestionMutation.mutate({
                    questionId: question.id,
                    data: { assigned_user_id: vals[0] ? Number(vals[0]) : null },
                  })}
                  items={(users || []).map((u) => ({
                    value: String(u.id),
                    label: u.display_name || u.username,
                    subLabel: u.email || undefined,
                  }))}
                  placeholder="Unassigned"
                />
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

            <MethodologyQuestionCard
              assessmentId={assessmentId}
              question={question}
              methodology={activeMethodology}
              onSave={(fields) =>
                updateQuestionMutation.mutate({
                  questionId: question.id,
                  data: { methodology_fields: fields },
                })
              }
              onApplyScores={(scores) =>
                updateQuestionMutation.mutate({ questionId: question.id, data: scores })
              }
              isSaving={updateQuestionMutation.isPending}
            />

            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
                  {activeMethodology
                    ? `Risk Rating · ${activeMethodology.display_name}`
                    : 'Question Risk Assessment'}
                </div>
                {activeMethodology && (
                  <span className="text-[10px] text-[var(--color-muted)]">
                    Likelihood &amp; impact labels follow {activeMethodology.reference_standard}
                  </span>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                <ScaleSelect
                  label="Inherent Likelihood"
                  scale={activeMethodology?.likelihood_scale}
                  value={question.inherent_likelihood}
                  onChange={(v) => updateQuestionRiskValues(question.id, { inherent_likelihood: v })}
                />
                <ScaleSelect
                  label="Inherent Impact"
                  scale={activeMethodology?.impact_scale}
                  value={question.inherent_impact}
                  onChange={(v) => updateQuestionRiskValues(question.id, { inherent_impact: v })}
                />
                <div>
                  <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">Inherent Score</label>
                  <div className="cw-field w-full rounded-lg px-3 py-2 text-sm bg-white/70">{question.inherent_score ?? '-'}</div>
                </div>
                <ScaleSelect
                  label="Residual Likelihood"
                  scale={activeMethodology?.likelihood_scale}
                  value={question.residual_likelihood}
                  onChange={(v) => updateQuestionRiskValues(question.id, { residual_likelihood: v })}
                />
                <ScaleSelect
                  label="Residual Impact"
                  scale={activeMethodology?.impact_scale}
                  value={question.residual_impact}
                  onChange={(v) => updateQuestionRiskValues(question.id, { residual_impact: v })}
                />
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

/* ---------------------------------------------------------------------------
 * Helper components — methodology-aware scale select & per-question card.
 * ------------------------------------------------------------------------- */

function ScaleSelect({
  label,
  scale,
  value,
  onChange,
}: {
  label: string;
  scale: FrameworkMethodology['likelihood_scale'] | undefined;
  value?: number | null;
  onChange: (v: number | null) => void;
}) {
  const fallback = [1, 2, 3, 4, 5];
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--color-muted)] mb-1">{label}</label>
      <select
        className="cw-field w-full rounded-lg px-2 py-2 text-sm"
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">-</option>
        {scale && scale.length > 0
          ? scale.map((p) => (
              <option key={p.value} value={p.value} title={p.description}>
                {p.value} · {p.label}
              </option>
            ))
          : fallback.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
      </select>
    </div>
  );
}

interface AISuggestResult {
  suggestions: Record<string, string>;
  recommendations: string;
  rationale: string;
  recommended_scores: {
    inherent_likelihood: number | null;
    inherent_impact: number | null;
    residual_likelihood: number | null;
    residual_impact: number | null;
  };
}

function MethodologyQuestionCard({
  assessmentId,
  question,
  methodology,
  onSave,
  onApplyScores,
  isSaving,
}: {
  assessmentId: number;
  question: QuestionItem;
  methodology: FrameworkMethodology | undefined;
  onSave: (fields: Record<string, string>) => void;
  onApplyScores: (scores: Partial<{
    inherent_likelihood: number;
    inherent_impact: number;
    residual_likelihood: number;
    residual_impact: number;
  }>) => void;
  isSaving: boolean;
}) {
  // IMPORTANT: All hooks must be declared *before* any early return so the
  // hook order stays identical across renders (Rules of Hooks). The previous
  // version returned early when methodology was undefined on the first
  // render and then declared hooks on the second — silently corrupting the
  // useState slot that backed `draft`, which is why "Apply" never landed.
  const initial = question.methodology_fields || {};
  const [draft, setDraft] = useState<Record<string, string>>({ ...initial });

  // AI suggest state
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AISuggestResult | null>(null);
  const [contextHint, setContextHint] = useState('');

  // Sync draft → server value when the user navigates between questions or
  // a save round-trips fresh data. Only `question.id` is the dep so a local
  // edit (Apply, typing) is never clobbered by an in-flight refetch.
  useEffect(() => {
    setDraft({ ...(question.methodology_fields || {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  // Don't render the card unless this question is methodology-driven and
  // the registry has loaded. All hooks above remain consistent regardless.
  if (!question.methodology_code || !methodology) return null;

  const phase = methodology.phases.find((p) => p.code === question.phase_code);
  const fields = methodology.fields;
  const dirty = fields.some((f) => (draft[f.key] || '') !== (initial[f.key] || ''));

  const runAISuggest = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await ermApi.frameworkRiskAssessments.aiSuggestQuestion(
        assessmentId,
        question.id,
        contextHint.trim() || undefined,
      );
      setAiResult(res.data);
      setAiOpen(true);
    } catch (e: any) {
      setAiError(e?.response?.data?.detail || e?.message || 'AI suggest failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const applySuggestion = (key: string) => {
    if (!aiResult) return;
    const value = aiResult.suggestions[key] || '';
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const applyAllSuggestions = () => {
    if (!aiResult) return;
    setDraft((d) => ({ ...d, ...aiResult.suggestions }));
  };

  const applyRecommendedScores = () => {
    if (!aiResult) return;
    const out: Partial<{
      inherent_likelihood: number;
      inherent_impact: number;
      residual_likelihood: number;
      residual_impact: number;
    }> = {};
    const s = aiResult.recommended_scores;
    if (s.inherent_likelihood) out.inherent_likelihood = s.inherent_likelihood;
    if (s.inherent_impact) out.inherent_impact = s.inherent_impact;
    if (s.residual_likelihood) out.residual_likelihood = s.residual_likelihood;
    if (s.residual_impact) out.residual_impact = s.residual_impact;
    if (Object.keys(out).length > 0) onApplyScores(out);
  };

  const hasRecommendedScores =
    !!aiResult &&
    Object.values(aiResult.recommended_scores).some((v) => v !== null && v !== undefined);

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
          <BookOpen size={11} /> {methodology.display_name}
        </span>
        {phase && (
          <span className="rounded-full bg-white px-2 py-0.5 font-medium text-blue-700 border border-blue-200">
            Phase {phase.order}: {phase.name}
          </span>
        )}
        {question.clause_reference && (
          <span className="rounded-full bg-white px-2 py-0.5 font-mono text-blue-700 border border-blue-200">
            {question.clause_reference}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            onClick={runAISuggest}
            disabled={aiLoading}
            title="Ask AI to suggest values for the fields below"
          >
            {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />}
            AI assist
          </button>
        </div>
      </div>

      {aiError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {aiError}
        </div>
      )}

      {aiOpen && aiResult && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-900">
              <Wand2 size={12} /> AI suggestions
            </div>
            <div className="flex items-center gap-1">
              <button
                className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700"
                onClick={applyAllSuggestions}
              >
                <Check size={10} /> Apply all to fields
              </button>
              {hasRecommendedScores && (
                <button
                  className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-[11px] font-medium text-violet-700 hover:bg-violet-100"
                  onClick={applyRecommendedScores}
                  title="Apply the suggested likelihood / impact ratings to the risk-rating section below"
                >
                  Apply suggested scores
                </button>
              )}
              <button
                className="inline-flex items-center gap-1 rounded-md border border-violet-300 bg-white px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-100"
                onClick={() => setAiOpen(false)}
              >
                <X size={10} /> Hide
              </button>
            </div>
          </div>

          {aiResult.recommendations && (
            <div className="rounded-md bg-white px-3 py-2 text-xs text-violet-900">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-700">
                Assessor guidance
              </div>
              <div>{aiResult.recommendations}</div>
            </div>
          )}

          <div className="space-y-2">
            {fields.map((f) => {
              const suggested = aiResult.suggestions[f.key];
              if (suggested === undefined) return null;
              const trimmed = (suggested || '').trim();
              return (
                <div
                  key={f.key}
                  className="rounded-md border border-violet-200 bg-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="text-[11px] font-semibold text-violet-900">{f.label}</div>
                      <div className="mt-0.5 text-xs text-violet-900/90 whitespace-pre-wrap">
                        {trimmed || <span className="italic text-violet-500">No suggestion</span>}
                      </div>
                    </div>
                    {trimmed && (
                      <button
                        className="inline-flex shrink-0 items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700"
                        onClick={() => applySuggestion(f.key)}
                      >
                        <Check size={10} /> Apply
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {hasRecommendedScores && (
            <div className="rounded-md bg-white px-3 py-2 text-xs text-violet-900">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-violet-700">
                Suggested ratings (1–5)
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                <div>
                  Inherent L:{' '}
                  <strong>{aiResult.recommended_scores.inherent_likelihood ?? '–'}</strong>
                </div>
                <div>
                  Inherent I:{' '}
                  <strong>{aiResult.recommended_scores.inherent_impact ?? '–'}</strong>
                </div>
                <div>
                  Residual L:{' '}
                  <strong>{aiResult.recommended_scores.residual_likelihood ?? '–'}</strong>
                </div>
                <div>
                  Residual I:{' '}
                  <strong>{aiResult.recommended_scores.residual_impact ?? '–'}</strong>
                </div>
              </div>
            </div>
          )}

          {aiResult.rationale && (
            <div className="text-[11px] italic text-violet-700">{aiResult.rationale}</div>
          )}

          <div>
            <label className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-violet-700">
              Re-run with extra context (optional)
            </label>
            <div className="flex items-center gap-2">
              <input
                className="cw-field flex-1 rounded-md px-2 py-1 text-xs"
                placeholder="e.g. We host on AWS, ~200 employees, no PII processing"
                value={contextHint}
                onChange={(e) => setContextHint(e.target.value)}
              />
              <button
                className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                onClick={runAISuggest}
                disabled={aiLoading}
              >
                {aiLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
                Re-run
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={f.field_type === 'textarea' ? 'md:col-span-2' : ''}>
            <label className="mb-1 block text-xs font-medium text-blue-900">
              {f.label}
              {f.required && <span className="ml-0.5 text-red-500">*</span>}
            </label>
            {f.field_type === 'textarea' ? (
              <textarea
                className="cw-field w-full rounded-lg px-3 py-2 text-sm"
                rows={2}
                placeholder={f.placeholder || ''}
                value={draft[f.key] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            ) : f.field_type === 'select' ? (
              <select
                className="cw-field w-full rounded-lg px-3 py-2 text-sm"
                value={draft[f.key] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              >
                <option value="">-</option>
                {(f.options || []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="cw-field w-full rounded-lg px-3 py-2 text-sm"
                placeholder={f.placeholder || ''}
                value={draft[f.key] || ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
              />
            )}
            {f.help_text && <div className="mt-1 text-[10px] text-blue-700/80">{f.help_text}</div>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50"
          onClick={() => onSave(draft)}
          disabled={!dirty || isSaving}
        >
          {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
          Save methodology fields
        </button>
      </div>
    </div>
  );
}
