'use client';

// The KRI page's "Values to check" and "Values due" tabs (wave 2-F): the checker's queue and the provider's due list.
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Bell, Loader2 } from 'lucide-react';
import { ermApi, type KRIDueValue, type KRIPendingValue } from '@/lib/api';
import { changeFromLast, dueText } from './_kriModel';

export const KRI_STATUS_COLORS = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-rose-500',
  unknown: 'bg-slate-400',
};

export function errorText(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === 'string' ? detail : fallback;
}

export function ValuesToCheck({
  items,
  nameOf,
  canEdit,
  onChanged,
}: {
  items: KRIPendingValue[];
  nameOf: (id?: number | null) => string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
        No values waiting for your check.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Indicator</th>
            <th className="px-4 py-2">Value</th>
            <th className="px-4 py-2">Change from last</th>
            <th className="px-4 py-2">Source</th>
            <th className="px-4 py-2">Submitted by</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((item) => (
            <PendingValueRow key={item.measurement_id} item={item} nameOf={nameOf} canEdit={canEdit} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PendingValueRow({
  item,
  nameOf,
  canEdit,
  onChanged,
}: {
  item: KRIPendingValue;
  nameOf: (id?: number | null) => string | null;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (approve: boolean) =>
      approve ? ermApi.kris.approveValue(item.measurement_id) : ermApi.kris.rejectValue(item.measurement_id),
    onSuccess: () => { setError(null); onChanged(); },
    onError: (e) => setError(errorText(e, 'Could not record your check')),   // the maker is told why (409)
  });
  const change = changeFromLast(item.value, item.previous_value);
  const statusColor = KRI_STATUS_COLORS[(item.status as keyof typeof KRI_STATUS_COLORS) || 'unknown'] || KRI_STATUS_COLORS.unknown;
  return (
    <tr className="hover:bg-slate-50 align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-slate-900">{item.kri_name}</div>
        {item.period_label && <div className="text-[11px] text-slate-500">{item.period_label}</div>}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-slate-900">
          <span className={`h-2 w-2 rounded-full ${statusColor}`} />
          {item.value}{item.unit || ''}
        </span>
      </td>
      <td className="px-4 py-3 text-slate-700">
        {change === null ? 'First value' : `${change > 0 ? '+' : ''}${change}${item.unit || ''} (was ${item.previous_value}${item.unit || ''})`}
      </td>
      <td className="px-4 py-3 text-slate-700">
        <div>{item.data_source || '—'}</div>
        {item.notes && <div className="text-[11px] text-slate-500 whitespace-pre-line">{item.notes}</div>}
      </td>
      <td className="px-4 py-3 text-slate-700">
        <div>{nameOf(item.measured_by) || '—'}</div>
        {item.measured_at && <div className="text-[11px] text-slate-500">{new Date(item.measured_at).toLocaleDateString()}</div>}
      </td>
      <td className="px-4 py-3">
        {canEdit && (
          <div className="flex justify-end gap-2">
            <button
              onClick={() => review.mutate(true)}
              disabled={review.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={() => review.mutate(false)}
              disabled={review.isPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        )}
        {error && <p className="mt-2 max-w-xs text-right text-xs text-rose-700">{error}</p>}
      </td>
    </tr>
  );
}

export function ValuesDue({
  items,
  nameOf,
  canEdit,
  onSubmit,
  onRemind,
  reminding,
}: {
  items: KRIDueValue[];
  nameOf: (id?: number | null) => string | null;
  canEdit: boolean;
  onSubmit: (item: KRIDueValue) => void;
  onRemind: () => void;
  reminding: boolean;
}) {
  return (
    <div className="space-y-3">
      {canEdit && items.some((d) => d.overdue && !d.pending_review) && (
        <div className="flex justify-end">
          <button
            onClick={onRemind}
            disabled={reminding}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {reminding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Remind providers of overdue values
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-600">
          No values due this week.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Indicator</th>
                <th className="px-4 py-2">Data provider</th>
                <th className="px-4 py-2">Due</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{d.name}</div>
                    <div className="text-[11px] text-slate-500">{d.frequency}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{nameOf(d.data_provider_id) || nameOf(d.owner_id) || '—'}</td>
                  <td className="px-4 py-3">
                    <div className={d.overdue ? 'text-rose-600' : 'text-slate-800'}>{dueText(d.next_due_date)}</div>
                    <div className="text-[11px] text-slate-500">{new Date(d.next_due_date).toLocaleDateString()}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.pending_review ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border bg-blue-50 text-blue-700 border-blue-200">
                        Submitted · awaiting check
                      </span>
                    ) : canEdit && (
                      <button
                        onClick={() => onSubmit(d)}
                        className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                      >
                        Submit value
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
