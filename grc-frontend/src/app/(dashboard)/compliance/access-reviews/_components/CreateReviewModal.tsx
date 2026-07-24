'use client';
// src/app/(dashboard)/compliance/access-reviews/_components/CreateReviewModal.tsx
import { useState } from 'react';
import { X, Search } from 'lucide-react';
import { useCreateCampaign } from '../api';
import type { Campaign } from '../types';

const SCOPES = [['all', 'All users'], ['privileged', 'Privileged only'], ['terminated', 'Terminated only']] as const;
const METHODS = [['random', 'Random'], ['risk', 'Risk-weighted'], ['full', 'Full population']] as const;
const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;

export function CreateReviewModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Campaign) => void }) {
  const create = useCreateCampaign();
  const [name, setName] = useState('Q3 2026 Privileged Access Review');
  const [scope, setScope] = useState<string>('privileged');
  const [method, setMethod] = useState<string>('risk');
  const [size, setSize] = useState(25);
  const full = method === 'full';

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
      { name, review_type: scope, sampling_method: method, requested_sample_size: full ? 0 : size },
      { onSuccess: (c) => onCreated(c) }
    );

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6">
      <div onClick={(e) => e.stopPropagation()} className="max-h-full w-[560px] max-w-full overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
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
          <div><label className="mb-1.5 block text-xs font-semibold text-slate-600">Sampling method</label>{seg(method, setMethod, METHODS)}</div>
          <div>
            <div className="mb-1.5 flex items-center justify-between"><label className="text-xs font-semibold text-slate-600">Sample size</label><span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--color-base-strong)' }}>{full ? 'all' : size}</span></div>
            <input type="range" min={5} max={67} value={size} disabled={full} onChange={(e) => setSize(+e.target.value)} className="w-full" style={{ accentColor: 'var(--color-base)' }} />
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-4 py-3.5" style={{ background: 'var(--color-base-soft)' }}>
            <Search size={18} style={{ color: 'var(--color-base-strong)' }} />
            <div className="text-[12.5px] text-slate-700"><span className="font-semibold">{full ? 'All in-scope users' : `${size} of the in-scope population`}</span> will be drawn and frozen as a snapshot.</div>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-slate-100 px-6 py-4">
          <button onClick={onClose} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-600">Cancel</button>
          <button onClick={submit} disabled={create.isPending} style={ACCENT} className="rounded-md px-5 py-2 text-[13px] font-semibold shadow-sm disabled:opacity-60">
            {create.isPending ? 'Creating…' : 'Create review'}
          </button>
        </div>
      </div>
    </div>
  );
}
