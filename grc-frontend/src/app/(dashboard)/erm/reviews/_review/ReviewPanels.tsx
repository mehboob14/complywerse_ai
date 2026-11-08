'use client';

/**
 * The two panels of the Reviews page, on the kit's SidePanel: Schedule a review (the risk from the COMPLETE register, the cycle, the type, who carries it out, the due date) and
 * Start / Complete a review (re-score the risk, findings, recommendations, an evidence file). Both say what went wrong in words and keep what was typed; each asks before it throws
 * typed input away. What completing sends is reviewsModel.completeBody (the risk's scores travel with its likelihood and impact). Starting a review sets it "in review" when the person
 * presses Start (it used to happen silently the moment the panel opened, and a failure was ignored).
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { Button, Combobox, FormField, Notice, Select, SidePanel, SkeletonLines, TextInput, Textarea, useNotify, type ListOption } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { ermApi, evidenceApi, risksApi } from '@/lib/api';
import { RISK_REFRESH, type PendingReview } from '../../risks/_register/riskData';
import { categoryKey, categoryLabel, type RiskRow } from '../../risks/_register/riskModel';
import { completeBody, completeProblem, type Review } from './reviewsModel';

export interface Person { id: number; display_name: string; email?: string }

const CYCLES = [['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['semi_annual', 'Semi-annual'], ['annual', 'Annual']] as const;
const TYPES = [['periodic', 'Periodic'], ['triggered', 'Triggered'], ['ad_hoc', 'Ad hoc'], ['audit', 'Audit']] as const;
const SCALE = [1, 2, 3, 4, 5];

export function useReviewRefresh() {
  const qc = useQueryClient();
  return () => {
    [['erm-reviews-all'], ['erm-reviews'], ['erm-pending-reviews'], ['erm-overdue-reviews'], ...RISK_REFRESH].forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });
  };
}

// ── Schedule ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function SchedulePanel({ open, onClose, risks, risksFailed, people, initialRiskId }: { open: boolean; onClose: () => void; risks: readonly RiskRow[]; risksFailed: boolean; people: readonly Person[]; initialRiskId?: number }) {
  const refresh = useReviewRefresh();
  const notify = useNotify();
  const inThirtyDays = () => new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [riskId, setRiskId] = useState<string | null>(initialRiskId ? String(initialRiskId) : null);
  const [cycle, setCycle] = useState('quarterly');
  const [type, setType] = useState('periodic');
  const [reviewer, setReviewer] = useState('');
  const [due, setDue] = useState(inThirtyDays);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const options: ListOption[] = risks.map((r) => ({ value: String(r.id), label: r.title, description: categoryLabel(categoryKey(r)) }));
  const missing = !riskId ? 'Choose the risk to review.' : !due ? 'Choose a due date.' : '';
  const dirty = riskId !== null || reviewer !== '' || cycle !== 'quarterly' || type !== 'periodic';
  const close = () => { setError(null); setTried(false); onClose(); };

  const submit = async () => {
    setTried(true);
    if (missing) return;
    setBusy(true);
    setError(null);
    try {
      await ermApi.reviews.create({ risk_id: Number(riskId), review_cycle: cycle, review_type: type, due_date: due, reviewer_id: reviewer ? Number(reviewer) : undefined } as never);
      refresh();
      notify.success('The review is on the schedule.', { title: 'Review scheduled' });
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      open={open} onClose={close} title="Schedule a review" subtitle="Pick the risk, who carries it out and when it is due" width="md" dockFrom={Infinity} dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => { void submit(); }}>Schedule</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        {risksFailed && <Notice tone="warning" title="The list of risks could not be loaded">Reload the page to try again; a review cannot be scheduled without a risk.</Notice>}
        <FormField label="Risk" required error={tried && !riskId ? 'Choose the risk to review.' : undefined}>
          <Combobox label="Risk" options={options} value={riskId} onChange={setRiskId} placeholder="Choose a risk" searchable searchPlaceholder="Search risks by title" />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Review cycle"><Select value={cycle} onChange={(e) => setCycle(e.target.value)}>{CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Review type"><Select value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        </div>
        <FormField label="Carried out by" optional><Select value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Unassigned">{people.map((p) => <option key={p.id} value={String(p.id)}>{p.display_name}</option>)}</Select></FormField>
        <FormField label="Due date" required error={tried && !due ? 'Choose a due date.' : undefined}><TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
        {error && <Notice tone="danger" title="The review was not scheduled">{error}</Notice>}
      </div>
    </SidePanel>
  );
}

// ── Start / Complete ─────────────────────────────────────────────────────────────────────────────────────────────────────

export function CompletePanel({ review, onClose }: { review: Review | null; onClose: () => void }) {
  const refresh = useReviewRefresh();
  const notify = useNotify();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['erm-risk-for-review', review?.risk_id],
    queryFn: async () => (await ermApi.risks.getById(review!.risk_id)).data as unknown as { inherent_likelihood?: number | null; inherent_impact?: number | null; residual_likelihood?: number | null; residual_impact?: number | null },
    enabled: !!review,
    retry: (f, e) => f < 2 && canRetry(e),
  });
  const risk = q.data;
  const [inhL, setInhL] = useState(''); const [inhI, setInhI] = useState(''); const [resL, setResL] = useState(''); const [resI, setResI] = useState('');
  const [findings, setFindings] = useState(''); const [recommendations, setRecommendations] = useState('');
  const [file, setFile] = useState<File | null>(null); const [fileName, setFileName] = useState(''); const [fileNote, setFileNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState<number | null>(null);

  // the form starts from the risk's own values, once, for each review opened
  useEffect(() => {
    if (!review) { setSeed(null); return; }
    if (seed === review.id || !risk) return;
    setSeed(review.id);
    setInhL(risk.inherent_likelihood?.toString() ?? ''); setInhI(risk.inherent_impact?.toString() ?? '');
    setResL(risk.residual_likelihood?.toString() ?? ''); setResI(risk.residual_impact?.toString() ?? '');
    setFindings(review.findings ?? ''); setRecommendations(review.recommendations ?? '');
    setFile(null); setFileName(''); setFileNote(''); setError(null);
  }, [review, risk, seed]);

  const problem = completeProblem({ inhL, inhI, resL, resI });
  const dirty = !!review && seed === review.id && (findings !== (review.findings ?? '') || recommendations !== (review.recommendations ?? '') || !!file);

  const complete = async () => {
    if (!review || problem) return;
    setBusy(true);
    setError(null);
    try {
      const body = completeBody({ risk, inhL, inhI, resL, resI, findings, recommendations });
      if (body.assess) await ermApi.risks.assess(review.risk_id, body.assess);
      if (file) {
        const form = new FormData();
        form.append('name', fileName.trim() || file.name);
        if (fileNote.trim()) form.append('description', fileNote.trim());
        form.append('file', file);
        const uploaded = await evidenceApi.create(form);
        const evidenceId = uploaded.data?.id;
        if (evidenceId) { try { await risksApi.linkEvidence(review.risk_id, { evidence_id: evidenceId }); } catch { notify.warning('The evidence is saved but could not be linked to the risk. Link it from the risk page.', { title: 'Evidence not linked' }); } }
      }
      await ermApi.reviews.update(review.id, body.review as never);
      refresh();
      void qc.invalidateQueries({ queryKey: ['erm-risk-for-review', review.risk_id] });
      notify.success(body.assess ? 'The review is complete and the risk scores are updated.' : 'The review is complete.', { title: 'Review completed' });
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const scale = (l: string, set: (v: string) => void, label: string) => (
    <FormField label={label}><Select value={l} onChange={(e) => set(e.target.value)} placeholder="Not scored">{SCALE.map((n) => <option key={n} value={String(n)}>{n}</option>)}</Select></FormField>
  );

  return (
    <SidePanel
      open={!!review} onClose={onClose} title="Complete the review" subtitle={review?.risk_title ?? undefined} width="lg" dockFrom={Infinity} dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!!problem || q.isPending} onClick={() => { void complete(); }}>Complete review</Button></div>}
    >
      {review && (
        <div className="flex flex-col gap-[16px]">
          {q.isPending && <SkeletonLines lines={3} label="Loading the risk" />}
          {q.isError && !risk && <Notice tone="warning" title="The risk could not be loaded" action={canRetry(q.error) ? <Button onClick={() => { void q.refetch(); }}>Retry</Button> : undefined}>{errorMessage(q.error)} You can still write the findings; the scores start empty.</Notice>}
          <p className="m-0 text-ds-body text-ds-fg-muted">Update the risk&apos;s scores if the review changes them, add what you found, and attach evidence if you have it.</p>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-[4px] p-0 text-ds-body font-[600] text-ds-fg">Inherent score</legend>
            <div className="grid gap-[12px] sm:grid-cols-2">{scale(inhL, setInhL, 'Likelihood')}{scale(inhI, setInhI, 'Impact')}</div>
          </fieldset>
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-[4px] p-0 text-ds-body font-[600] text-ds-fg">Residual score</legend>
            <div className="grid gap-[12px] sm:grid-cols-2">{scale(resL, setResL, 'Likelihood')}{scale(resI, setResI, 'Impact')}</div>
          </fieldset>
          <FormField label="Findings" optional><Textarea rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="What the review found" /></FormField>
          <FormField label="Recommendations" optional><Textarea rows={3} value={recommendations} onChange={(e) => setRecommendations(e.target.value)} placeholder="Any recommended next steps" /></FormField>
          <div className="rounded-ds-card border border-dashed border-ds-border-strong p-[12px]">
            <h3 className="m-0 !text-ds-body !font-[600] !text-ds-fg">Attach evidence <span className="font-normal text-ds-fg-muted">(optional)</span></h3>
            <div className="mt-[8px] flex flex-col gap-[8px]">
              <label className="inline-flex min-h-ds-control w-fit cursor-pointer items-center gap-[8px] rounded-ds-control border border-ds-border-strong bg-ds-surface px-[12px] text-ds-body text-ds-fg hover:bg-ds-surface-hover focus-within:shadow-ds-ring">
                <Upload aria-hidden className="h-[16px] w-[16px]" />{file ? file.name : 'Choose a file'}
                <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
              {file && (
                <>
                  <FormField label="Name"><TextInput value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder={file.name} /></FormField>
                  <FormField label="Description" optional><TextInput value={fileNote} onChange={(e) => setFileNote(e.target.value)} /></FormField>
                </>
              )}
            </div>
          </div>
          {(problem || error) && <Notice tone="danger" title={problem ? 'Not completed yet' : 'The review was not completed'}>{problem || error}</Notice>}
        </div>
      )}
    </SidePanel>
  );
}

export type { PendingReview };
