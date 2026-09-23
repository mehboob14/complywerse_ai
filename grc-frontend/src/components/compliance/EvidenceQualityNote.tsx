'use client';

/** What an uploaded file actually proves about the item it was attached to.
 *
 *  The review runs on upload and on link, so this renders the verdict it left
 *  and offers a re-check — for a replaced file, or when the review could not run.
 *  Kept deliberately plain: a reviewer needs the gaps, not a dashboard.
 */
import { AlertTriangle, CheckCircle2, FileQuestion, Loader2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import apiClient from '@/lib/api';

export type EvidenceQuality = {
  status: 'ok' | 'no_text' | 'licence_restricted' | 'failed';
  covers?: 'full' | 'partial' | 'none' | null;
  score?: number | null;
  confidence?: number | null;
  verdict?: string | null;
  detail?: { strengths?: string[]; gaps?: string[]; improvements?: string[]; as_of?: string | null } | null;
  basis?: 'requirement_text' | 'identifier_only' | null;
  note?: string | null;
  checked_at?: string | null;
};

const COVERS = {
  full: { label: 'Proves this item', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800', Icon: CheckCircle2 },
  partial: { label: 'Partly proves it', cls: 'border-amber-200 bg-amber-50 text-amber-800', Icon: AlertTriangle },
  none: { label: 'Does not prove it', cls: 'border-rose-200 bg-rose-50 text-rose-800', Icon: XCircle },
} as const;

const NOT_REVIEWED: Record<string, { label: string; hint: string; Icon: typeof ShieldAlert }> = {
  no_text: {
    label: 'Not reviewed',
    hint: 'No readable text could be extracted from this file, so it could not be checked.',
    Icon: FileQuestion,
  },
  licence_restricted: {
    label: 'Not reviewed',
    hint: 'This requirement’s wording is licensed and cannot be sent to the model.',
    Icon: ShieldAlert,
  },
  failed: { label: 'Review failed', hint: 'The check could not be completed.', Icon: AlertTriangle },
};

export function EvidenceQualityNote({
  assessmentId, itemId, evidenceId, quality, onRechecked,
}: {
  assessmentId: number;
  itemId: number;
  evidenceId: number;
  quality?: EvidenceQuality | null;
  onRechecked?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const recheck = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await apiClient.post(
        `/compliance/assessments/${assessmentId}/items/${itemId}/evidence/${evidenceId}/quality`,
      );
      onRechecked?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const CheckButton = ({ label }: { label: string }) => (
    <button
      onClick={recheck}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <RefreshCw className="h-2.5 w-2.5" />} {label}
    </button>
  );

  if (!quality) {
    return (
      <div className="mt-1 flex items-center gap-2 pl-5 text-[11px] text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin text-slate-400" />
        Checking this file against the requirement…
        <CheckButton label="Check now" />
        {failed && <span className="text-rose-600">Could not start the check.</span>}
      </div>
    );
  }

  if (quality.status !== 'ok') {
    const state = NOT_REVIEWED[quality.status] || NOT_REVIEWED.failed;
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 pl-5 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 font-medium text-slate-600">
          <state.Icon className="h-2.5 w-2.5" /> {state.label}
        </span>
        <span>{quality.note || state.hint}</span>
        <CheckButton label="Try again" />
      </div>
    );
  }

  const covers = COVERS[(quality.covers || 'partial') as keyof typeof COVERS] || COVERS.partial;
  const gaps = quality.detail?.gaps || [];
  const improvements = quality.detail?.improvements || [];

  return (
    <div className="mt-1 pl-5">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-semibold ${covers.cls}`}>
          <covers.Icon className="h-2.5 w-2.5" /> {covers.label}
          {typeof quality.score === 'number' && <span className="font-normal opacity-80">· {quality.score}/100</span>}
        </span>
        {quality.detail?.as_of && <span className="text-slate-500">as of {quality.detail.as_of}</span>}
        {quality.basis === 'identifier_only' && (
          <span className="text-slate-400" title="The requirement's own wording is licensed, so this was judged on its code and title only.">
            indicative
          </span>
        )}
        <CheckButton label="Re-check" />
      </div>
      {quality.verdict && <p className="mt-1 text-[12px] leading-relaxed text-slate-700">{quality.verdict}</p>}
      {gaps.length > 0 && (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">Missing: </span>{gaps.join('; ')}
        </p>
      )}
      {improvements.length > 0 && (
        <p className="mt-0.5 text-[11px] leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-700">To close it: </span>{improvements.join('; ')}
        </p>
      )}
    </div>
  );
}

export default EvidenceQualityNote;
