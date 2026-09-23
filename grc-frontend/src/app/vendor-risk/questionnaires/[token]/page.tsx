'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle, Clock, FileText, Loader2, MessageSquare, Save, Send, Shield } from 'lucide-react';
import apiClient from '@/lib/api';

type QuestionType = 'text' | 'yes_no' | 'multiple_choice' | 'rating';

interface Question {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  evidence_required: boolean;
  weight: number;
  // A sent questionnaire carries its options as {value, label}; older templates as plain strings.
  options?: Array<string | { value: string; label?: string }>;
  // Shown only when an earlier question was answered with one of these values.
  show_if?: { question: string; in: string[] };
}

interface Attestation { name: string; title: string; email: string }

interface QuestionnaireResponseData {
  questionnaire_id: number;
  vendor_name: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  status: string;
  expires_at: string | null;
  due_date: string | null;
  questions: Question[];
  existing_responses: Record<string, unknown>;
  comments: Record<string, string>;
  clarifications: Record<string, string | null>;
  attestation: { name: string | null; title: string | null; email: string | null };
  evidence: Record<string, Array<{ id: number; file_name: string; file_type: string | null; file_size: number | null }>>;
}

const optionsOf = (question: Question) =>
  (question.options || []).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) });

const emptyFormState = (questions: Question[], existingResponses: Record<string, unknown>) => {
  const initial: Record<string, string> = {};
  questions.forEach((question) => {
    const value = existingResponses[question.id];
    initial[question.id] = typeof value === 'string' ? value : value == null ? '' : String(value);
  });
  return initial;
};

// The same rule the server applies at submit: a question with show_if applies only
// when the earlier question it names applies and was answered with one of its values.
function applicable(questions: Question[], answers: Record<string, string>): Question[] {
  const shown: Question[] = [];
  const keys = new Set<string>();
  for (const q of questions) {
    const rule = q.show_if;
    if (rule?.question) {
      const allowed = (rule.in || []).map((v) => String(v).trim().toLowerCase());
      if (!keys.has(rule.question) || !allowed.includes((answers[rule.question] || '').trim().toLowerCase())) continue;
    }
    shown.push(q);
    keys.add(q.id);
  }
  return shown;
}

const inputCls = 'w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-100 disabled:text-gray-500';

export default function ExternalQuestionnairePage() {
  const params = useParams();
  const token = String(params.token || '');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<QuestionnaireResponseData | null>(null);
  const [respondentName, setRespondentName] = useState('');
  const [respondentEmail, setRespondentEmail] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [attestation, setAttestation] = useState<Attestation>({ name: '', title: '', email: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    const loadQuestionnaire = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await apiClient.get(`/vendor-risk/questionnaires/external/${token}`);
        const payload = response.data as QuestionnaireResponseData;
        setData(payload);
        setRespondentName(payload.respondent_name || '');
        setRespondentEmail(payload.respondent_email || '');
        setResponses(emptyFormState(payload.questions || [], payload.existing_responses || {}));
        setComments(payload.comments || {});
        setAttestation({
          name: payload.attestation?.name || payload.respondent_name || '',
          title: payload.attestation?.title || '',
          email: payload.attestation?.email || payload.respondent_email || '',
        });
      } catch (loadError: any) {
        setError(loadError?.response?.data?.detail || 'Unable to load questionnaire. The link may be invalid or expired.');
      } finally {
        setLoading(false);
      }
    };

    loadQuestionnaire();
  }, [token]);

  const returned = data?.status === 'returned';
  const clarifications = data?.clarifications || {};
  const canEdit = (question: Question) => !returned || question.id in clarifications;

  const shownQuestions = useMemo(() => applicable(data?.questions || [], responses), [data, responses]);

  const unansweredRequired = useMemo(
    () => shownQuestions.filter((question) => question.required && !(responses[question.id] || '').toString().trim()),
    [shownQuestions, responses],
  );

  // Completeness across the REQUIRED questions that apply — drives the progress
  // meter and the submit gate. The server applies the same rule at submit.
  const requiredTotal = shownQuestions.filter((q) => q.required).length;
  const requiredAnswered = Math.max(0, requiredTotal - unansweredRequired.length);
  const requiredComplete = requiredTotal === 0 || unansweredRequired.length === 0;
  const requiredPct = requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100);
  const attested = !!attestation.name.trim() && /\S+@\S+\.\S+/.test(attestation.email.trim()) && confirmed;

  const isAnswered = (question: Question) => !!(responses[question.id] || '').toString().trim();

  const updateResponse = (questionId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
  };

  const submitQuestionnaire = async (submit: boolean) => {
    if (!data) return;
    if (submit && unansweredRequired.length > 0) {
      setError(`Please answer all required questions before submitting (${unansweredRequired.length} remaining).`);
      return;
    }
    if (submit && !attested) {
      setError('Before submitting, give the name and email of the person attesting to these answers and confirm them.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const saved = await apiClient.post(`/vendor-risk/questionnaires/external/${token}`, {
        respondent_name: respondentName || undefined,
        respondent_email: respondentEmail || undefined,
        responses,
        comments,
        attestation: submit ? { ...attestation, confirm: confirmed } : undefined,
        submit,
      });
      setSubmitSuccess(submit ? 'Questionnaire submitted. Thank you.' : 'Draft saved.');
      setData((prev) => (prev ? { ...prev, status: saved.data?.status || prev.status } : prev));
    } catch (submitError: any) {
      setError(submitError?.response?.data?.detail || 'Failed to save questionnaire response.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
          <span className="text-sm text-gray-700">Loading questionnaire...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 px-6 py-10">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-3 text-rose-600">
            <AlertCircle className="h-6 w-6" />
            <h1 className="text-xl font-semibold">Questionnaire unavailable</h1>
          </div>
          <p className="mt-3 text-sm text-gray-700">{error}</p>
        </div>
      </div>
    );
  }

  const done = data?.status === 'submitted';

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
                Vendor Questionnaire
              </div>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight text-gray-900">
                {data?.vendor_name || 'Questionnaire'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
                Complete the requested questionnaire and attach any supporting evidence directly in the platform.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span>{done ? 'Submitted' : returned ? 'Clarification requested' : 'In progress'}</span>
              </div>
              {data?.due_date && (
                <div className="mt-1 text-xs text-gray-600">Due {new Date(data.due_date).toLocaleDateString()}</div>
              )}
              {data?.expires_at && (
                <div className="mt-0.5 text-xs text-gray-500">Link expires {new Date(data.expires_at).toLocaleDateString()}</div>
              )}
            </div>
          </div>
        </div>

        {returned && !done && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">
              Your contact has a question about {Object.keys(clarifications).length} of your answers.
            </p>
            <p className="mt-1 text-amber-800">Only those questions can be changed now. Answer them, then submit again.</p>
          </div>
        )}

        {submitSuccess && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{submitSuccess}</span>
            </div>
          </div>
        )}

        {error && data && (
          <div className="mb-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm font-medium">{error}</span>
            </div>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center gap-2 text-gray-900">
                <FileText className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
                <h2 className="text-lg font-semibold">Response Details</h2>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Respondent Name</span>
                  <input type="text" value={respondentName} disabled={done} onChange={(e) => setRespondentName(e.target.value)}
                    className={inputCls} placeholder="Your name" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Respondent Email</span>
                  <input type="email" value={respondentEmail} disabled={done} onChange={(e) => setRespondentEmail(e.target.value)}
                    className={inputCls} placeholder="you@company.com" />
                </label>
              </div>
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5 flex items-center justify-between gap-2 text-gray-900">
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
                  <h2 className="text-lg font-semibold">Questionnaire</h2>
                </div>
                {requiredTotal > 0 && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                    requiredComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {requiredComplete ? <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.75} /> : <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    {requiredAnswered}/{requiredTotal} required answered
                  </span>
                )}
              </div>

              <div className="space-y-5">
                {shownQuestions.map((question, index) => {
                  const currentValue = responses[question.id] || '';
                  const answered = isAnswered(question);
                  const needsAnswer = question.required && !answered;
                  const editable = canEdit(question) && !done;
                  const asked = clarifications[question.id];
                  const isAsked = question.id in clarifications;
                  const commentOpen = openComments[question.id] || !!comments[question.id] || isAsked;
                  return (
                    <div key={question.id}
                      className={`rounded-xl border p-5 ${isAsked ? 'border-amber-300 bg-amber-50/40'
                        : needsAnswer && editable ? 'border-amber-300 bg-gray-50 ring-1 ring-amber-100' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="mb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700">Q{index + 1}</span>
                          {question.required && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                              <span aria-hidden="true">*</span> Required
                            </span>
                          )}
                          {question.evidence_required && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Evidence requested</span>
                          )}
                          {needsAnswer && editable && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                              <AlertCircle className="h-3 w-3" strokeWidth={1.75} /> Needs an answer
                            </span>
                          )}
                        </div>
                        <p className="mt-3 text-sm leading-6 text-gray-900">
                          {question.text}
                          {question.required && <span className="ml-1 text-rose-600" aria-hidden="true">*</span>}
                        </p>
                        {isAsked && (
                          <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
                            <span className="font-medium">Your contact asks: </span>{asked || 'Please review this answer.'}
                          </p>
                        )}
                      </div>

                      {question.type === 'text' && (
                        <textarea value={currentValue} disabled={!editable} onChange={(e) => updateResponse(question.id, e.target.value)}
                          className={`min-h-[120px] ${inputCls}`} placeholder="Enter your answer" aria-label={`Answer to question ${index + 1}`} />
                      )}

                      {question.type !== 'text' && (
                        <select value={currentValue} disabled={!editable} onChange={(e) => updateResponse(question.id, e.target.value)}
                          className={inputCls} aria-label={`Answer to question ${index + 1}`}>
                          <option value="">Select an answer</option>
                          {(question.type === 'rating'
                            ? [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))
                            : optionsOf(question).length ? optionsOf(question)
                              : [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]
                          ).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      )}

                      {commentOpen ? (
                        <label className="mt-3 block">
                          <span className="text-xs font-medium text-gray-600">{isAsked ? 'Your reply' : 'Comment (optional)'}</span>
                          <textarea value={comments[question.id] || ''} disabled={!editable} rows={2} maxLength={4000}
                            onChange={(e) => setComments((prev) => ({ ...prev, [question.id]: e.target.value }))}
                            className={`mt-1 ${inputCls}`} />
                        </label>
                      ) : editable && (
                        <button type="button" onClick={() => setOpenComments((prev) => ({ ...prev, [question.id]: true }))}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
                          <MessageSquare className="h-3.5 w-3.5" /> Add a comment
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            {!done && (
              <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-gray-900">Attestation</h2>
                <p className="mt-1 text-sm text-gray-600">
                  A named person must stand behind these answers before they can be submitted.
                </p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">Name</span>
                    <input value={attestation.name} onChange={(e) => setAttestation({ ...attestation, name: e.target.value })} className={inputCls} />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">Job title</span>
                    <input value={attestation.title} onChange={(e) => setAttestation({ ...attestation, title: e.target.value })} className={inputCls} />
                  </label>
                  <label className="space-y-2">
                    <span className="text-sm font-medium text-gray-700">Email</span>
                    <input type="email" value={attestation.email} onChange={(e) => setAttestation({ ...attestation, email: e.target.value })} className={inputCls} />
                  </label>
                </div>
                <label className="mt-4 flex items-start gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                  I confirm these answers are accurate and complete to the best of my knowledge, and that I am authorised to give them.
                </label>
              </section>
            )}
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sticky top-6">
              <h2 className="text-lg font-semibold text-gray-900">Summary</h2>

              {requiredTotal > 0 && (
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs font-medium">
                    <span className="text-gray-600">Required complete</span>
                    <span className={requiredComplete ? 'text-emerald-600' : 'text-amber-600'}>{requiredAnswered}/{requiredTotal}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0}
                    aria-valuemax={requiredTotal} aria-valuenow={requiredAnswered} aria-label="Required questions completed">
                    <div className={`h-full rounded-full transition-all ${requiredComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${requiredPct}%` }} />
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3 text-sm text-gray-600">
                <div className="flex items-center justify-between">
                  <span>Questions</span>
                  <span className="font-medium text-gray-900">{shownQuestions.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Required</span>
                  <span className="font-medium text-gray-900">{requiredTotal}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Evidence items</span>
                  <span className="font-medium text-gray-900">{shownQuestions.filter((q) => q.evidence_required).length}</span>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-5 text-gray-600">
                  Save a draft at any time. Submitting needs every
                  <span className="mx-1 font-medium text-rose-600">Required</span>
                  question answered and a named person attesting to the answers.
                </div>
              </div>

              {!done && (
                <div className="mt-6 space-y-3">
                  <button onClick={() => submitQuestionnaire(false)} disabled={submitting}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Draft
                  </button>
                  <button onClick={() => submitQuestionnaire(true)} disabled={submitting}
                    className="cw-btn-primary flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={1.75} />}
                    {returned ? 'Submit answers' : 'Submit Questionnaire'}
                  </button>
                  {!requiredComplete && (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      {unansweredRequired.length} required question{unansweredRequired.length === 1 ? '' : 's'} still
                      {unansweredRequired.length === 1 ? ' needs' : ' need'} an answer before you can submit.
                    </p>
                  )}
                  {requiredComplete && !attested && (
                    <p className="flex items-start gap-1.5 text-xs text-gray-600">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                      Complete the attestation below the questions to submit.
                    </p>
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
