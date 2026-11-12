'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ermApi } from '@/lib/api';
import { errorText } from '@/components/settings/CustomFields';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import type { LimitKRI } from './appetiteModel';

export interface PickUser { id: number; display_name: string; email: string }
export interface PickKRI { id: number; name: string }

const KRI_TONE: Record<string, string> = { red: 'bg-rose-500', amber: 'bg-amber-500', green: 'bg-emerald-500' };

interface LimitLinksProps {
  configId: number;
  category: string;
  concentrationLimit: number | null;
  escalationOwnerId: number | null;
  ownerName: string | null;
  limitKris: LimitKRI[];
  users: PickUser[];
  kris: PickKRI[];
  canEdit: boolean;
}

/** On a category card: who hears of a breach (the escalation owner), the KRIs that measure the limit (red = breach) and,
 *  for third party, the most critical or important vendors that may rely on one fourth party (over it = breach). */
export default function LimitLinks({ configId, category, concentrationLimit, escalationOwnerId, ownerName, limitKris, users, kris, canEdit }: LimitLinksProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [concentration, setConcentration] = useState<string | null>(null);
  const settle = {
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['appetite-configs-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['appetite-breach-log'] });
    },
    onError: (e: unknown) => setError(errorText(e, 'Could not save.')),
  };
  const setOwner = useMutation({ mutationFn: (id: number | null) => ermApi.appetite.update(configId, { escalation_owner_id: id }), ...settle });
  const setKris = useMutation({ mutationFn: (ids: number[]) => ermApi.appetite.setLimitKris(configId, ids), ...settle });
  const setLimit = useMutation({
    mutationFn: (n: number | null) => ermApi.appetite.update(configId, { concentration_limit: n }),
    ...settle, onSuccess: () => { settle.onSuccess(); setConcentration(null); },
  });
  const typed = concentration === null ? null : concentration.trim() === '' ? null : Number(concentration);

  return (
    <div className="space-y-2 border-t border-slate-200 pt-2">
      <div>
        <span className="mb-1 block text-xs text-slate-600">Escalation owner</span>
        {canEdit ? (
          <MultiSelectDropdown title="Escalation owner" multiSelect={false} autoApply forceSearch showAvatars triggerVariant="input"
            triggerClassName="w-full" size="sm" placeholder="Not assigned" disabled={setOwner.isPending}
            items={users.map((u) => ({ value: String(u.id), label: u.display_name || u.email, subLabel: u.email }))}
            selectedValues={escalationOwnerId ? [String(escalationOwnerId)] : []}
            onApply={(values) => setOwner.mutate(values[0] ? Number(values[0]) : null)} />
        ) : <span className="text-sm text-slate-800">{ownerName || 'Not assigned'}</span>}
      </div>
      <div>
        <span className="mb-1 block text-xs text-slate-600">Limit KRIs</span>
        {limitKris.length > 0 && (
          <ul className="mb-1 space-y-0.5">
            {limitKris.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                <span className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 rounded-full', KRI_TONE[k.status] || 'bg-slate-300')} aria-hidden />{k.name}</span>
                <span className="text-slate-500">{k.current_value ?? '—'} <span className="sr-only">status {k.status}</span></span>
              </li>
            ))}
          </ul>
        )}
        {canEdit ? (
          <MultiSelectDropdown title="Limit KRIs" triggerVariant="input" triggerClassName="w-full" size="sm"
            placeholder={limitKris.length ? 'Change KRIs' : 'Link KRIs'} disabled={setKris.isPending}
            items={kris.map((k) => ({ value: String(k.id), label: k.name }))}
            selectedValues={limitKris.map((k) => String(k.id))}
            onApply={(values) => setKris.mutate(values.map(Number))} />
        ) : limitKris.length === 0 && <span className="text-sm text-slate-500">None linked</span>}
      </div>
      {category === 'third_party' && (
        <div>
          <label htmlFor={`concentration-${configId}`} className="mb-1 block text-xs text-slate-600">Concentration limit (critical or important vendors on one fourth party)</label>
          {canEdit ? (
            <div className="flex gap-1.5">
              <input id={`concentration-${configId}`} type="number" min={1} max={1000} placeholder="No limit"
                value={concentration ?? (concentrationLimit ?? '')} onChange={(e) => setConcentration(e.target.value)}
                className="w-24 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-primary-500 focus:outline-none" />
              {concentration !== null && (
                <button type="button" disabled={setLimit.isPending || (typed !== null && !(Number.isInteger(typed) && typed >= 1 && typed <= 1000))}
                  onClick={() => setLimit.mutate(typed)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  Save
                </button>
              )}
            </div>
          ) : <span className="text-sm text-slate-800">{concentrationLimit ?? 'No limit'}</span>}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
