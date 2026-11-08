'use client';

export const dynamic = 'force-dynamic';

// Administration > AI governance: what AI is used for, how data is protected before anything is sent, and every call that was made. Three views kept in the address
// (?tab=overview|inventory|activity): Overview (the figures and what was refused), Features (everything in the product that can call AI) and Activity (the calls, each
// opening in a Sheet). The rights are unchanged: the server needs admin:ai_governance:view, and the text of a call needs the payload right. A person without the view
// right gets a plain note, not a broken page.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui';
import { EmptyState, ErrorState, Select, SkeletonLines, TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
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
const KEYS = TABS.map((t) => t.key) as readonly TabKey[];
const PERIODS = [7, 30, 90];

export default function AIGovernancePage() {
  const [tab, setTab] = useTabParam<TabKey>('tab', KEYS, { fallback: 'overview' });
  const [days, setDays] = useState(30);
  const [useCase, setUseCase] = useState('');
  const [openCall, setOpenCall] = useState<number | null>(null);

  const overview = useQuery({ queryKey: ['ai-governance-overview', days], queryFn: async () => (await apiClient.get<Overview>('/admin/ai-governance/overview', { params: { days } })).data, retry: false });
  const inventory = useQuery({ queryKey: ['ai-governance-inventory', days], queryFn: async () => (await apiClient.get<Inventory>('/admin/ai-governance/inventory', { params: { days } })).data, retry: false });

  const forbidden = statusOf(overview.error) === 403 || statusOf(inventory.error) === 403;
  const failed = overview.isError || inventory.isError;
  const openUseCase = (id: string) => { setUseCase(id); setTab('activity'); };

  if (forbidden) {
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="AI governance" />
        <EmptyState kind="firstUse" title="You can't see AI governance" description="Ask an administrator for the AI governance view right." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="AI governance"
        info="What AI is used for, how your data is protected before anything is sent, and every call that was made."
        actions={(
          <Select aria-label="Period" className="w-[160px]" value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {PERIODS.map((d) => <option key={d} value={d}>Last {d} days</option>)}
          </Select>
        )}
      />
      {failed ? (
        <ErrorState
          title="Couldn't load AI governance"
          message={errorMessage(overview.error ?? inventory.error)}
          onRetry={canRetry(overview.error ?? inventory.error) ? () => { void overview.refetch(); void inventory.refetch(); } : undefined}
        />
      ) : !overview.data || !inventory.data ? (
        <SkeletonLines lines={8} label="Loading AI governance" />
      ) : (
        <Tabs tabs={TABS.map((t) => ({ ...t }))} value={tab} onChange={setTab} ariaLabel="AI governance views">
          <TabPanel tabKey="overview">{tab === 'overview' && <OverviewTab data={overview.data} days={days} onOpenUseCase={openUseCase} />}</TabPanel>
          <TabPanel tabKey="inventory">{tab === 'inventory' && <InventoryTab data={inventory.data} days={days} onOpenUseCase={openUseCase} />}</TabPanel>
          <TabPanel tabKey="activity">
            {tab === 'activity' && (
              <ActivityTab days={days} useCase={useCase} onUseCaseChange={setUseCase} modules={inventory.data.modules.map((m) => ({ module: m.module, label: m.label }))} onOpen={setOpenCall} />
            )}
          </TabPanel>
        </Tabs>
      )}
      <CallPanel id={openCall} onClose={() => setOpenCall(null)} onOpenUseCase={(id) => { setOpenCall(null); openUseCase(id); }} />
    </div>
  );
}
