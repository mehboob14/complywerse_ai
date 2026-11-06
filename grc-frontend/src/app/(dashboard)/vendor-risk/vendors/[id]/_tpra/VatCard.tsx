'use client';

// An EU vendor's VAT number, checked live with the European Commission's VIES: whether it is registered, and to which name and address.
// Drawn inside a panel of the Overview (its title and note are the panel's).

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { BadgeCheck, Loader2, XCircle } from 'lucide-react';
import { vendorLeaksApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN, TONE, fmt } from '../../../_ui';
import { FIELD } from '../../_components/formStyles';

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
  const tone = check?.valid ? TONE.success : TONE.danger;
  return (
    <div>
      {canEdit && (
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); run.mutate(); }}>
          <input id="vendor-vat-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="DE123456789" aria-label="VAT number"
            className={`${FIELD} w-56 uppercase`} />
          <button type="submit" disabled={run.isPending || value.trim().length < 4} className={BTN}>
            {run.isPending && <Loader2 aria-hidden className="h-4 w-4 animate-spin" />} Check with VIES
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] leading-5 text-[#c01741]">{error}</p>}
      {check ? (
        <div className="mt-3 rounded-lg border px-3 py-2.5" style={{ background: tone.tint, borderColor: tone.border }}>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold leading-5" style={{ color: tone.text }}>
            {check.valid ? <BadgeCheck aria-hidden className="h-4 w-4" /> : <XCircle aria-hidden className="h-4 w-4" />}
            {vatNumber} is {check.valid ? 'registered' : 'not registered'}
          </p>
          {check.name && <p className="mt-0.5 text-[13px] leading-5 text-[#26323d]">Registered to {check.name}{check.address ? `, ${check.address}` : ''}</p>}
          {check.name_matches === false && (
            <p className="mt-0.5 text-[13px] font-medium leading-5" style={{ color: TONE.warning.text }}>That is not this vendor&apos;s name: check it is the right company.</p>
          )}
          <p className="mt-0.5 text-[12px] leading-4 text-[#64707e]">Checked {fmt.date(check.checked_at)}</p>
        </div>
      ) : !canEdit && <p className="text-[13px] leading-5 text-[#64707e]">Not checked yet.</p>}
    </div>
  );
}
