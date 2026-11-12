'use client';

// "Suggested for a unit": the library risks that fit what a unit already does (requirements the organisation has adopted, the
// categories the unit records), not yet in its register, best first and each with why.

import { useQuery } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { riskLibraryApi } from '../_lib/api';
import { proposedText, type LibraryRisk } from '../_lib/model';

const SELECT = 'mt-1 h-9 w-full rounded-lg border border-[#c9d1d9] bg-[#ffffff] px-2.5 text-[13px] text-[#1f2933] focus:border-[#0f766e] focus:outline-none focus:ring-2 focus:ring-[#0f766e]/30';

interface SuggestionsProps {
  unit: string;
  framework?: string;
  onUnit: (unit: string) => void;
  mayPropose: boolean;
  onPropose: (risk: LibraryRisk) => void;
}

export default function Suggestions({ unit, framework, onUnit, mayPropose, onPropose }: SuggestionsProps) {
  const units = useQuery({ queryKey: ['risk-library-units'], queryFn: riskLibraryApi.units, staleTime: 60_000 });
  const list = useQuery({
    queryKey: ['risk-library', 'suggestions', unit, framework], enabled: !!unit,
    queryFn: () => riskLibraryApi.suggestions(Number(unit), framework),
  });

  return (
    <div className="space-y-3">
      <div className="max-w-sm rounded-xl border border-[#d8dee4] bg-[#ffffff] p-3">
        <label htmlFor="rl-unit" className="block text-[12px] font-medium text-[#586472]">Unit</label>
        <select id="rl-unit" className={SELECT} value={unit} onChange={(e) => onUnit(e.target.value)}>
          <option value="">Choose a unit</option>
          {(units.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </div>
      <section aria-live="polite" className="overflow-hidden rounded-xl border border-[#d8dee4] bg-[#ffffff]">
        {!unit ? (
          <p className="px-4 py-10 text-center text-[14px] text-[#586472]">Choose a unit to see the library risks that fit it.</p>
        ) : list.isLoading ? (
          <p className="px-4 py-10 text-center text-[14px] text-[#586472]">Loading…</p>
        ) : list.isError ? (
          <p className="px-4 py-10 text-center text-[14px] text-[#9b1c1c]">The suggestions could not be loaded.</p>
        ) : !list.data?.items.length ? (
          <p className="px-4 py-10 text-center text-[14px] text-[#586472]">
            Nothing to suggest for this unit: no adopted requirement or recorded category matches a library risk it does not have.
          </p>
        ) : (
          <ul className="divide-y divide-[#eef1f4]">
            {list.data.items.map((r) => {
              const proposed = proposedText(r);
              return (
                <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium leading-5 text-[#1f2933]">{r.title}</p>
                    <p className="text-[12px] leading-4 text-[#586472]"><span className="font-medium">{r.objective_id}</span> {r.objective_title}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Why it is suggested">
                      {r.reasons.map((why) => (
                        <li key={why} className="rounded-full bg-[#e6f6f3] px-2.5 py-0.5 text-[12px] leading-5 text-[#115e59]">{why}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {proposed && <span className="inline-flex h-7 items-center rounded-full bg-[#fef3c7] px-2.5 text-[12px] font-medium text-[#92400e]">{proposed}</span>}
                    {mayPropose && !proposed && (
                      <button type="button" onClick={() => onPropose(r)}
                        className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-lg bg-[#0f766e] px-3 text-[13px] font-medium text-[#ffffff] hover:bg-[#115e59] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                        <Send aria-hidden className="h-3.5 w-3.5" /> Propose to owner
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {!!list.data && list.data.total > list.data.items.length && (
        <p className="text-[13px] text-[#586472]">Showing the best {list.data.items.length} of {list.data.total}.</p>
      )}
    </div>
  );
}
