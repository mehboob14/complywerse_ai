'use client';

export const dynamic = 'force-dynamic';

// Administration > AI usage: how much AI the organisation uses, in three views kept in the address (?view=tokens|people|activity&range=&person=). Tokens is the old Token
// usage page (totals, over time, budgets, by module, heaviest users); By person is the old per-person page, one row per person with their own use in a Sheet; Activity is the
// old Usage Monitoring page (the call-by-call view, only where it is set up). The first two read the platform's own ledger; the rules are usageModel.ts.
import { useState } from 'react';
import { PageHeader } from '@/components/ui';
import { TabPanel, Tabs, useAddressState } from '@/components/ui/ds';
import { ActivityView } from './ActivityView';
import { BudgetSheet } from './BudgetSheet';
import { PeopleView } from './PeopleView';
import { TokensView } from './TokensView';
import { USAGE_SCHEMA, VIEW_LABELS, VIEWS, type View } from './usageModel';

const TABS = VIEWS.map((key) => ({ key, label: VIEW_LABELS[key] }));

export default function AiUsagePage() {
  const [state, set] = useAddressState(USAGE_SCHEMA);
  const [budgets, setBudgets] = useState(false);
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="AI usage"
        info="How much AI the organisation uses, by module and by person. Tokens are counted for every AI call. Cost is an estimate at the rate set in Budgets, and changes compare with the period just before."
      />
      <Tabs tabs={TABS} value={state.view} onChange={(view: View) => set({ view })} ariaLabel="AI usage views">
        <TabPanel tabKey="tokens">{state.view === 'tokens' && <TokensView range={state.range} onRange={(range) => set({ range })} onBudgets={() => setBudgets(true)} />}</TabPanel>
        <TabPanel tabKey="people">{state.view === 'people' && <PeopleView person={state.person} onPerson={(person) => set({ person })} />}</TabPanel>
        <TabPanel tabKey="activity">{state.view === 'activity' && <ActivityView />}</TabPanel>
      </Tabs>
      <BudgetSheet open={budgets} onClose={() => setBudgets(false)} />
    </div>
  );
}
