'use client';

// Pick the SCF controls a custom control implements, by id or by name, instead
// of typing ids from memory. Names are shown as SCF publishes them.

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search, X } from 'lucide-react';
import { scfApi, type ScfControlHit } from '@/lib/api';

export function ScfControlPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(id);
  }, [term]);

  const resultsQ = useQuery({
    queryKey: ['scf-control-search', debounced],
    queryFn: async () => (await scfApi.searchControls({ q: debounced, limit: 25 })).data.items,
    enabled: open,
    staleTime: 60_000,
  });
  // Names for ids already chosen (an edit opens with ids only).
  const namesQ = useQuery({
    queryKey: ['scf-control-resolve', [...value].sort().join(',')],
    queryFn: async () => (await scfApi.searchControls({ ids: value })).data.items,
    enabled: value.length > 0,
    staleTime: 10 * 60_000,
  });
  const names = useMemo(() => {
    const out: Record<string, ScfControlHit> = {};
    for (const hit of [...(namesQ.data ?? []), ...(resultsQ.data ?? [])]) out[hit.scf_id] = hit;
    return out;
  }, [namesQ.data, resultsQ.data]);

  const chosen = new Set(value);
  const toggle = (id: string) => onChange(chosen.has(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={term}
            onChange={(e) => { setTerm(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            placeholder="Search SCF controls by id or name — e.g. IAC-17 or access review"
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-[12.5px] text-slate-700 focus:border-primary-500 focus:outline-none"
          />
        </div>
        {open && (
          <button type="button" onClick={() => { setOpen(false); setTerm(''); }}
            className="rounded-lg px-2 py-1.5 text-[12px] font-medium text-slate-500 hover:text-slate-800">
            Done
          </button>
        )}
      </div>

      {open && (
        <div className="max-h-56 overflow-y-auto border-b border-slate-100">
          {resultsQ.isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching the SCF catalogue…
            </div>
          ) : (resultsQ.data?.length ?? 0) === 0 ? (
            <p className="px-3 py-3 text-[12.5px] text-slate-400">No SCF control matches “{debounced}”.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {resultsQ.data?.map((hit) => {
                const on = chosen.has(hit.scf_id);
                return (
                  <li key={hit.scf_id}>
                    <button type="button" onClick={() => toggle(hit.scf_id)}
                      className={`flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 ${on ? 'bg-primary-50/60' : ''}`}>
                      <span className="mt-px w-16 shrink-0 font-mono text-[11.5px] font-semibold text-slate-600">{hit.scf_id}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-slate-800">{hit.name}</span>
                        {hit.domain && <span className="block truncate text-[11px] text-slate-400">{hit.domain}</span>}
                      </span>
                      {on && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="p-2">
        {value.length === 0 ? (
          <p className="px-1 py-1 text-[11.5px] leading-relaxed text-slate-400">
            None yet. Implementing an SCF control inherits its framework requirements, maturity criteria and deliverables.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {value.map((id) => (
              <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-slate-100 py-1 pl-2 pr-1 text-[11.5px] text-slate-700">
                <span className="font-mono font-semibold">{id}</span>
                {names[id]?.name && <span className="truncate text-slate-500">{names[id]?.name}</span>}
                <button type="button" onClick={() => toggle(id)} aria-label={`Remove ${id}`}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ScfControlPicker;
