'use client';

// Stage 04 — Questionnaire & Evidence, framed correctly: the VENDOR completes the
// questionnaire and uploads evidence via the sent portal link; the analyst REVIEWS
// here. Shows each issued questionnaire's status + the vendor's submitted answers,
// with copy/open-link so the analyst can (re)share the link. Internal evidence
// attachment stays as a fallback for offline vendors.

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ClipboardList, Copy, ExternalLink, Clock, CheckCircle2, Loader2, ChevronDown, ChevronRight,
  Send, User, AlertCircle,
} from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import EvidencePanel from './EvidencePanel';

interface QResponse {
  id: number; vendor_id: number; assessment_id: number | null; template_id: number | null;
  respondent_name: string | null; respondent_email: string | null;
  responses: Record<string, unknown>; status: string; token: string;
  expires_at: string | null; submitted_at: string | null; created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-600', in_progress: 'bg-amber-100 text-amber-700',
  submitted: 'bg-emerald-100 text-emerald-700', expired: 'bg-red-100 text-red-700',
};

function formatAnswer(a: unknown): string {
  if (a === null || a === undefined || a === '') return 'No answer';
  if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') return String(a);
  if (typeof a === 'object' && a !== null && 'answer' in (a as Record<string, unknown>)) {
    const n = (a as Record<string, unknown>).answer;
    return n == null || n === '' ? 'No answer' : typeof n === 'object' ? JSON.stringify(n) : String(n);
  }
  return JSON.stringify(a);
}
function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return '—'; }
}
function isExpired(r: QResponse): boolean {
  return r.status !== 'submitted' && !!r.expires_at && new Date(r.expires_at) < new Date();
}

export default function QuestionnaireReviewPanel({ vendorId, assessmentId }: { vendorId: number; assessmentId: number }) {
  const { toast } = useToast();
  const [open, setOpen] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['tpra-questionnaire-responses', assessmentId],
    queryFn: async () => (await vendorRiskApi.getQuestionnaireResponses({ vendor_id: vendorId, assessment_id: assessmentId })).data as QResponse[],
  });
  const responses = (data || []).filter((r) => r.assessment_id === assessmentId || !r.assessment_id);

  const portalLink = (token: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/vendor-risk/questionnaires/${token}`;
  const copyLink = async (token: string) => {
    try { await navigator.clipboard.writeText(portalLink(token)); toast({ type: 'success', title: 'Link copied', message: 'Share it with the vendor contact.' }); }
    catch { toast({ type: 'error', title: 'Could not copy' }); }
  };

  const anyWaiting = responses.some((r) => r.status !== 'submitted' && !isExpired(r));
  const anySubmitted = responses.some((r) => r.status === 'submitted');

  return (
    <div className="space-y-4">
      {/* Framing + who's turn */}
      <div className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <div className="flex items-start gap-2 text-xs text-gray-600">
          <ClipboardList className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary-600" />
          <p>The <span className="font-medium">vendor</span> completes the questionnaire and uploads evidence via the link you send. Track status and <span className="font-medium">review their answers</span> here — you don&apos;t fill it in.</p>
        </div>
        {responses.length > 0 && (
          anySubmitted && !anyWaiting ? (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Ready to review</span>
          ) : anyWaiting ? (
            <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700"><Clock className="h-3 w-3" /> Waiting on vendor</span>
          ) : null
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : responses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <Send className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No questionnaire issued yet</p>
          <p className="text-xs text-gray-500">Issue one from <span className="font-medium">Due Diligence Planning</span> (send questionnaire), then the vendor&apos;s responses appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {responses.map((r) => {
            const expired = isExpired(r);
            const status = expired ? 'expired' : r.status;
            const answered = Object.values(r.responses || {}).filter((v) => v !== null && v !== undefined && v !== '').length;
            const entries = Object.entries(r.responses || {});
            return (
              <div key={r.id} className="rounded-xl border border-gray-200 bg-white">
                <div className="flex items-start gap-3 p-3">
                  <button onClick={() => setOpen(open === r.id ? null : r.id)} className="mt-0.5 text-gray-400 hover:text-gray-600">
                    {open === r.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${STATUS_STYLE[status] || 'bg-gray-100 text-gray-600'}`}>{status.replace('_', ' ')}</span>
                      <span className="text-sm font-medium text-slate-900">{answered} answer{answered === 1 ? '' : 's'}</span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                      <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> {r.respondent_name || r.respondent_email || 'Vendor contact'}</span>
                      <span>· sent {fmtDate(r.created_at)}</span>
                      {r.submitted_at && <span>· submitted {fmtDate(r.submitted_at)}</span>}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button onClick={() => copyLink(r.token)} title="Copy vendor link" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><Copy className="h-3.5 w-3.5" /></button>
                    <a href={portalLink(r.token)} target="_blank" rel="noreferrer" title="Open portal" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><ExternalLink className="h-3.5 w-3.5" /></a>
                  </div>
                </div>

                {open === r.id && (
                  <div className="border-t border-gray-100 p-3">
                    {r.status !== 'submitted' && (
                      <p className="mb-2 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"><AlertCircle className="h-3 w-3" /> Not yet submitted — answers may be incomplete.</p>
                    )}
                    {entries.length === 0 ? (
                      <p className="text-xs text-gray-400">No answers submitted yet.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {entries.map(([qid, ans]) => (
                          <div key={qid} className="rounded-lg border border-gray-100 bg-gray-50/60 px-2.5 py-1.5">
                            <p className="font-mono text-[10px] text-gray-400">{qid}</p>
                            <p className="text-xs text-slate-700">{formatAnswer(ans)}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <Link href="/vendor-risk/questionnaires" className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline">
                      Full review &amp; vendor evidence <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Fallback: analyst-attached evidence for offline vendors */}
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Analyst-attached evidence <span className="font-normal normal-case text-gray-400">(fallback for offline vendors)</span></p>
        <EvidencePanel assessmentId={assessmentId} title="Evidence pack" />
      </div>
    </div>
  );
}
