'use client';
// src/app/(dashboard)/compliance/access-reviews/rules/page.tsx
// Rule Library: the scenario catalog from GET /rules/catalog, grouped by
// domain. Compact one-line rows; reads/trips/regulation detail now lives in
// a click-to-open drawer instead of always rendering inline (the biggest
// "less scrolling, more popups" change in this module — the old layout
// rendered every rule's full detail inline with no popups at all). Enable
// toggle and "needs connector / needs data" states are unchanged and still
// actionable directly from the row.

import { useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { useRuleCatalog, useUpdateRule } from '../api';
import { severityClass } from '../pipeline';
import type { CatalogRule } from '../types';

const REGS = ['All', 'SOX', 'PCI', 'GDPR', 'SAMA'] as const;
const ACCENT = { background: 'var(--ar-accent)', color: '#fff' } as const;
const statusMeta: Record<CatalogRule['status'], { label: string; color: string }> = {
  runnable: { label: 'Runnable', color: '#15803D' },
  needs_data: { label: 'Needs data feed', color: '#B45309' },
  needs_connector: { label: 'Needs connector', color: '#8A94A1' },
};

export default function RuleLibraryPage() {
  const { data, isLoading } = useRuleCatalog();
  const update = useUpdateRule();
  const [reg, setReg] = useState<(typeof REGS)[number]>('All');
  const [openRule, setOpenRule] = useState<CatalogRule | null>(null);

  const domains = useMemo(() => {
    if (!data) return [];
    return data.domains
      .map((d) => ({ ...d, rules: reg === 'All' ? d.rules : d.rules.filter((r) => r.regulation.includes(reg)) }))
      .filter((d) => d.rules.length);
  }, [data, reg]);

  if (isLoading || !data) return <PageLoader />;
  const filteredCount = domains.reduce((n, d) => n + d.rules.length, 0);
  const toggle = (r: CatalogRule) => update.mutate({ ruleId: r.id, enabled: !r.enabled });

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        {[['Catalog', data.summary.total], ['Runnable now', data.summary.runnable], ['Enabled', data.summary.enabled_active]].map(([k, v]) => (
          <div key={k as string} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2" style={{ borderColor: 'var(--ar-border)' }}>
            <span className="font-mono text-[14px] font-bold" style={{ color: 'var(--ar-text)' }}>{v}</span>
            <span className="text-[11.5px]" style={{ color: 'var(--ar-text-muted)' }}>{k}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--ar-text)' }}>Regulation</span>
          <div className="flex gap-0.5 rounded-lg border p-1" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)' }}>
            {REGS.map((k) => (
              <button key={k} onClick={() => setReg(k)} style={reg === k ? ACCENT : undefined}
                className="rounded-md px-2.5 py-1.5 text-xs font-semibold">
                <span style={{ color: reg === k ? '#fff' : 'var(--ar-text-muted)' }}>{k}</span>
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>{filteredCount} rules</span>
        </div>
      </div>

      {domains.map((d) => (
        <div key={d.domain} className="mb-4">
          <div className="mb-1.5 flex items-center gap-2"><h2 className="text-[13px] font-bold" style={{ color: 'var(--ar-text)' }}>{d.domain}</h2><span className="font-mono text-[11px]" style={{ color: 'var(--ar-text-muted)' }}>{d.rules.length}</span></div>
          <div className="overflow-hidden rounded-xl border bg-white shadow-sm" style={{ borderColor: 'var(--ar-border)' }}>
            {d.rules.map((r) => (
              <button key={r.id} onClick={() => setOpenRule(r)}
                className={`grid w-full grid-cols-[100px_1fr_140px_50px] items-center gap-4 border-b px-5 py-2.5 text-left transition-colors hover:bg-[color:var(--ar-surface-alt)] ${r.runnable ? '' : 'opacity-60'}`}
                style={{ borderColor: 'var(--ar-border)' }}>
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--ar-text-muted)' }}>{r.id}</span>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[12.5px] font-semibold" style={{ color: 'var(--ar-text)' }}>{r.name}</span>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${severityClass[r.severity]}`}>{r.severity}</span>
                </div>
                <span className="text-[11px] font-semibold" style={{ color: statusMeta[r.status].color }}>{statusMeta[r.status].label}</span>
                <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                  <button disabled={!r.runnable} onClick={() => toggle(r)}
                    className={`h-[20px] w-[34px] rounded-full p-0.5 ${!r.runnable ? 'cursor-not-allowed opacity-50' : ''}`}
                    style={{ background: r.enabled && r.runnable ? 'var(--ar-accent)' : '#DDE1E7' }}>
                    <div className="h-[16px] w-[16px] rounded-full bg-white shadow-sm transition-transform" style={{ transform: r.enabled && r.runnable ? 'translateX(14px)' : 'none' }} />
                  </button>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {openRule && <RuleDrawer rule={openRule} onToggle={() => toggle(openRule)} onClose={() => setOpenRule(null)} />}
    </div>
  );
}

function RuleDrawer({ rule: r, onToggle, onClose }: { rule: CatalogRule; onToggle: () => void; onClose: () => void }) {
  const meta = statusMeta[r.status];
  return (
    <div onClick={onClose} className="fixed inset-0 z-40 flex justify-end bg-slate-900/45">
      <div onClick={(e) => e.stopPropagation()} className="flex h-full w-[440px] max-w-[94%] flex-col border-l bg-white shadow-2xl" style={{ borderColor: 'var(--ar-border)' }}>
        <div className="border-b px-5 py-4" style={{ borderColor: 'var(--ar-border)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[11px] font-semibold" style={{ color: 'var(--ar-text-muted)' }}>{r.id}</div>
              <div className="mt-0.5 text-[15px] font-bold" style={{ color: 'var(--ar-text)' }}>{r.name}</div>
            </div>
            <button onClick={onClose} className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-md border" style={{ borderColor: 'var(--ar-border)', background: 'var(--ar-surface-alt)', color: 'var(--ar-text-muted)' }}><X size={15} /></button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${severityClass[r.severity]}`}>{r.severity}</span>
            <span className="text-[11.5px] font-semibold" style={{ color: meta.color }}>{meta.label}</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Reads</div>
            <div className="text-[13px] leading-relaxed" style={{ color: 'var(--ar-text)' }}>{r.reads}</div>
          </div>
          <div className="mb-4">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Trips when</div>
            <div className="text-[13px] leading-relaxed" style={{ color: 'var(--ar-text)' }}>{r.trips}</div>
          </div>
          {r.regulation !== '—' && (
            <div className="mb-5">
              <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--ar-text-muted)' }}>Regulation mapping</div>
              <div className="flex flex-wrap gap-1.5">
                {r.regulation.split('·').map((x) => <span key={x} className="rounded px-2 py-1 text-[11px] font-bold tracking-wide" style={{ background: 'var(--ar-surface-alt)', color: 'var(--ar-text)' }}>{x.trim()}</span>)}
              </div>
            </div>
          )}
          {!r.runnable && (
            <div className="rounded-lg border border-dashed p-3 text-[12px]" style={{ borderColor: 'var(--ar-border)', color: 'var(--ar-text-muted)' }}>
              This rule needs {r.status === 'needs_connector' ? 'a connected source' : 'a data feed'} before it can run — it will stay off until then.
            </div>
          )}
        </div>

        <div className="border-t px-5 py-4" style={{ borderColor: 'var(--ar-border)' }}>
          <button disabled={!r.runnable} onClick={onToggle} style={r.runnable ? ACCENT : undefined}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-[13px] font-semibold ${r.runnable ? 'shadow-sm' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}>
            {r.enabled ? 'Disable rule' : 'Enable rule'} <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
