'use client';

// The Register's toolbar: a search box, a pill per filter (each reads "Label: value" and lives in the address), "Clear filters", the
// Archived view, and on the right what the old register had beside them. The pills are the kit's FilterFacet; the page owns the
// address, this only turns a pick into a patch.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, Search } from 'lucide-react';
import { ClearFilters, FilterFacet, ToggleChip, tierLabel } from '../../_ui';
import type { ParamPatch } from '../../_ui/urlParams';
import { ATTENTION } from '../../_lib/attention';
import { CLEAR_FILTERS, TIERS, filterPatch, hasFilters, type RegisterState } from '../../_lib/registerModel';

type Option = { value: string; label: string };

export interface FacetOptions {
  statuses: Option[];
  types: Option[];
  owners: Option[];
  units: Option[];
}

/** The text box: what is typed shows at once, the address (and so the list) follows a moment after the last key. */
function SearchBox({ value, onCommit }: { value: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value);
  const written = useRef(value);                              // the last text this box put in the address
  useEffect(() => {
    if (value !== written.current) { written.current = value; setText(value); }       // a change from outside (Clear filters, Back)
  }, [value]);
  useEffect(() => {
    const next = text.trim();
    if (next === written.current) return undefined;
    const timer = setTimeout(() => { written.current = next; onCommit(next); }, 300);
    return () => clearTimeout(timer);
  }, [text, onCommit]);
  return (
    <label className="relative block w-full sm:w-72">
      <span className="sr-only">Search vendors</span>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64707e]" />
      <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search vendors"
        className="h-9 w-full rounded-lg border border-[#c3ccd5] bg-[#fff] pl-9 pr-3 text-sm text-[#1f2933] placeholder:text-[#64707e] focus:border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]/30" />
    </label>
  );
}

export default function Toolbar({ state, options, onChange, right }: {
  state: RegisterState;
  options: FacetOptions;
  /** writes the address */
  onChange: (patch: ParamPatch) => void;
  /** the buttons at the end of the row (Settings, Import) */
  right?: ReactNode;
}) {
  const set = (change: Parameters<typeof filterPatch>[0]) => onChange(filterPatch(change));
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SearchBox value={state.q} onCommit={(q) => onChange(filterPatch({ q }))} />
      <FilterFacet label="Needs attention" options={ATTENTION.map((a) => ({ value: a.code, label: a.label }))} selected={state.attention} onChange={(attention) => set({ attention })} />
      <FilterFacet label="Tier" options={TIERS.map((t) => ({ value: t, label: tierLabel(t) }))} selected={state.tier} onChange={(tier) => set({ tier })} />
      <FilterFacet label="Status" options={options.statuses} selected={state.status} onChange={(status) => set({ status })} />
      <FilterFacet label="Type" single options={options.types} selected={state.type ? [state.type] : []} onChange={(next) => set({ type: next[0] ?? null })} />
      <FilterFacet label="Business owner" single options={options.owners} selected={state.owner ? [state.owner] : []} onChange={(next) => set({ owner: next[0] ?? null })} />
      <FilterFacet label="Data" options={[{ value: 'pii', label: 'Holds personal data' }]} selected={state.pii ? ['pii'] : []} onChange={(next) => set({ pii: next.length > 0 })} />
      {options.units.length > 0 && (
        <FilterFacet label="Business unit" options={options.units} selected={state.unit} onChange={(unit) => set({ unit })} />
      )}
      <ToggleChip on={state.archived} onClick={() => set({ archived: !state.archived })}>
        <Archive aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
        Archived
      </ToggleChip>
      <ClearFilters visible={hasFilters(state)} onClick={() => onChange(CLEAR_FILTERS)} />
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
