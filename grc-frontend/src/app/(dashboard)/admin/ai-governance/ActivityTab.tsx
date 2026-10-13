'use client';

import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { STATUS_LABEL, STATUS_TONE, fmtDuration, fmtNumber, fmtTokens, fmtUsd, fmtWhen } from './format';
import type { CallRow } from './types';

const PAGE = 50;
const STATUSES = [
  { value: '', label: 'Any outcome' },
  { value: 'success', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'blocked', label: 'Blocked' },
];

export default function ActivityTab({
  days, useCase, onUseCaseChange, modules, onOpen,
}: {
  days: number;
  useCase: string;
  onUseCaseChange: (id: string) => void;
  modules: Array<{ module: string; label: string }>;
  onOpen: (id: number) => void;
}) {
  const [module, setModule] = useState('');
  const [status, setStatus] = useState('');
  const [username, setUsername] = useState('');
  const [q, setQ] = useState('');
  const [skip, setSkip] = useState(0);
  const [rows, setRows] = useState<CallRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { setSkip(0); }, [days, module, status, username, q, useCase]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string | number> = { days, skip, limit: PAGE };
      if (module) params.module = module;
      if (status) params.status = status;
      if (username.trim()) params.username = username.trim();
      if (q.trim()) params.q = q.trim();
      if (useCase) params.use_case = useCase;
      const res = await apiClient.get<{ total: number; items: CallRow[] }>('/admin/ai-governance/activity', { params });
      setRows(res.data.items);
      setTotal(res.data.total);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Could not load the calls.');
    } finally {
      setLoading(false);
    }
  }, [days, skip, module, status, username, q, useCase]);

  useEffect(() => {
    const t = window.setTimeout(load, q || username ? 250 : 0);
    return () => window.clearTimeout(t);
  }, [load, q, username]);

  const field = 'rounded-md border border-slate-300 px-2.5 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-700">Module
          <select value={module} onChange={(e) => setModule(e.target.value)} className={`${field} mt-1 block`}>
            <option value="">All modules</option>
            {modules.map((m) => <option key={m.module} value={m.module}>{m.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-700">Outcome
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${field} mt-1 block`}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-700">User
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" className={`${field} mt-1 block w-36`} />
        </label>
        <label className="text-xs text-slate-700">Search
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="feature, page or operation id" className={`${field} mt-1 block w-60`} />
        </label>
        {useCase && (
          <button type="button" onClick={() => onUseCaseChange('')} className="rounded-full border border-primary-400 bg-primary-50 px-3 py-1.5 text-xs font-medium text-primary-800">
            Feature: {useCase} ✕
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-700">
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Feature</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 font-medium">Outcome</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 text-right font-medium">Tokens</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">Protected</th>
              <th className="px-3 py-2 text-right font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-700">No calls match.</td></tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                tabIndex={0}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r.id); } }}
                className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-primary-50 focus:bg-primary-50 focus:outline-none"
              >
                <td className="whitespace-nowrap px-3 py-2">{fmtWhen(r.at)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{r.use_case_label}</div>
                  <div className="text-xs text-slate-700">{r.module_label}{r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}</div>
                </td>
                <td className="px-3 py-2">{r.user}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status] || STATUS_TONE.failed}`}>
                    {STATUS_LABEL[r.status] || r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{r.model || '–'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtTokens(r.total_tokens)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.cost_usd == null ? '–' : fmtUsd(r.cost_usd)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.entities ? <span className="inline-flex items-center gap-1"><ShieldCheck size={13} className="text-primary-700" aria-hidden />{fmtNumber(r.entities)}</span> : '–'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(r.duration_ms)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-slate-700">
        <span>{loading ? 'Loading…' : `${fmtNumber(total)} calls`}</span>
        <div className="flex gap-2">
          <button type="button" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - PAGE))} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
          <button type="button" disabled={skip + PAGE >= total} onClick={() => setSkip(skip + PAGE)} className="rounded-md border border-slate-300 px-3 py-1.5 disabled:opacity-40">Next</button>
        </div>
      </div>
    </div>
  );
}
