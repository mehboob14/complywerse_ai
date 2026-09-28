'use client';

// An EU supplier's VAT number, checked live with the European Commission's VIES:
// whether it is registered, and to which name and address.

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { BadgeCheck, Loader2, XCircle } from 'lucide-react';
import { vendorLeaksApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';

interface Check { valid: boolean; name: string | null; address: string | null; checked_at: string; name_matches?: boolean | null }

export default function VatCard({ vendorId, vatNumber, check, onChecked }: {
  vendorId: number; vatNumber: string | null; check: Check | null; onChecked: () => void;
}) {
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit');
  const [value, setValue] = useState(vatNumber || '');
  const [error, setError] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () => vendorLeaksApi.checkVat(vendorId, value),
    onSuccess: () => { setError(null); onChecked(); },
    onError: (e) => setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'VIES could not be asked.'),
  });
  return (
    <div className="col-span-full rounded-xl border border-gray-200 bg-white p-3 sm:p-4">
      <h3 className="text-sm font-semibold text-slate-900">EU VAT registration</h3>
      <p className="mb-2 text-xs text-slate-500">Checked live with the European Commission&apos;s VIES when you ask.</p>
      {canEdit && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. DE123456789" aria-label="VAT number"
            className="w-56 rounded-lg border border-slate-300 px-3 py-1.5 text-sm uppercase focus:border-primary-500 focus:outline-none" />
          <button type="submit" disabled={run.isPending || value.trim().length < 4}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {run.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Check with VIES
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
      {check && (
        <div className={clsx('mt-3 rounded-lg px-3 py-2 text-sm', check.valid ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900')}>
          <p className="flex items-center gap-1.5 font-medium">
            {check.valid ? <BadgeCheck className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {vatNumber} is {check.valid ? 'registered' : 'not registered'}
          </p>
          {check.name && <p className="mt-0.5 text-xs">Registered to {check.name}{check.address ? `, ${check.address}` : ''}</p>}
          {check.name_matches === false && (
            <p className="mt-0.5 text-xs font-medium text-amber-800">That is not this supplier&apos;s name: check it is the right company.</p>
          )}
          <p className="mt-0.5 text-[11px] opacity-70">Checked {new Date(check.checked_at).toLocaleString('en-GB')}</p>
        </div>
      )}
    </div>
  );
}
