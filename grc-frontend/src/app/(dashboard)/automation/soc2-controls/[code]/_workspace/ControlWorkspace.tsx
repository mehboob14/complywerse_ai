'use client';

/**
 * Controls Automation > a control: the workspace. One head (the code, the name, the status, who is responsible, the ONE next step, Run tests), five tabs (Summary, Testing, Evidence, Links,
 * Activity) and the sheets any part can ask for (does it apply, rate its maturity, record a test, edit a control the organisation wrote). Only the open tab asks for its requests. The tab and
 * the section are in the address: every old ?tab= (tests, assurance, evidence, links, ...) opens the tab that holds its content now (workspaceModel.ts).
 *
 * Who may do what is what the SERVER enforces (workspaceRightsModel.ts): a button the server would refuse is drawn off with the reason. A control nobody has acted on has no work item (the reads
 * no longer create one), so `work_item_id` may be null; every write that needs the item creates it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Button, ErrorState, SkeletonRows, TabPanel, Tabs, useTabParam, type TabItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useMeId } from '../../_explorer/controlsData';
import { ActivityTab } from './ActivityTab';
import { ApplicabilitySheet } from './ApplicabilitySheet';
import { ControlHeader } from './ControlHeader';
import { EditControlDialog } from './EditControlDialog';
import { EvidenceTab } from './EvidenceTab';
import { LinksTab } from './LinksTab';
import { MaturitySheet } from './Maturity';
import { RecordTestSheet } from './RecordTestSheet';
import { SummaryTab } from './SummaryTab';
import { TestingTab } from './TestingTab';
import { useRunChecks } from './useRunChecks';
import { WorkspaceProvider, type WorkspaceValue } from './workspaceContext';
import { fromCustomRecord, refreshControl, useAssurance, useControlDetail, useCustomRecord } from './workspaceData';
import { TABS, TAB_ALIASES, TAB_LABEL, arrival, initialOpen, scrollTarget, type SectionKey, type TabKey } from './workspaceModel';
import { useWorkspaceRights } from './workspaceRights';

const BACK = '/automation/soc2-controls';

export function ControlWorkspace({ code }: { code: string }) {
  const qc = useQueryClient();
  const sp = useSearchParams();
  const me = useMeId();
  const { rights, why } = useWorkspaceRights();
  const detailQ = useControlDetail(code);
  const customQ = useCustomRecord(code, detailQ.isError || !!detailQ.data?.custom);
  const d = detailQ.data ?? (customQ.data ? fromCustomRecord(code, customQ.data) : undefined);
  const isCustom = !!(d?.custom || customQ.data?.custom);
  const assurance = useAssurance(code, !!d);

  const [tab, setTab] = useTabParam<TabKey>('tab', TABS, { fallback: 'summary', aliases: TAB_ALIASES });
  const first = useMemo(() => arrival(sp?.get('tab'), sp?.get('section')), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpenSet] = useState<ReadonlySet<SectionKey>>(() => new Set(initialOpen(first)));
  const [scrollTo, setScrollTo] = useState<SectionKey | null>(() => scrollTarget(sp?.get('tab'), sp?.get('section')));
  const setOpen = useCallback((section: SectionKey, on: boolean) => setOpenSet((s) => { const n = new Set(s); if (on) n.add(section); else n.delete(section); return n; }), []);
  const go = useCallback((to: TabKey, section?: SectionKey) => {
    setTab(to);
    if (section) { setOpen(section, true); setScrollTo(section); }
  }, [setTab, setOpen]);
  // scroll to the section a link asked for once it is on the page (the control, then the tab's panel, load first): try for a few seconds, then give up quietly
  const ready = !!d;
  useEffect(() => {
    if (!scrollTo || !ready) return undefined;
    let tries = 0;
    const id = window.setInterval(() => {
      const el = document.getElementById(`ws-${scrollTo}`);
      tries += 1;
      if (el) { el.scrollIntoView({ block: 'start' }); setScrollTo(null); window.clearInterval(id); } else if (tries > 30) { setScrollTo(null); window.clearInterval(id); }
    }, 100);
    return () => window.clearInterval(id);
  }, [scrollTo, tab, ready]);

  const [applicabilityOpen, setApplicabilityOpen] = useState(false);
  const [maturityOpen, setMaturityOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [testTarget, setTestTarget] = useState<number | 'new' | null>(null);
  const { run, running } = useRunChecks();
  const refresh = useCallback(() => refreshControl(qc), [qc]);

  useEffect(() => { document.title = d ? `${d.control_id} ${d.title} · Controls` : 'Control'; }, [d]);

  if (!d) {
    if (detailQ.isPending || (detailQ.isError && customQ.isPending && !customQ.isError)) {
      return <div aria-busy="true" className="flex flex-col gap-[16px]"><SkeletonRows rows={1} columns={2} label="Loading the control" /><SkeletonRows rows={8} columns={3} label="Loading the control" /></div>;
    }
    const missing = axios.isAxiosError(detailQ.error) && detailQ.error.response?.status === 404;
    return (
      <div className="flex flex-col gap-[16px]">
        <ErrorState
          title={missing ? 'This control is not in your library' : 'Couldn’t open this control'}
          message={missing ? `${code} is not a control of your organisation. It may have been retired, or the address may be wrong.` : errorMessage(detailQ.error)}
          onRetry={!missing && canRetry(detailQ.error) ? () => { void detailQ.refetch(); } : undefined}
        />
        <div><Button href={BACK}>Back to controls</Button></div>
      </div>
    );
  }

  const value: WorkspaceValue = {
    code, d, isCustom, rights, why, me, open, setOpen, go, running, refresh,
    decide: () => setApplicabilityOpen(true),
    rateMaturity: () => setMaturityOpen(true),
    recordTest: (t) => setTestTarget(t),
    editControl: () => setEditOpen(true),
    runTests: () => { void run(d.checks ?? []); },
  };
  const evidenceCount = assurance.data?.evidence.length;
  const tabs: TabItem[] = TABS.map((k) => ({ key: k, label: TAB_LABEL[k], count: k === 'evidence' && evidenceCount ? evidenceCount : undefined }));

  return (
    <WorkspaceProvider value={value}>
      <div className="flex flex-col gap-[16px]">
        <ControlHeader />
        <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Control sections" countFormat="exact">
          <TabPanel tabKey="summary"><SummaryTab /></TabPanel>
          <TabPanel tabKey="testing" lazy><TestingTab /></TabPanel>
          <TabPanel tabKey="evidence" lazy><EvidenceTab /></TabPanel>
          <TabPanel tabKey="links" lazy><LinksTab /></TabPanel>
          <TabPanel tabKey="activity" lazy><ActivityTab /></TabPanel>
        </Tabs>
      </div>
      <ApplicabilitySheet open={applicabilityOpen} onClose={() => setApplicabilityOpen(false)} />
      <MaturitySheet open={maturityOpen} onClose={() => setMaturityOpen(false)} />
      <RecordTestSheet target={testTarget} onTarget={setTestTarget} onClose={() => setTestTarget(null)} />
      {isCustom && <EditControlDialog open={editOpen} onClose={() => setEditOpen(false)} />}
    </WorkspaceProvider>
  );
}
