'use client';

// Scenario Analysis: saved loss scenarios (estimated in a workshop, run on the FAIR / Monte Carlo engine, compared with appetite,
// approved by a second person) and the older score what-if, kept as the "Quick what-if" tab (?tab=what-if).
import Link from 'next/link';
import { ArrowLeft, Target } from 'lucide-react';
import { TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import QuickWhatIf from './QuickWhatIf';
import SavedScenarios from './SavedScenarios';

const TABS = [{ key: 'scenarios', label: 'Scenarios' }, { key: 'what-if', label: 'Quick what-if' }] as const;
const KEYS = TABS.map((t) => t.key);

export default function ScenarioAnalysisPage() {
  const [tab, setTab] = useTabParam('tab', KEYS, { fallback: 'scenarios' });

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center gap-4">
        <Link
          href="/erm"
          className="flex items-center gap-1 rounded-lg bg-white px-3 py-2 text-sm text-slate-600 hover:text-slate-900 border border-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900 flex items-center gap-2">
            <Target className="h-5 w-5 text-primary-400" />
            Scenario Analysis
          </h2>
          <p className="text-sm text-slate-600">Severe but plausible events, estimated in money and compared with appetite</p>
        </div>
      </div>

      <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} ariaLabel="Scenario Analysis views">
        <TabPanel tabKey="scenarios" className="pt-[16px]"><SavedScenarios /></TabPanel>
        <TabPanel tabKey="what-if" lazy className="pt-[16px]"><QuickWhatIf /></TabPanel>
      </Tabs>
    </div>
  );
}
