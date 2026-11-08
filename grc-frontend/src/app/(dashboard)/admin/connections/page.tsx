'use client';

// Administration > Connected systems. A host for the four kinds of connection until the one register replaces it (the group that owns the connections
// replaces this file): the vulnerability scanners, the cloud security feeds, the business tools (ServiceNow, Splunk, Teams …) and the evidence sources.
// Each kind is the page it has always been (those pages keep their own addresses too: the vendor pages link to /admin/connectors). The kind is in the
// address (?kind=), and the old tab addresses (/admin?tab=integrations …) arrive here with it (lib/adminSections.ts).
import { PageHeader } from '@/components/ui';
import { TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import IntegrationsConnectionsPage from '../../integrations/connections/page';
import CloudConnectorsAdminPage from '../cloud-connectors/page';
import ConnectorsAdminPage from '../connectors/page';
import EvidenceCollectorsPage from '../evidence-collectors/page';

const KINDS = ['evidence', 'scanners', 'cloud', 'tools'] as const;
const LABELS: Record<(typeof KINDS)[number], string> = { evidence: 'Evidence sources', scanners: 'Scanners', cloud: 'Cloud security', tools: 'Business tools' };

export default function ConnectedSystemsPage() {
  const [kind, setKind] = useTabParam('kind', KINDS, { fallback: 'evidence' });
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title="Connected systems" info="The systems this platform reads from: evidence sources, vulnerability scanners, cloud security feeds and business tools." />
      <Tabs ariaLabel="Kinds of connected system" value={kind} onChange={setKind} tabs={KINDS.map((key) => ({ key, label: LABELS[key] }))}>
        <TabPanel tabKey="evidence" lazy className="pt-[16px]"><EvidenceCollectorsPage /></TabPanel>
        <TabPanel tabKey="scanners" lazy className="pt-[16px]"><IntegrationsConnectionsPage /></TabPanel>
        <TabPanel tabKey="cloud" lazy className="pt-[16px]"><CloudConnectorsAdminPage /></TabPanel>
        <TabPanel tabKey="tools" lazy className="pt-[16px]"><ConnectorsAdminPage /></TabPanel>
      </Tabs>
    </div>
  );
}
