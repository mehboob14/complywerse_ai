'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertCircle, CheckCircle, Clock, FileText, Loader2, Save, Send, Shield } from 'lucide-react';
import apiClient from '@/lib/api';

type QuestionType = 'text' | 'yes_no' | 'multiple_choice' | 'rating';

interface Question {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  evidence_required: boolean;
  weight: number;
  options?: string[];
}

interface QuestionnaireResponseData {
  questionnaire_id: number;
  vendor_name: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  status: string;
  expires_at: string | null;
  questions: Question[];
  existing_responses: Record<string, unknown>;
  evidence: Record<string, Array<{ id: number; file_name: string; file_type: string | null; file_size: number | null }>>;
}

const emptyFormState = (questions: Question[], existingResponses: Record<string, unknown>) => {
  const initial: Record<string, string> = {};
  questions.forEach((question) => {
    const value = existingResponses[question.id];
    initial[question.id] = typeof value === 'string' ? value : value == null ? '' : String(value);
  });
  return initial;
};

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
      } catch (loadError: any) {
        setError(loadError?.response?.data?.detail || 'Unable to load questionnaire. The link may be invalid or expired.');
      } finally {
        setLoading(false);
      }
    };

    loadQuestionnaire();
  }, [token]);

  const unansweredRequired = useMemo(() => {
    if (!data) return [] as Question[];
    return data.questions.filter((question) => question.required && !(responses[question.id] || '').toString().trim());
  }, [data, responses]);

  // Completeness across REQUIRED questions — drives the sidebar progress meter
  // and the submit-gate messaging. (Client-side enforcement is preserved below;
  // this only surfaces progress, it does not weaken the required-answer check.)
  const requiredTotal = useMemo(
    () => (data?.questions || []).filter((q) => q.required).length,
    [data],
  );
  const requiredAnswered = Math.max(0, requiredTotal - unansweredRequired.length);
  const requiredComplete = requiredTotal === 0 || unansweredRequired.length === 0;
  const requiredPct = requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100);

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

    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(`/vendor-risk/questionnaires/external/${token}`, {
        respondent_name: respondentName || undefined,
        respondent_email: respondentEmail || undefined,
        responses,
        submit,
      });
      setSubmitSuccess(submit ? 'Questionnaire submitted successfully.' : 'Draft saved successfully.');
      if (submit) {
        setData((prev) => (prev ? { ...prev, status: 'submitted' } : prev));
      }
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
                <span>{data?.status === 'submitted' ? 'Submitted' : 'In progress'}</span>
              </div>
              {data?.expires_at && (
                <div className="mt-1 text-xs text-gray-500">
                  Expires {new Date(data.expires_at).toLocaleString()}
                </div>
              )}
            </div>
          </div>
        </div>

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
                  <input
                    type="text"
                    value={respondentName}
                    onChange={(e) => setRespondentName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    placeholder="Your name"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-gray-700">Respondent Email</span>
                  <input
                    type="email"
                    value={respondentEmail}
                    onChange={(e) => setRespondentEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                    placeholder="you@company.com"
                  />
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
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                      requiredComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {requiredComplete ? <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.75} /> : <AlertCircle className="h-3.5 w-3.5" strokeWidth={1.75} />}
                    {requiredAnswered}/{requiredTotal} required answered
                  </span>
                )}
              </div>

              <div className="space-y-5">
                {(data?.questions || []).map((question, index) => {
                  const currentValue = responses[question.id] || '';
                  const answered = isAnswered(question);
                  const needsAnswer = question.required && !answered;
                  return (
                    <div
                      key={question.id}
                      className={`rounded-xl border bg-gray-50 p-5 ${needsAnswer ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'}`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700">
                              Q{index + 1}
                            </span>
                            {question.required && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                                <span aria-hidden="true">*</span> Required
                              </span>
                            )}
                            {question.evidence_required && (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                Evidence requested
                              </span>
                            )}
                            {needsAnswer && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                                <AlertCircle className="h-3 w-3" strokeWidth={1.75} /> Needs an answer
                              </span>
                            )}
                            {question.required && answered && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
                                <CheckCircle className="h-3 w-3" strokeWidth={1.75} /> Answered
                              </span>
                            )}
                          </div>
                          <p className="mt-3 text-sm leading-6 text-gray-900">
                            {question.text}
                            {question.required && <span className="ml-1 text-rose-600" aria-hidden="true">*</span>}
                          </p>
                        </div>
                      </div>

                      {question.type === 'text' && (
                        <textarea
                          value={currentValue}
                          onChange={(e) => updateResponse(question.id, e.target.value)}
                          className="min-h-[120px] w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                          placeholder="Enter your answer"
                        />
                      )}

                      {question.type === 'yes_no' && (
                        <select
                          value={currentValue}
                          onChange={(e) => updateResponse(question.id, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        >
                          <option value="">Select an answer</option>
                          <option value="yes">Yes</option>
                          <option value="no">No</option>
                        </select>
                      )}

                      {question.type === 'multiple_choice' && (
                        <select
                          value={currentValue}
                          onChange={(e) => updateResponse(question.id, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        >
                          <option value="">Select an option</option>
                          {(question.options || []).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      )}

                      {question.type === 'rating' && (
                        <select
                          value={currentValue}
                          onChange={(e) => updateResponse(question.id, e.target.value)}
                          className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
                        >
                          <option value="">Select a rating</option>
                          {[1, 2, 3, 4, 5].map((rating) => (
                            <option key={rating} value={String(rating)}>
                              {rating}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm sticky top-6">
              <h2 className="text-lg font-semibold text-gray-900">Summary</h2>

              {/* Completeness meter for required questions. */}
              {requiredTotal > 0 && (
                <div className="mt-4">
                  <div className="mb-1 flex items-center justify-between text-xs font-medium">
                    <span className="text-gray-600">Required complete</span>
                    <span className={requiredComplete ? 'text-emerald-600' : 'text-amber-600'}>
                      {requiredAnswered}/{requiredTotal}
                    </span>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-gray-100"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={requiredTotal}
                    aria-valuenow={requiredAnswered}
                    aria-label="Required questions completed"
                  >
                    <div
                      className={`h-full rounded-full transition-all ${requiredComplete ? 'bg-emerald-500' : 'bg-amber-500'}`}
                      style={{ width: `${requiredPct}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-3 text-sm text-gray-600">
                <div className="flex items-center justify-between">
                  <span>Questions</span>
                  <span className="font-medium text-gray-900">{data?.questions.length || 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Required</span>
                  <span className="font-medium text-gray-900">{requiredTotal}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Evidence items</span>
                  <span className="font-medium text-gray-900">{data?.questions.filter((q) => q.evidence_required).length || 0}</span>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-5 text-gray-600">
                  Responses can be saved as drafts before final submission. All questions marked
                  <span className="mx-1 font-medium text-rose-600">Required</span>
                  must be answered before you can submit.
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <button
                  onClick={() => submitQuestionnaire(false)}
                  disabled={submitting}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Draft
                </button>
                <button
                  onClick={() => submitQuestionnaire(true)}
                  disabled={submitting}
                  className="cw-btn-primary flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={1.75} />}
                  Submit Questionnaire
                </button>
                {/* Client-side gate is enforced in submitQuestionnaire(true); this
                    just tells the vendor what's still outstanding. */}
                {!requiredComplete && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-700">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                    {unansweredRequired.length} required question{unansweredRequired.length === 1 ? '' : 's'} still need
                    {unansweredRequired.length === 1 ? 's' : ''} an answer before you can submit.
                  </p>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
