'use client';

// What a person can DO to a vendor from the register (a row's ⋯ menu and the drawer's footer): open it, copy its link, tier it, go to what blocks it, start its assessment, visit its
// website, archive or restore it. Each is shown only to people who may do it (the rights the server checks: vendors:delete for archive and restore, assessments:create for starting an
// assessment, each with the erm:risks:edit fallback the whole module accepts), a failure is said and can be retried, and archiving asks first. Nothing here is new: it is what the old row
// menu and the old Assessments board offered, in one place.
import { useRouter } from 'next/navigation';
import { AlertCircle, Archive, ArchiveRestore, ArrowUpRight, ExternalLink, Gauge, Link2, PlayCircle, Workflow } from 'lucide-react';
import { useConfirm, useNotify, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { truncate } from '@/lib/format';
import { tpraApi, vendorRiskApi } from '@/lib/api';
import { countsKey } from '../../_lib/portfolioApi';
import { isTiered, lifecycleHref, recordHref, tierHref, websiteHref, type VendorRow } from '../../_lib/vendorRegisterDef';

// what a change to a vendor may move: the register, the pickers, the Overview, the board and the header's counts
const CHANGED = [['vendors'], ['vendors-select'], ['vendor-dashboard'], ['vendor-assessments-all'], ['tprm-dashboard'], ['tpra-board'], [...countsKey]];

export function useVendorActions() {
  const router = useRouter();
  const notify = useNotify();
  const { hasPermission } = usePermissions();
  const { confirm, confirmDialog } = useConfirm();
  const erm = hasPermission('erm:risks:edit');                                  // the server accepts it for every write in the module
  const canCreate = hasPermission('vendor_risk:vendors:create') || erm;
  const canArchive = hasPermission('vendor_risk:vendors:delete') || erm;
  const canAssess = hasPermission('vendor_risk:assessments:create') || erm;

  const archive = useReportedMutation({
    mutationFn: async (vendor: VendorRow) => { await vendorRiskApi.deleteVendor(vendor.id); return vendor; },
    success: (vendor: VendorRow) => `${truncate(vendor.name, 60).text} archived`,
    failure: "Couldn't archive the vendor",
    invalidate: CHANGED,
  });
  const restore = useReportedMutation({
    mutationFn: async (vendor: VendorRow) => { await vendorRiskApi.restoreVendor(vendor.id); return vendor; },
    success: (vendor: VendorRow) => `${truncate(vendor.name, 60).text} restored`,
    failure: "Couldn't restore the vendor",
    invalidate: CHANGED,
  });
  const start = useReportedMutation({
    mutationFn: async (vendor: VendorRow) => { await tpraApi.initLifecycle(vendor.id); return vendor; },
    success: (vendor: VendorRow) => `The assessment of ${truncate(vendor.name, 60).text} has started`,
    failure: "Couldn't start the assessment",
    retryable: false,
    invalidate: CHANGED,
    onSuccess: (vendor: VendorRow) => router.push(recordHref(vendor.id)),
  });

  const copyLink = async (v: VendorRow) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${recordHref(v.id)}`);
      notify.success('Link copied');
    } catch {
      notify.error("Couldn't copy the link");
    }
  };

  const askArchive = async (v: VendorRow) => {
    const yes = await confirm({
      title: 'Archive this vendor?',
      message: `${truncate(v.name, 80).text} leaves the register, the dashboards and the reminders. Its records stay, and you can restore it from Archived.`,
      confirmLabel: 'Archive vendor',
      tone: 'danger',
    });
    if (yes) archive.mutate(v);
  };

  /** The step a vendor most needs from the register itself: tier it, or start its assessment. Null when neither applies. */
  const nextStep = (v: VendorRow): { key: 'tier' | 'start'; label: string; run: () => void; busy: boolean } | null => {
    if (v.archived_at) return null;
    if (!isTiered(v)) return { key: 'tier', label: 'Tier engagement', run: () => router.push(tierHref(v.id)), busy: false };
    if (!v.lifecycle && canAssess) return { key: 'start', label: 'Start assessment', run: () => start.mutate(v), busy: start.isPending };
    return null;
  };

  /** A row's menu (and the drawer's "More"). `skip` leaves out the items the drawer's own buttons already say. */
  const menuFor = (v: VendorRow, skip: readonly string[] = []): MenuItem[] => {
    const site = websiteHref(v.website);
    const blocker = v.next_action;
    return [
      { key: 'open', label: 'Open vendor', icon: ArrowUpRight, hidden: skip.includes('open'), onSelect: () => router.push(recordHref(v.id)) },
      { key: 'copy', label: 'Copy link', icon: Link2, onSelect: () => { void copyLink(v); } },
      { key: 'tier', label: 'Tier engagement', icon: Gauge, hidden: skip.includes('tier') || isTiered(v) || !!v.archived_at, onSelect: () => router.push(tierHref(v.id)) },
      { key: 'start', label: 'Start assessment', icon: PlayCircle, hidden: skip.includes('start') || !!v.lifecycle || !!v.archived_at || !canAssess, onSelect: () => start.mutate(v) },
      blocker && !v.archived_at
        ? { key: 'blocker', label: 'View what it waits on', icon: AlertCircle, onSelect: () => router.push(blocker.link || recordHref(v.id)) }
        : { key: 'lifecycle', label: 'Open lifecycle', icon: Workflow, hidden: !!v.archived_at, onSelect: () => router.push(lifecycleHref(v.id)) },
      { key: 'site', label: 'Visit website', icon: ExternalLink, hidden: !site, onSelect: () => { if (site) window.open(site, '_blank', 'noopener,noreferrer'); } },
      v.archived_at
        ? { key: 'restore', label: 'Restore', icon: ArchiveRestore, hidden: !canArchive, onSelect: () => restore.mutate(v) }
        : { key: 'archive', label: 'Archive', icon: Archive, danger: true, hidden: !canArchive, onSelect: () => { void askArchive(v); } },
    ];
  };

  return { menuFor, nextStep, canCreate, confirmDialog, busy: archive.isPending || restore.isPending || start.isPending };
}
