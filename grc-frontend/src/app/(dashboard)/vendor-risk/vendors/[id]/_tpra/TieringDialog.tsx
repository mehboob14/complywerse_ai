'use client';

// Tier an engagement, or tier it again. The tenant's onboarding questions (answers already given by the request are in), a live
// score on the scale with the tier the five factors give, a minimum from an answer when one holds the tier up, and an override that
// needs its reason. Closing keeps the draft for the next time. Saving writes the answers, then sets the tier in one step, so the
// work follows the tier once (backend service._follow_tier). The score is always the server's: the preview calls the same rules.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { clsx } from 'clsx';
import { BTN, BTN_PRIMARY } from '../_record/btn';
import { Dialog, TierBadge } from '../_record/recordUi';
import { TONE } from '@/lib/status';
import { ThresholdRuler } from '../../../_ui/Charts';
import { useToast } from '@/components/ui/ToastProvider';
import { tpraApi } from '@/lib/api';
import { QuestionRow, useIntake, useIntakeCatalogue } from '../../../_lib/intake/IntakeForm';
import { intakeApi } from '../../../_lib/intakeApi';
import { engagementsKey, useEngagements, type Engagement } from '../../../_lib/engagementsApi';
import { apiErrorText, lifecycleApi, type HeldPolicy, type TierPreview, type TierResult } from '../../../_lib/lifecycleApi';
import {
  changed, changesFrom, draftKey, overrideReady, owed, visibleQuestions, type AskedSection,
} from '../../../_lib/lifecycleLogic';

const FIELD = 'w-full rounded-ds-card border border-ds-border-strong bg-ds-surface px-3 py-2 text-[14px] text-ds-fg placeholder:text-ds-fg-muted focus-visible:border-ds-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-border-strong';
const OVERRIDE = 'override';
const BANDS = { critical: 75, high: 50, medium: 25 };
const TIERS = [['critical', 'Critical'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] as const;

interface AnswerSet { answers?: Record<string, unknown>; justifications?: Record<string, string> }
interface Draft { answers: Record<string, unknown>; reasons: Record<string, string>; tier: string; why: string }

/** Drafts survive closing the dialog (and opening it from another page of the record) for as long as the tab lives. */
const drafts = new Map<string, Draft>();

const blank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
const given = (answers: Record<string, unknown>) => Object.fromEntries(Object.entries(answers).filter(([, v]) => !blank(v)));

export default function TieringDialog({
  open, onClose, vendorId, engagementId, engagementName, assessmentId, currentTier, policy, blockedWhy, onDone, canRunSaved = true,
}: {
  open: boolean;
  onClose: () => void;
  vendorId: number;
  /** null: General, the supplier itself */
  engagementId: number | null;
  engagementName: string;
  /** null until the lifecycle has started: saving starts it */
  assessmentId: number | null;
  currentTier: string | null;
  policy: HeldPolicy | null;
  /** why the tier cannot change now (an exit is under way) */
  blockedWhy: string | null;
  onDone: (result: TierResult) => void;
  /** the person may tier without answering everything (they may run the tiering engine) */
  canRunSaved?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const key = draftKey(vendorId, engagementId);
  const { data: catalogue } = useIntakeCatalogue();
  const supplier = useIntake(vendorId);
  const { data: scopes } = useEngagements(vendorId);

  // What is saved: the supplier's own answers, or the engagement's.
  const saved = useMemo(() => {
    if (engagementId) {
      const mine = scopes?.items.find((e) => e.id === engagementId) as (Engagement & { intake?: AnswerSet | null }) | undefined;   // the list carries it
      const intake: AnswerSet = mine?.intake ?? {};
      return mine ? { answers: intake.answers ?? {}, justifications: intake.justifications ?? {} } : null;
    }
    const intake = supplier.data?.intake;
    return intake ? { answers: intake.answers ?? {}, justifications: intake.justifications ?? {} } : null;
  }, [engagementId, scopes, supplier.data]);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState<string>('');
  const [preview, setPreview] = useState<TierPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const live = useRef(draft);
  live.current = draft;

  useEffect(() => {
    if (!open || draft) return;
    const kept = drafts.get(key);
    if (kept) setDraft(kept);
    else if (saved) setDraft({ answers: { ...saved.answers }, reasons: { ...saved.justifications }, tier: '', why: '' });
  }, [open, draft, key, saved]);

  const sections = useMemo<AskedSection[]>(
    () => (catalogue?.sections ?? []).filter((s) => s.questions.length > 0) as AskedSection[], [catalogue]);
  const minReason = catalogue?.min_reason ?? 10;
  useEffect(() => {
    if (!open || !draft || step || sections.length === 0) return;
    const first = sections.find((s) => owed(s, draft.answers, draft.reasons, minReason).length > 0) ?? sections[0];
    setStep(first.key);
  }, [open, draft, step, sections, minReason]);

  // The score, from the server's rules, a moment after the last change. Nothing is saved.
  useEffect(() => {
    if (!open || !draft) return undefined;
    const answers = given(draft.answers);
    if (Object.keys(answers).length === 0) return undefined;           // nothing to score: the box says so
    const timer = setTimeout(async () => {
      try {
        setPreview((await lifecycleApi.previewTier(answers)).data);
        setPreviewError(null);
      } catch (e) {
        setPreviewError(apiErrorText(e, 'The score is not available.'));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [open, draft?.answers]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (live.current) drafts.set(key, live.current);
    setDraft(null);
    setStep('');
    setPreview(null);
    onClose();
  };

  // The score shown is for the answers as they stand: with none given there is none, whatever came back earlier.
  const score = draft && Object.keys(given(draft.answers)).length > 0 ? preview : null;
  const left = useMemo(() => (draft ? sections.reduce((n, s) => n + owed(s, draft.answers, draft.reasons, minReason).length, 0) : 0),
    [sections, draft, minReason]);
  const total = sections.reduce((n, s) => n + s.questions.length, 0);
  const answered = draft ? sections.reduce((n, s) => n + visibleQuestions(s, draft.answers).filter((q) => !blank(draft.answers[q.key])).length, 0) : 0;

  const save = useMutation({
    mutationFn: async () => {
      if (!draft || !saved) throw new Error('Nothing to save');
      const answers = changed(draft.answers, saved.answers);
      const reasons = changed(draft.reasons, saved.justifications);
      if (Object.keys(answers).length || Object.keys(reasons).length) {
        if (engagementId) await lifecycleApi.saveEngagementAnswers(engagementId, answers, reasons);
        else await intakeApi.save(vendorId, { answers, justifications: reasons });
      }
      const id = assessmentId ?? (await tpraApi.initLifecycle(vendorId, engagementId)).data.assessment.id;
      return (await lifecycleApi.setTier(id, draft.tier ? { tier: draft.tier, justification: draft.why.trim() } : undefined)).data;
    },
    onSuccess: (result) => {
      drafts.delete(key);
      setDraft(null);
      setStep('');
      ['tpra-lifecycle', 'tprm-intake', 'tier-requirements', 'tprm-assessment-cards'].forEach((k) => qc.invalidateQueries({ queryKey: [k, vendorId] }));
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      qc.invalidateQueries({ queryKey: ['tprm-intake'] });
      qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
      onDone(result);
      onClose();
    },
    onError: (e) => toast({ type: 'error', title: 'Tier not set', message: apiErrorText(e, 'Try again.') }),
  });

  // Answers missing is not always a reason to wait: a supplier added directly was never asked them. This tiers it from what is saved
  // (its answers if it has any, else its profile), as the old Compute tier did.
  const fromSaved = useMutation({
    mutationFn: async () => {
      const id = assessmentId ?? (await tpraApi.initLifecycle(vendorId, engagementId)).data.assessment.id;
      return (await lifecycleApi.setTier(id)).data;
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['tpra-lifecycle'] });
      qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
      close();
      onDone(result);
    },
    onError: (e) => toast({ type: 'error', title: 'Tier not set', message: apiErrorText(e, 'Try again.') }),
  });

  const current = sections.find((s) => s.key === step);
  const at = step === OVERRIDE ? sections.length : sections.findIndex((s) => s.key === step);
  const steps = [...sections.map((s) => s.key), OVERRIDE];
  const shown = draft?.tier || score?.tier || null;
  const moved = changesFrom(currentTier, shown);
  const ready = !!draft && left === 0 && overrideReady(draft.tier, draft.why) && !blockedWhy && !!saved;
  const title = `${currentTier ? 'Re-tier' : 'Tier'} ${engagementName}`;

  return (
    <Dialog
      open={open} onClose={close} size={720} flush title={title}
      description={`${total} questions. The tier sets stages and reviewers.`}
      footer={<>
        <span className="mr-auto text-[13px] text-ds-fg-muted">{left > 0 ? `${left} to answer` : ''}</span>
        {left > 0 && !blockedWhy && canRunSaved && (
          <button type="button" className={BTN} disabled={fromSaved.isPending || save.isPending} onClick={() => fromSaved.mutate()}
            title="Tier from the answers already saved (else the vendor's profile), without this draft">
            {fromSaved.isPending ? 'Working…' : 'Tier from saved answers'}
          </button>
        )}
        <button type="button" className={BTN} disabled={at <= 0} onClick={() => setStep(steps[at - 1])}>Back</button>
        {at < steps.length - 1 && <button type="button" className={BTN} onClick={() => setStep(steps[at + 1])}>Next</button>}
        <button type="button" className={BTN_PRIMARY} disabled={!ready || save.isPending} onClick={() => save.mutate()}
          title={blockedWhy ?? undefined}>
          {save.isPending ? 'Saving…' : currentTier ? 'Save tier' : 'Set tier'}
        </button>
      </>}
    >
      {!draft || !catalogue ? (
        <p className="px-[20px] py-[24px] text-[13px] text-ds-fg-muted">Loading the questions…</p>
      ) : (
        <div>
          {blockedWhy && <p className="px-[20px] pt-3 text-[13px]" style={{ color: TONE.warning.text }}>{blockedWhy}</p>}
          {/* The score */}
          <div className="border-b border-ds-surface-hover px-[20px] py-3">
            {!score ? (
              <p className="text-[13px] text-ds-fg-muted">{previewError && draft && Object.keys(given(draft.answers)).length > 0 ? previewError : 'Answer to see the tier'}</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-[13px] font-[600] text-ds-fg-muted">{draft.tier ? 'Tier' : 'Likely tier'}</span>
                  <TierBadge tier={shown} />
                  <span className="text-[13px] tabular-nums text-ds-fg-muted">Score {Math.round(score.score * 10) / 10}</span>
                  {draft.tier && <span className="rounded-full px-2 py-0.5 text-[12px] font-[600]" style={{ background: TONE.pending.tint, color: TONE.pending.text }}>Overridden</span>}
                  {score.minimum_tier && (
                    <span className="rounded-full px-2 py-0.5 text-[12px] font-[600]" style={{ background: TONE.progress.tint, color: TONE.progress.text }}
                      title={score.minimum_from ? `An answer sets a minimum tier, whatever the score: ${score.minimum_from}` : 'An answer sets a minimum tier, whatever the score.'}>
                      Minimum {score.minimum_tier[0].toUpperCase() + score.minimum_tier.slice(1)} from an answer
                    </span>
                  )}
                  {moved && <span className="rounded-full px-2 py-0.5 text-[12px] font-[600]" style={{ background: TONE.warning.tint, color: TONE.warning.text }}>Changes from {moved}</span>}
                  <span className="ml-auto text-[13px] tabular-nums text-ds-fg-muted">{answered}/{total}</span>
                </div>
                <ThresholdRuler score={score.score} thresholds={policy?.thresholds ?? BANDS} compact showNext />
              </div>
            )}
          </div>

          {/* The questions, by section */}
          <div className="grid md:grid-cols-[190px_minmax(0,1fr)]">
            <nav aria-label="Sections" className="border-b border-ds-surface-hover p-2.5 md:border-b-0 md:border-r">
              <ul className="space-y-0.5">
                {steps.map((k) => {
                  const s = sections.find((x) => x.key === k);
                  const open_ = s ? owed(s, draft.answers, draft.reasons, minReason).length : 0;
                  return (
                    <li key={k}>
                      <button type="button" onClick={() => setStep(k)} aria-current={step === k ? 'step' : undefined}
                        className={clsx('flex w-full items-center gap-2 rounded-ds-card px-2.5 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary',
                          step === k ? 'bg-ds-primary-soft font-[600] text-ds-primary-hover' : 'text-ds-fg-body hover:bg-ds-surface-hover')}>
                        <span aria-hidden className="grid h-4 w-4 shrink-0 place-items-center rounded-full"
                          style={{ background: s && open_ === 0 ? TONE.success.dot : '#e3e8ee', color: '#fff' }}>
                          {s && open_ === 0 && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{s ? s.title : 'Override'}</span>
                        {open_ > 0 && <span className="text-[12px] text-ds-fg-muted">{open_}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </nav>

            <div className="min-w-0 space-y-[12px] p-[16px]">
              {current ? (
                <>
                  {current.can_answer === false && (
                    <p className="rounded-ds-card bg-ds-surface-hover px-3 py-2 text-[13px] text-ds-fg-muted">Someone else answers this section; you can read it.</p>
                  )}
                  {visibleQuestions(current, draft.answers).map((q) => (
                    <QuestionRow
                      key={q.key} q={q as never} value={draft.answers[q.key]} reason={draft.reasons[q.key] || ''}
                      editable={current.can_answer !== false} minReason={minReason}
                      onAnswer={(v) => setDraft((d) => (d ? { ...d, answers: { ...d.answers, [q.key]: v } } : d))}
                      onReason={(v) => setDraft((d) => (d ? { ...d, reasons: { ...d.reasons, [q.key]: v } } : d))}
                    />
                  ))}
                </>
              ) : (
                <div className="space-y-[12px]">
                  <p className="text-[13px] text-ds-fg-body">
                    Computed tier is <span className="font-[600]">{score ? score.tier[0].toUpperCase() + score.tier.slice(1) : 'not known yet'}</span>.
                  </p>
                  <div>
                    <label className="mb-1 block text-[13px] font-medium text-ds-fg-body" htmlFor="tier-override">Tier</label>
                    <select id="tier-override" className={FIELD} value={draft.tier} onChange={(e) => setDraft({ ...draft, tier: e.target.value })}>
                      <option value="">Use computed tier</option>
                      {TIERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  {draft.tier && (
                    <div>
                      <label className="mb-1 block text-[13px] font-medium text-ds-fg-body" htmlFor="tier-why">Reason</label>
                      <textarea id="tier-why" rows={3} className={FIELD} value={draft.why} placeholder="Say what the answers miss."
                        onChange={(e) => setDraft({ ...draft, why: e.target.value })} />
                      {!overrideReady(draft.tier, draft.why) && <p className="mt-0.5 text-[12px] text-ds-fg-muted">At least 10 characters. It goes on the audit trail.</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
