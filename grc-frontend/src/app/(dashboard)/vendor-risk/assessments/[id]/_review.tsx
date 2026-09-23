'use client';

// Reviewing a submitted questionnaire: accept each answer or ask the vendor to
// clarify it, then return the questionnaire (the vendor can change only what was
// asked about) or accept it, which closes the vendor's link.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSearch, HelpCircle, Library, Loader2, MessageSquare, RotateCcw, Send, ShieldCheck, Undo2, Upload, X } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';

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
  return () => qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
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
  const downloadBook = async () => {
    try {
      const res = await vendorRiskApi.downloadQuestionnaireWorkbook(qr.id);
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `questionnaire-${qr.id}.xlsx`;
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
          <button type="button" onClick={downloadBook} className={`${btn} border-gray-200 text-gray-600 hover:bg-gray-50`}>
            <Download className="h-3.5 w-3.5" /> Download workbook
          </button>
          <label className={`${btn} cursor-pointer border-gray-200 text-gray-600 hover:bg-gray-50`}>
            {importBook.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            Import the vendor&apos;s workbook
            <input type="file" accept=".xlsx" className="sr-only" disabled={importBook.isPending}
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
