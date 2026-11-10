'use client';

// Monitoring > Dependencies: who relies on what. It is the Technology page and the Concentration page in one: what suppliers run, the platforms and known-exploited flaws several of them share,
// and the suppliers our own discovery found that nobody has recorded. The view, the search and the category are in the address (?view=platforms&q=aws), so a link opens the same page; the old
// /technology?q= and /concentration addresses forward here. The views are _dependencies/*.
import { useId } from 'react';
import { PageHeader } from '@/components/ui';
import { SegmentedControl, useAddressState } from '@/components/ui/ds';
import { oneOf, text } from '@/lib/addressState';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { VendorTabs } from '../_lib/VendorNav';
import { PlatformsView, TechnologyView, UnregisteredView, VulnerabilitiesView } from '../_dependencies/DependenciesViews';
import { VIEWS, VIEW_LABEL, type DepView } from '../_dependencies/dependenciesModel';

const VIEW = { view: oneOf(VIEWS, 'technology'), q: text(), cat: text() };
const INFO = 'What suppliers run, read from their websites, mail and DNS records, and from Shodan where a key is connected; the platforms and known-exploited flaws several suppliers share; and the suppliers our own discovery found that nobody has recorded.';

export default function DependenciesPage() {
  const uid = useId();
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');
  const canRequest = hasPermission('vendor_risk:intake:create') || erm;
  const canEdit = hasPermission('vendor_risk:config:edit') || erm;       // the server's right for platform names (config:edit, or the risk-edit right in its place)
  const [{ view, q, cat }, set] = useAddressState(VIEW);
  const label = routeFor('/vendor-risk/dependencies')?.label ?? 'Dependencies';
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <PageHeader variant="page" title={label} info={INFO} />
      <VendorTabs />
      <SegmentedControl label="Dependencies view" name={`${uid}-view`} options={VIEWS.map((v) => ({ value: v, label: VIEW_LABEL[v] }))} value={view} onChange={(v) => set({ view: v as DepView })} />
      {view === 'technology' && <TechnologyView q={q} category={cat} onQuery={(v) => set({ q: v, cat: '' })} onCategory={(v) => set({ cat: v })} />}
      {view === 'platforms' && <PlatformsView canEdit={canEdit} />}
      {view === 'vulnerabilities' && <VulnerabilitiesView />}
      {view === 'unregistered' && <UnregisteredView canRequest={canRequest} canEdit={canEdit} />}
    </div>
  );
}
