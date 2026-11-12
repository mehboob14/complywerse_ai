'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { errorText } from '@/components/settings/CustomFields';
import { limitChangeLines, limitsSourceText, type LimitChange as Change, type LimitsSource } from './appetiteModel';
import type { PickUser } from './LimitLinks';

interface LimitChangeProps {
  configId: number;
  inForce: Record<string, unknown>;
  change: Change | null | undefined;
  source: LimitsSource | null | undefined;
  users: PickUser[];
  canEdit: boolean;
}

/**
 * On a category card: which approved version its limits in force come from, and a limit change waiting for a second
 * person (Approve / Send back show to appetite editors; the server refuses the proposer and says so).
 */
export default function LimitChange({ configId, inForce, change, source, users, canEdit }: LimitChangeProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const decide = useMutation({
    mutationFn: (approve: boolean): Promise<unknown> => (approve ? ermApi.appetite.approveLimitChange(configId, note.trim() || undefined)
      : ermApi.appetite.rejectLimitChange(configId, note.trim())),
    onSuccess: () => {
      setError(null); setNote('');
      ['appetite-configs-with-stats', 'appetite-breach-log', 'appetite-breaches'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    },
    onError: (e: unknown) => setError(errorText(e, 'Could not record your decision.')),
  });
  const nameOf = (id: number) => users.find((u) => u.id === id)?.display_name || `User #${id}`;

  return (
    <div className="space-y-1.5 border-t border-slate-200 pt-2 text-xs">
      <p className="text-slate-500">{limitsSourceText(source)}</p>
      {change?.status === 'rejected' && (
        <p className="text-slate-500">Last change sent back by {change.decided_by_name || '—'}{change.note ? `: ${change.note}` : ''}</p>
      )}
      {change?.status === 'pending' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-2" role="status">
          <p className="font-medium text-amber-800">Limit change waiting for approval</p>
          <ul className="mt-1 space-y-0.5 text-slate-700">
            {limitChangeLines(inForce, change.changes, nameOf).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="mt-1 text-slate-500">Proposed by {change.proposed_by_name || '—'}. The approved limits stay in force until then.</p>
          {canEdit && (
            <div className="mt-1.5 space-y-1.5">
              <label htmlFor={`limit-note-${configId}`} className="sr-only">Decision note</label>
              <input id={`limit-note-${configId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (needed to send it back)"
                className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-900 focus:border-primary-500 focus:outline-none" />
              <div className="flex justify-end gap-2">
                <button type="button" disabled={decide.isPending || !note.trim()} onClick={() => decide.mutate(false)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Send back
                </button>
                <button type="button" disabled={decide.isPending} onClick={() => decide.mutate(true)}
                  className="inline-flex items-center gap-1 rounded-md bg-primary-500 px-2 py-1 font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
                  {decide.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Approve
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-rose-700">{error}</p>}
    </div>
  );
}
