'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { LEVEL_TONE, fmtNumber, fmtWhen } from './format';
import type { Inventory, UseCaseRow } from './types';

const TRIGGER_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'own', label: 'Fire on their own' },
  { key: 'used', label: 'Used in this period' },
] as const;

function Chip({ children, tone = 'border-slate-300 text-slate-700', title }: { children: React.ReactNode; tone?: string; title?: string }) {
  return <span title={title} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tone}`}>{children}</span>;
}

function Row({ u, onOpen }: { u: UseCaseRow; onOpen: (id: string) => void }) {
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <div className="font-medium text-slate-900">{u.label}</div>
          <p className="mt-0.5 text-sm text-slate-700">{u.value}</p>
          <p className="mt-0.5 text-xs text-slate-700">{u.surface}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Chip tone={u.trigger === 'click' ? undefined : 'border-amber-300 text-amber-900'} title="When this feature calls AI">{u.trigger_label}</Chip>
            <Chip tone={LEVEL_TONE[u.level]} title={u.level_meaning}>{u.level} · {u.level_meaning}</Chip>
            {u.field_policy && <Chip tone="border-primary-300 text-primary-800" title="Only the fields this feature needs are read from the record">Fields limited</Chip>}
            {!u.guarded && <Chip tone="border-rose-300 text-rose-800" title="This path is not covered by the request check yet">Not yet checked</Chip>}
            {u.modality === 'vision' && <Chip tone="border-rose-300 text-rose-800" title="Pictures are refused">Pictures refused</Chip>}
          </div>
        </div>
        <div className="shrink-0 text-right text-sm">
          <div className="tabular-nums text-slate-900">{fmtNumber(u.calls)} {u.calls === 1 ? 'call' : 'calls'}</div>
          <div className="text-xs text-slate-700">
            {u.blocked ? `${fmtNumber(u.blocked)} blocked · ` : ''}{u.failed ? `${fmtNumber(u.failed)} failed · ` : ''}last used {u.last_used ? fmtWhen(u.last_used) : 'never'}
          </div>
          {u.calls > 0 && (
            <button type="button" onClick={() => onOpen(u.id)} className="mt-1 text-xs font-medium text-primary-700 hover:underline">
              View calls
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function InventoryTab({ data, days, onOpenUseCase }: { data: Inventory; days: number; onOpenUseCase: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<(typeof TRIGGER_FILTERS)[number]['key']>('all');

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.modules
      .map((g) => ({
        ...g,
        use_cases: g.use_cases.filter((u) => {
          if (filter === 'own' && u.trigger === 'click') return false;
          if (filter === 'used' && u.calls === 0) return false;
          return !q || `${u.label} ${u.value} ${u.surface} ${g.label}`.toLowerCase().includes(q);
        }),
      }))
      .filter((g) => g.use_cases.length > 0);
  }, [data, query, filter]);

  const shown = groups.reduce((n, g) => n + g.use_cases.length, 0);
  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-slate-700">
        Everything in the product that can call AI, what it uses it for, and how its data is handled. Calls are for the last {days} days.
        Nothing here can be switched off: protection applies to every feature.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative">
          <span className="sr-only">Search features</span>
          <Search className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" size={14} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search features"
            className="w-64 rounded-md border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
        <div className="flex gap-1.5" role="group" aria-label="Show">
          {TRIGGER_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${filter === f.key ? 'border-primary-500 bg-primary-50 text-primary-800' : 'border-slate-300 text-slate-700 hover:border-slate-400'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-700">{shown} of {data.total} features</span>
      </div>

      {groups.length === 0 && <p className="py-8 text-center text-sm text-slate-700">No feature matches.</p>}
      {groups.map((g) => (
        <section key={g.module} aria-label={g.label}>
          <h3 className="mb-1.5 text-sm font-semibold text-slate-900">{g.label} <span className="font-normal text-slate-700">· {g.use_cases.length}</span></h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {g.use_cases.map((u) => <Row key={u.id} u={u} onOpen={onOpenUseCase} />)}
          </ul>
        </section>
      ))}
      {data.unclassified > 0 && (
        <p className="text-xs text-slate-700">{fmtNumber(data.unclassified)} older calls in this period could not be matched to a feature.</p>
      )}
    </div>
  );
}
