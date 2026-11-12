'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, UserCheck } from 'lucide-react';
import { ermApi, tenantApi } from '@/lib/api';
import { apiErrorText } from '@/lib/apiError';

interface TenantUserOption {
  id: number;
  display_name: string;
}

interface ReassignReviewerProps {
  reviewId: number;
  reviewerId?: number | null;
  onDone: () => void;
}

const INPUT = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500';

/** An approver hands a review not yet submitted to someone else; the server keeps it in the audit log and tells them. */
export default function ReassignReviewer({ reviewId, reviewerId, onDone }: ReassignReviewerProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  const { data: users } = useQuery({
    queryKey: ['erm-reviews-tenant-users'],      // the page's own list, so it comes from the cache
    queryFn: async () => ((await tenantApi.getTenantUsers()).data || []) as TenantUserOption[],
    enabled: open,
  });

  const reassign = useMutation({
    mutationFn: () => ermApi.reviews.reassign(reviewId, Number(to), note.trim() || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-reviews'] });
      onDone();
    },
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-sm text-primary-700 hover:underline">
        <UserCheck className="h-4 w-4" />
        Reassign reviewer
      </button>
    );
  }

  return (
    <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Reassign reviewer</h3>
      <select aria-label="New reviewer" value={to} onChange={(e) => setTo(e.target.value)} className={INPUT}>
        <option value="">Choose the new reviewer</option>
        {(users || []).filter((u) => u.id !== reviewerId).map((u) => (
          <option key={u.id} value={u.id}>{u.display_name}</option>
        ))}
      </select>
      <input
        type="text"
        aria-label="Why it is reassigned"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why (optional), e.g. the reviewer is on leave"
        className={INPUT}
      />
      {reassign.isError && (
        <p className="text-sm text-rose-700">{apiErrorText(reassign.error, 'The review could not be reassigned.')}</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => reassign.mutate()}
          disabled={!to || reassign.isPending}
          className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {reassign.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Reassign
        </button>
      </div>
    </section>
  );
}
