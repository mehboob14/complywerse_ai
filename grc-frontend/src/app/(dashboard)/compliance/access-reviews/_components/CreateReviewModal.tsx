'use client';
// src/app/(dashboard)/compliance/access-reviews/_components/CreateReviewModal.tsx
import { useState } from 'react';
import { X, Search } from 'lucide-react';
import { useCreateCampaign } from '../api';
import type { Campaign } from '../types';

const SCOPES = [['all', 'All users'], ['privileged', 'Privileged only'], ['terminated', 'Terminated only']] as const;
const METHODS = [['random', 'Random'], ['risk', 'Risk-weighted'], ['full', 'Full population']] as const;
const ACCENT = { background: 'var(--ar-accent)', color: '#fff' } as const;

export function CreateReviewModal({ onClose, onCreated }: { onClose: () => void; onCreated: (c: Campaign) => void }) {
  const create = useCreateCampaign();
  const [name, setName] = useState('Q3 2026 Privileged Access Review');
  const [scope, setScope] = useState<string>('privileged');
  const [method, setMethod] = useState<string>('risk');
  const [size, setSize] = useState(25);
  const full = method === 'full';

  const seg = (val: string, set: (v: string) => void, opts: readonly (readonly [string, string])[]) => (
    <div className="flex gap-1 rounded-lg border p-1" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }}>
      {opts.map(([k, l]) => (
        <button key={k} onClick={() => set(k)} style={val === k ? ACCENT : undefined}
          className="flex-1 rounded-md px-2.5 py-2 text-[12.5px] font-semibold">
          <span style={{ color: val === k ? '#fff' : 'var(--ar-text-muted)' }}>{l}</span>
        </button>
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
      <div onClick={(e) => e.stopPropagation()} className="max-h-full w-[560px] max-w-full overflow-y-auto rounded-xl border bg-white shadow-xl" style={{ borderColor: 'var(--ar-border)' }}>
        <div className="flex items-center justify-between border-b px-6 py-5" style={{ borderColor: 'var(--ar-border)' }}>
          <div>
            <div className="text-[15px] font-bold" style={{ color: 'var(--ar-text)' }}>New access review</div>
            <div className="mt-0.5 text-xs" style={{ color: 'var(--ar-text-muted)' }}>Scope and sample the population to certify</div>
          </div>
          <button onClick={onClose} className="flex h-[30px] w-[30px] items-center justify-center rounded-md border" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}><X size={15} /></button>
        </div>
        <div className="flex flex-col gap-5 px-6 py-5">
          <div>
            <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--ar-text)' }}>Review name</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border px-3 py-2.5 text-[13.5px] outline-none focus:ring-2 focus:ring-[color:var(--ar-accent-soft)]" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }} />
          </div>
          <div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--ar-text)' }}>Scope</label>{seg(scope, setScope, SCOPES)}</div>
          <div><label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--ar-text)' }}>Sampling method</label>{seg(method, setMethod, METHODS)}</div>
          <div>
            <div className="mb-1.5 flex items-center justify-between"><label className="text-xs font-semibold" style={{ color: 'var(--ar-text)' }}>Sample size</label><span className="font-mono text-[13px] font-semibold" style={{ color: 'var(--ar-accent-strong)' }}>{full ? 'all' : size}</span></div>
            <input type="range" min={5} max={67} value={size} disabled={full} onChange={(e) => setSize(+e.target.value)} className="w-full" style={{ accentColor: 'var(--ar-accent)' }} />
          </div>
          <div className="flex items-center gap-2.5 rounded-lg px-4 py-3.5" style={{ background: 'var(--ar-accent-soft)' }}>
            <Search size={18} style={{ color: 'var(--ar-accent-strong)' }} />
            <div className="text-[12.5px]" style={{ color: 'var(--ar-text)' }}><span className="font-semibold">{full ? 'All in-scope users' : `${size} of the in-scope population`}</span> will be drawn and frozen as a snapshot.</div>
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t px-6 py-4" style={{ borderColor: 'var(--ar-border)' }}>
          <button onClick={onClose} className="rounded-md border bg-white px-4 py-2 text-[13px] font-semibold" style={{ borderColor: 'var(--ar-border)', color: 'var(--ar-text)' }}>Cancel</button>
          <button onClick={submit} disabled={create.isPending} style={ACCENT} className="rounded-md px-5 py-2 text-[13px] font-semibold shadow-sm disabled:opacity-60">
            {create.isPending ? 'Creating…' : 'Create review'}
          </button>
        </div>
      </div>
    </div>
  );
}
