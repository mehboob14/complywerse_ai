'use client';

// A supplier's record. This file is only the host: it reads the vendor (and, with it, the engagements, the exit and the contacts: the four reads of the first paint), draws the head, the
// "Next up" strip, the tabs and the "At a glance" card, and opens the dialogs the head offers. Each tab's body is a chunk of its own, loaded when the tab is first opened (`TabPanel lazy`),
// and the heavy dialogs load when first used. Reads that only decorate the page (the logo, who is next, the two tab counts) wait until the first paint is out.
// The address holds the tab (`?tab=`, the twelve older keys still land on the tab that holds their content now), a stage (`?stage=`), a finding (`?finding=`, which beats a stage), an
// engagement (`?engagement=`), the tiering dialog (`?tier=`) and a request (`?request=`); a tab click drops the ones that act once.
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorState, Notice, Skeleton, SkeletonLines, TabPanel, Tabs, useAddressState } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { usePermissions } from '@/hooks/usePermissions';
import { text } from '@/lib/addressState';
import { engagementsKey, useEngagements } from '../../_lib/engagementsApi';
import { useOffboarding } from '../../_lib/offboardingApi';
import type { SupplierContact } from '../../_lib/portalApi';
import { BACK, recordTabs, showsPicker, tabPatch } from '../../_lib/recordShellModel';
import { findingFrom, isTiered, openScopes, pickEngagement, tabFor, targetTiered, tierTarget } from '../../_lib/vendorRecordModel';
import AtAGlance from './_record/AtAGlance';
import EngagementPicker from './_record/EngagementPicker';
import NextUpStrip from './_record/NextUpStrip';
import RecordHead from './_record/RecordHead';
import { failed, statusOf, useAfterPaint, useNextUp, useTabCounts, useVendorRecord } from './_record/recordData';
import OverviewTab from './_tabs/OverviewTab';
import type { TabProps } from './_tabs/tabProps';
import { EngagementForm } from './_tpra/EngagementsPanel';
import OffboardingPanel, { StartOffboardingDialog } from './_tpra/OffboardingPanel';

const TabLoading = () => <div className="pt-[16px]"><SkeletonLines lines={6} label="Loading this tab" /></div>;
const lazyTab = (load: () => Promise<{ default: React.ComponentType<TabProps> }>) => dynamic(load, { ssr: false, loading: TabLoading });
const LifecycleTab = lazyTab(() => import('./_tabs/LifecycleTab'));
const AssessmentsTab = lazyTab(() => import('./_tabs/AssessmentsTab'));
const FindingsTab = lazyTab(() => import('./_tabs/FindingsTab'));
const PaperworkTab = lazyTab(() => import('./_tabs/PaperworkTab'));
const MonitoringTab = lazyTab(() => import('./_tabs/MonitoringTab'));
const VendorFormDialog = dynamic(() => import('../_components/VendorFormDialog'), { ssr: false });
const ContactDialog = dynamic(() => import('./_record/ContactDialog'), { ssr: false });

const BODY = { lifecycle: LifecycleTab, assessments: AssessmentsTab, findings: FindingsTab, paperwork: PaperworkTab, monitoring: MonitoringTab } as const;

const SCHEMA = { tab: text(), stage: text(), finding: text(), engagement: text(), tier: text(), request: text() };

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-[16px]">
      <Skeleton className="h-[16px] w-[80px]" />
      <Skeleton className="h-[28px] w-[40%]" />
      <Skeleton className="h-[32px] w-[60%]" />
      <Skeleton className="h-[44px] w-full" />
      <Skeleton className="h-[32px] w-full" />
      <SkeletonLines lines={8} label="Loading the supplier" />
    </div>
  );
}

export default function VendorRecordPage() {
  const params = useParams();
  const vendorId = Number(params.id);
  const qc = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const canTier = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const vendorQuery = useVendorRecord(vendorId);
  const vendor = vendorQuery.data;
  const engagements = useEngagements(vendorId);
  const offboarding = useOffboarding(vendorId);

  const [address, set] = useAddressState(SCHEMA);
  const tab = tabFor({ tab: address.tab, stage: address.stage, finding: address.finding });
  const items = engagements.data?.items;
  const engagementId = pickEngagement(items, Number(address.engagement) || null);

  // An old ?tab= key is rewritten to the tab that holds its content now.
  useEffect(() => {
    if (address.tab && address.tab !== tab) set({ tab });
  }, [address.tab, tab, set]);

  // An archived supplier has no engagements, contacts, steps or findings to read (the server answers "not found"): nothing is asked for them.
  const archived = !!vendor?.archived_at;
  const late = useAfterPaint(!!vendor);
  const next = useNextUp(vendorId, engagementId, late && !archived);
  const counts = useTabCounts(vendorId, engagementId, late && !archived);

  const [editing, setEditing] = useState(false);
  const [addingEngagement, setAddingEngagement] = useState(false);
  const [contact, setContact] = useState<SupplierContact | 'new' | null>(null);
  const [startingExit, setStartingExit] = useState(false);
  const [vatRequest, setVatRequest] = useState(0);

  useEffect(() => { document.title = vendor ? `${vendor.name} · Supplier` : 'Supplier'; }, [vendor]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
    void qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
    void qc.invalidateQueries({ queryKey: ['tpra-lifecycle', vendorId] });
  };

  if (!vendor) {
    if (vendorQuery.isPending) return <Loading />;
    const gone = !vendorId || statusOf(vendorQuery.error) === 404;
    return (
      <div className="mx-auto flex max-w-[640px] flex-col gap-[16px] py-[24px]">
        {gone ? (
          <EmptyState kind="firstUse" title="This supplier is not here" description="It may have been archived, or the link may be wrong." action={<Button href={BACK.href} variant="primary">Back to vendors</Button>} />
        ) : (
          <>
            <ErrorState title="Couldn’t load this supplier" message={errorMessage(vendorQuery.error)} onRetry={() => { void vendorQuery.refetch(); }} />
            <div><Button href={BACK.href}>Back to vendors</Button></div>
          </>
        )}
      </div>
    );
  }

  const supplier = engagements.data?.supplier;
  const tiered = isTiered(vendor);
  const closing = archived || !!offboarding.data?.started;
  // The picker is on the Lifecycle and Assessments tabs: only there is the engagement picked on purpose (elsewhere "Tier engagement" is for the vendor, and for the first engagement still to be tiered).
  const picker = showsPicker(tab, openScopes(items).length);
  const picked = tab === 'lifecycle' || tab === 'assessments' ? engagementId : null;
  const target = tierTarget(items, picked);
  const engagementsFailed = failed(engagements);
  const readFailed = engagementsFailed || failed(offboarding);

  const tabProps: TabProps = {
    vendorId, engagementId, vendor, stage: address.stage || null, findingId: findingFrom(address.finding), vatRequest,
    onEngagementChange: (id) => set({ engagement: id == null ? '' : String(id) }),
    onChanged: refresh,
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <RecordHead
        vendor={vendor}
        vendorId={vendorId}
        grade={supplier?.rating_grade ?? null}
        onLifecycleTab={tab === 'lifecycle'}
        a={{
          canEdit, canTier, tiered, closing, archived, target, targetTiered: targetTiered(items, target),
          canAddEngagement: !!engagements.data, canStartExit: !!offboarding.data,
          onEdit: () => setEditing(true), onAddEngagement: () => setAddingEngagement(true), onAddContact: () => setContact('new'), onStartExit: () => setStartingExit(true),
          onVat: () => { setVatRequest((n) => n + 1); if (tab !== 'overview') set(tabPatch('overview')); },
        }}
      />

      {vendorQuery.isError && (
        <Notice tone="warning" title="Couldn’t refresh this supplier" action={<Button onClick={() => { void vendorQuery.refetch(); }}>Retry</Button>}>
          What you see may be out of date.
        </Notice>
      )}
      {readFailed && (
        <Notice
          tone="warning"
          title={engagementsFailed ? 'Couldn’t read the engagements' : 'Couldn’t read the exit status'}
          action={<Button onClick={() => { void (engagementsFailed ? engagements.refetch() : offboarding.refetch()); }}>Retry</Button>}
        >
          {engagementsFailed ? 'The tier, grade and review date below may be incomplete.' : 'Whether an exit is under way may not be shown.'}
        </Notice>
      )}

      {archived && (
        <Notice tone="info" title="This supplier is archived">
          Its engagements, contacts and lifecycle are kept but cannot be opened until it is restored from the register’s Archived view.
        </Notice>
      )}
      <OffboardingPanel vendorId={vendorId} exitOnly />
      <NextUpStrip vendor={vendor} items={items} next={next} archived={archived} />

      <div className="grid items-start gap-[16px] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Tabs tabs={recordTabs(counts)} value={tab} onChange={(key) => set(tabPatch(key))} ariaLabel="Supplier sections" countFormat="exact">
            {picker && items && (
              <div className="pt-[12px]">
                <EngagementPicker items={items} value={engagementId} onChange={(id) => set({ engagement: id == null ? '' : String(id) })} />
              </div>
            )}
            <TabPanel tabKey="overview"><div className="pt-[16px]"><OverviewTab {...tabProps} /></div></TabPanel>
            {(Object.keys(BODY) as Array<keyof typeof BODY>).map((key) => {
              const Tab = BODY[key];
              return <TabPanel key={key} tabKey={key} lazy><div className="pt-[16px]"><Tab {...tabProps} /></div></TabPanel>;
            })}
          </Tabs>
        </div>
        <AtAGlance
          vendorId={vendorId}
          vendor={vendor}
          engagementId={engagementId}
          engagements={engagements.data}
          engagementsFailed={engagementsFailed}
          onRetryEngagements={() => { void engagements.refetch(); }}
          canEdit={canEdit && !archived}
          archived={archived}
          late={late}
          onAddContact={() => setContact('new')}
          onEditContact={setContact}
        />
      </div>

      {editing && <VendorFormDialog open mode="edit" vendor={vendor} onClose={() => setEditing(false)} />}
      {addingEngagement && engagements.data && <EngagementForm vendorId={vendorId} engagement={null} list={engagements.data} onClose={() => setAddingEngagement(false)} />}
      {contact !== null && <ContactDialog vendorId={vendorId} contact={contact} onClose={() => setContact(null)} />}
      <StartOffboardingDialog vendorId={vendorId} open={startingExit} onClose={() => setStartingExit(false)} engagementId={picked} />
    </div>
  );
}
