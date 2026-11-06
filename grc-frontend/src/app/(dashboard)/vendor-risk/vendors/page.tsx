'use client';

// The Register: every vendor in use, sliced by the pills in its toolbar and sorted by the server. The filters, the sort and the page
// live in the address (a link or a reload lands where you were); the columns you choose are kept in this browser. A row opens the
// vendor; the ⋯ menu copies its link, starts its tiering, goes to what blocks it, visits its website, archives or restores it.
// The title and "Add vendor" are the module header's (layout); this page keeps Import, Settings and the Archived view the old one had.

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Archive, ArchiveRestore, Building2, ExternalLink, Gauge, Link2, Settings as SettingsIcon, Upload, Workflow } from 'lucide-react';
import { vendorRiskApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/components/ui/ToastProvider';
import { listOptions, statusChoices, useModuleSettings } from '@/components/settings/CustomFields';
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';
import type { RowAction } from '@/app/(dashboard)/governance/documents/_workspace/RowActionsMenu';
import { BTN, BTN_PRIMARY, Dialog, EmptyState, ErrorState, Skeleton, fmt, useUrlParams } from '../_ui';
import AddVendorDialog from '../_lib/AddVendorDialog';
import Pager from '../_lib/Pager';
import { errText } from '../_lib/intake/types';
import { countsKey, portfolioApi, registerKey, unitsKey, usePeople, type RegisterVendor } from '../_lib/portfolioApi';
import {
  CLEAR_FILTERS, COLUMNS_KEY, PAGE_SIZE, defaultColumns, hasFilters, isTiered, lifecycleHref, listParams, nextActionCell, parseColumns, readState,
  recordHref, sortPatch, tierHref, websiteHref, type ColumnId,
} from '../_lib/registerModel';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import ImportVendors from './_ImportVendors';
import ColumnChooser from './_register/ColumnChooser';
import RegisterTable from './_register/RegisterTable';
import Toolbar from './_register/Toolbar';

// Statuses a vendor has before the tenant names its own (Settings, vendor statuses).
const STATUSES = ['active', 'under_review', 'onboarding', 'offboarded', 'suspended'].map((value) => ({ value, label: fmt.status(value) }));

export default function VendorRegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = useUrlParams();
  const state = useMemo(() => readState(params), [params]);
  const { hasPermission } = usePermissions();
  const erm = hasPermission('erm:risks:edit');                          // the server accepts it for every write in the module
  const canCreate = hasPermission('vendor_risk:vendors:create') || erm;
  // Archive and restore: what the server checks (vendors:delete, or its erm:risks:edit fallback).
  const canArchive = hasPermission('vendor_risk:vendors:delete') || erm;

  const [showSettings, setShowSettings] = useState(false);
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pendingArchive, setPendingArchive] = useState<RegisterVendor | null>(null);
  const [columns, setColumns] = useState<ColumnId[]>(defaultColumns);
  useEffect(() => {
    try { setColumns(parseColumns(window.localStorage.getItem(COLUMNS_KEY))); } catch { /* storage can be blocked: the default columns */ }
  }, []);
  const chooseColumns = (next: ColumnId[]) => {
    setColumns(next);
    try { window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(next)); } catch { /* not kept this time */ }
  };

  const query = listParams(state);
  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useQuery({
    queryKey: [...registerKey, query],
    queryFn: async () => (await portfolioApi.vendors(query)).data,
    placeholderData: keepPreviousData,
    ...TPRM_QUERY_OPTS,
  });
  const people = usePeople();
  const { data: units } = useQuery({ queryKey: unitsKey, queryFn: async () => (await portfolioApi.units()).data.items, ...TPRM_QUERY_OPTS });
  const { data: fields } = useModuleSettings('vendors');

  const options = {
    statuses: statusChoices(fields, STATUSES),
    types: listOptions(fields, 'vendor_type', state.type).map((o) => ({ value: o.value, label: o.label })),
    owners: [{ value: 'me', label: 'Mine' }, { value: 'unassigned', label: 'Unassigned' }, ...people.map((p) => ({ value: String(p.id), label: p.name }))],
    units: (units ?? []).map((u) => ({ value: String(u.id), label: u.name })),
  };

  const total = data?.total ?? 0;
  const rows = data?.items ?? [];
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // a link to a page the list no longer reaches (a filter has since shrunk it) lands on the last one
  useEffect(() => {
    if (data && !isPlaceholderData && state.page > pages) params.set({ page: pages > 1 ? String(pages) : null });
  }, [data, isPlaceholderData, state.page, pages, params]);

  const archive = useMutation({
    // Archives the vendor (nothing is deleted) or brings it back.
    mutationFn: async ({ vendor, restore }: { vendor: RegisterVendor; restore: boolean }) => {
      await (restore ? vendorRiskApi.restoreVendor(vendor.id) : vendorRiskApi.deleteVendor(vendor.id));
      return { vendor, restore };
    },
    onSuccess: ({ vendor, restore }) => {
      ['vendors', 'vendors-select', 'vendor-dashboard', 'vendor-assessments-all', 'tprm-dashboard'].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
      qc.invalidateQueries({ queryKey: countsKey });
      setPendingArchive(null);
      toast({ type: 'success', title: restore ? `${vendor.name} restored` : `${vendor.name} archived` });
    },
    onError: (e) => toast({ type: 'error', title: 'That did not work', message: errText(e, 'Try again.') }),
  });

  const copyLink = async (id: number) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${recordHref(id)}`);
      toast({ type: 'success', title: 'Link copied' });
    } catch {
      toast({ type: 'error', title: 'Could not copy the link' });
    }
  };

  const menuFor = (v: RegisterVendor): RowAction[] => {
    const blocker = nextActionCell(v);
    const site = websiteHref(v.website);
    return [
      { key: 'copy', label: 'Copy link', icon: Link2, onClick: () => { void copyLink(v.id); } },
      { key: 'tier', label: 'Tier engagement', icon: Gauge, hidden: isTiered(v) || !!v.archived_at, onClick: () => router.push(tierHref(v.id)) },
      blocker.kind === 'action'
        ? { key: 'blocker', label: 'View blocker', icon: AlertCircle, onClick: () => router.push(blocker.href ?? recordHref(v.id)) }
        : { key: 'lifecycle', label: 'Open lifecycle', icon: Workflow, hidden: !!v.archived_at, onClick: () => router.push(lifecycleHref(v.id)) },
      { key: 'site', label: 'Visit website', icon: ExternalLink, hidden: !site, onClick: () => { if (site) window.open(site, '_blank', 'noopener,noreferrer'); } },
      {
        key: 'archive', label: v.archived_at ? 'Restore' : 'Archive', icon: v.archived_at ? ArchiveRestore : Archive, hidden: !canArchive,
        onClick: () => (v.archived_at ? archive.mutate({ vendor: v, restore: true }) : setPendingArchive(v)),
      },
    ];
  };

  if (showSettings) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <button type="button" onClick={() => setShowSettings(false)} className="text-sm font-medium text-slate-600 hover:text-slate-900">← Vendors</button>
        <ModuleSettingsPanel moduleKey="vendors" />
      </div>
    );
  }

  const filtered = hasFilters(state);
  const empty = state.archived && !hasFilters({ ...state, archived: false })
    ? { title: 'No archived vendors', hint: undefined }
    : filtered
      ? { title: 'No vendors match these filters', hint: 'Adjust or clear the filters.' }
      : { title: 'No vendors yet', hint: 'Add the third parties you share data or systems with.' };

  return (
    <div className="space-y-4">
      {importing && <ImportVendors onClose={() => setImporting(false)} onDone={() => qc.invalidateQueries({ queryKey: ['vendors'] })} />}

      <Toolbar
        state={state}
        options={options}
        onChange={(patch) => params.set(patch)}
        right={(
          <>
            <button type="button" onClick={() => setShowSettings(true)} className={BTN} title="Statuses, SLA, fields and dropdown lists">
              <SettingsIcon aria-hidden className="h-4 w-4" strokeWidth={1.75} />
              Settings
            </button>
            {canCreate && (
              <button type="button" onClick={() => setImporting(true)} className={BTN}>
                <Upload aria-hidden className="h-4 w-4" strokeWidth={1.75} />
                Import
              </button>
            )}
          </>
        )}
      />

      {isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading vendors">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
        </div>
      ) : isError ? (
        <ErrorState title="Couldn't load the vendors" message={errText(error, 'Try again in a moment.')} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={empty.title}
          hint={empty.hint}
          action={filtered
            ? <button type="button" onClick={() => params.set(CLEAR_FILTERS)} className={BTN}>Clear filters</button>
            : canCreate ? <button type="button" onClick={() => setAdding(true)} className={BTN_PRIMARY}>Add vendor</button> : undefined}
        />
      ) : (
        <section aria-label="Vendors" className="rounded-xl border border-[#d5dbe1] bg-[#fff]">
          <div className="flex items-center justify-end border-b border-[#e1e6eb] px-3 py-2">
            <ColumnChooser visible={columns} onChange={chooseColumns} />
          </div>
          <RegisterTable
            rows={rows}
            visible={columns}
            sort={state.sort}
            onSort={(next) => params.set(sortPatch(next))}
            onOpen={(id) => router.push(recordHref(id))}
            menuFor={menuFor}
            dim={isPlaceholderData}
          />
          <Pager page={state.page} pageSize={PAGE_SIZE} total={total} noun="vendors" onPage={(page) => params.set({ page: page > 1 ? String(page) : null })} />
        </section>
      )}

      <Dialog
        open={pendingArchive !== null}
        onClose={() => { if (!archive.isPending) setPendingArchive(null); }}
        title="Archive vendor"
        footer={(
          <>
            <button type="button" className={BTN} disabled={archive.isPending} onClick={() => setPendingArchive(null)}>Cancel</button>
            <button type="button" className={BTN_PRIMARY} disabled={archive.isPending}
              onClick={() => pendingArchive && archive.mutate({ vendor: pendingArchive, restore: false })}>
              {archive.isPending ? 'Archiving…' : 'Archive'}
            </button>
          </>
        )}
      >
        <p className="text-[14px] leading-5 text-[#26323d]">
          <span className="font-semibold text-[#1f2933]">{pendingArchive?.name}</span> leaves the register, dashboards and reminders.
          Its records stay; restore it from Archived.
        </p>
      </Dialog>
      <AddVendorDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}
