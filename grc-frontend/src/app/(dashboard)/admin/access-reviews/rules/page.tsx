'use client';
// src/app/(dashboard)/admin/access-reviews/rules/page.tsx
// Rule Library: the scenario catalog from GET /rules/catalog, grouped by
// domain, with severity, reads/trips, regulation mapping, enable toggle and
// "needs connector / needs data" states. Visual spec: Access Reviews.dc.html.

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { useRuleCatalog, useUpdateRule } from '../api';
import { severityClass } from '../pipeline';
import type { CatalogRule } from '../types';

const REGS = ['All', 'SOX', 'PCI', 'GDPR', 'SAMA'] as const;
const ACCENT = { background: 'var(--color-base)', color: 'var(--color-on-base)' } as const;
const statusMeta: Record<CatalogRule['status'], { label: string; cls: string }> = {
  runnable: { label: 'Runnable', cls: 'text-emerald-600' },
  needs_data: { label: 'Needs data feed', cls: 'text-amber-600' },
  needs_connector: { label: 'Needs connector', cls: 'text-slate-400' },
};

export default function RuleLibraryPage() {
  const router = useRouter();
  const { data, isLoading } = useRuleCatalog();
  const update = useUpdateRule();
  const [reg, setReg] = useState<(typeof REGS)[number]>('All');

  const domains = useMemo(() => {
    if (!data) return [];
    return data.domains
      .map((d) => ({ ...d, rules: reg === 'All' ? d.rules : d.rules.filter((r) => r.regulation.includes(reg)) }))
      .filter((d) => d.rules.length);
  }, [data, reg]);

  if (isLoading || !data) return <PageLoader />;
  const filteredCount = domains.reduce((n, d) => n + d.rules.length, 0);

  return (
    <div className="mx-auto max-w-[1080px] px-8 py-7 pb-16">
      <button onClick={() => router.push('/admin/access-reviews')} className="mb-2 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500"><ChevronLeft size={14} /> Access Reviews</button>
      <h1 className="text-[23px] font-bold tracking-tight text-slate-900">Rule library</h1>
      <p className="mb-5 mt-1 text-[13.5px] text-slate-500">Checks that run during Stage 3. Enabled, runnable rules fire on the next review.</p>

      <div className="mb-4 grid grid-cols-3 gap-3.5">
        {[['Catalog', data.summary.total, 'rules across all domains'], ['Runnable now', data.summary.runnable, 'with connected data'], ['Enabled', data.summary.enabled_active, 'fire on next Run checks']].map(([k, v, s]) => (
          <div key={k as string} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-1.5 text-[11.5px] font-medium text-slate-500">{k}</div>
            <div className="font-mono text-[25px] font-bold tracking-tight text-slate-900">{v}</div>
            <div className="mt-0.5 text-[11px] text-slate-400">{s}</div>
          </div>
        ))}
      </div>

      <div className="mb-5 flex items-center gap-3">
        <span className="text-xs font-semibold text-slate-600">Regulation</span>
        <div className="flex gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-1">
          {REGS.map((k) => (
            <button key={k} onClick={() => setReg(k)} style={reg === k ? ACCENT : undefined}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold ${reg === k ? 'shadow-sm' : 'text-slate-500'}`}>{k}</button>
          ))}
        </div>
        <span className="font-mono text-[11.5px] text-slate-400">{filteredCount} rules</span>
      </div>

      {domains.map((d) => (
        <div key={d.domain} className="mb-[18px]">
          <div className="mb-2 flex items-center gap-2"><h2 className="text-[13.5px] font-bold text-slate-900">{d.domain}</h2><span className="font-mono text-[11px] text-slate-400">{d.rules.length}</span></div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {d.rules.map((r) => (
              <div key={r.id} className={`grid grid-cols-[120px_1fr_150px_64px] items-center gap-4 border-b border-slate-100 px-5 py-3.5 ${r.runnable ? '' : 'opacity-60'}`}>
                <div className="flex flex-col gap-1.5">
                  <span className="font-mono text-[11.5px] font-semibold text-slate-600">{r.id}</span>
                  <span className={`text-[11px] font-semibold ${statusMeta[r.status].cls}`}>{statusMeta[r.status].label}</span>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold text-slate-900">{r.name}</span><span className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide ${severityClass[r.severity]}`}>{r.severity}</span></div>
                  <div className="text-[11.5px] leading-snug text-slate-600"><span className="text-slate-400">reads</span> {r.reads} <span className="text-slate-400">· trips when</span> {r.trips}</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {r.regulation !== '—' && r.regulation.split('·').map((x) => <span key={x} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-bold tracking-wide text-slate-600">{x.trim()}</span>)}
                </div>
                <div className="flex justify-end">
                  <button disabled={!r.runnable} onClick={() => update.mutate({ ruleId: r.id, enabled: !r.enabled })}
                    className={`h-[22px] w-[38px] rounded-full p-0.5 ${!r.runnable ? 'cursor-not-allowed opacity-50' : ''}`}
                    style={{ background: r.enabled && r.runnable ? 'var(--color-base)' : '#EEF1F4' }}>
                    <div className="h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform" style={{ transform: r.enabled && r.runnable ? 'translateX(16px)' : 'none' }} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
