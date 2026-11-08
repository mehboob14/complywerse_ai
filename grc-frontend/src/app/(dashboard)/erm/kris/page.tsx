'use client';

// Risk Management > KRIs: the KRI register (a facet explorer over every KRI, _monitoring/KriRegister) and, in a tab of its own, the NCA KPI Report Template register that used to
// replace the page through a "Register Type" select. Every address that opened this page still does (/erm/kris); ?tab=nca opens the second tab.
import { PageHeader } from '@/components/ui';
import { Tabs, useTabParam } from '@/components/ui/ds';
import NcaKpiSection from '@/components/risks/NcaKpiSection';
import { routeFor } from '@/lib/navRegistry';
import KriRegister from '../_monitoring/KriRegister';

const TABS = [{ key: 'kris', label: 'KRIs' }, { key: 'nca', label: 'NCA KPI report' }] as const;
const KEYS = TABS.map((t) => t.key);

export default function KrisPage() {
  const label = routeFor('/erm/kris')?.label ?? 'KRIs';
  const [tab, setTab] = useTabParam('tab', KEYS, { fallback: 'kris' });
  const strip = <Tabs tabs={TABS.map((t) => ({ ...t }))} value={tab} onChange={setTab} ariaLabel="KRI registers" />;
  if (tab === 'nca') {
    return (
      <div className="flex min-w-0 flex-col gap-[12px]">
        <PageHeader variant="page" title={label} info="The NCA KPI Report Template register: the same KRIs page, for the Saudi NCA template." />
        {strip}
        <NcaKpiSection />
      </div>
    );
  }
  return <KriRegister label={label} tabs={strip} />;
}
