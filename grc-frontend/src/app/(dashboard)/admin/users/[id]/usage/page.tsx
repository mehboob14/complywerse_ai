'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download } from 'lucide-react';
import { adminApi, AdminUser, AIUsageBreakdown, AIUsageEvent, AIUsageSummary } from '@/lib/api';

const fmt = (value: number) => new Intl.NumberFormat().format(value || 0);

export default function UserAIUsagePage({ params: route }: { params: { id: string } }) {
  const userId = Number(route.id);
  const [data, setData] = useState<{ user: AdminUser; summary: AIUsageSummary; modules: AIUsageBreakdown[]; recent: AIUsageEvent[] } | null>(null);
  const [days, setDays] = useState('30');
  const [error, setError] = useState('');

  const filters = useCallback(() => { const date = new Date(); date.setDate(date.getDate() - Number(days)); return { date_from: date.toISOString() }; }, [days]);
  useEffect(() => { adminApi.getAIUsageForUser(userId, filters()).then(r => setData(r.data)).catch((e: any) => setError(e?.response?.data?.detail || 'Failed to load user usage.')); }, [userId, filters]);

  const exportCsv = async () => {
    if (!data) return;
    const response = await adminApi.exportAIUsage({ ...filters(), username: data.user.username });
    const url = URL.createObjectURL(response.data); const a = document.createElement('a');
    a.href = url; a.download = `${data.user.username}-ai-usage.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (error) return <div className="p-6 text-rose-700">{error}</div>;
  if (!data) return <div className="p-6 text-slate-500">Loading usage…</div>;
  return <div className="p-6 space-y-6">
    <div className="flex items-center justify-between gap-3"><div><Link href="/admin?tab=users" className="mb-2 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft size={14}/> User Management</Link><h1 className="text-2xl font-semibold">{data.user.display_name || data.user.username}</h1><p className="text-sm text-slate-500">@{data.user.username} · AI usage</p></div><div className="flex gap-2"><select value={days} onChange={e => setDays(e.target.value)} className="rounded-lg border px-3 py-2 text-sm"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select><button onClick={exportCsv} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Download size={15}/> Export</button></div></div>
    <div className="grid gap-4 md:grid-cols-4">{[['Total tokens', data.summary.total_tokens], ['Input tokens', data.summary.prompt_tokens], ['Output tokens', data.summary.completion_tokens], ['AI calls', data.summary.calls]].map(([label,value]) => <div key={String(label)} className="rounded-xl border bg-white p-4"><div className="text-2xl font-semibold">{fmt(Number(value))}</div><div className="text-xs text-slate-500">{label}</div></div>)}</div>
    <section className="rounded-xl border bg-white"><h2 className="border-b p-4 font-medium">Module breakdown</h2><table className="w-full text-sm"><thead><tr className="text-left text-xs text-slate-500"><th className="p-3">Module</th><th>Feature</th><th>Calls</th><th>Input</th><th>Output</th><th>Total</th></tr></thead><tbody>{data.modules.map(row => <tr key={`${row.module_key}.${row.feature_key}`} className="border-t"><td className="p-3 font-medium">{row.module_key}</td><td>{row.feature_key}</td><td>{fmt(row.calls)}</td><td>{fmt(row.prompt_tokens)}</td><td>{fmt(row.completion_tokens)}</td><td>{fmt(row.total_tokens)}</td></tr>)}</tbody></table></section>
    <section className="rounded-xl border bg-white"><h2 className="border-b p-4 font-medium">Recent AI activity</h2><div className="divide-y">{data.recent.map(event => <div key={event.id} className="grid grid-cols-4 gap-3 p-3 text-sm"><span>{new Date(event.occurred_at).toLocaleString()}</span><span>{event.module_key} / {event.feature_key}</span><span>{event.model || 'Unknown model'}</span><span className="text-right">{fmt(event.total_tokens)} tokens</span></div>)}</div></section>
  </div>;
}
