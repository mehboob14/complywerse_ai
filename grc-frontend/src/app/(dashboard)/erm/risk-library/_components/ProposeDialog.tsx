'use client';

// "Propose to owner": the risk team picks the unit and the risk owner for a library risk; the owner is told and drafts its score
// (or declines it) on the Proposals tab.

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { errorText } from '@/components/settings/CustomFields';
import { riskLibraryApi } from '../_lib/api';
import { proposeBody, proposeProblem, whereUsed, type LibraryRisk, type Proposal, type ProposeForm } from '../_lib/model';
import { AREA, BTN, BTN_PRIMARY, FIELD, LABEL } from './AddToRegisterDialog';

interface ProposeDialogProps {
  risk: LibraryRisk | null;
  /** the unit already picked (the Suggestions tab), as the address holds it */
  unitId?: string;
  onClose: () => void;
  onProposed: (p: Proposal) => void;
}

export default function ProposeDialog({ risk, unitId = '', onClose, onProposed }: ProposeDialogProps) {
  const [form, setForm] = useState<ProposeForm>({ business_unit_id: unitId, owner_id: '', note: '' });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setForm({ business_unit_id: unitId, owner_id: '', note: '' }); setError(null); }, [risk?.id, unitId]);

  const units = useQuery({ queryKey: ['risk-library-units'], queryFn: riskLibraryApi.units, staleTime: 60_000, enabled: !!risk });
  const people = useQuery({ queryKey: ['risk-library-people'], queryFn: riskLibraryApi.people, staleTime: 60_000, enabled: !!risk });
  const send = useMutation({
    mutationFn: () => riskLibraryApi.propose(risk!.id, proposeBody(form)),
    onSuccess: onProposed,
    onError: (e) => setError(errorText(e, 'Could not propose the risk.')),
  });
  if (!risk) return null;

  const blocked = proposeProblem(form);
  const set = (change: Partial<ProposeForm>) => { setError(null); setForm((f) => ({ ...f, ...change })); };
  const used = whereUsed(risk);

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="lg"
      title="Propose to owner"
      subtitle={`${risk.objective_id} · ${risk.objective_title}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span role="status" className="min-w-0 truncate text-[13px] text-[#9b1c1c]">{error || ''}</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" className={BTN} onClick={onClose}>Cancel</button>
            <button type="submit" form="risk-library-propose" className={BTN_PRIMARY} disabled={!!blocked || send.isPending} title={blocked || undefined}>
              {send.isPending ? 'Sending…' : 'Propose to owner'}
            </button>
          </div>
        </div>
      }
    >
      <form id="risk-library-propose" className="space-y-4 px-1 py-1"
        onSubmit={(e) => { e.preventDefault(); if (!blocked && !send.isPending) send.mutate(); }}>
        <div className="rounded-lg bg-[#e6f6f3] px-3 py-2">
          <p className="text-[14px] font-medium leading-5 text-[#115e59]">{risk.title}</p>
          <p className="mt-1 text-[13px] leading-5 text-[#115e59]">{risk.objective}</p>
        </div>
        {used.length > 0 && <p className="text-[13px] leading-5 text-[#586472]">Already used: {used.join(', ')}.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="rp-unit" className={LABEL}>Unit <span aria-hidden className="text-[#9b1c1c]">*</span></label>
            <select id="rp-unit" className={FIELD} value={form.business_unit_id} onChange={(e) => set({ business_unit_id: e.target.value })} required>
              <option value="">Choose a unit</option>
              {(units.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="rp-owner" className={LABEL}>Risk owner <span aria-hidden className="text-[#9b1c1c]">*</span></label>
            <select id="rp-owner" className={FIELD} value={form.owner_id} onChange={(e) => set({ owner_id: e.target.value })} required>
              <option value="">Choose a person</option>
              {(people.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="rp-note" className={LABEL}>Note to the owner</label>
          <textarea id="rp-note" rows={3} maxLength={2000} className={AREA} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </div>
      </form>
    </AnimatedModal>
  );
}
