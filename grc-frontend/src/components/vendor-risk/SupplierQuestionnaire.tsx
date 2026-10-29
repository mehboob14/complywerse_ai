'use client';

// The questionnaire a supplier answers, wherever it is opened from: a questionnaire's own
// link (sent before personal links) or a contact's personal link in the supplier portal.
// Both APIs have the same shape under their own base path, so the path is all that differs.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowDown, ArrowLeft, CheckCircle, Clock, Download, FileSpreadsheet, FileText, Loader2, Lock, MessageSquare, Paperclip, Save, Send, Shield, Trash2, Upload } from 'lucide-react';
import apiClient from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';

type QuestionType = 'text' | 'yes_no' | 'multiple_choice' | 'rating' | 'file';

/** An answer option. `na`/`not_applicable`: picking it needs a reason; `comment_required`: a note. */
export interface QuestionOption {
  value: string; label?: string; score?: number | null;
  na?: boolean; not_applicable?: boolean; comment_required?: boolean;
}

/** What the question rules read (tpra/portal.py). */
export interface RuleQuestion {
  type?: string;
  evidence?: 'none' | 'optional' | 'required';
  evidence_on?: string[];                  // answers that owe the evidence; empty: any answer
  evidence_required?: boolean;             // before the rules: owed on Yes or Partial
  options?: Array<string | QuestionOption>;
}

interface Question extends RuleQuestion {
  id: string;
  text: string;
  type: QuestionType;
  required: boolean;
  evidence_required: boolean;
  weight: number;
  // A sent questionnaire carries its options as {value, label}; older templates as plain strings.
  options?: Array<string | QuestionOption>;
  // Shown only when an earlier question was answered with one of these values.
  show_if?: { question: string; in: string[] };
  // Answered by a certificate the requester already holds; cannot be changed.
  locked?: boolean;
}

// The question rules as the server applies them at submit (tpra/portal.py). ponytail: answers here
// are always an option's own value, so the server's Yes/No spellings ("Y", "true") are not read.
export function evidenceRule(q: RuleQuestion): { mode: 'none' | 'optional' | 'required'; on: string[] } {
  if (q.evidence === 'none' || q.evidence === 'optional' || q.evidence === 'required') {
    return { mode: q.evidence, on: (q.evidence_on || []).map((v) => String(v).trim().toLowerCase()) };
  }
  return q.evidence_required ? { mode: 'required', on: ['yes', 'partial'] } : { mode: 'optional', on: [] };
}

const optionOf = (q: RuleQuestion, value: string) => (q.options || []).find(
  (o): o is QuestionOption => typeof o !== 'string' && String(o.value).trim().toLowerCase() === value.trim().toLowerCase());

export const isNotApplicable = (o?: QuestionOption | null) => !!o && !!(o.na || o.not_applicable);

/** Whether this answer owes evidence: a file question's file is its answer; N/A owes a reason instead. */
export function owesEvidence(q: RuleQuestion, answer: string): boolean {
  const { mode, on } = evidenceRule(q);
  const value = (answer || '').trim();
  if (mode !== 'required' || !value || q.type === 'file' || isNotApplicable(optionOf(q, value))) return false;
  return on.length === 0 || on.includes(value.toLowerCase());
}

/** 'reason' for a not-applicable answer, 'note' for one whose option asks for a note. */
export function noteNeeded(q: RuleQuestion, answer: string): 'reason' | 'note' | null {
  const option = optionOf(q, answer || '');
  if (isNotApplicable(option)) return 'reason';
  return option?.comment_required ? 'note' : null;
}

type EvidenceFile = { id: number; file_name: string; file_type: string | null; file_size: number | null };

// A comment a reviewer shared on a question, or the supplier's reply (portal only).
type QuestionMessage = { id: number; from_supplier: boolean; author: string | null; body: string; created_at: string };

interface Attestation { name: string; title: string; email: string }

interface QuestionnaireResponseData {
  questionnaire_id: number;
  title?: string | null;
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
  certificate: { name: string; mode: string; expires: string | null } | null;
  evidence: Record<string, EvidenceFile[]>;
  // In the supplier portal: the comments shared on each question. A questionnaire's own link has none.
  messages?: Record<string, QuestionMessage[]>;
}

const optionsOf = (question: Question) =>
  (question.options || []).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : { value: String(o.value), label: String(o.label ?? o.value) });

const WAITING = ['pending', 'in_progress', 'returned'];
const SENT_STATUS: Record<string, string> = { submitted: 'Submitted', under_review: 'In review', accepted: 'Accepted' };

/** The file a question asks for, dropped here or chosen. */
function DropZone({ busy, onFile, label }: { busy: boolean; onFile: (f: File) => void; label: string }) {
  return (
    <label onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !busy) onFile(f); }}
      className="relative flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-gray-300 bg-white px-4 py-5 text-center text-sm text-gray-600 hover:border-primary-400">
      {busy ? <Loader2 className="h-5 w-5 animate-spin text-primary-600" /> : <Upload className="h-5 w-5 text-gray-400" />}
      <span>Drop the file here or <span className="font-medium text-primary-700">choose it</span></span>
      <input type="file" className="sr-only" aria-label={label} disabled={busy}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </label>
  );
}

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

export default function SupplierQuestionnaire({ apiBase, backHref }: {
  /** e.g. /vendor-risk/questionnaires/external/<token> or /vendor-risk/portal/<token>/questionnaires/<id> */
  apiBase: string;
  /** the supplier portal's home, when opened from there */
  backHref?: string;
}) {
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
  const [evidence, setEvidence] = useState<Record<string, EvidenceFile[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [expiresOn, setExpiresOn] = useState<Record<string, string>>({});
  const [openDrops, setOpenDrops] = useState<Record<string, boolean>>({});
  const [threads, setThreads] = useState<Record<string, QuestionMessage[]>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [replying, setReplying] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const loadQuestionnaire = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get(apiBase);
      const payload = response.data as QuestionnaireResponseData;
      setData(payload);
      setRespondentName(payload.respondent_name || '');
      setRespondentEmail(payload.respondent_email || '');
      setResponses(emptyFormState(payload.questions || [], payload.existing_responses || {}));
      setComments(payload.comments || {});
      setEvidence(payload.evidence || {});
      setThreads(payload.messages || {});
      setAttestation((prev) => ({
        name: payload.attestation?.name || prev.name || payload.respondent_name || '',
        title: payload.attestation?.title || prev.title || '',
        email: payload.attestation?.email || prev.email || payload.respondent_email || '',
      }));
    } catch (loadError: any) {
      setError(loadError?.response?.data?.detail || 'Unable to load questionnaire. The link may be invalid or expired.');
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (apiBase) loadQuestionnaire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase]);

  // Offline: download the questionnaire as a workbook, answer it, upload it back.
  const [importing, setImporting] = useState(false);
  const downloadWorkbook = async (as: 'xlsx' | 'pdf' = 'xlsx') => {
    setError(null);
    try {
      const res = await apiClient.get(`${apiBase}/${as === 'pdf' ? 'pdf' : 'workbook'}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `questionnaire-${data?.questionnaire_id ?? ''}.${as}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(as === 'pdf' ? 'The PDF could not be downloaded.' : 'The workbook could not be downloaded.');
    }
  };
  const importWorkbook = async (file: File) => {
    setImporting(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await apiClient.post(`${apiBase}/workbook`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await loadQuestionnaire(true);
      const who = res.data?.attestation as { name?: string; title?: string; email?: string; confirm?: boolean } | undefined;
      if (who?.name) setAttestation({ name: who.name || '', title: who.title || '', email: who.email || '' });
      setSubmitSuccess(`${res.data?.imported ?? 0} answers imported. Check them, confirm the attestation and submit.`);
    } catch (importError: any) {
      setError(importError?.response?.data?.detail || 'The workbook could not be imported.');
    } finally {
      setImporting(false);
    }
  };

  const reloadEvidence = async () => {
    const res = await apiClient.get(`${apiBase}/evidence`);
    setEvidence((res.data || {}) as Record<string, EvidenceFile[]>);
  };

  // The file goes into the requester's evidence library against this question,
  // with the expiry date the vendor gives (for a certificate or a report).
  const uploadFile = async (questionId: string, file: File) => {
    setUploading(questionId);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      if (expiresOn[questionId]) form.append('expires_on', expiresOn[questionId]);
      await apiClient.post(`${apiBase}/evidence/${encodeURIComponent(questionId)}`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await reloadEvidence();
    } catch (uploadError: any) {
      setError(uploadError?.response?.data?.detail || 'The file could not be uploaded.');
    } finally {
      setUploading(null);
    }
  };

  const deleteFile = async (fileId: number) => {
    setError(null);
    try {
      await apiClient.delete(`${apiBase}/evidence/${fileId}`);
      await reloadEvidence();
    } catch (deleteError: any) {
      setError(deleteError?.response?.data?.detail || 'The file could not be removed.');
    }
  };

  // A reply on one question, to the comments a reviewer shared there (portal only; always shared).
  const sendReply = async (questionId: string) => {
    const body = (replies[questionId] || '').trim();
    if (!body) return;
    setReplying(questionId);
    setError(null);
    try {
      const res = await apiClient.post(`${apiBase}/messages`, { question_key: questionId, body });
      setThreads((prev) => ({ ...prev, [questionId]: [...(prev[questionId] || []), res.data as QuestionMessage] }));
      setReplies((prev) => ({ ...prev, [questionId]: '' }));
    } catch (replyError: any) {
      setError(replyError?.response?.data?.detail || 'Your reply could not be sent.');
    } finally {
      setReplying(null);
    }
  };

  const returned = data?.status === 'returned';
  const done = !!data && !WAITING.includes(data.status);       // sent: there to read, and to reply on
  const clarifications = data?.clarifications || {};
  const canEdit = (question: Question) => !question.locked && (!returned || question.id in clarifications);

  const shownQuestions = useMemo(() => applicable(data?.questions || [], responses), [data, responses]);

  // A file question is answered by its file.
  const isAnswered = (question: Question) => (question.type === 'file'
    ? (evidence[question.id] || []).length > 0 : !!(responses[question.id] || '').toString().trim());

  // What a question still lacks, by the server's rules: an answer, a reason or note, a document.
  const gapsOf = (question: Question) => {
    const value = (responses[question.id] || '').toString();
    const answered = isAnswered(question);
    const need = answered ? noteNeeded(question, value) : null;
    return {
      need,
      left: (!answered && question.required) || (!!need && !(comments[question.id] || '').trim()),
      document: answered && owesEvidence(question, value) && !(evidence[question.id] || []).length,
    };
  };
  const toDo = done ? [] : shownQuestions.filter((q) => canEdit(q) && (gapsOf(q).left || gapsOf(q).document));
  const questionsLeft = toDo.filter((q) => gapsOf(q).left).length;
  const documentsMissing = toDo.filter((q) => gapsOf(q).document).length;
  const goNext = () => {
    if (!toDo.length) return;
    const q = toDo[cursor % toDo.length];
    document.getElementById(`question-${q.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setCursor((c) => c + 1);
  };

  const unansweredRequired = shownQuestions.filter((question) => question.required && !isAnswered(question));

  // Completeness across the REQUIRED questions that apply — drives the progress
  // meter and the submit gate. The server applies the same rule at submit.
  const requiredTotal = shownQuestions.filter((q) => q.required).length;
  const requiredAnswered = Math.max(0, requiredTotal - unansweredRequired.length);
  const requiredComplete = requiredTotal === 0 || unansweredRequired.length === 0;
  const requiredPct = requiredTotal === 0 ? 100 : Math.round((requiredAnswered / requiredTotal) * 100);
  const attested = !!attestation.name.trim() && /\S+@\S+\.\S+/.test(attestation.email.trim()) && confirmed;

  const updateResponse = (questionId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }));
  };

  const submitQuestionnaire = async (submit: boolean) => {
    if (!data) return;
    if (submit && toDo.length > 0) {
      setError('Finish the questions marked first.');
      goNext();
      return;
    }
    if (submit && !attested) {
      setError('Before submitting, give the name and email of the person attesting to these answers and confirm them.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const saved = await apiClient.post(apiBase, {
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

  const back = backHref ? (
    <Link href={backHref} className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary-700 hover:underline">
      <ArrowLeft className="h-4 w-4" /> All questionnaires
    </Link>
  ) : null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-6 py-4 shadow-sm">
          <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
          <span className="text-sm text-gray-700">Loading questionnaire...</span>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-10">
        <div className="mx-auto max-w-3xl">
          {back}
          <div className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertCircle className="h-6 w-6" />
              <h1 className="text-xl font-semibold">Questionnaire unavailable</h1>
            </div>
            <p className="mt-3 text-sm text-gray-700">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        {back}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary-200 bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">
                <Shield className="h-3.5 w-3.5" strokeWidth={1.75} />
                {data?.title || 'Vendor Questionnaire'}
              </div>
              <h1 className="mt-4 break-words text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">
                {data?.vendor_name || 'Questionnaire'}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
                Complete the requested questionnaire and attach any supporting evidence directly in the platform.
              </p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-gray-500" />
                <span>{done ? SENT_STATUS[data?.status || ''] || 'Submitted' : returned ? 'Clarification requested' : 'In progress'}</span>
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

        {data?.certificate && !done && (
          <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Some questions were answered from <span className="font-medium">{data.certificate.name}</span>
            {data.certificate.expires ? `, valid until ${new Date(data.certificate.expires).toLocaleDateString()}` : ''}.
            {data.certificate.mode === 'skip' ? ' Those answers are fixed.' : ' Check them and change any that are wrong.'}
          </div>
        )}

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
          <div className="min-w-0 space-y-6">
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
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

            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 text-gray-900">
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
                  const gaps = gapsOf(question);
                  const files = evidence[question.id] || [];
                  const rule = evidenceRule(question);
                  const owes = owesEvidence(question, currentValue);
                  // A question from before the rules asked for evidence this way, whatever the answer.
                  const requested = question.evidence === undefined && !!question.evidence_required;
                  const dropOpen = question.type === 'file' || owes || requested || !!openDrops[question.id];
                  const thread = threads[question.id] || [];
                  const commentOpen = openComments[question.id] || !!comments[question.id] || isAsked || !!gaps.need;
                  return (
                    <div key={question.id} id={`question-${question.id}`}
                      className={`scroll-mt-6 rounded-xl border p-4 sm:p-5 ${isAsked ? 'border-amber-300 bg-amber-50/40'
                        : (gaps.left || gaps.document) && editable ? 'border-amber-300 bg-gray-50 ring-1 ring-amber-100' : 'border-gray-200 bg-gray-50'}`}>
                      <div className="mb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700">Q{index + 1}</span>
                          {question.required && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-xs font-medium text-rose-700">
                              <span aria-hidden="true">*</span> Required
                            </span>
                          )}
                          {owes ? (
                            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                              files.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                              <Paperclip className="h-3 w-3" /> {files.length ? 'Evidence attached' : 'Evidence needed'}
                            </span>
                          ) : requested && (
                            <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">Evidence requested</span>
                          )}
                          {needsAnswer && editable && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                              <AlertCircle className="h-3 w-3" strokeWidth={1.75} /> Needs an answer
                            </span>
                          )}
                        </div>
                        <p className="mt-3 break-words text-sm leading-6 text-gray-900">
                          {question.text}
                          {question.required && <span className="ml-1 text-rose-600" aria-hidden="true">*</span>}
                        </p>
                        {question.locked && (
                          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">
                            <Lock className="h-3.5 w-3.5" /> Answered by your certificate
                          </p>
                        )}
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

                      {question.type !== 'text' && question.type !== 'file' && (
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

                      {(files.length > 0 || question.type === 'file' || (editable && rule.mode !== 'none')) && (
                        <div className="mt-3 space-y-2">
                          {files.map((file) => (
                            <div key={file.id} className="flex min-w-0 items-center gap-2 text-xs text-gray-700">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                              <span className="truncate">{file.file_name}</span>
                              {editable && (
                                <button type="button" onClick={() => deleteFile(file.id)} aria-label={`Remove ${file.file_name}`}
                                  className="rounded p-1 text-gray-400 hover:text-rose-600">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                          {editable && (dropOpen ? (
                            <div className="space-y-2">
                              <DropZone busy={uploading === question.id} onFile={(f) => uploadFile(question.id, f)}
                                label={`File for question ${index + 1}`} />
                              <label className="block text-xs font-medium text-gray-600">
                                Expires on (certificates, reports)
                                <input type="date" value={expiresOn[question.id] || ''}
                                  onChange={(e) => setExpiresOn((prev) => ({ ...prev, [question.id]: e.target.value }))}
                                  className="mt-1 block rounded-lg border border-gray-300 px-2 py-1 text-xs" />
                              </label>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setOpenDrops((prev) => ({ ...prev, [question.id]: true }))}
                              className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
                              <Paperclip className="h-3.5 w-3.5" /> Attach a file
                            </button>
                          ))}
                          {question.type === 'file' && !editable && !files.length && (
                            <p className="text-xs text-gray-500">No file sent.</p>
                          )}
                        </div>
                      )}

                      {commentOpen ? (
                        <label className="mt-3 block">
                          <span className="text-xs font-medium text-gray-600">
                            {gaps.need === 'reason' ? 'Why it does not apply' : gaps.need === 'note' ? 'Note'
                              : isAsked ? 'Your reply' : 'Comment (optional)'}
                            {gaps.need && <span className="ml-1 text-rose-600" aria-hidden="true">*</span>}
                          </span>
                          <textarea value={comments[question.id] || ''} disabled={!editable} rows={2} maxLength={4000}
                            required={!!gaps.need}
                            onChange={(e) => setComments((prev) => ({ ...prev, [question.id]: e.target.value }))}
                            className={`mt-1 ${inputCls}`} />
                        </label>
                      ) : editable && (
                        <button type="button" onClick={() => setOpenComments((prev) => ({ ...prev, [question.id]: true }))}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
                          <MessageSquare className="h-3.5 w-3.5" /> Add a comment
                        </button>
                      )}

                      {thread.length > 0 && (
                        <div className="mt-3 space-y-2 rounded-lg border border-primary-100 bg-white p-3">
                          <p className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                            <MessageSquare className="h-3.5 w-3.5 text-primary-600" /> Comments
                          </p>
                          <ul className="space-y-2">
                            {thread.map((m) => (
                              <li key={m.id} className={`rounded-lg px-3 py-2 ${m.from_supplier ? 'ml-6 bg-primary-50' : 'mr-6 bg-gray-50'}`}>
                                <p className="text-xs text-gray-600">
                                  <span className="font-medium text-gray-800">{m.author || (m.from_supplier ? 'You' : 'Us')}</span>
                                  {' · '}{parseUtc(m.created_at)?.toLocaleDateString() ?? ''}
                                </p>
                                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-gray-900">{m.body}</p>
                              </li>
                            ))}
                          </ul>
                          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); sendReply(question.id); }}>
                            <label className="min-w-[200px] flex-1">
                              <span className="sr-only">Reply on question {index + 1}</span>
                              <textarea rows={2} maxLength={8000} value={replies[question.id] || ''} placeholder="Reply"
                                onChange={(e) => setReplies((prev) => ({ ...prev, [question.id]: e.target.value }))}
                                className={inputCls} />
                            </label>
                            <button type="submit" disabled={replying === question.id || !(replies[question.id] || '').trim()}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                              {replying === question.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Reply
                            </button>
                          </form>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {!done && shownQuestions.length > 0 && (
                <div className="sticky bottom-0 z-10 -mx-4 mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
                  role="status" aria-live="polite">
                  {toDo.length ? (
                    <span className="text-sm font-medium text-amber-800">
                      {questionsLeft} question{questionsLeft === 1 ? '' : 's'} left · {documentsMissing} document{documentsMissing === 1 ? '' : 's'} missing
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                      <CheckCircle className="h-4 w-4" /> Ready to submit
                    </span>
                  )}
                  {toDo.length > 0 && (
                    <button type="button" onClick={goNext}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50">
                      Next <ArrowDown className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
            </section>

            {!done && (
              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
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

          <aside className="min-w-0 space-y-6">
            {!done && (
              <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <FileSpreadsheet className="h-4 w-4 text-primary-600" /> Prefer a spreadsheet?
                </h2>
                <p className="mt-1 text-xs leading-5 text-gray-600">
                  Download the questionnaire as a workbook or a fillable PDF, answer it offline, and upload it here. Your
                  answers are saved as a draft to check before you submit.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => downloadWorkbook('xlsx')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    <Download className="h-3.5 w-3.5" /> Download workbook
                  </button>
                  <button type="button" onClick={() => downloadWorkbook('pdf')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    <Download className="h-3.5 w-3.5" /> Download fillable PDF
                  </button>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload completed workbook or PDF
                    <input type="file" accept=".xlsx,.pdf" className="sr-only" disabled={importing}
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) importWorkbook(f); e.target.value = ''; }} />
                  </label>
                </div>
              </section>
            )}
            <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6 lg:sticky lg:top-6">
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
                  <span>Documents needed</span>
                  <span className="font-medium text-gray-900">
                    {shownQuestions.filter((q) => q.type === 'file' || owesEvidence(q, responses[q.id] || '')).length}
                  </span>
                </div>
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-5 text-gray-600">
                  Save a draft at any time. Submitting needs every
                  <span className="mx-1 font-medium text-rose-600">Required</span>
                  question answered, the documents asked for, and a named person attesting to the answers.
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
