'use client';

// "Link Framework Control" on a risk's Controls tab: pick one or more controls of a framework this organisation has installed
// (the UAE IA Standard, ISO 27001, ...) and say how well they mitigate the risk. Saved through /erm/risks/{id}/framework-requirements.

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { risksApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { errorText } from '@/components/settings/CustomFields';

const EFFECTIVENESS = [
  { value: 'full', label: 'Full' }, { value: 'partial', label: 'Partial' }, { value: 'minimal', label: 'Minimal' }, { value: 'none', label: 'None' },
];

const versionText = (v?: string | null) => (v ? ` ${/^v/i.test(v) ? v : `v${v}`}` : '');

export default function LinkFrameworkRequirementModal({ isOpen, riskId, linkedControlIds, preferredFrameworkId, onClose, onLinked }: {
  isOpen: boolean;
  riskId: number;
  /** ParsedFrameworkControl ids the risk already has (they are not offered again). */
  linkedControlIds: number[];
  /** The framework to start on: the one the risk is already linked to (the first one when absent or not installed). */
  preferredFrameworkId?: number | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [frameworkId, setFrameworkId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<number[]>([]);
  const [effectiveness, setEffectiveness] = useState('partial');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  // start clean each time it opens
  useEffect(() => { if (isOpen) { setPicked([]); setText(''); setSearch(''); setNotes(''); setEffectiveness('partial'); setError(null); setFrameworkId(null); } }, [isOpen]);
  useEffect(() => { const t = setTimeout(() => setSearch(text.trim()), 250); return () => clearTimeout(t); }, [text]);

  const frameworks = useQuery({
    queryKey: ['risk-requirement-frameworks'], enabled: isOpen, staleTime: 60_000,
    queryFn: async () => (await risksApi.requirementFrameworks()).data.items,
  });
  const preferred = frameworks.data?.find((f) => f.id === preferredFrameworkId)?.id;
  const chosen = frameworkId ?? preferred ?? frameworks.data?.[0]?.id ?? null;
  const controls = useQuery({
    queryKey: ['risk-requirement-controls', chosen, search], enabled: isOpen && chosen !== null,
    queryFn: async () => (await risksApi.searchRequirements({ framework_id: chosen as number, q: search || undefined, limit: 100 })).data,
  });
  const offered = (controls.data?.items || []).filter((c) => !linkedControlIds.includes(c.id));

  const link = useMutation({
    mutationFn: () => risksApi.linkRequirements(riskId, {
      framework_id: chosen as number, control_ids: picked, mitigation_effectiveness: effectiveness, notes: notes.trim() || undefined,
    }),
    onSuccess: () => onLinked(),
    onError: (e) => setError(errorText(e, 'Could not link the controls.')),
  });

  const toggle = (id: number) => { setError(null); setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };

  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Link Framework Control" subtitle="Controls of the frameworks your organisation has installed">
      <div className="space-y-4">
        {frameworks.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading frameworks…</p>
        ) : !frameworks.data?.length ? (
          <p className="py-4 text-center text-slate-600">No framework with controls is installed for your organisation.</p>
        ) : (
          <>
            <div>
              <label htmlFor="lfr-framework" className="mb-2 block text-sm text-slate-600">Framework</label>
              <select id="lfr-framework" value={chosen ?? ''} onChange={(e) => { setFrameworkId(Number(e.target.value)); setPicked([]); }}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none">
                {frameworks.data.map((f) => <option key={f.id} value={f.id}>{f.name}{versionText(f.version)} ({f.controls})</option>)}
              </select>
            </div>
            <input type="text" placeholder="Search by id, title or domain..." aria-label="Search framework controls" value={text} onChange={(e) => setText(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none" />

            <div className="max-h-72 space-y-1 overflow-y-auto">
              {controls.isLoading ? (
                <p className="py-4 text-center text-slate-600">Loading…</p>
              ) : offered.length === 0 ? (
                <p className="py-4 text-center text-slate-600">{search ? 'No controls found' : 'Every control is already linked'}</p>
              ) : offered.map((c) => (
                <label key={c.id} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${picked.includes(c.id) ? 'border-primary-500 bg-primary-50' : 'border-transparent bg-white hover:bg-slate-100'}`}>
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="min-w-0">
                    <span className="text-sm font-medium text-primary-600">{c.code}</span>
                    <span className="block text-slate-900">{c.title}</span>
                    {c.domain && <span className="block text-xs text-slate-500">{c.domain}</span>}
                  </span>
                </label>
              ))}
              {(controls.data?.total || 0) > (controls.data?.items.length || 0) && (
                <p className="pt-1 text-center text-xs text-slate-500">Showing the first {controls.data?.items.length} of {controls.data?.total}. Search to narrow it down.</p>
              )}
            </div>

            {picked.length > 0 && (
              <>
                <div>
                  <label htmlFor="lfr-eff" className="mb-2 block text-sm text-slate-600">Mitigation effectiveness</label>
                  <select id="lfr-eff" value={effectiveness} onChange={(e) => setEffectiveness(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none">
                    {EFFECTIVENESS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="lfr-notes" className="mb-2 block text-sm text-slate-600">Notes (optional)</label>
                  <textarea id="lfr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add notes about these controls..."
                    className="h-20 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none" />
                </div>
              </>
            )}
          </>
        )}

        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-slate-100 px-4 py-2 text-slate-900 hover:bg-slate-200">Cancel</button>
          <button type="button" onClick={() => link.mutate()} disabled={!picked.length || chosen === null || link.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50">
            {link.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {picked.length > 1 ? `Link ${picked.length} controls` : 'Link control'}
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );
}
