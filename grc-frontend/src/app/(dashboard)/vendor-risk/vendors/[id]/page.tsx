'use client';

// A vendor's record: the header (who it is, its tier, status and grade, what can be done), the exit card while an offboarding is open,
// six tabs kept in `?tab=` (the old twelve map onto them, and the deep links ?stage=, ?finding= and ?engagement= still work), and a
// 20rem column of facts beside every tab but the Lifecycle. The tabs are components of their own (`_tabs/`); the page owns the vendor,
// the engagement picked, and the dialogs the header opens.
import { useEffect, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { BadgeCheck, Copy, FileText, Layers, LogOut, Pencil, UserPlus, Users } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';
import { usePermissions } from '@/hooks/usePermissions';
import {
  BTN, BTN_PRIMARY, DetailHeader, EmptyState, ErrorState, GradePill, Skeleton, StatusPill, TONE, TierBadge, fmt, tones, useUrlParams,
  type Tone,
} from '../../_ui';
import VendorLogo from '../../_lib/VendorLogo';
import { engagementsKey, useEngagements } from '../../_lib/engagementsApi';
import { useOffboarding } from '../../_lib/offboardingApi';
import type { SupplierContact } from '../../_lib/portalApi';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import {
  TABS, classificationTone, findingFrom, isTiered, metaParts, openScopes, pickEngagement, recordHref, targetTiered, tabFor, tierHref,
  tierTarget, webHost, webHref, type TabKey,
} from '../../_lib/vendorRecordModel';
import VendorFormDialog from '../_components/VendorFormDialog';
import ActionsMenu, { type MenuItem } from './_record/ActionsMenu';
import ContactDialog from './_record/ContactDialog';
import RightColumn from './_record/RightColumn';
import AssessmentsTab from './_tabs/AssessmentsTab';
import FindingsTab from './_tabs/FindingsTab';
import LifecycleTab from './_tabs/LifecycleTab';
import MonitoringTab from './_tabs/MonitoringTab';
import OverviewTab from './_tabs/OverviewTab';
import PaperworkTab from './_tabs/PaperworkTab';
import type { TabProps } from './_tabs/tabProps';
import { EngagementForm, WorstOfNote } from './_tpra/EngagementsPanel';
import OffboardingPanel, { StartOffboardingDialog } from './_tpra/OffboardingPanel';

const TAB_COMPONENT: Record<TabKey, ComponentType<TabProps>> = {
  overview: OverviewTab, lifecycle: LifecycleTab, assessments: AssessmentsTab, findings: FindingsTab, paperwork: PaperworkTab, monitoring: MonitoringTab,
};

/** A small badge for a fact about the vendor ("Holds personal data", "Restricted"): a tone's tint, no dot. */
function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const c = TONE[tone];
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-md border px-2 py-[3px] text-[11px] font-semibold leading-none" style={{ background: c.tint, color: c.text, borderColor: c.border }}>
      {children}
    </span>
  );
}

const statusOf = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

export default function VendorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const url = useUrlParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const vendorId = Number(params.id);
  const canEdit = hasPermission('vendor_risk:vendors:edit') || hasPermission('erm:risks:edit');
  const canTier = hasPermission('vendor_risk:assessments:edit') || hasPermission('erm:risks:edit');

  const vendorQuery = useQuery({
    queryKey: ['vendor', vendorId],
    queryFn: async () => (await vendorRiskApi.getVendor(vendorId)).data as Record<string, any>,
    enabled: !!vendorId,
    retry: (n, e) => statusOf(e) !== 404 && n < 1,
  });
  const vendor = vendorQuery.data;
  const engagements = useEngagements(vendorId);
  const offboarding = useOffboarding(vendorId);

  // The address says which tab, which stage or finding, and which engagement.
  const rawTab = url.get('tab');
  const stage = url.get('stage');
  const findingId = findingFrom(url.get('finding'));
  const tab = tabFor({ tab: rawTab, stage, finding: url.get('finding') });
  const items = engagements.data?.items;
  const engagementId = pickEngagement(items, Number(url.get('engagement')) || null);

  // An old ?tab= key is rewritten to the tab that holds its content now.
  useEffect(() => {
    if (rawTab && rawTab !== tab) url.set({ tab });
  }, [rawTab, tab, url]);

  const [editing, setEditing] = useState(false);
  const [addingEngagement, setAddingEngagement] = useState(false);
  const [contact, setContact] = useState<SupplierContact | 'new' | null>(null);
  const [startingExit, setStartingExit] = useState(false);

  // "VAT check" is a card on the Overview: go there, then bring it into view once it is drawn.
  const [wantVat, setWantVat] = useState(false);
  useEffect(() => {
    if (!wantVat || tab !== 'overview') return undefined;
    const timer = setTimeout(() => {
      document.getElementById('vendor-vat-check')?.scrollIntoView({ block: 'center' });
      document.getElementById('vendor-vat-input')?.focus({ preventScroll: true });
      setWantVat(false);
    }, 150);
    return () => clearTimeout(timer);
  }, [wantVat, tab]);

  const tabRefs = useRef<Partial<Record<TabKey, HTMLButtonElement | null>>>({});
  // A tab click drops the one-shot deep links (a stage, a finding, a request, the tiering popup) so they do not fire again.
  const select = (key: TabKey) => url.set({ tab: key, stage: null, finding: null, tier: null, request: null });
  const onTabKey = (e: KeyboardEvent) => {
    const at = TABS.findIndex((t) => t.key === tab);
    let next = at;
    if (e.key === 'ArrowRight') next = (at + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    select(TABS[next].key);
    tabRefs.current[TABS[next].key]?.focus();
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
    qc.invalidateQueries({ queryKey: engagementsKey(vendorId) });
    qc.invalidateQueries({ queryKey: ['tpra-lifecycle', vendorId] });
  };

  if (vendorQuery.isLoading) {
    return (
      <div className="mx-auto max-w-7xl space-y-4" aria-busy="true">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-16 w-2/3" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (!vendor) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        {!vendorId || statusOf(vendorQuery.error) === 404 ? (
          <EmptyState
            title="This vendor is not here"
            hint="It may have been archived, or the link may be wrong."
            action={<Link href="/vendor-risk/vendors" className={BTN}>Back to the register</Link>}
          />
        ) : (
          <ErrorState title="Couldn't load this vendor" onRetry={() => vendorQuery.refetch()} />
        )}
      </div>
    );
  }

  const tiered = isTiered(vendor);
  const supplier = engagements.data?.supplier;
  const closing = !!vendor.archived_at || !!offboarding.data?.started;
  // The picker is on the Lifecycle and Assessments tabs: only there is the engagement picked on purpose (elsewhere "Tier engagement" and
  // "Start offboarding" are for the vendor, and the first engagement still to be tiered).
  const pickerTab = tab === 'lifecycle' || tab === 'assessments';
  const picked = pickerTab ? engagementId : null;
  const target = tierTarget(items, picked);
  const several = openScopes(items).length > 1;
  const website = webHref(vendor.website);
  const meta = metaParts(vendor);
  const Current = TAB_COMPONENT[tab];
  const tabProps: TabProps = { vendorId, engagementId, onEngagementChange: (id) => url.set({ engagement: id == null ? null : String(id) }), vendor, stage, findingId, onChanged: refresh };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${recordHref(vendorId)}`);
      toast({ type: 'success', title: 'Link copied' });
    } catch {
      toast({ type: 'error', title: 'Could not copy the link' });
    }
  };

  const menu: MenuItem[] = [
    { key: 'tier', label: targetTiered(items, target) ? 'Re-tier engagement' : 'Tier engagement', icon: Layers, onSelect: () => router.push(tierHref(vendorId, target)), hidden: !canTier || closing },
    { key: 'engagement', label: 'Add engagement', icon: Users, onSelect: () => setAddingEngagement(true), hidden: !canEdit || !engagements.data || !!vendor.archived_at },
    { key: 'contact', label: 'Add contact', icon: UserPlus, onSelect: () => setContact('new'), hidden: !canEdit },
    { key: 'summary', label: 'Summary report', icon: FileText, onSelect: () => router.push(`/vendor-risk/vendors/${vendorId}/summary`) },
    { key: 'vat', label: 'VAT check', icon: BadgeCheck, onSelect: () => { setWantVat(true); if (tab !== 'overview') select('overview'); } },
    { key: 'copy', label: 'Copy link', icon: Copy, onSelect: copyLink },
    { key: 'offboard', label: 'Start offboarding', icon: LogOut, danger: true, onSelect: () => setStartingExit(true), hidden: !canEdit || closing || !offboarding.data },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <DetailHeader
        backHref="/vendor-risk/vendors"
        backLabel="Back to register"
        logo={<VendorLogo vendorId={vendor.id} name={vendor.name} size={48} />}
        title={vendor.name}
        chips={(
          <>
            <span className="inline-flex items-center">
              <TierBadge tier={tiered ? vendor.tier : null} suffix="tier" />
              <WorstOfNote vendorId={vendorId} />
            </span>
            {vendor.status && <StatusPill tone={tones.lifecycle(vendor.status)}>{fmt.status(vendor.status)}</StatusPill>}
            {vendor.archived_at && <StatusPill tone="neutral">Archived</StatusPill>}
            {supplier?.rating_grade && (
              <span title={supplier.residual_risk_score != null ? `Residual score ${Math.round(supplier.residual_risk_score * 10) / 10}` : undefined}>
                <GradePill grade={supplier.rating_grade} prefix="Grade" />
              </span>
            )}
            {vendor.holds_personal_data === true && <Badge tone="warning">Holds personal data</Badge>}
            {vendor.data_classification && <Badge tone={classificationTone(vendor.data_classification)}>{fmt.status(vendor.data_classification)}</Badge>}
          </>
        )}
        meta={(meta.length > 0 || website) ? (
          <>
            {meta.join(' · ')}
            {website && (
              <>
                {meta.length > 0 ? ' · ' : ''}
                <a href={website} target="_blank" rel="noopener noreferrer" className="rounded-sm font-medium text-[#0f766e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">
                  {webHost(vendor.website)}
                </a>
              </>
            )}
          </>
        ) : undefined}
        actions={(
          <>
            {canTier && !tiered && !closing && tab !== 'lifecycle' && (
              <Link href={tierHref(vendorId, target)} className={BTN_PRIMARY}>Tier engagement</Link>
            )}
            {canEdit && (
              <button type="button" onClick={() => setEditing(true)} className={BTN}>
                <Pencil aria-hidden className="h-4 w-4" strokeWidth={1.75} /> Edit
              </button>
            )}
            <ActionsMenu items={menu} />
          </>
        )}
      />

      <OffboardingPanel vendorId={vendorId} exitOnly />

      <div className="border-b border-[#d5dbe1]">
        <nav role="tablist" aria-label="Vendor record sections" className="flex gap-6 overflow-x-auto" onKeyDown={onTabKey}>
          {TABS.map((t) => {
            const selected = tab === t.key;
            return (
              <button
                key={t.key}
                id={`vendor-tab-${t.key}`}
                ref={(el) => { tabRefs.current[t.key] = el; }}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={`vendor-tabpanel-${t.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(t.key)}
                className={clsx(
                  'whitespace-nowrap border-b-2 px-1 pb-3 pt-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] focus-visible:ring-offset-1',
                  selected ? 'border-[#0f766e] text-[#0f766e]' : 'border-transparent text-[#586472] hover:text-[#1f2933]',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
      </div>

      {pickerTab && several && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#f3f6f8] px-3 py-2">
          <label htmlFor="vendor-engagement" className="text-[13px] font-medium leading-5 text-[#26323d]">Engagement</label>
          <select
            id="vendor-engagement"
            value={engagementId ?? ''}
            onChange={(e) => url.set({ engagement: e.target.value || null })}
            className="h-9 min-w-[14rem] rounded-lg border border-[#c3ccd5] bg-[#fff] px-3 text-sm text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          >
            {openScopes(items).map((e) => (
              <option key={e.id ?? 'general'} value={e.is_general ? '' : (e.id as number)}>
                {e.name}{' · '}{isTiered(e) ? fmt.status(e.tier) : 'Not tiered'}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={tab === 'lifecycle' ? undefined : 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]'}>
        <div role="tabpanel" id={`vendor-tabpanel-${tab}`} aria-labelledby={`vendor-tab-${tab}`} tabIndex={0} className="min-w-0 focus:outline-none">
          <Current {...tabProps} />
        </div>
        {tab !== 'lifecycle' && (
          <RightColumn
            vendorId={vendorId}
            vendor={vendor}
            engagementId={engagementId}
            engagements={engagements.data}
            canEdit={canEdit}
            onAddContact={() => setContact('new')}
            onEditContact={setContact}
          />
        )}
      </div>

      {editing && <VendorFormDialog open mode="edit" vendor={vendor} onClose={() => setEditing(false)} />}
      {addingEngagement && engagements.data && (
        <EngagementForm vendorId={vendorId} engagement={null} list={engagements.data} onClose={() => setAddingEngagement(false)} />
      )}
      <ContactDialog vendorId={vendorId} contact={contact} onClose={() => setContact(null)} />
      <StartOffboardingDialog vendorId={vendorId} open={startingExit} onClose={() => setStartingExit(false)} engagementId={picked} />
    </div>
  );
}
