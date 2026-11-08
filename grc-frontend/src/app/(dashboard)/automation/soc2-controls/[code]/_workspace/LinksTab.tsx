'use client';

// The Links tab: what the control is tied to. The Requirements it discharges (by framework), the Risks it mitigates, the Assets it protects, the Other records it relies on (documents, vendors,
// issues, projects, tasks, evidence, internal controls) and the Regulatory obligations it meets. The old page had five tabs for these and counted each on open (six requests); now a section
// reads its own list when the tab opens.
import { useQuery } from '@tanstack/react-query';
import RegulatoryObligationsCard, { useRegulatoryLinks } from '@/components/regulatory/RegulatoryObligationsCard';
import { automationApi } from '@/lib/api';
import { AssetsSection, RecordsSection, RisksSection } from './LinkedSections';
import { RequirementsSection } from './RequirementsSection';
import { SectionStack } from './SectionStack';
import { useWorkspace } from './workspaceContext';

export function LinksTab() {
  const { code, d } = useWorkspace();
  const risks = useQuery({ queryKey: ['control-risks', code], queryFn: async () => (await automationApi.listControlRisks(code)).data as { items: unknown[] } });
  const assets = useQuery({ queryKey: ['control-assets', code], queryFn: async () => (await automationApi.listControlAssets(code)).data as { items: unknown[] } });
  const links = useQuery({ queryKey: ['control-links', code], queryFn: async () => (await automationApi.listControlLinks(code)).data.items });
  const regulatory = useRegulatoryLinks('control', { ref: code });
  const others = (links.data ?? []).filter((r) => r.type !== 'risk' && r.type !== 'asset').length;
  const count = (n: number | undefined, one: string, many: string, failed: boolean) => (n == null ? (failed ? 'Couldn’t be loaded' : undefined) : `${n} ${n === 1 ? one : many}`);
  return (
    <SectionStack
      label="Links"
      sections={[
        { key: 'requirements', meta: d.requirement_count ? `${d.requirement_count} ${d.requirement_count === 1 ? 'requirement' : 'requirements'} · ${d.framework_count} ${d.framework_count === 1 ? 'framework' : 'frameworks'}` : 'None map to this control', children: <RequirementsSection /> },
        { key: 'risks', meta: count(risks.data?.items.length, 'risk', 'risks', risks.isError), children: <RisksSection /> },
        { key: 'assets', meta: count(assets.data?.items.length, 'asset', 'assets', assets.isError), children: <AssetsSection /> },
        { key: 'records', meta: count(links.data ? others : undefined, 'record', 'records', links.isError), children: <RecordsSection /> },
        { key: 'regulatory', meta: count(regulatory.data?.length, 'obligation', 'obligations', regulatory.isError), children: <RegulatoryObligationsCard targetType="control" targetRef={code} noun="control" /> },
      ]}
    />
  );
}
