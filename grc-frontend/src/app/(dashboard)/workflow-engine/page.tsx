'use client';

export const dynamic = 'force-dynamic';

// Administration > Workflow Engine: build, automate and watch workflows. A full-width page of its own (it was a tab inside the Administration tab strip, under a fixed
// full-screen frame), with five tabs kept in the address (?tab=builder|workflows|analytics|approvals|schedules): the Builder (a guided shell: triggers, notifications,
// escalation), the saved Workflows, Analytics, Approvals, and Schedules & webhooks. Nothing here uses a browser dialog: questions are the kit's confirm, tries and e-mail
// tests are Sheets, results are toasts, and a failed load says so with a Retry instead of showing an empty builder.
// The engine, its route names and the events the audit log describes are the server's; this page only reads and writes through workflowEngineApi as before.
// (The old free-form canvas, switched off since the guided builder replaced it, and the "locked" switches that were never on were removed from this file; the components only
// they used are still in components/ and are listed as dead code in the plan.)
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, TabPanel, Tabs, useConfirm, useTabParam } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { workflowEngineApi } from '@/lib/api';
import { AnalyticsTab } from './components/AnalyticsTab';
import { ApprovalsTab } from './components/ApprovalsTab';
import GuidedBuilder from './components/GuidedBuilder';
import { SchedulesTab } from './components/SchedulesTab';
import type { WorkflowDefinition } from './components/types';
import { SmtpSheet } from './_parts/SmtpSheet';
import { TestEmailSheet, TrySheet } from './_parts/TrySheets';
import { WorkflowList } from './_parts/WorkflowList';
import { runsLine, TAB_KEYS, TAB_LABELS, type DefinitionRow, type Overview, type TabKey } from './workflowModel';

const TABS = TAB_KEYS.map((key) => ({ key, label: TAB_LABELS[key] }));
const DEFS = ['workflow-definitions'];
const OVERVIEW = ['workflow-overview'];
const EMAIL = ['workflow-email-setups'];

export default function WorkflowEnginePage() {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useTabParam<TabKey>('tab', TAB_KEYS, { fallback: 'builder' });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [builderKey, setBuilderKey] = useState(0);                // a new key starts the builder again from the saved version (or empty)
  const [smtpOpen, setSmtpOpen] = useState(false);
  const [testMailOpen, setTestMailOpen] = useState(false);
  const [trying, setTrying] = useState<{ id: number; name: string } | null>(null);

  const defs = useQuery({ queryKey: DEFS, queryFn: async () => ((await workflowEngineApi.definitions.list()).data || []) as WorkflowDefinition[] });
  const overview = useQuery({ queryKey: OVERVIEW, queryFn: async () => ((await workflowEngineApi.analytics.overview()).data || {}) as Overview, retry: 1 });
  const email = useQuery({ queryKey: EMAIL, queryFn: async () => Number((await workflowEngineApi.notifications.checkSetup()).data?.email_config_count || 0), retry: 1 });

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: DEFS });
    void qc.invalidateQueries({ queryKey: OVERVIEW });
  }, [qc]);

  const open = (id: number | null) => { setSelectedId(id); setBuilderKey((k) => k + 1); setTab('builder'); };
  const discard = async () => {
    const saved = selectedId != null;
    const ok = await confirm({
      title: 'Discard your changes?',
      message: saved ? 'The builder goes back to the last saved version of this workflow.' : 'The builder goes back to an empty workflow.',
      confirmLabel: 'Discard changes',
      tone: 'danger',
    });
    if (ok) setBuilderKey((k) => k + 1);
  };

  const rows = (defs.data ?? []) as DefinitionRow[];
  const failed = defs.isError ? { message: errorMessage(defs.error, 'The workflows could not be loaded.'), onRetry: canRetry(defs.error) ? () => { void defs.refetch(); } : undefined } : null;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title="Workflow Engine"
        back={{ href: '/admin', label: 'Back to Administration' }}
        info="Build, automate and monitor workflows: when something happens on the platform, notify people and escalate."
        meta={overview.data ? runsLine(overview.data) : undefined}
        actions={<Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => open(null)}>New workflow</Button>}
      />

      <Tabs tabs={TABS} value={tab} onChange={setTab} ariaLabel="Workflow Engine sections">
        <TabPanel tabKey="builder">
          {tab === 'builder' && (
            <div className="overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
              <GuidedBuilder key={`${selectedId ?? 'new'}-${builderKey}`} definitionId={selectedId} onSaved={(id) => { setSelectedId(id); refresh(); }} onClose={() => { void discard(); }} />
            </div>
          )}
        </TabPanel>
        <TabPanel tabKey="workflows">
          {tab === 'workflows' && (
            <WorkflowList
              rows={rows}
              loading={defs.isLoading}
              error={failed}
              emailCount={email.data ?? 0}
              emailKnown={email.isSuccess}
              onOpen={open}
              onTry={(row) => setTrying({ id: row.id, name: row.name })}
              onSetupEmail={() => setSmtpOpen(true)}
              onTestEmail={() => setTestMailOpen(true)}
              onNew={() => open(null)}
            />
          )}
        </TabPanel>
        <TabPanel tabKey="analytics">{tab === 'analytics' && <AnalyticsTab />}</TabPanel>
        <TabPanel tabKey="approvals">{tab === 'approvals' && <ApprovalsTab />}</TabPanel>
        <TabPanel tabKey="schedules">{tab === 'schedules' && <SchedulesTab definitions={defs.data ?? []} />}</TabPanel>
      </Tabs>

      <SmtpSheet open={smtpOpen} onClose={() => setSmtpOpen(false)} onSaved={() => { void qc.invalidateQueries({ queryKey: EMAIL }); }} />
      <TestEmailSheet open={testMailOpen} onClose={() => setTestMailOpen(false)} serverCount={email.data ?? 0} onSetup={() => setSmtpOpen(true)} />
      <TrySheet workflow={trying} onClose={() => setTrying(null)} />
      {confirmDialog}
    </div>
  );
}
