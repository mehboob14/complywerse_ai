'use client';

export const dynamic = 'force-dynamic';

import { detailText } from '@/lib/apiError';
import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { PageHeader, PageLoader } from '@/components/ui';
import { apiClient } from '@/lib/api';
import ActivityTab from './ActivityTab';
import CallPanel from './CallPanel';
import InventoryTab from './InventoryTab';
import OverviewTab from './OverviewTab';
import type { Inventory, Overview } from './types';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'inventory', label: 'Features' },
  { key: 'activity', label: 'Activity' },
] as const;
type TabKey = (typeof TABS)[number]['key'];
const PERIODS = [7, 30, 90];

function initialTab(): TabKey {
  if (typeof window === 'undefined') return 'overview';
  const t = new URLSearchParams(window.location.search).get('tab');
  return TABS.some((x) => x.key === t) ? (t as TabKey) : 'overview';
}

export default function AIGovernancePage() {
  const [tab, setTab] = useState<TabKey>('overview');
  const [days, setDays] = useState(30);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [useCase, setUseCase] = useState('');
  const [openCall, setOpenCall] = useState<number | null>(null);

  useEffect(() => { setTab(initialTab()); }, []);

  const go = useCallback((next: TabKey) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url.toString());
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [o, i] = await Promise.all([
        apiClient.get<Overview>('/admin/ai-governance/overview', { params: { days } }),
        apiClient.get<Inventory>('/admin/ai-governance/inventory', { params: { days } }),
      ]);
      setOverview(o.data);
      setInventory(i.data);
    } catch (e: any) {
      if (e?.response?.status === 403) setForbidden(true);
      else setError(detailText(e?.response?.data?.detail) || 'Could not load AI Governance.');
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  const openUseCase = (id: string) => { setUseCase(id); go('activity'); };

  if (forbidden) {
    return (
      <div className="p-6">
        <PageHeader title="AI Governance" icon={Sparkles} />
        <p className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700">You do not have permission to view AI Governance. Ask an administrator for the “AI Governance → view” permission.</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <PageHeader
        title="AI Governance"
        subtitle="What AI is used for, how your data is protected before anything is sent, and every call that was made."
        icon={Sparkles}
        actions={
          <label className="text-xs text-slate-700">Period
            <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="ml-2 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm">
              {PERIODS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
            </select>
          </label>
        }
      />

      <div role="tablist" aria-label="AI Governance" className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={tab === t.key}
            onClick={() => go(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-primary-600 text-primary-800' : 'border-transparent text-slate-700 hover:text-slate-900'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
      {!overview && !inventory && !error ? <PageLoader /> : (
        <div role="tabpanel">
          {tab === 'overview' && overview && <OverviewTab data={overview} days={days} onOpenUseCase={openUseCase} />}
          {tab === 'inventory' && inventory && <InventoryTab data={inventory} days={days} onOpenUseCase={openUseCase} />}
          {tab === 'activity' && (
            <ActivityTab
              days={days}
              useCase={useCase}
              onUseCaseChange={setUseCase}
              modules={(inventory?.modules || []).map((m) => ({ module: m.module, label: m.label }))}
              onOpen={setOpenCall}
            />
          )}
        </div>
      )}

      <CallPanel id={openCall} onClose={() => setOpenCall(null)} onOpenUseCase={(id) => { setOpenCall(null); openUseCase(id); }} />
    </div>
  );
}
