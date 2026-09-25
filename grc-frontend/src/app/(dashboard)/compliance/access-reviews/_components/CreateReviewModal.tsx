'use client';
// src/app/(dashboard)/compliance/access-reviews/_components/CreateReviewModal.tsx
import { useState } from 'react';
import { X, Search } from 'lucide-react';
import { errorText, useConnectors, useCreateCampaign } from '../api';
import type { Campaign, RuleSelection } from '../types';
import { RulePicker, selectionReady, useRulesFor } from './RulePicker';

// These are the backend's own words (sampling.build_population / draw_sample).
// They used to be the UI's — 'privileged' fell through to "everyone" silently.
const SCOPES = [['user_access', 'All users'], ['privileged_access', 'Privileged only'], ['terminated_access', 'Terminated only']] as const;
const METHODS = [['random', 'Random'], ['risk_based', 'Risk-weighted'], ['full', 'Full population']] as const;
const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;

export function CreateReviewModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Campaign) => void }) {
  const create = useCreateCampaign();
  const [name, setName] = useState('Q3 2026 Privileged Access Review');
  const [scope, setScope] = useState<string>('privileged_access');
  const [method, setMethod] = useState<string>('risk_based');
  const [source, setSource] = useState<string>('');
  const [size, setSize] = useState(25);
  const [rules, setRules] = useState<RuleSelection>({ rule_scope: 'enabled' });
  const { rules: willRun } = useRulesFor(rules);
  const full = method === 'full';
  const connectors = useConnectors();
  const sources = connectors.data?.sources ?? [];

  const seg = (val: string, set: (v: string) => void, opts: readonly (readonly [string, string])[]) => (
    <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      {opts.map(([k, l]) => (
        <button key={k} onClick={() => set(k)} style={val === k ? ACCENT : undefined}
          className={`flex-1 rounded-md px-2.5 py-2 text-[12.5px] font-semibold ${val === k ? 'shadow-sm' : 'text-slate-500'}`}>{l}</button>
      ))}
    </div>
  );

  const submit = () =>
    create.mutate(
      { name, review_type: scope, sampling_method: method, source: source || null, requested_sample_size: size, ...rules },
      { onSuccess: (c) => onCreated(c) }
    );

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6">
      <div onClick={(e) => e.stopPropagation()} className="max-h-full w-[640px] max-w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <div className="text-base font-bold text-slate-900">New access review</div>
            <div className="mt-0.5 text-xs text-slate-400">Scope and sample the population to certify</div>
          </div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500"><X size={15} /></button>
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">Review name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] outline-none focus:border-[color:var(--color-base)] focus:ring-2 focus:ring-[color:var(--color-base-soft)]" />
          </div>
          <div><label className="mb-1.5 block text-xs font-semibold text-slate-600">Scope</label>{seg(scope, setScope, SCOPES)}</div>
          {sources.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Source</label>
              <select value={source} onChange={(e) => setSource(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13.5px] outline-none focus:border-[color:var(--color-base)]">
                <option value="">Every connected source</option>
                {sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <p className="mt-1 text-[11.5px] text-slate-400">Review one system on its own — its keys and accounts only.</p>
            </div>
          )}
          <div><label className="mb-1.5 block text-xs font-semibold text-slate-600">Sampling method</label>{seg(method, setMethod, METHODS)}</div>
          <div>
            <div className="mb-1.5 flex items-center justify-between"><label className="text-xs font-semibold text-slate-600">Sample size</label><span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--color-base-strong)' }}>{full ? 'all' : size}</span></div>
            <input type="range" min={5} max={67} value={size} disabled={full} onChange={(e) => setSize(+e.target.value)} className="w-full" style={{ accentColor: 'var(--color-base)' }} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">Rules to run</label>
            <RulePicker value={rules} onChange={setRules} />
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-4 py-3.5" style={{ background: 'var(--color-base-soft)' }}>
            <Search size={18} style={{ color: 'var(--color-base-strong)' }} />
            <div className="text-[12.5px] text-slate-700">
              <span className="font-semibold">{full ? 'All in-scope users' : `${size} of the in-scope population`}</span> will be drawn and frozen as a snapshot,
              then checked against <span className="font-semibold">{willRun.length} rule{willRun.length === 1 ? '' : 's'}</span>.
            </div>
          </div>
          {create.isError && (
            <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12.5px] text-rose-700">
              {errorText(create.error, 'The review could not be created.')}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={create.isPending || !selectionReady(rules, willRun.length)} style={ACCENT} className="rounded-md px-5 py-2 text-[13px] font-semibold shadow-sm disabled:opacity-60">
            {create.isPending ? 'Creating…' : 'Create review'}
          </button>
        </div>
      </div>
    </div>
  );
}
