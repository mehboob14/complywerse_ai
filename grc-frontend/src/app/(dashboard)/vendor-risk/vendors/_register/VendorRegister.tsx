'use client';

// The Vendors register (Third-Party Vendor Risk > Vendors): the Facet explorer over every vendor in use (read whole, lean rows), as a List or as a Board by lifecycle stage (what the old
// Vendors > Assessments page drew), with live counts for tier, status, next step, owner, unit, type, stage, personal data and classification, and a drawer that carries the next step.
// The state of the page is in its address (a filter, a chip, a sort, the view, the open vendor): every link the old register wrote still lands on the same vendors (migrateAddress).
// The two ways to bring a vendor in (Request vendor, Add vendor) are the module's own (VendorActions); Import and the vendor settings are in the head's menu; "Archived" asks the server
// for the archived vendors instead. Nothing here changes a right: what a person may do is what the server checks (useVendorActions).
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, Settings as SettingsIcon, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, Menu, Notice, Sheet, type MenuItem } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { OwnerCell } from '@/components/records/cells';
import { useCurrentUserId } from '@/components/records/lookups';
import type { RecordColumn, RecordRow } from '@/components/records/RecordTable';
import { RecordDetail, RegisterFrame } from '@/components/records/RegisterFrame';
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';
import { listOptions, statusChoices, useModuleSettings } from '@/components/settings/CustomFields';
import { formatCount, truncate } from '@/lib/format';
import { vendorLifecycle } from '@/lib/statuses/vendor';
import AddVendorDialog from '../../_lib/AddVendorDialog';
import VendorActions from '../../_lib/VendorActions';
import { VendorTabs } from '../../_lib/VendorNav';
import { usePortfolioCounts } from '../../_lib/portfolioApi';
import { headerStats } from '../../_lib/portfolioModel';
import {
  VENDOR_SCHEMA, migrateAddress, ownerName, recordHref, stageProgress, subline, vendorDef, type VendorRow,
} from '../../_lib/vendorRegisterDef';
import ImportVendors from '../_ImportVendors';
import { vendorsKey, useVendorRows } from './vendorData';
import { VendorDetail } from './VendorDetail';
import { ClassPill, GradePill, NextStep, ReviewDate, StatusWord, TierPill } from './VendorCells';
import { useVendorActions } from './useVendorActions';

const MUTED = 'text-ds-fg-muted';
const INFO = 'Every third party you share data or systems with: who it is, how risky it is, who owns it and what it waits on. Filter by anything on the left; open a vendor to act on it. Board shows where each vendor is in its lifecycle.';
const BUILTIN_STATUSES = ['active', 'under_review', 'onboarding', 'offboarded', 'suspended'].map((value) => ({ value, label: vendorLifecycle.label(value) }));

export default function VendorRegister({ label }: { label: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useCurrentUserId();
  const counts = usePortfolioCounts();
  const actions = useVendorActions();
  const [importing, setImporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState(false);

  // an address the old register wrote is read as the new one reads it (once, then the address is the new one)
  const search = params?.toString() ?? '';
  useEffect(() => {
    const next = migrateAddress(search);
    if (next !== null) router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [search, pathname, router]);

  const archived = params?.get('archived') === '1';
  const setArchived = (on: boolean) => {
    const next = new URLSearchParams(search);
    if (on) next.set('archived', '1'); else next.delete('archived');
    next.delete('id');
    next.delete('page');
    router.replace(next.toString() ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  };

  const { data: fields } = useModuleSettings('vendors');
  const def = useMemo(() => vendorDef({
    me,
    statuses: statusChoices(fields, BUILTIN_STATUSES),
    types: listOptions(fields, 'vendor_type', null).map((o) => ({ value: o.value, label: o.label })),
  }), [me, fields]);
  const list = useVendorRows(archived);
  const rows = useMemo(() => list.data?.items ?? [], [list.data]);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { if (list.dataUpdatedAt) setNow(new Date()); }, [list.dataUpdatedAt]);

  const columns: RecordColumn<VendorRow>[] = [
    {
      key: 'vendor', header: 'Vendor', sortKey: 'name',
      cell: (row) => (
        <div className="min-w-0">
          <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]" title={row.record.name}>{row.record.name}</span>
          {subline(row.record) && <span className={`block truncate text-ds-label ${MUTED}`}>{subline(row.record)}</span>}
        </div>
      ),
    },
    { key: 'tier', header: 'Tier', sortKey: 'tier', fit: { px: 112 }, cell: (row) => <TierPill v={row.record} /> },
    { key: 'next', header: 'Next step', fit: { px: 196 }, cell: (row) => <NextStep v={row.record} /> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: { px: 124, dropRank: 5 }, cell: (row) => <StatusWord v={row.record} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: { px: 96, dropRank: 4, wide: { px: 168, titleMin: 420 } }, cell: (row, look) => <OwnerCell name={ownerName(row.record)} wide={look.wide} /> },
    { key: 'review', header: 'Next review', sortKey: 'next_reassessment', fit: { px: 128, dropRank: 3 }, cell: (row) => <ReviewDate v={row.record} now={now} /> },
    { key: 'grade', header: 'Grade', sortKey: 'grade', fit: { px: 92, dropRank: 2 }, cell: (row) => <GradePill v={row.record} /> },
    { key: 'stage', header: 'Lifecycle', fit: { px: 168, dropRank: 1 }, cell: (row) => <span className="whitespace-nowrap text-ds-body text-ds-fg-body">{stageProgress(row.record.lifecycle?.stage)}</span> },
  ];
  const meta = (v: VendorRow): string => [ownerName(v) || 'Unassigned', v.business_unit?.name].filter(Boolean).join(' · ');
  const card = (row: RecordRow<VendorRow>) => (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{row.record.name}</span>
      <span className="flex flex-wrap items-center gap-[8px]"><TierPill v={row.record} /><StatusWord v={row.record} />{row.record.grade && <GradePill v={row.record} />}</span>
      <NextStep v={row.record} />
      <span className={`truncate text-ds-label ${MUTED}`}>{meta(row.record)}</span>
    </div>
  );
  const boardCard = (v: VendorRow) => (
    <>
      <span className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{v.name}</span>
      <span className="flex flex-wrap items-center gap-[6px]"><TierPill v={v} />{v.lifecycle?.open_findings ? <span className={`text-ds-label ${MUTED}`}>{`${formatCount(v.lifecycle.open_findings)} open ${v.lifecycle.open_findings === 1 ? 'finding' : 'findings'}`}</span> : null}</span>
      <span className="block"><NextStep v={v} /></span>
      <span className={`truncate text-ds-label ${MUTED}`}>{meta(v)}</span>
    </>
  );

  const more: MenuItem[] = [
    { key: 'import', label: 'Import vendors', icon: Upload, hidden: !actions.canCreate, onSelect: () => setImporting(true) },
    { key: 'settings', label: 'Vendor settings', icon: SettingsIcon, onSelect: () => setSettings(true) },
  ];
  const head = () => (
    <>
      <PageHeader variant="page" title={label} info={INFO} meta={headerStats(counts)} actions={<><Menu iconOnly label="More actions" items={more} /><VendorActions /></>} />
      <VendorTabs />
    </>
  );
  const first = archived
    ? <EmptyState bare kind="firstUse" title="No archived vendors" description="A vendor you archive leaves this register and shows here." action={<Button onClick={() => setArchived(false)}>Back to the register</Button>} />
    : <EmptyState bare kind="firstUse" title="No vendors yet" description={actions.canCreate ? 'Add the third parties you share data or systems with.' : 'No vendors have been added yet.'}
      action={actions.canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add vendor</Button> : undefined} />;

  return (
    <>
      <RegisterFrame
        def={def}
        schema={VENDOR_SCHEMA}
        label={label}
        rows={rows}
        loading={list.isLoading}
        error={list.isError && !list.data ? list.error : undefined}
        refreshError={list.isError && list.data ? list.error : undefined}
        onRetry={() => { void list.refetch(); }}
        serverTotal={list.data?.total}
        head={head}
        notices={archived ? (
          <Notice tone="info" title="Showing archived vendors" action={<Button onClick={() => setArchived(false)}>Back to the register</Button>}>
            They are left out of the register, the dashboards and the reminders. Restore one to bring it back.
          </Notice>
        ) : undefined}
        actions={() => <Button leftIcon={<Archive aria-hidden />} aria-pressed={archived} onClick={() => setArchived(!archived)}>{archived ? 'Archived: on' : 'Archived'}</Button>}
        columns={columns}
        card={card}
        boardCard={boardCard}
        boardLabel={(v) => v.name}
        rowActions={(v) => <Menu iconOnly label={`Actions for ${truncate(v.name, 60).text}`} items={actions.menuFor(v)} />}
        rowLabel={(v) => `Select ${truncate(v.name, 60).text}`}
        searchLabel="Search vendors by name, type, owner, unit or next step"
        noAccess={{ title: "You don't have access to the vendors", reason: errorMessage(list.error) }}
        emptyFirst={first}
        detail={(open, nav) => {
          const step = open ? actions.nextStep(open) : null;
          return (
            <RecordDetail
              id={open?.id ?? null}
              nav={nav}
              title={<span dir="auto" className="line-clamp-3 break-words" title={open?.name}>{open?.name}</span>}
              subtitle={open ? subline(open) || undefined : undefined}
              footer={open ? (
                <div className="flex flex-wrap items-center gap-[8px]">
                  <Button href={recordHref(open.id)} variant="primary">Open vendor</Button>
                  {step && <Button loading={step.busy} onClick={step.run}>{step.label}</Button>}
                  <Menu label="More" items={actions.menuFor(open, ['open', step?.key ?? ''])} />
                </div>
              ) : undefined}
            >
              {open && <VendorDetail v={open} now={now} />}
            </RecordDetail>
          );
        }}
      />
      {importing && <ImportVendors onClose={() => setImporting(false)} onDone={() => { void qc.invalidateQueries({ queryKey: ['vendors'] }); void qc.invalidateQueries({ queryKey: vendorsKey(false) }); }} />}
      <Sheet open={settings} onClose={() => setSettings(false)} title="Vendor settings" subtitle="Statuses, SLA, fields and dropdown lists" width="lg" side="right">
        <ModuleSettingsPanel moduleKey="vendors" />
      </Sheet>
      <AddVendorDialog open={adding} onClose={() => setAdding(false)} />
      {actions.confirmDialog}
    </>
  );
}
