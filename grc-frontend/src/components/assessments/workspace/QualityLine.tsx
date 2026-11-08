'use client';

/**
 * What an attached file proves about its control, as the AI review left it: a verdict (proves it, partly proves it, does not), the maturity of the file out of 100, what is missing
 * and how to close it, and a re-check. Until the review has run it says it is rating the file, and after a few minutes that it was not rated. (The older EvidenceQualityNote did
 * this in 10 to 11 px text; the data is the same: `quality` on the evidence rows of `GET /{id}/items/{item}/evidence`.)
 */
import { AlertTriangle, CheckCircle2, FileQuestion, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { Button, StatusPill, useReportedMutation } from '@/components/ui/ds';
import type { EvidenceQuality } from '@/components/compliance/EvidenceQualityNote';
import { parseUtc } from '@/lib/serverTime';
import apiClient from '@/lib/api';

const FRESH_MS = 5 * 60 * 1000;
const fresh = (since?: string | null): boolean => !since || Date.now() - (parseUtc(since)?.getTime() ?? 0) < FRESH_MS;

const COVERS = {
  full: { tone: 'success', label: 'Proves this control', Icon: CheckCircle2 },
  partial: { tone: 'warning', label: 'Partly proves it', Icon: AlertTriangle },
  none: { tone: 'danger', label: 'Does not prove it', Icon: XCircle },
} as const;

const NOT_REVIEWED: Record<string, { label: string; hint: string; Icon: typeof ShieldAlert }> = {
  no_text: { label: 'Not reviewed', hint: 'No readable text could be taken from this file, so it could not be checked.', Icon: FileQuestion },
  licence_restricted: { label: 'Not reviewed', hint: 'The wording of this requirement is licensed, so the AI cannot read it.', Icon: ShieldAlert },
  failed: { label: 'Review failed', hint: 'The check could not be completed.', Icon: AlertTriangle },
};

export function QualityLine({ assessmentId, itemId, evidenceId, quality, since, readOnly, onRechecked }: {
  assessmentId: number; itemId: number; evidenceId: number; quality: EvidenceQuality | null | undefined; since?: string | null; readOnly: boolean; onRechecked: () => void;
}) {
  const recheck = useReportedMutation({
    mutationFn: async () => (await apiClient.post(`/compliance/assessments/${assessmentId}/items/${itemId}/evidence/${evidenceId}/quality`)).data,
    failure: "Couldn't start the check",
    onSuccess: onRechecked,
  });
  const again = (label: string) => !readOnly && (
    <Button size="sm" leftIcon={<RefreshCw aria-hidden />} loading={recheck.isPending} onClick={() => recheck.mutate()}>{label}</Button>
  );

  if (!quality) {
    const live = fresh(since);
    return (
      <div className="mt-[8px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        {live ? <><Loader2 aria-hidden className="h-[14px] w-[14px] animate-spin" />Rating this file against the control…</> : 'Not rated against this control yet.'}
        {again(live ? 'Check now' : 'Rate now')}
      </div>
    );
  }
  if (quality.status !== 'ok') {
    const state = NOT_REVIEWED[quality.status] ?? NOT_REVIEWED.failed;
    return (
      <div className="mt-[8px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
        <StatusPill tone="neutral" label={state.label} size="sm" />
        <span className="min-w-0">{quality.note || state.hint}</span>
        {again('Try again')}
      </div>
    );
  }
  const covers = COVERS[(quality.covers || 'partial') as keyof typeof COVERS] ?? COVERS.partial;
  const gaps = quality.detail?.gaps ?? [];
  const improvements = quality.detail?.improvements ?? [];
  return (
    <div className="mt-[8px]">
      <div className="flex flex-wrap items-center gap-[8px] text-ds-label">
        <StatusPill tone={covers.tone} label={covers.label} size="sm" />
        {typeof quality.score === 'number' && <span className="text-ds-fg-muted">Maturity {quality.score} of 100</span>}
        {quality.basis === 'identifier_only' && <span className="text-ds-fg-muted">Indicative: judged on the control&apos;s code and title only</span>}
        {again('Check again')}
      </div>
      {quality.verdict && <p className="mt-[4px] text-ds-body text-ds-fg-body">{quality.verdict}</p>}
      {gaps.length > 0 && <p className="mt-[4px] text-ds-label text-ds-fg-muted"><span className="font-[600] text-ds-fg">Missing: </span>{gaps.join('; ')}</p>}
      {improvements.length > 0 && <p className="mt-[2px] text-ds-label text-ds-fg-muted"><span className="font-[600] text-ds-fg">To close it: </span>{improvements.join('; ')}</p>}
    </div>
  );
}
