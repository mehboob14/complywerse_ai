'use client';

/** Where the AI review of an uploaded file stands, and the pieces of a page that say so.
 *
 *  A file is read, rated for how mature it is as audit evidence (the maturity: a score, what is missing, how to
 *  close it), and then matched to framework clauses, which is slow. The server runs all three and writes where it
 *  has got to on the file, so a page asks for that instead of waiting on one request: it can show each step, say
 *  when something failed, and never spin for a run that no longer exists.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, CheckCircle2, Circle, FileQuestion, Loader2, RefreshCw } from 'lucide-react';
import apiClient from '@/lib/api';
import { elapsed } from '@/lib/serverTime';

export type ReviewStatus = 'queued' | 'running' | 'done' | 'failed' | 'unavailable' | null;
export type ReviewStep = 'reading' | 'rating' | 'matching' | null;

/** The part of the state a list row carries. */
export interface ReviewBrief { status: ReviewStatus; step?: ReviewStep; error?: string | null; mapping_error?: string | null; mapping_skipped?: boolean; stopped?: boolean }

export interface ReviewCheck {
  status: 'ok' | 'no_text' | 'licence_restricted' | 'failed';
  covers?: 'full' | 'partial' | 'none' | null;
  score?: number | null;
  verdict?: string | null;
  detail?: { strengths?: string[]; gaps?: string[]; improvements?: string[]; as_of?: string | null } | null;
  note?: string | null;
  target: { kind: string; ref: string; label?: string | null };
  checked_at?: string | null;
}

export interface ReviewState extends ReviewBrief {
  evidence_id: number;
  started_at: string | null;
  updated_at: string | null;
  finished_at: string | null;
  ocr_status: string;
  ocr_stalled: boolean;
  has_assessment: boolean;
  mappings: number;
  quality_score: number | null;
  checks: ReviewCheck[];
}

export const reviewActive = (status?: string | null) => status === 'queued' || status === 'running';

/** The file's review: polled while it runs, and started when the file never had one or its run was lost. `also`
 *  names other queries (a module's list of files) to refresh when the rating lands and when the run ends. */
export function useEvidenceReview(evidenceId: number | null | undefined, { start = false, also = [] }: { start?: boolean; also?: string[] } = {}) {
  const qc = useQueryClient();
  const enabled = typeof evidenceId === 'number' && Number.isFinite(evidenceId);
  const key = ['evidence-review', evidenceId];

  const query = useQuery<ReviewState>({
    queryKey: key,
    enabled,
    queryFn: async () => (await apiClient.get(`/evidence-mgmt/ai/${evidenceId}/review`)).data,
    refetchInterval: (q) => (reviewActive((q.state.data as ReviewState | undefined)?.status) ? 3000 : false),
    refetchIntervalInBackground: true,
  });

  const run = useMutation({
    mutationFn: async (opts: { force?: boolean; stage?: 'mappings' } = {}) =>
      (await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/review`, null, {
        params: { ...(opts.force ? { force: true } : {}), ...(opts.stage ? { stage: opts.stage } : {}) },
      })).data as ReviewState,
    onSuccess: (data) => qc.setQueryData(key, data),
  });

  // What the review writes (the rating, then the clauses) is read by other queries on the page: refresh them
  // when the rating lands and when the run ends, not on every poll.
  const review = query.data;
  const seen = useRef<{ init: boolean; active: boolean; rated: boolean; mappings: number }>({ init: false, active: false, rated: false, mappings: 0 });
  useEffect(() => {
    if (!review) return;
    const active = reviewActive(review.status);
    const before = seen.current;
    seen.current = { init: true, active, rated: review.has_assessment, mappings: review.mappings };
    if (!before.init) return;
    if ((review.has_assessment && !before.rated) || (before.active && !active) || review.mappings !== before.mappings) {
      ['evidence-detail', 'evidence-assessment', 'evidence-clause-mappings', 'evidence-clauses', 'evidence-ai-link-status', 'ev-ws-items', 'ev-ws-summary', ...also]
        .forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.status, review?.has_assessment, review?.mappings]);

  // Ask the server to start what is missing, once per visit: it starts nothing that is running, finished or
  // failed for a reason, so this is safe to send.
  const asked = useRef(false);
  useEffect(() => {
    if (!start || asked.current || !review) return;
    asked.current = true;
    if (!reviewActive(review.status) && !review.has_assessment && (review.status === null || review.stopped)) run.mutate({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, review]);

  return {
    review,
    loading: query.isLoading,
    working: run.isPending,
    again: () => run.mutate({ force: true }),
    matchAgain: () => run.mutate({ stage: 'mappings' }),
  };
}

// ── the steps, while a file is being reviewed ────────────────────────────────

const STEPS: { key: Exclude<ReviewStep, null>; label: string; hint: string }[] = [
  { key: 'reading', label: 'Reading the file', hint: 'a few seconds' },
  { key: 'rating', label: 'Rating how mature it is as audit evidence', hint: 'about 15 seconds' },
  { key: 'matching', label: 'Matching it to framework clauses', hint: 'about 2 minutes' },
];

function useTick(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

/** The card shown where the rating will appear, until it does. */
export function ReviewProgress({ review, ocrStatus, onAgain, again }: {
  review: ReviewBrief & { started_at?: string | null; ocr_stalled?: boolean } | null | undefined;
  ocrStatus?: string | null;
  onAgain?: () => void;
  /** a retry is being sent */
  again?: boolean;
}) {
  const active = reviewActive(review?.status);
  const now = useTick(active);

  if (review?.status === 'failed') {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <AlertCircle className="mb-3 h-10 w-10 text-rose-500" />
        <p className="text-lg font-medium text-slate-800">{review.stopped ? 'The review stopped' : 'This file could not be rated'}</p>
        <p className="mt-1 max-w-md text-sm text-slate-600">{review.error || 'Something went wrong while it was being reviewed.'}</p>
        {onAgain && (
          <button type="button" onClick={onAgain} disabled={again}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {again ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Try again
          </button>
        )}
      </div>
    );
  }

  if (review?.status === 'unavailable') {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <FileQuestion className="mb-3 h-10 w-10 text-slate-400" />
        <p className="text-lg font-medium text-slate-800">This file can&apos;t be rated by AI</p>
        <p className="mt-1 max-w-md text-sm text-slate-600">{review.error}</p>
      </div>
    );
  }

  // Nothing has been started and the text is not there: say which of the two it is.
  if (!active && ocrStatus === 'failed') {
    return (
      <div className="flex flex-col items-center py-8 text-center">
        <AlertTriangle className="mb-3 h-10 w-10 text-amber-500" />
        <p className="text-lg font-medium text-slate-800">The file&apos;s text could not be read</p>
        <p className="mt-1 max-w-md text-sm text-slate-600">It is rated from its text, so read the file again with <strong>OCR</strong> above and the review will start.</p>
      </div>
    );
  }

  const step = active ? (review?.step ?? 'reading') : 'reading';
  const at = Math.max(0, STEPS.findIndex((s) => s.key === step));
  return (
    <div className="flex flex-col items-center py-8 text-center">
      <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary-400" />
      <p className="text-lg font-medium text-slate-800">{active ? 'Reviewing this file…' : 'Getting ready to review this file…'}</p>
      <ol className="mt-5 w-full max-w-sm space-y-2.5 text-left text-sm">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-start gap-2.5">
            {i < at ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
              : i === at ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary-500" />
                : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-300" />}
            <span className={i <= at ? 'text-slate-800' : 'text-slate-400'}>
              {s.label} <span className="text-xs text-slate-400">· {s.hint}</span>
            </span>
          </li>
        ))}
      </ol>
      {active && review?.started_at && (
        <p className="mt-5 text-xs text-slate-500">Working for {elapsed(review.started_at, now)}. You can leave this page; the review carries on.</p>
      )}
    </div>
  );
}

/** Above the clause suggestions: still being matched, the matching did not finish, or it was left out on upload. */
export function MatchingNote({ review, onMatchAgain, again }: { review: ReviewState | null | undefined; onMatchAgain: () => void; again?: boolean }) {
  const matching = reviewActive(review?.status) && (review?.step === 'matching' || review?.step === 'rating');
  const now = useTick(matching);
  if (matching) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-800">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        <p>Matching this file to framework clauses. The rating above is ready; the suggestions fill in below, usually within two minutes
          {review?.started_at ? ` (${elapsed(review.started_at, now)} so far)` : ''}.</p>
      </div>
    );
  }
  const failed = review?.status === 'done' && !!review.mapping_error;
  const skipped = review?.status === 'done' && !!review.mapping_skipped && !review.mappings;
  if (failed || skipped) {
    return (
      <div className={`flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-sm ${failed ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'}`}>
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p className="min-w-0 flex-1">
          {failed ? `The rating is saved, but matching to framework clauses did not finish. ${review?.mapping_error}`
            : 'This file is rated, but it has not been matched to framework clauses.'}
        </p>
        <button type="button" onClick={onMatchAgain} disabled={again}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50">
          {again ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} {failed ? 'Match again' : 'Match to clauses'}
        </button>
      </div>
    );
  }
  return null;
}

// ── the maturity, wherever a file is listed ──────────────────────────────────

const BAND = (pct: number) => (pct >= 80 ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : pct >= 60 ? 'border-amber-200 bg-amber-50 text-amber-800'
  : pct >= 40 ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-rose-200 bg-rose-50 text-rose-800');

/** The maturity of an uploaded file as one chip, for a list of files in any module: the rating once there is one,
 *  and where the review stands until then. It opens the file in Evidence Management, where what is missing and how
 *  to close it are spelled out. */
export function EvidenceMaturity({ evidenceId, refresh }: { evidenceId?: number | null; refresh?: string[] }) {
  const { review } = useEvidenceReview(evidenceId, { also: refresh });
  if (!review) return null;
  const score = review.quality_score;
  const chip = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold';
  if (typeof score === 'number') {
    return (
      <Link href={`/evidence/${evidenceId}`} onClick={(e) => e.stopPropagation()} className={`${chip} ${BAND(score)} hover:underline`}
        title="How mature this file is as audit evidence. Open it to see what is missing and how to close it.">
        Maturity {Math.round(score)}%
      </Link>
    );
  }
  if (reviewActive(review.status)) {
    return <span className={`${chip} border-primary-200 bg-primary-50 text-primary-700`}><Loader2 className="h-3 w-3 animate-spin" /> AI rating…</span>;
  }
  if (review.status === 'failed' || review.status === 'unavailable') {
    return <span className={`${chip} border-amber-200 bg-amber-50 text-amber-800`} title={review.error ?? undefined}>Not rated</span>;
  }
  return <span className={`${chip} border-slate-200 bg-slate-50 text-slate-500`}>Not rated yet</span>;
}

// ── what is missing, and how to close it ─────────────────────────────────────

/** The two lists that make a maturity score usable: what an auditor would still ask for, and what to do about it. */
export function MaturityNotes({ gaps, recommendations, stacked }: { gaps?: string[] | null; recommendations?: string[] | null; stacked?: boolean }) {
  const missing = (gaps ?? []).filter(Boolean);
  const todo = (recommendations ?? []).filter(Boolean);
  if (!missing.length && !todo.length) return null;
  return (
    <div className={stacked ? 'grid gap-3' : 'grid gap-3 md:grid-cols-2'}>
      {missing.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">What&apos;s missing</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-slate-700">{missing.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </div>
      )}
      {todo.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800">How to raise it</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm text-slate-700">{todo.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ── what the file was rated against ──────────────────────────────────────────

const COVERS = {
  full: { label: 'Proves it', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  partial: { label: 'Partly proves it', cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  none: { label: 'Does not prove it', cls: 'border-rose-200 bg-rose-50 text-rose-800' },
} as const;

/** The file's rating against each thing it was attached to (an assessment item, a requirement, a control). */
export function RatedAgainst({ checks }: { checks: ReviewCheck[] | undefined }) {
  if (!checks?.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Rated against what it was attached to</p>
      <ul className="space-y-2">
        {checks.map((c) => {
          const cov = c.covers ? COVERS[c.covers] : null;
          return (
            <li key={`${c.target.kind}:${c.target.ref}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-slate-800">{c.target.ref}{c.target.label ? ` · ${c.target.label}` : ''}</span>
                {c.status === 'ok' && cov ? (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${cov.cls}`}>
                    {cov.label}{typeof c.score === 'number' ? ` · maturity ${c.score}/100` : ''}
                  </span>
                ) : (
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">Not rated</span>
                )}
              </div>
              {c.status === 'ok' ? (
                <>
                  {c.verdict && <p className="mt-1 text-slate-700">{c.verdict}</p>}
                  {!!c.detail?.gaps?.length && <p className="mt-1 text-xs text-slate-600"><span className="font-semibold text-slate-700">Missing: </span>{c.detail.gaps.join('; ')}</p>}
                  {!!c.detail?.improvements?.length && <p className="mt-0.5 text-xs text-slate-600"><span className="font-semibold text-slate-700">To close it: </span>{c.detail.improvements.join('; ')}</p>}
                </>
              ) : (
                <p className="mt-1 text-xs text-slate-500">{c.note || 'The check could not be completed.'}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
