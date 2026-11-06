'use client';

// The controls that meet one obligation: confirmed ones, suggestions to decide,
// and a search to link any control by hand. SCF suggestions come from a keyword
// match (no model reads SCF text); the organisation's own controls are weighed
// by the model, which says why.

import { useEffect, useState } from 'react';
import { Check, Link2, Loader2, Search, X } from 'lucide-react';
import { regulatoryApi } from '@/lib/api';
import type { RegLink } from '../_ui';

export type { RegLink };
type Found = { type: string; id: number; ref: string; label: string; scf: boolean };

const SOURCE: Record<RegLink['source'], string> = { match: 'Keyword match', ai: 'AI', manual: 'Linked by hand' };

export default function ObligationControls({ obligationId, links, onChanged, onError }: {
  obligationId: number; links: RegLink[]; onChanged: () => void; onError: (e: unknown) => void;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [busy, setBusy] = useState<number | 'search' | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return; }
    const t = setTimeout(async () => {
      setBusy('search');
      try { setFound(((await regulatoryApi.searchControls(q.trim())).data?.items || []) as Found[]); }
      catch (e) { onError(e); } finally { setBusy(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (id: number, run: () => Promise<unknown>) => {
    setBusy(id);
    try { await run(); onChanged(); } catch (e) { onError(e); } finally { setBusy(null); }
  };
  const shown = links.filter((l) => l.status !== 'rejected');
  const linked = new Set(links.map((l) => `${l.target_type}:${l.target_id}`));

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Controls that meet it</p>
      {shown.length === 0 && <p className="text-xs text-slate-500">None yet. Search below to link one.</p>}
      {shown.map((l) => (
        <div key={l.id} className={`flex flex-wrap items-start gap-2 rounded-lg border px-2 py-1.5 text-xs ${
          l.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
          <span className="font-mono text-[11px] text-slate-700">{l.target_ref}</span>
          <span className="min-w-0 flex-1 text-slate-800">
            {l.target_label}
            <span className="ml-1.5 text-[10px] text-slate-500">
              {l.status === 'confirmed' ? `Confirmed${l.decided_by ? ` by ${l.decided_by}` : ''}` : `Suggested · ${SOURCE[l.source]}`}
            </span>
            {l.rationale && l.status === 'proposed' && <span className="block text-[11px] text-slate-600">{l.rationale}</span>}
          </span>
          {busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : l.status === 'proposed' ? (
            <span className="flex gap-1">
              <button type="button" onClick={() => act(l.id, () => regulatoryApi.decideLink(l.id, 'confirmed'))}
                className="inline-flex items-center gap-0.5 rounded border border-emerald-300 bg-white px-1.5 py-0.5 text-[11px] text-emerald-700">
                <Check className="h-3 w-3" /> Confirm
              </button>
              <button type="button" onClick={() => act(l.id, () => regulatoryApi.decideLink(l.id, 'rejected'))}
                className="inline-flex items-center gap-0.5 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600">
                <X className="h-3 w-3" /> Not this one
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => act(l.id, () => regulatoryApi.removeLink(l.id))} aria-label={`Unlink ${l.target_ref}`}
              className="text-slate-400 hover:text-rose-600"><X className="h-3.5 w-3.5" /></button>
          )}
        </div>
      ))}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Link a control: search by name or code"
          aria-label="Search controls" className="w-full rounded-md border border-slate-300 py-1 pl-7 pr-2 text-xs" />
        {busy === 'search' && <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {found.length > 0 && (
        <ul className="max-h-48 overflow-y-auto rounded-md border border-slate-200 bg-white">
          {found.map((c) => {
            const already = linked.has(`${c.type}:${c.id}`);
            return (
              <li key={`${c.type}:${c.id}`}>
                <button type="button" disabled={already}
                  onClick={() => act(c.id, async () => { await regulatoryApi.addLink(obligationId, { target_type: c.type, target_id: c.id }); setQ(''); })}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-slate-50 disabled:opacity-50">
                  <Link2 className="h-3 w-3 shrink-0 text-slate-400" />
                  <span className="font-mono text-[11px] text-slate-600">{c.ref}</span>
                  <span className="flex-1 truncate">{c.label}</span>
                  <span className="text-[10px] text-slate-400">{already ? 'linked' : c.type === 'internal_control' ? 'Internal control' : c.scf ? 'SCF' : 'Custom'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
