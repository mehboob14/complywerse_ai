'use client';

/**
 * Reviewer action panel for the evidence detail page. A reviewer note textarea
 * plus Approve / Return-for-changes buttons. Presentational only — the parent
 * owns the note state and wires the existing reviewMutation to onApprove /
 * onReject.
 *
 * Charter: single teal brand (primary-*) for Approve, rose semantic tint for
 * Return, hairline borders, no gradients, lucide strokeWidth 1.75.
 */

import { CheckCircle, RotateCcw, Loader2 } from 'lucide-react';

export default function ReviewerActionPanel({
  note,
  onNoteChange,
  onApprove,
  onReject,
  isPending,
}: {
  note: string;
  onNoteChange: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
  isPending: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        <CheckCircle className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
        Reviewer decision
      </h3>
      <p className="mt-1 text-xs text-slate-500">
        Record a note, then approve this evidence or return it for changes.
      </p>

      <textarea
        value={note}
        onChange={(e) => onNoteChange(e.target.value)}
        rows={3}
        placeholder="Reviewer note (optional for approve, recommended when returning)…"
        className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
      />

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onReject}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          Return for changes
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
          ) : (
            <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.75} />
          )}
          Approve
        </button>
      </div>
    </div>
  );
}
