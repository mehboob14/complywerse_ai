'use client';

// On a KRI card (wave 5): a threshold change waiting for a second person's decision, and a KRI that measures no risk yet.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link2, Loader2 } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { errorText } from './_KriValueTabs';
import { thresholdChangeLines, type ThresholdChange } from './_kriModel';

interface InForce {
  id: number;
  green_threshold?: number | null;
  amber_threshold?: number | null;
  threshold_direction?: string | null;
  threshold_change?: ThresholdChange | null;
}

/**
 * The approved thresholds stay in force while a change waits. Approve / Send back show to KRI editors; the server refuses
 * the proposer and the message says so.
 */
export function ThresholdChangeNotice({ kri, canEdit, nameOf, onChanged }: {
  kri: InForce;
  canEdit: boolean;
  nameOf: (id?: number | null) => string | null;
  onChanged: () => void;
}) {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      approve ? ermApi.kris.approveThresholds(kri.id, note.trim() || undefined) : ermApi.kris.rejectThresholds(kri.id, note.trim()),
    onSuccess: () => { setError(null); setNote(''); onChanged(); },
    onError: (e) => setError(errorText(e, 'Could not record your decision')),
  });
  const change = kri.threshold_change;
  if (!change || change.status === 'approved') return null;
  if (change.status === 'rejected') {
    return (
      <p className="mt-3 text-xs text-slate-500">
        Threshold change sent back by {nameOf(change.decided_by) || '—'}{change.note ? `: ${change.note}` : ''}
      </p>
    );
  }
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs" role="status">
      <p className="font-medium text-amber-800">Threshold change waiting for approval</p>
      <ul className="mt-1 space-y-0.5 text-slate-700">
        {thresholdChangeLines(kri, change).map((line) => <li key={line}>{line}</li>)}
      </ul>
      <p className="mt-1 text-slate-500">Proposed by {nameOf(change.proposed_by) || '—'}. The approved thresholds stay in force until then.</p>
      {canEdit && (
        <div className="mt-2 space-y-1.5">
          <label htmlFor={`kri-threshold-note-${kri.id}`} className="sr-only">Decision note</label>
          <input id={`kri-threshold-note-${kri.id}`} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Note (needed to send it back)"
            className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-primary-500 focus:outline-none" />
          <div className="flex justify-end gap-2">
            <button type="button" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate(false)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              Send back
            </button>
            <button type="button" disabled={decide.isPending} onClick={() => decide.mutate(true)}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              {decide.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Approve
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-1.5 text-rose-700">{error}</p>}
    </div>
  );
}

/** A KRI linked to no risk: kept on the list (an early upload had no risk) so it can be linked from Edit. */
export function NeedsRisk({ onLink, canEdit }: { onLink: () => void; canEdit: boolean }) {
  const badge = 'mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium bg-orange-50 text-orange-700 border-orange-200';
  return canEdit ? (
    <button type="button" onClick={onLink} className={`${badge} hover:bg-orange-100`} title="Link the risk this indicator measures">
      <Link2 className="h-3 w-3" /> Needs a risk
    </button>
  ) : <span className={badge}>Needs a risk</span>;
}

export function NeedsRiskSummary({ count }: { count: number }) {
  if (!count) return null;
  return (
    <p className="rounded-lg border border-orange-200 bg-orange-50/50 px-3 py-2 text-xs text-orange-800">
      {count} indicator{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} a risk: link each to the risk it measures with Edit.
    </p>
  );
}
