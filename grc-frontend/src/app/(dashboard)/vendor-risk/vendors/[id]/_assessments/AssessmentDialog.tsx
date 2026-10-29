'use client';

// One questionnaire read in full (720px): who is reading which part, the conversation, what moved since the last cycle, the
// score's steps, and the answers by section with what each is worth and what backs it. The review itself (accept or ask to
// clarify each answer, return or accept the questionnaire, the offline workbook) is the review page's own set of controls
// (assessments/[id]/_review.tsx), here in one place. Data: GET /questionnaire-responses/{id}/detail (tpra/assessment_view.py).
import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ExternalLink, Minus } from 'lucide-react';
import { BTN, BTN_PRIMARY, Dialog, ErrorState, GradePill, Skeleton, StatusPill, TONE, fmt, type Tone } from '@/app/(dashboard)/vendor-risk/_ui';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';
import { useToast } from '@/components/ui/ToastProvider';
import { apiErrorText } from '@/lib/apiError';
import { tpraApi } from '@/lib/api';
import { QuestionEvidence, QuestionReview, ReviewBar, ReviewersStrip } from '../../../assessments/[id]/_review';
import {
  CARDS_KEY, useQuestionnaireDetail, type AssessmentCard, type DetailChanges, type DetailRow, type QuestionnaireDetail,
} from '../../../_lib/assessmentsApi';
import { creditTone, kindLabel, movedLine, movement, statusPill } from '../../../_lib/assessmentsLogic';
import { commentsKey, reviewsApi } from '../../../_lib/reviewsApi';
import { requestsApi, sentNote } from '../../../_lib/requestsApi';

const ANSWERED = ['submitted', 'under_review', 'returned', 'accepted'];

function Box({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#d5dbe1] bg-[#f7f9fa] p-3.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#64707e]">{title}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** A small badge: Optional, Critical control, Changed. */
function Chip({ tone, title, children }: { tone: Tone; title?: string; children: ReactNode }) {
  const c = TONE[tone];
  return (
    <span title={title} className="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-4" style={{ background: c.tint, color: c.text, borderColor: c.border }}>
      {children}
    </span>
  );
}

const trim = (text: string | null, n = 70) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text ?? '');

/** The questionnaire's whole thread: comments on its answers (internal or shared, and the vendor's replies) and, here, a
 *  general one. A shared comment is emailed to the vendor. */
function Conversation({ qr, canWrite }: { qr: QuestionnaireDetail; canWrite: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [shared, setShared] = useState(false);
  const { data } = useQuery({ queryKey: commentsKey(qr.id), queryFn: async () => (await reviewsApi.comments(qr.vendor_id, qr.id)).data.items });
  const asked = new Map(qr.sections.flatMap((s) => s.rows).map((r) => [r.id, r.text]));
  const send = useMutation({
    mutationFn: () => requestsApi.sendMessage(qr.vendor_id, { subject_type: 'questionnaire', subject_id: qr.id, visibility: shared ? 'shared' : 'internal', body }),
    onSuccess: (res) => {
      setBody('');
      qc.invalidateQueries({ queryKey: commentsKey(qr.id) });
      if (shared) {
        const note = sentNote(res.data.sent);
        toast({ type: note.ok ? 'success' : 'warning', title: 'Sent to the vendor', message: note.text });
      }
    },
    onError: (e) => toast({ type: 'error', title: 'Not sent', message: apiErrorText(e, 'Try again.') }),
  });
  const items = data ?? [];
  return (
    <Box title="Conversation">
      {items.length === 0 ? (
        <p className="text-[13px] leading-5 text-[#64707e]">Nothing said yet. Notes stay internal unless you share them.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((m) => (
            <li key={m.id} className="rounded-md border border-[#d5dbe1] bg-[#fff] px-3 py-2">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-4 text-[#64707e]">
                <span className="font-semibold text-[#1f2933]">{m.author || 'System'}</span>
                {m.from_supplier
                  ? <StatusPill tone="pending" variant="inline">Vendor</StatusPill>
                  : m.visibility === 'shared'
                    ? <StatusPill tone="progress" variant="inline">Shared with the vendor</StatusPill>
                    : <StatusPill tone="neutral" variant="inline">Internal</StatusPill>}
                <span>{fmt.date(m.created_at)}</span>
                {m.question_key && asked.get(m.question_key) ? <span>on &ldquo;{trim(asked.get(m.question_key) ?? null)}&rdquo;</span> : null}
              </p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-[#26323d]">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send.mutate(); }}>
          <label htmlFor={`conversation-${qr.id}`} className="block text-[13px] font-medium text-[#26323d]">Add a comment</label>
          <textarea
            id={`conversation-${qr.id}`}
            rows={2}
            maxLength={8000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 py-2 text-[13px] text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="inline-flex items-center gap-2 text-[13px] text-[#26323d]">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Send it to the vendor
            </label>
            <button type="submit" className={BTN_PRIMARY} disabled={!body.trim() || send.isPending}>{shared ? 'Send to vendor' : 'Add comment'}</button>
          </div>
        </form>
      )}
    </Box>
  );
}

function Changes({ ch }: { ch: DetailChanges }) {
  const mv = movement(ch);
  return (
    <Box title={`Changes since cycle ${ch.cycle}`}>
      {!ch.compared ? (
        <p className="text-[13px] leading-5 text-[#64707e]">Nothing was answered in cycle {ch.cycle} to set these answers against.</p>
      ) : (
        <>
          <p className="text-[14px] leading-5 text-[#1f2933]">
            {mv.text || (
              <>
                Residual risk{' '}
                <span className="font-semibold tabular-nums" style={{ color: TONE[mv.tone].text }}>{mv.verb}{mv.amount != null ? ` ${mv.amount}` : ''}</span>
                {mv.to != null ? ` to ${mv.to}` : ''}{mv.grade ? `, and the grade went from ${mv.grade}` : ''}.
              </>
            )}
          </p>
          <p className="mt-1 text-[13px] leading-5 text-[#586472]">{movedLine(ch)}</p>
          {ch.items.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {ch.items.slice(0, 8).map((m) => (
                <li key={m.id} className="flex items-start gap-2">
                  {m.weaker === true ? <ArrowUp aria-label="Weaker" className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TONE.danger.dot }} />
                    : m.weaker === false ? <ArrowDown aria-label="Stronger" className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: TONE.success.dot }} />
                      : <Minus aria-label="Same strength" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#64707e]" />}
                  <span className="min-w-0 text-[13px] leading-5 text-[#26323d]">
                    {m.text}{' '}
                    <span className="whitespace-nowrap text-[#64707e]">{trim(m.from, 40) || 'unanswered'} → <span className="font-semibold text-[#1f2933]">{trim(m.to, 40) || 'unanswered'}</span></span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {ch.moved > 8 && <p className="mt-1.5 text-[12px] text-[#64707e]">{ch.moved - 8} more marked Changed below.</p>}
        </>
      )}
    </Box>
  );
}

function AnswerRow({ row, qr, assessmentId, canReview }: { row: DetailRow; qr: QuestionnaireDetail; assessmentId: number; canReview: boolean }) {
  const answer = row.state === 'na' ? { label: row.label ?? 'Not applicable', tone: 'neutral' as Tone }
    : row.state === 'unanswered' ? null
      : { label: row.label ?? 'Answered', tone: row.label ? creditTone(row.credit) : 'neutral' as Tone };
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-5 text-[#1f2933]">{row.text}</p>
          {(row.optional || row.critical || row.evidence.owed) && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] leading-4 text-[#64707e]">
              {row.optional && <span>Optional</span>}
              {row.critical && <Chip tone="danger" title="A No here puts the rating at High at least and holds the approval.">Critical control</Chip>}
              {row.evidence.owed && (row.evidence.has ? <Chip tone="success">Evidence provided</Chip> : <Chip tone="danger">Evidence missing</Chip>)}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {row.changed && <span className="text-[12px] text-[#64707e]">Was {row.was ?? 'unanswered'}</span>}
          {answer ? <StatusPill tone={answer.tone}>{answer.label}</StatusPill> : <span className="text-[12px] text-[#64707e]">Unanswered</span>}
          {row.changed && <Chip tone="progress">Changed</Chip>}
        </div>
      </div>
      {row.text_answer && (
        <p className="mt-1.5 whitespace-pre-line rounded-md bg-[#f3f6f8] px-2.5 py-1.5 text-[13px] leading-5 text-[#1f2933]">{row.text_answer}</p>
      )}
      {row.evidence.files.length > 0 && (
        <ul className="mt-1.5 space-y-1" aria-label="Files from the vendor">
          {row.evidence.files.map((f) => (
            <li key={f.id} className="flex items-center gap-2 text-[12px] text-[#586472]">
              <span className="truncate">{f.file_name}</span>
              {f.file_path && (
                <EvidencePreviewButton
                  file={{ file_path: f.file_path, file_name: f.file_name, mime_type: f.file_type, file_size: f.file_size }}
                  label="View"
                  className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-[#0f766e] hover:bg-[#f0fdfa]"
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <QuestionEvidence qr={qr} questionKey={row.id} assessmentId={assessmentId} canEdit={canReview} />
      <QuestionReview qr={qr} questionKey={row.id} assessmentId={assessmentId} canEdit={canReview} />
    </li>
  );
}

export default function AssessmentDialog({ card, canReview, canMessage, onClose, onScored }: {
  card: AssessmentCard;
  canReview: boolean;
  canMessage: boolean;
  onClose: () => void;
  /** after scoring: the engagement's scores and stage may have moved */
  onScored: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: d, isLoading, error, refetch } = useQuestionnaireDetail(card.assessment_id, card.id);
  const [only, setOnly] = useState<string[] | null>(null);       // a reviewer's own sections' questions
  const pill = statusPill(d?.status ?? card.status, card.expired);
  const assessmentId = d?.assessment_id ?? 0;

  const score = useMutation({
    mutationFn: async () => (await tpraApi.runScoring(d?.assessment?.id as number)).data as { rating_grade?: string | null },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      qc.invalidateQueries({ queryKey: [CARDS_KEY] });
      toast({ type: 'success', title: `Scored: grade ${res.rating_grade ?? 'none'}` });
      onScored();
    },
    onError: (e) => toast({ type: 'error', title: 'Not scored', message: apiErrorText(e, 'Try again.') }),
  });

  // only the scope's current review may be scored (scoring writes the engagement's own scores), and not one whose tier skips it
  const canScore = canReview && !!d?.assessment?.lifecycle && !!d.assessment.active && !d.assessment.scored && !d.assessment.scoring_skipped;
  const submitted = !!d && ANSWERED.includes(d.status);

  return (
    <Dialog
      open
      onClose={onClose}
      size={720}
      title={kindLabel(card.kind, card.cycle)}
      description={d ? [`${d.answered} of ${d.questions} answered`, d.missing_evidence ? `${d.missing_evidence} still missing evidence` : ''].filter(Boolean).join(' · ') : 'Loading answers…'}
      footer={(
        <>
          <button type="button" className={BTN} onClick={onClose}>Close</button>
          {canScore && (
            <span title={submitted ? undefined : 'Score it once the vendor has submitted.'}>
              <button type="button" className={BTN_PRIMARY} disabled={!submitted || score.isPending} onClick={() => score.mutate()}>
                {score.isPending ? 'Scoring…' : 'Score'}
              </button>
            </span>
          )}
        </>
      )}
    >
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !d ? (
        <ErrorState message={apiErrorText(error, 'The questionnaire could not be read.')} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2" tabIndex={-1} data-autofocus>
            <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
            {d.assessment?.scored && <GradePill grade={d.assessment.grade} score={d.assessment.residual_score} prefix="Grade" />}
            <span className="text-[13px] text-[#64707e]">{card.name}{d.template_version ? ` · version ${d.template_version}` : ''}</span>
            {d.assessment_id ? (
              <Link
                href={`/vendor-risk/assessments/${d.assessment_id}?tab=questionnaire`}
                className="ml-auto inline-flex items-center gap-1 rounded text-[13px] font-medium text-[#0f766e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
              >
                Full review <ExternalLink aria-hidden className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>

          <Box title="Who is reading what">
            <ReviewersStrip bare qr={d} canEdit={canReview} filtered={!!only} onFilter={setOnly} />
          </Box>
          <Conversation qr={d} canWrite={canMessage} />
          {d.changes && d.answered > 0 && <Changes ch={d.changes} />}
          {d.steps.length > 0 && (
            <Box title="Score breakdown">
              <ul className="space-y-1.5">
                {d.steps.map((s) => (
                  <li key={s.label} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 text-[13px] leading-5 text-[#1f2933]">
                      {s.label}{s.detail ? <span className="ml-1.5 text-[12px] text-[#64707e]">{s.detail}</span> : null}
                    </span>
                    <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[#1f2933]">{s.value}</span>
                  </li>
                ))}
              </ul>
            </Box>
          )}

          <ReviewBar qr={d} assessmentId={assessmentId} canEdit={canReview} />

          {d.sections.map((s) => {
            const rows = s.rows.filter((r) => !only || only.includes(r.id));
            if (rows.length === 0) return null;
            return (
              <section key={s.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[14px] font-semibold text-[#1f2933]">{s.label}</h3>
                  <span className="text-[12px] tabular-nums text-[#64707e]">{s.residual != null ? `residual ${s.residual} · ` : ''}{s.answered} answered</span>
                </div>
                <ul className="mt-1 divide-y divide-[#e1e6eb]">
                  {rows.map((r) => <AnswerRow key={r.id} row={r} qr={d} assessmentId={assessmentId} canReview={canReview} />)}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}
