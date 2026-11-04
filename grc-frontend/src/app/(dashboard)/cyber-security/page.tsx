'use client';

// Cyber Security: the assessments of application security (OWASP ASVS, OWASP Testing, Mobile App Security) and of security-operations maturity (CSIR, CTI,
// Incident Management, IT Security Operations), and the NIST library. One page with a tab strip kept in the address (?tab=): the Overview across the types,
// each type on its own page (what to have ready, its questionnaire, the assessments made from it, Start), and the NIST library.
// On the design-system kit like the Governance pages: PageHeading, Tabs, StatTile, SectionCard, RegisterTable. The numbers of the Overview and their rules are
// in ./_overview (overviewModel.ts, tested); one request feeds the Overview and the badges on the tabs.
import { Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { PageHeading } from '@/components/ui/ds/PageHeading';
import { Menu, TabPanel, Tabs, useTabParam, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import AssessmentTypePage from '@/components/compliance/scoping/AssessmentTypePage';
import StartDialog from '@/components/compliance/scoping/StartDialog';
import NistLibraryTab from '@/components/compliance/NistLibraryTab';
import { typeOfTab, TYPE_INFO } from '@/components/compliance/scoping/scopingModel';
import type { AssessmentRow } from '@/components/compliance/scoping/scopingApi';
import Overview from './_overview/Overview';
import { inFlightByTab, TYPE_FORMATS } from './_overview/overviewModel';

// the keys are the ones the old hub put in ?tab= (links from emails, tasks and bookmarks keep working)
const TAB_KEYS = ['overview', 'asvs', 'owasp_testing', 'cs_mobile', 'cs_csir', 'cs_cti', 'cs_incident', 'cs_itsecops', 'nist_library'] as const;
type TabKey = (typeof TAB_KEYS)[number];

function CyberSecurityWorkspace() {
  const [tab, setTab] = useTabParam<TabKey>('tab', TAB_KEYS, { fallback: 'overview' });
  const [starting, setStarting] = useState<string | null>(null);
  // an assessment is made per application or function, so a type can hold many: the list is longer than it was
  const list = useQuery({
    queryKey: ['cyber-security-assessments'],
    queryFn: async () => {
      const r = await apiClient.get('/compliance/assessments', { params: { skip: 0, limit: 500 } });
      return (r.data?.assessments ?? r.data ?? []) as AssessmentRow[];
    },
  });
  const rows = useMemo(() => list.data ?? [], [list.data]);
  const flying = useMemo(() => inFlightByTab(rows), [rows]);

  const tabs = useMemo(() => [
    { key: 'overview', label: 'Overview' },
    ...TYPE_FORMATS.map((f) => ({ key: TYPE_INFO[f].tab, label: TYPE_INFO[f].label, count: flying[TYPE_INFO[f].tab] })),
    { key: 'nist_library', label: 'NIST library' },
  ], [flying]);
  const startItems: MenuItem[] = TYPE_FORMATS.map((f) => ({ key: f, label: TYPE_INFO[f].label, onSelect: () => setStarting(f) }));

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeading
        title="Cyber Security"
        info="Application security and security-operations maturity assessments. Start one for an application chosen from the asset library or for a function, scope it with the people who take part, then answer it with evidence."
        actions={<Menu label="Start assessment" items={startItems} />}
      />
      <Tabs tabs={tabs} value={tab} onChange={setTab} ariaLabel="Cyber Security">
        <TabPanel tabKey="overview" className="pt-[16px]">
          <Overview
            rows={rows}
            loading={list.isLoading}
            error={list.isError ? { title: "Couldn't load the assessments", message: errorMessage(list.error), onRetry: canRetry(list.error) ? () => { void list.refetch(); } : undefined } : null}
          />
        </TabPanel>
        {TAB_KEYS.filter((k) => !!typeOfTab(k)).map((k) => (
          <TabPanel key={k} tabKey={k} lazy className="pt-[16px]"><AssessmentTypePage format={typeOfTab(k) as string} /></TabPanel>
        ))}
        <TabPanel tabKey="nist_library" lazy className="pt-[16px]"><NistLibraryTab /></TabPanel>
      </Tabs>
      {starting && <StartDialog format={starting} onClose={() => setStarting(null)} />}
    </div>
  );
}

export default function CyberSecurityPage() {
  return (
    <Suspense fallback={<div className="p-4 text-ds-body text-ds-fg-muted">Loading…</div>}>
      <CyberSecurityWorkspace />
    </Suspense>
  );
}
