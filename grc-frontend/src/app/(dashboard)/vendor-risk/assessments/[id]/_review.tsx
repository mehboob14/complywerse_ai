'use client';

// Reviewing a submitted questionnaire: accept each answer or ask the vendor to
// clarify it, then return the questionnaire (the vendor can change only what was
// asked about) or accept it, which closes the vendor's link.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, HelpCircle, Loader2, MessageSquare, RotateCcw, Send, ShieldCheck, Undo2 } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';

export interface ReviewEntry { status: 'accepted' | 'clarify' | 'answered'; note?: string | null; at?: string }

export interface ReviewableResponse {
  id: number;
  status: string;
  review?: Record<string, ReviewEntry>;
  comments?: Record<string, string>;
  due_date?: string | null;
  attested_by?: { name: string; title: string | null; email: string | null; at: string | null } | null;
  accepted_at?: string | null;
  template_version?: number | null;
}

const REVIEWABLE = ['submitted', 'under_review'];
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

  return (
    <div className="mt-3 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
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
