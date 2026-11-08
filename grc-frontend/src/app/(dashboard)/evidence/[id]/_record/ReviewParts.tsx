'use client';

// The pieces of the AI review tab, on the kit: the steps while a file is being reviewed (or why it was not), the note above the clause suggestions, the two lists that make a score
// usable (what is missing, how to raise it) and the rating against each thing the file was attached to. They say what the legacy pieces of ../../_review.tsx say (those stay for the
// six other modules that import them); the hook that runs the review is that file's and is not touched.
import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Circle, FileQuestion, Loader2, XCircle } from 'lucide-react';
import { Button, Notice, StatusPill } from '@/components/ui/ds';
import { safeDetail } from '@/lib/apiError';
import { elapsed } from '@/lib/serverTime';
import { reviewActive, type ReviewBrief, type ReviewCheck, type ReviewState } from '../../_review';

const MUTED = 'text-ds-fg-muted';

function useTick(on: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

const STEPS = [
  { key: 'reading', label: 'Reading the file', hint: 'a few seconds' },
  { key: 'rating', label: 'Rating how mature it is as audit evidence', hint: 'about 15 seconds' },
  { key: 'matching', label: 'Matching it to framework clauses', hint: 'about 2 minutes' },
] as const;

function Centered({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-[8px] px-[16px] py-[32px] text-center">
      {icon}
      <p className="text-ds-section text-ds-fg">{title}</p>
      {children}
    </div>
  );
}

/** Where the rating will appear, until it does: the steps while it runs, and the plain reason when it did not (a stopped run, a file that cannot be rated, text that was never read). */
export function ReviewProgressCard({ review, ocrStatus, onAgain, again, onReadAgain, reading }: {
  review: (ReviewBrief & { started_at?: string | null; ocr_stalled?: boolean }) | null | undefined;
  ocrStatus?: string | null;
  onAgain?: () => void;
  again?: boolean;
  onReadAgain?: () => void;
  reading?: boolean;
}) {
  const active = reviewActive(review?.status);
  const now = useTick(active);
  if (review?.status === 'failed') {
    return (
      <Centered icon={<XCircle aria-hidden className="h-[32px] w-[32px] text-ds-danger" strokeWidth={1.75} />} title={review.stopped ? 'The review stopped' : 'This file could not be rated'}>
        <p className="max-w-[28rem] break-words text-ds-body text-ds-fg-body">{safeDetail(review.error) || 'Something went wrong while it was being reviewed.'}</p>
        {onAgain && <Button variant="primary" loading={again} onClick={onAgain}>Try again</Button>}
      </Centered>
    );
  }
  if (review?.status === 'unavailable') {
    return (
      <Centered icon={<FileQuestion aria-hidden className={`h-[32px] w-[32px] ${MUTED}`} strokeWidth={1.75} />} title="This file can't be rated by AI">
        <p className="max-w-[28rem] break-words text-ds-body text-ds-fg-body">{safeDetail(review.error)}</p>
      </Centered>
    );
  }
  if (!active && ocrStatus === 'failed') {
    return (
      <Centered icon={<AlertTriangle aria-hidden className="h-[32px] w-[32px] text-ds-warning" strokeWidth={1.75} />} title="The file's text could not be read">
        <p className="max-w-[28rem] text-ds-body text-ds-fg-body">It is rated from its text. Read the file again and the review starts.</p>
        {onReadAgain && <Button variant="primary" loading={reading} onClick={onReadAgain}>Read the file again</Button>}
      </Centered>
    );
  }
  const step = active ? review?.step ?? 'reading' : 'reading';
  const at = Math.max(0, STEPS.findIndex((s) => s.key === step));
  return (
    <Centered icon={<Loader2 aria-hidden className="h-[32px] w-[32px] animate-spin text-ds-primary-text motion-reduce:animate-none" strokeWidth={1.75} />} title={active ? 'Reviewing this file…' : 'Getting ready to review this file…'}>
      <ol className="mt-[8px] flex w-full max-w-[24rem] list-none flex-col gap-[10px] p-0 text-left">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-start gap-[10px] text-ds-body">
            {i < at ? <CheckCircle2 aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-success" /> : i === at ? <Loader2 aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 animate-spin text-ds-primary-text motion-reduce:animate-none" /> : <Circle aria-hidden className={`mt-[2px] h-[16px] w-[16px] shrink-0 ${MUTED}`} />}
            <span className={i <= at ? 'text-ds-fg' : MUTED}>{s.label} <span className={`text-ds-label ${MUTED}`}>· {s.hint}</span></span>
          </li>
        ))}
      </ol>
      {active && review?.started_at && <p role="status" className={`mt-[8px] text-ds-label ${MUTED}`}>Working for {elapsed(review.started_at, now)}. You can leave this page; the review carries on.</p>}
    </Centered>
  );
}

/** Above the clause suggestions: still being matched, the matching did not finish, or it was left out on upload. */
export function MatchingNote({ review, onMatchAgain, again }: { review: ReviewState | null | undefined; onMatchAgain: () => void; again?: boolean }) {
  const matching = reviewActive(review?.status) && (review?.step === 'matching' || review?.step === 'rating');
  const now = useTick(matching);
  if (matching) {
    return (
      <Notice tone="info" icon={Loader2}>
        Matching this file to framework clauses. The rating is ready; the suggestions fill in below, usually within two minutes{review?.started_at ? ` (${elapsed(review.started_at, now)} so far)` : ''}.
      </Notice>
    );
  }
  const failed = review?.status === 'done' && !!review.mapping_error;
  const skipped = review?.status === 'done' && !!review.mapping_skipped && !review.mappings;
  if (!failed && !skipped) return null;
  return (
    <Notice
      tone={failed ? 'warning' : 'info'}
      action={<Button size="sm" loading={again} onClick={onMatchAgain}>{failed ? 'Match again' : 'Match to clauses'}</Button>}
    >
      {failed ? `The rating is saved, but matching to framework clauses did not finish. ${safeDetail(review?.mapping_error)}` : 'This file is rated, but it has not been matched to framework clauses.'}
    </Notice>
  );
}

function Bullets({ title, items, tone }: { title: string; items: string[]; tone: 'warning' | 'success' }) {
  if (!items.length) return null;
  return (
    <div className={`rounded-ds-card border border-ds-border p-[12px] ${tone === 'warning' ? 'bg-ds-warning-soft' : 'bg-ds-success-soft'}`}>
      <h3 className="!text-ds-label !font-[600] !text-ds-fg">{title}</h3>
      <ul className="mt-[6px] flex list-disc flex-col gap-[4px] pl-[18px] text-ds-body text-ds-fg-body">{items.map((t, i) => <li key={i} className="break-words [overflow-wrap:anywhere]">{t}</li>)}</ul>
    </div>
  );
}

/** The two lists that make a maturity score usable: what an auditor would still ask for, and what to do about it. */
export function MaturityLists({ gaps, recommendations }: { gaps?: string[] | null; recommendations?: string[] | null }) {
  const missing = (gaps ?? []).filter(Boolean);
  const todo = (recommendations ?? []).filter(Boolean);
  if (!missing.length && !todo.length) return null;
  return (
    <div className="grid grid-cols-1 gap-[12px] md:grid-cols-2">
      <Bullets title="What's missing" items={missing} tone="warning" />
      <Bullets title="How to raise it" items={todo} tone="success" />
    </div>
  );
}

const COVERS = {
  full: { label: 'Proves it', tone: 'success' },
  partial: { label: 'Partly proves it', tone: 'warning' },
  none: { label: 'Does not prove it', tone: 'danger' },
} as const;

/** The file's rating against each thing it was attached to (an assessment item, a requirement, a control). */
export function RatedAgainst({ checks }: { checks: ReviewCheck[] | undefined }) {
  if (!checks?.length) return null;
  return (
    <section aria-labelledby="rated-against">
      <h3 id="rated-against" className={`mb-[6px] !text-ds-label !font-[600] ${MUTED}`}>Rated against what it was attached to</h3>
      <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
        {checks.map((c) => {
          const cov = c.covers ? COVERS[c.covers] : null;
          return (
            <li key={`${c.target.kind}:${c.target.ref}`} className="rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px]">
              <div className="flex flex-wrap items-center gap-[8px]">
                <span className="min-w-0 break-words text-ds-body font-[500] text-ds-fg [overflow-wrap:anywhere]">{c.target.ref}{c.target.label ? ` · ${c.target.label}` : ''}</span>
                {c.status === 'ok' && cov ? <StatusPill size="sm" tone={cov.tone} label={`${cov.label}${typeof c.score === 'number' ? ` · maturity ${c.score}/100` : ''}`} /> : <StatusPill size="sm" tone="neutral" label="Not rated" />}
              </div>
              {c.status === 'ok' ? (
                <>
                  {c.verdict && <p className="mt-[4px] text-ds-body text-ds-fg-body">{c.verdict}</p>}
                  {!!c.detail?.gaps?.length && <p className="mt-[4px] text-ds-label text-ds-fg-body"><span className="font-[600] text-ds-fg">Missing: </span>{c.detail.gaps.join('; ')}</p>}
                  {!!c.detail?.improvements?.length && <p className="mt-[2px] text-ds-label text-ds-fg-body"><span className="font-[600] text-ds-fg">To close it: </span>{c.detail.improvements.join('; ')}</p>}
                </>
              ) : (
                <p className={`mt-[4px] text-ds-label ${MUTED}`}>{c.note || 'The check could not be completed.'}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
