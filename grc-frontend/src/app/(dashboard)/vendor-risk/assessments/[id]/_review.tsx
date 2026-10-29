'use client';

// Reviewing a submitted questionnaire: accept each answer or ask the vendor to
// clarify it, then return the questionnaire (the vendor can change only what was
// asked about) or accept it, which closes the vendor's link. Reviewers take a
// section each (or the whole), and comment on answers, internally or to the supplier.

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSearch, HelpCircle, Library, Loader2, MessageSquare, RotateCcw, Send, ShieldCheck, Undo2, Upload, UserPlus, Users, X } from 'lucide-react';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { parseUtc } from '@/lib/serverTime';
import { commentsKey, reviewersKey, reviewsApi, type ReviewAssignment, type ReviewSection } from '../../_lib/reviewsApi';
import { sentNote } from '../../_lib/requestsApi';

export interface ReviewEntry { status: 'accepted' | 'clarify' | 'answered'; note?: string | null; at?: string }

export interface LibraryEvidence {
  link_id: number;
  evidence_id: number;
  name: string;
  file_name: string | null;
  expiry_date: string | null;
  source: 'vendor' | 'library';
  note: string | null;
  quality: { status: string; covers: string | null; score: number | null; verdict: string | null; note: string | null } | null;
}

export interface ReviewableResponse {
  id: number;
  vendor_id?: number;
  status: string;
  library_evidence?: Record<string, LibraryEvidence[]>;
  review?: Record<string, ReviewEntry>;
  comments?: Record<string, string>;
  due_date?: string | null;
  attested_by?: { name: string; title: string | null; email: string | null; at: string | null } | null;
  accepted_at?: string | null;
  template_version?: number | null;
  parent_response_id?: number | null;     // a follow-up another answer called for
}

const REVIEWABLE = ['submitted', 'under_review'];
const WAITING = ['pending', 'in_progress', 'returned'];
const btn = 'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium disabled:opacity-60';

function errorText(e: unknown): string {
  return (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'That did not save. Try again.';
}

function useRefresh(assessmentId: number) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
    qc.invalidateQueries({ queryKey: ['tpra-reviewers'] });          // a decision moves a section towards done
  };
}

const STATE: Record<string, { label: string; cls: string }> = {
  assigned: { label: 'Assigned', cls: 'bg-[#f1f3f5] text-[#4b5563]' },
  in_review: { label: 'In review', cls: 'bg-[#eff6ff] text-[#1d4ed8]' },
  done: { label: 'Done', cls: 'bg-[#ecfdf5] text-[#047857]' },
};

/** The questionnaire's reviewers: each section, who has it and where they stand. Assign people, move your own
 *  along (done needs a decision on every question of the section), or show only your sections' questions. */
export function ReviewersStrip({ qr, canEdit, filtered, onFilter }: {
  qr: ReviewableResponse; canEdit: boolean;
  filtered: boolean; onFilter: (questionKeys: string[] | null) => void;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data } = useQuery({ queryKey: reviewersKey(qr.id), queryFn: async () => (await reviewsApi.reviewers(qr.id)).data });
  const { data: directory } = useQuery({
    queryKey: ['tpra-config-directory'],
    queryFn: async () => (await tpraApi.configDirectory()).data as { people: Array<{ id: number; name: string }> },
    enabled: canEdit,
  });
  const done = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: reviewersKey(qr.id) });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });            // planning counts the people assigned
  };
  const failed = (e: unknown) => setError(errorText(e));
  const assign = useMutation({
    mutationFn: (v: { reviewer_id: number; section_key: string | null }) => reviewsApi.assign(qr.id, v),
    onSuccess: done, onError: failed,
  });
  const move = useMutation({
    mutationFn: (v: { id: number; status: 'in_review' | 'done' }) => reviewsApi.setStatus(qr.id, v.id, v.status),
    onSuccess: done, onError: failed,
  });
  const drop = useMutation({ mutationFn: (id: number) => reviewsApi.unassign(qr.id, id), onSuccess: done, onError: failed });
  if (!data) return null;

  const sections: Array<Pick<ReviewSection, 'label' | 'questions' | 'undecided'> & { key: string | null }> = [
    { key: null, label: 'Whole questionnaire', questions: data.sections.flatMap((s) => s.questions),
      undecided: data.sections.reduce((n, s) => n + s.undecided, 0) },
    ...data.sections.filter((s) => data.sections.length > 1 || data.assignments.some((a) => a.section_key === s.key)),
  ];
  // A section someone has whose questions do not apply to these answers still shows.
  data.assignments.forEach((a) => {
    if (a.section_key && !sections.some((s) => s.key === a.section_key)) {
      sections.push({ key: a.section_key, label: a.section_label, questions: [], undecided: 0 });
    }
  });
  const keysOf = (key: string | null) => sections.find((s) => s.key === key)?.questions || [];
  const mine = data.assignments.filter((a) => a.mine);
  // Opening your section shows its questions and puts it in review.
  const open = (a: ReviewAssignment) => {
    onFilter(keysOf(a.section_key));
    if (a.status === 'assigned') move.mutate({ id: a.id, status: 'in_review' });
  };

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 font-semibold text-slate-800"><Users className="h-3.5 w-3.5 text-primary-600" /> Reviewers</p>
        {mine.length > 0 && (
          <label className="inline-flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={filtered}
              onChange={(e) => onFilter(e.target.checked ? Array.from(new Set(mine.flatMap((a) => keysOf(a.section_key)))) : null)} />
            My sections
          </label>
        )}
      </div>
      <ul className="divide-y divide-gray-100">
        {sections.map((s) => {
          const people = data.assignments.filter((a) => a.section_key === s.key);
          return (
            <li key={s.key ?? 'whole'} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="w-40 shrink-0 font-medium text-slate-700">
                {s.label}
                {s.undecided > 0 && <span className="ml-1 font-normal text-gray-500">· {s.undecided} open</span>}
              </span>
              {people.length === 0 && <span className="text-gray-400">No one</span>}
              {people.map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 py-0.5 pl-2 pr-1">
                  {a.mine ? (
                    <button type="button" onClick={() => open(a)} className="font-medium text-primary-700 hover:underline"
                      title="Show this section's questions">{a.reviewer.name || 'Someone'}</button>
                  ) : <span className="text-slate-700">{a.reviewer.name || 'Someone'}</span>}
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATE[a.status]?.cls}`}>{STATE[a.status]?.label}</span>
                  {a.can_act && a.status !== 'done' && (
                    <button type="button" disabled={move.isPending} onClick={() => move.mutate({ id: a.id, status: 'done' })}
                      title={a.undecided ? `${a.undecided} question${a.undecided === 1 ? '' : 's'} still need a decision` : 'Every question has a decision'}
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50">Mark done</button>
                  )}
                  {a.can_act && a.status === 'done' && (
                    <button type="button" disabled={move.isPending} onClick={() => move.mutate({ id: a.id, status: 'in_review' })}
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium text-gray-600 hover:bg-gray-100">Reopen</button>
                  )}
                  {canEdit && (
                    <button type="button" disabled={drop.isPending} onClick={() => drop.mutate(a.id)}
                      aria-label={`Unassign ${a.reviewer.name || 'this reviewer'}`} className="rounded-full p-0.5 text-gray-400 hover:text-red-600">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
              {canEdit && qr.status !== 'accepted' && (
                <label className="ml-auto inline-flex items-center gap-1 text-gray-500">
                  <UserPlus className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">Assign someone to {s.label}</span>
                  <select value="" disabled={assign.isPending}
                    onChange={(e) => e.target.value && assign.mutate({ reviewer_id: Number(e.target.value), section_key: s.key })}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs text-gray-700">
                    <option value="">Assign…</option>
                    {(directory?.people || []).filter((p) => !people.some((a) => a.reviewer.id === p.id))
                      .map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p role="alert" className="mt-1 text-red-600">{error}</p>}
    </div>
  );
}

/** One answer's comments: ours (internal unless shared) and the supplier's, with a box to add one. A shared
 *  comment is emailed to the supplier and shows on the question in the portal. */
function QuestionComments({ qr, questionKey, canEdit }: { qr: ReviewableResponse; questionKey: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [who, setWho] = useState<'internal' | 'shared'>('internal');
  const [note, setNote] = useState<string | null>(null);
  const vendorId = qr.vendor_id;
  const { data } = useQuery({
    queryKey: commentsKey(qr.id),
    queryFn: async () => (await reviewsApi.comments(vendorId as number, qr.id)).data.items,
    enabled: !!vendorId,
  });
  const send = useMutation({
    mutationFn: () => reviewsApi.comment(vendorId as number, { subject_id: qr.id, question_key: questionKey, visibility: who, body }),
    onSuccess: (res) => {
      setBody('');
      setNote(who === 'shared' ? sentNote(res.data.sent).text : null);
      qc.invalidateQueries({ queryKey: commentsKey(qr.id) });
    },
    onError: (e) => setNote(errorText(e)),
  });
  if (!vendorId) return null;
  const items = (data || []).filter((m) => m.question_key === questionKey);

  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>
        <MessageSquare className="h-3 w-3" /> {items.length || ''} Comment{items.length === 1 ? '' : 's'}
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-lg border border-gray-200 bg-white p-2">
          {items.length === 0 && <p className="text-xs text-gray-500">No comments yet.</p>}
          {items.map((m) => (
            <div key={m.id} className={`rounded-md px-2 py-1 text-xs ${m.from_supplier ? 'bg-[#eff6ff]'
              : m.visibility === 'internal' ? 'bg-[#fffbeb]' : 'bg-[#f0fdfa]'}`}>
              <p className="text-[11px] text-gray-500">
                <span className="font-medium text-gray-700">{m.author || 'System'}</span>
                {' · '}{m.from_supplier ? 'Supplier' : m.visibility === 'internal' ? 'Internal' : 'Shared'}
                {' · '}{parseUtc(m.created_at)?.toLocaleDateString() ?? ''}
              </p>
              <p className="whitespace-pre-wrap break-words text-xs text-gray-800">{m.body}</p>
            </div>
          ))}
          {canEdit && (
            <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}>
              <label className="sr-only" htmlFor={`comment-${qr.id}-${questionKey}`}>Comment</label>
              <textarea id={`comment-${qr.id}-${questionKey}`} rows={2} maxLength={8000} value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={who === 'shared' ? 'The supplier reads this' : 'Only we read this'}
                className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
              <div className="flex flex-wrap items-center gap-3">
                {(['internal', 'shared'] as const).map((v) => (
                  <label key={v} className="inline-flex items-center gap-1 text-xs text-gray-600">
                    <input type="radio" name={`who-${qr.id}-${questionKey}`} checked={who === v} onChange={() => setWho(v)} />
                    {v === 'internal' ? 'Internal' : 'Share with supplier'}
                  </label>
                ))}
                <button type="submit" disabled={send.isPending || !body.trim()}
                  className={`${btn} ml-auto border-gray-300 text-gray-700 hover:bg-gray-50`}>
                  {send.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  {who === 'shared' ? 'Send' : 'Add'}
                </button>
              </div>
            </form>
          )}
          {note && <p className="text-xs text-gray-600">{note}</p>}
        </div>
      )}
    </div>
  );
}

/** Status, attester and the questionnaire-level actions. */
export function ReviewBar({ qr, assessmentId, canEdit }: { qr: ReviewableResponse; assessmentId: number; canEdit: boolean }) {
  const refresh = useRefresh(assessmentId);
  const [error, setError] = useState<string | null>(null);
  const entries = Object.values(qr.review || {});
  const asked = entries.filter((e) => e.status === 'clarify').length;
  const replied = entries.filter((e) => e.status === 'answered').length;

  const act = useMutation({
    mutationFn: async (action: 'return' | 'accept') =>
      action === 'return' ? vendorRiskApi.returnQuestionnaire(qr.id) : vendorRiskApi.acceptQuestionnaire(qr.id),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });

  // A workbook the vendor filled in offline and sent back by email.
  const [submitImport, setSubmitImport] = useState(true);
  const importBook = useMutation({
    mutationFn: async (file: File) => vendorRiskApi.importQuestionnaireWorkbook(qr.id, file, submitImport),
    onSuccess: () => { setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const downloadBook = async (as: 'xlsx' | 'pdf' = 'xlsx') => {
    try {
      const res = as === 'pdf' ? await vendorRiskApi.downloadQuestionnairePdf(qr.id)
        : await vendorRiskApi.downloadQuestionnaireWorkbook(qr.id);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `questionnaire-${qr.id}.${as}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
        {qr.parent_response_id && <span className="text-indigo-700">Follow-up to response #{qr.parent_response_id}</span>}
        {qr.template_version && <span>Template version {qr.template_version}</span>}
        {qr.due_date && <span>Due {new Date(qr.due_date).toLocaleDateString()}</span>}
        {qr.attested_by ? (
          <span className="inline-flex items-center gap-1 text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Attested by {qr.attested_by.name}{qr.attested_by.title ? `, ${qr.attested_by.title}` : ''}
            {qr.attested_by.at ? ` on ${new Date(qr.attested_by.at).toLocaleDateString()}` : ''}
          </span>
        ) : REVIEWABLE.includes(qr.status) && <span className="text-amber-700">No attestation recorded</span>}
        {qr.accepted_at && <span className="text-emerald-700">Accepted {new Date(qr.accepted_at).toLocaleDateString()}</span>}
        {asked > 0 && <span className="text-amber-700">{asked} question{asked === 1 ? '' : 's'} to clarify</span>}
        {replied > 0 && <span className="text-blue-700">{replied} repl{replied === 1 ? 'y' : 'ies'} from the vendor</span>}
      </div>
      {canEdit && REVIEWABLE.includes(qr.status) && (
        <div className="flex flex-wrap items-center gap-2">
          <button className={`${btn} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`}
            disabled={act.isPending || asked === 0} onClick={() => act.mutate('return')}
            title={asked === 0 ? 'Ask the vendor about at least one answer first' : 'Send it back; the vendor can change only what you asked about'}>
            <Undo2 className="h-3.5 w-3.5" /> Return to vendor
          </button>
          <button className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}
            disabled={act.isPending || asked > 0} onClick={() => act.mutate('accept')}
            title={asked > 0 ? 'Clear or return the questions marked for clarification first' : 'Accept every answer and close the vendor\'s link'}>
            {act.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Accept questionnaire
          </button>
        </div>
      )}
      {canEdit && WAITING.includes(qr.status) && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => downloadBook('xlsx')} className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>
            <Download className="h-3.5 w-3.5" /> Download workbook
          </button>
          <button type="button" onClick={() => downloadBook('pdf')} className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>
            <Download className="h-3.5 w-3.5" /> Download fillable PDF
          </button>
          <label className={`${btn} cursor-pointer border-gray-200 text-gray-600 hover:bg-gray-50`}>
            {importBook.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Import the vendor&apos;s workbook or PDF
            <input type="file" accept=".xlsx,.pdf" className="sr-only" disabled={importBook.isPending}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importBook.mutate(f); e.target.value = ''; }} />
          </label>
          <label className="inline-flex items-center gap-1.5 text-gray-600"
            title="Submitting needs the vendor's own attestation, filled in on the workbook's Attestation sheet">
            <input type="checkbox" checked={submitImport} onChange={(e) => setSubmitImport(e.target.checked)} />
            and submit it on the vendor&apos;s attestation
          </label>
        </div>
      )}
      {error && <p role="alert" className="text-red-600">{error}</p>}
    </div>
  );
}

/** One answer's review: the reviewer's call, the vendor's comment, and the buttons. */
export function QuestionReview({ qr, questionKey, assessmentId, canEdit }: {
  qr: ReviewableResponse; questionKey: string; assessmentId: number; canEdit: boolean;
}) {
  const refresh = useRefresh(assessmentId);
  const entry = qr.review?.[questionKey];
  const comment = qr.comments?.[questionKey];
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (v: { decision: 'accept' | 'clarify' | 'clear'; note?: string }) =>
      vendorRiskApi.reviewQuestion(qr.id, { question_key: questionKey, ...v }),
    onSuccess: () => { setAsking(false); setNote(''); setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const open = canEdit && REVIEWABLE.includes(qr.status);

  return (
    <div className="mt-2 space-y-1.5">
      {comment && (
        <p className="flex items-start gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-700">
          <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
          <span><span className="font-medium">Vendor&apos;s comment: </span>{comment}</span>
        </p>
      )}
      {entry && (
        <p className={`flex items-start gap-1.5 text-xs ${
          entry.status === 'accepted' ? 'text-emerald-700' : entry.status === 'clarify' ? 'text-amber-800' : 'text-blue-700'}`}>
          {entry.status === 'accepted' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>
            {entry.status === 'accepted' ? 'Accepted' : entry.status === 'clarify' ? 'Asked the vendor' : 'The vendor replied to'}
            {entry.note ? `: ${entry.note}` : ''}
          </span>
        </p>
      )}
      {open && !asking && (
        <div className="flex flex-wrap gap-1.5">
          {entry?.status !== 'accepted' && (
            <button className={`${btn} border-emerald-200 text-emerald-700 hover:bg-emerald-50`} disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: 'accept' })}>
              <CheckCircle2 className="h-3 w-3" /> Accept
            </button>
          )}
          <button className={`${btn} border-amber-200 text-amber-800 hover:bg-amber-50`} onClick={() => setAsking(true)}>
            <HelpCircle className="h-3 w-3" /> Ask to clarify
          </button>
          {entry && (
            <button className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`} disabled={decide.isPending}
              onClick={() => decide.mutate({ decision: 'clear' })}>
              <RotateCcw className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      )}
      <QuestionComments qr={qr} questionKey={questionKey} canEdit={canEdit} />
      {open && asking && (
        <form className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => { e.preventDefault(); decide.mutate({ decision: 'clarify', note }); }}>
          <label className="sr-only" htmlFor={`clarify-${qr.id}-${questionKey}`}>What should the vendor clarify?</label>
          <input id={`clarify-${qr.id}-${questionKey}`} value={note} onChange={(e) => setNote(e.target.value)} required maxLength={4000}
            placeholder="What should the vendor clarify?"
            className="min-w-[240px] flex-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs" />
          <button type="submit" className={`${btn} border-amber-300 bg-amber-50 text-amber-800`} disabled={decide.isPending || !note.trim()}>
            <Send className="h-3 w-3" /> Ask
          </button>
          <button type="button" className={`${btn} border-gray-200 text-gray-600`} onClick={() => setAsking(false)}>Cancel</button>
        </form>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}


const COVERS: Record<string, { label: string; cls: string }> = {
  full: { label: 'Supports the answer', cls: 'text-emerald-700' },
  partial: { label: 'Partly supports it', cls: 'text-amber-700' },
  none: { label: 'Does not support it', cls: 'text-red-700' },
};

/** The library evidence behind one answer, its review against the question, and attaching more. */
export function QuestionEvidence({ qr, questionKey, assessmentId, canEdit }: {
  qr: ReviewableResponse; questionKey: string; assessmentId: number; canEdit: boolean;
}) {
  const refresh = useRefresh(assessmentId);
  const items = qr.library_evidence?.[questionKey] || [];
  const [searching, setSearching] = useState(false);
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<Array<{ id: number; name: string; expiry_date: string | null }>>([]);
  const [error, setError] = useState<string | null>(null);
  const open = canEdit && qr.status !== 'accepted';

  const search = async (value: string) => {
    setTerm(value);
    try {
      setFound((await vendorRiskApi.searchEvidenceLibrary(qr.id, value)).data || []);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const attach = useMutation({
    mutationFn: async (evidenceId: number) =>
      vendorRiskApi.attachQuestionEvidence(qr.id, { question_key: questionKey, evidence_id: evidenceId }),
    onSuccess: () => { setSearching(false); setTerm(''); setFound([]); setError(null); refresh(); },
    onError: (e) => setError(errorText(e)),
  });
  const detach = useMutation({
    mutationFn: async (linkId: number) => vendorRiskApi.detachQuestionEvidence(qr.id, linkId),
    onSuccess: () => refresh(),
    onError: (e) => setError(errorText(e)),
  });

  if (!items.length && !open) return null;
  return (
    <div className="mt-2 space-y-1.5">
      {items.map((item) => {
        const covers = item.quality?.status === 'ok' && item.quality.covers ? COVERS[item.quality.covers] : null;
        return (
          <div key={item.link_id} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <Library className="h-3.5 w-3.5 shrink-0 text-gray-400" />
              <span className="truncate font-medium text-gray-800">{item.name}</span>
              <span className="text-gray-400">{item.source === 'vendor' ? 'from the vendor' : 'from the library'}</span>
              {item.expiry_date && <span className="text-gray-500">expires {new Date(item.expiry_date).toLocaleDateString()}</span>}
              {open && (
                <button type="button" onClick={() => detach.mutate(item.link_id)} aria-label={`Detach ${item.name}`}
                  className="ml-auto rounded p-0.5 text-gray-400 hover:text-red-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {covers ? (
              <p className={`mt-0.5 ${covers.cls}`}>
                {covers.label}{item.quality?.score != null ? ` (${item.quality.score}/100)` : ''}
                {item.quality?.verdict ? `: ${item.quality.verdict}` : ''}
              </p>
            ) : item.quality?.note ? (
              <p className="mt-0.5 text-gray-500">{item.quality.note}</p>
            ) : (
              <p className="mt-0.5 text-gray-400">Not reviewed against this question yet.</p>
            )}
          </div>
        );
      })}
      {open && !searching && (
        <button type="button" onClick={() => { setSearching(true); search(''); }}
          className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>
          <FileSearch className="h-3 w-3" /> Attach from the evidence library
        </button>
      )}
      {open && searching && (
        <div className="space-y-1 rounded-lg border border-gray-200 bg-white p-2">
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`library-${qr.id}-${questionKey}`}>Search the evidence library</label>
            <input id={`library-${qr.id}-${questionKey}`} value={term} onChange={(e) => search(e.target.value)} autoFocus
              placeholder="Search the evidence library" className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs" />
            <button type="button" onClick={() => setSearching(false)} className={`${btn} border-gray-200 text-gray-600`}>Cancel</button>
          </div>
          {found.length === 0 ? <p className="px-1 text-xs text-gray-400">Nothing found.</p> : (
            <ul className="max-h-40 overflow-y-auto">
              {found.map((ev) => (
                <li key={ev.id}>
                  <button type="button" disabled={attach.isPending} onClick={() => attach.mutate(ev.id)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-gray-50">
                    <span className="truncate">{ev.name}</span>
                    {ev.expiry_date && <span className="shrink-0 text-gray-400">expires {new Date(ev.expiry_date).toLocaleDateString()}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
