'use client';

/**
 * Software Licenses — the register.
 *
 * Software asset management in one place: the ENTITLEMENTS a tenant owns (entered by
 * hand or imported — no scan can see what was purchased), reconciled live against the
 * software credentialed scans found INSTALLED. Three views over one dataset:
 *   Entitlements       — one row per purchase line (add / edit / delete / import).
 *   License position   — per product, entitled vs consumed, with the consuming assets.
 *   Unlicensed         — installed software with no entitlement on record.
 *
 * The page name lives in the header bar (Header PAGE_TITLES '/licenses'), so the body
 * has no title row. Pinned to the viewport: only the table scrolls, never the page.
 * Every figure is read from /licenses/*; nothing is estimated client-side.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck, CalendarClock, KeyRound, Layers, PiggyBank, Plus, RefreshCw, Search, ShieldAlert, Upload, Wallet, X,
} from 'lucide-react';
import { licensesApi, type LicenseEntitlement, type LicenseImportResult, type UnlicensedSoftware } from '@/cyber-assurance/lib/api';
import { usePermissions } from '@/cyber-assurance/hooks/usePermissions';
import { useTabParam } from '@/cyber-assurance/lib/useTabParam';
import { useToast } from '@/cyber-assurance/components/ui/ToastProvider';
import { CARD_SHADOW, FONT, Loading, Skel, T, alpha, money, nfmt } from '../dashboard/_components/kit';
import { EntitlementDrawer } from './_components/EntitlementDrawer';
import { ImportDrawer } from './_components/ImportDrawer';
import { EntitlementsTable, PositionsTable, UnlicensedTable } from './_components/RegisterTables';
import {
  EXPIRY_OPTIONS, LICENSE_PERMS, apiErrorMessage, compareEntitlements, dominantCurrency, matchesExpiry,
  normStatus, statusRank, statusTone,
  type EntitlementForm, type ExpiryFilter, type SortKey, type SortState,
} from './_components/lib';

type View = 'entitlements' | 'positions' | 'unlicensed';
const VIEWS: readonly View[] = ['entitlements', 'positions', 'unlicensed'];
type DrawerState = { key: number; mode: 'create' | 'edit'; entitlement?: LicenseEntitlement; prefill?: Partial<EntitlementForm> };

/** Rendering thousands of rows into one scroll box helps nobody; search / filters narrow the rest. */
const ROW_CAP = 500;

const BTN = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-[#E2E5EC] bg-white px-3 text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB] disabled:cursor-default disabled:opacity-70';
const BTN_PRIMARY = 'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-[9px] border border-[#005B96] bg-[#005B96] px-3 text-[12px] font-semibold text-white hover:bg-[#014A81] disabled:cursor-default disabled:opacity-70';
const SELECT = 'h-8 max-w-[200px] cursor-pointer rounded-[9px] border border-[#E2E5EC] bg-white px-2 text-[12px] font-semibold text-[#334155] hover:bg-[#F6F7FB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#005B96]';

/* ─── small local components ────────────────────────────────────────────── */

function Tile({ icon, label, value, sub, tone = T.base, valueColor = T.text, loading, onClick, title }: {
  icon: ReactNode; label: string; value: ReactNode; sub: ReactNode; tone?: string; valueColor?: string;
  loading?: boolean; onClick?: () => void; title?: string;
}) {
  const body = (
    <>
      <span className="flex items-center gap-2 text-[11.5px] font-medium text-[#64748B]">
        <span aria-hidden className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]" style={{ background: alpha(tone, 0.1), color: tone }}>{icon}</span>
        <span className="min-w-0 flex-1 truncate leading-[1.25]">{label}</span>
      </span>
      {loading ? (
        <span className="mt-2.5 flex flex-col gap-1.5"><Skel h={24} w="45%" /><Skel h={10} w="80%" /></span>
      ) : (
        <>
          <span className="mt-1.5 block text-[22px] font-semibold leading-[1.1]" style={{ color: valueColor }}>{value}</span>
          <span className="mt-1 block text-[11.5px] leading-[1.4] text-[#64748B]">{sub}</span>
        </>
      )}
    </>
  );
  const cls = `flex min-w-0 flex-col rounded-[12px] border border-[#E2E5EC] bg-white px-3 py-2.5 text-left ${CARD_SHADOW}`;
  return onClick
    ? <button type="button" onClick={onClick} title={title} className={`${cls} cursor-pointer transition hover:-translate-y-px hover:border-[#C7D2E4]`}>{body}</button>
    : <div title={title} className={cls}>{body}</div>;
}

function EmptyBlock({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <span aria-hidden className="mb-1 grid h-10 w-10 place-items-center rounded-full bg-[#F6F7FB] text-[#64748B]">{icon}</span>
      <p className="m-0 text-[13px] font-semibold text-[#0F172A]">{title}</p>
      {body && <p className="m-0 max-w-[460px] text-[12px] leading-[1.55] text-[#64748B]">{body}</p>}
      {action && <div className="mt-2.5">{action}</div>}
    </div>
  );
}

/** Distinct normalised statuses in a list → select options (worst first), with counts. */
function statusChoices(statuses: Array<string | null | undefined>) {
  const seen: Record<string, { value: string; label: string; n: number; rank: number }> = {};
  statuses.forEach((s) => {
    if (!s) return;
    const v = normStatus(s);
    if (seen[v]) seen[v].n += 1;
    else seen[v] = { value: v, label: statusTone(s).label, n: 1, rank: statusRank(s) };
  });
  return Object.keys(seen).map((k) => seen[k]).sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

const includes = (v: unknown, t: string) => v != null && String(v).toLowerCase().includes(t);

/* ─── page ──────────────────────────────────────────────────────────────── */

export default function LicensesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const params = useSearchParams();
  const { hasPermission, isLoading: permsLoading } = usePermissions();
  const canCreate = hasPermission(LICENSE_PERMS.create);
  const canEdit = hasPermission(LICENSE_PERMS.edit);
  const canDelete = hasPermission(LICENSE_PERMS.delete);

  const [view, setView] = useTabParam<View>('entitlements', VIEWS, 'view');
  const [term, setTerm] = useState('');
  const [statusF, setStatusF] = useState('all');
  const [publisherF, setPublisherF] = useState('all');
  const [expiryF, setExpiryF] = useState<ExpiryFilter>('any');
  // Worst-first by default: over-deployed and expired lines are what a reviewer opens this for.
  const [sort, setSort] = useState<SortState>({ key: 'status', dir: 'asc' });
  const [drawer, setDrawer] = useState<DrawerState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const entQ = useQuery({ queryKey: ['licenses', 'entitlements'], queryFn: async () => (await licensesApi.list()).data.entitlements ?? [] });
  const sumQ = useQuery({ queryKey: ['licenses', 'summary'], queryFn: async () => (await licensesApi.getSummary()).data });
  // The positions payload carries every consuming asset, so only fetch it once a view needs it.
  const posQ = useQuery({ queryKey: ['licenses', 'positions'], queryFn: async () => (await licensesApi.getPositions()).data, enabled: view !== 'entitlements' });

  const entitlements = useMemo(() => entQ.data ?? [], [entQ.data]);
  const positions = useMemo(() => posQ.data?.positions ?? [], [posQ.data]);
  const unlicensed = useMemo(() => posQ.data?.unlicensed ?? [], [posQ.data]);
  const s = sumQ.data;
  const dominant = useMemo(() => dominantCurrency(entitlements), [entitlements]);
  // Aggregates arrive in the tenant's primary currency; fall back to the most-used entitlement currency.
  const cur = s?.currency || dominant;

  /* deep links: /licenses?entitlement=<id> opens that record; /licenses?add=1&publisher=&product= opens a prefilled form */
  const linkHandled = useRef(false);
  useEffect(() => {
    if (linkHandled.current || permsLoading) return;
    const wantsAdd = !!params.get('add');
    const id = Number(params.get('entitlement'));
    if (wantsAdd) {
      linkHandled.current = true;
      if (canCreate) setDrawer({ key: Date.now(), mode: 'create', prefill: { publisher: params.get('publisher') ?? '', product: params.get('product') ?? '' } });
      window.history.replaceState(null, '', window.location.pathname);
    } else if (id > 0 && entQ.data) {
      linkHandled.current = true;
      const hit = entQ.data.find((e) => e.id === id);
      if (hit) setDrawer({ key: Date.now(), mode: 'edit', entitlement: hit });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, [params, permsLoading, canCreate, entQ.data]);

  /* ── filter option lists follow the active view ── */
  const publisherOptions = useMemo(() => {
    const names = view === 'positions' ? positions.map((p) => p.publisher)
      : view === 'unlicensed' ? unlicensed.map((u) => u.publisher)
        : entitlements.map((e) => e.publisher);
    return Array.from(new Set(names.filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b));
  }, [view, entitlements, positions, unlicensed]);
  const statusOptions = useMemo(
    () => statusChoices(view === 'positions' ? positions.map((p) => p.status) : entitlements.map((e) => e.status)),
    [view, entitlements, positions],
  );

  const t = term.trim().toLowerCase();
  const filteredEntitlements = useMemo(() => entitlements
    .filter((e) => (statusF === 'all' || normStatus(e.status) === statusF)
      && (publisherF === 'all' || e.publisher === publisherF)
      && matchesExpiry(e, expiryF)
      && (!t || [e.publisher, e.product, e.edition, e.po_reference, e.contract_reference, e.reseller].some((v) => includes(v, t))))
    .sort((a, b) => compareEntitlements(a, b, sort)),
  [entitlements, statusF, publisherF, expiryF, t, sort]);
  const filteredPositions = useMemo(() => positions
    .filter((p) => (statusF === 'all' || normStatus(p.status) === statusF)
      && (publisherF === 'all' || p.publisher === publisherF)
      && matchesExpiry({ expiry_date: p.nearest_expiry }, expiryF)
      && (!t || [p.publisher, p.product, p.edition].some((v) => includes(v, t))))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || `${a.publisher} ${a.product}`.localeCompare(`${b.publisher} ${b.product}`)),
  [positions, statusF, publisherF, expiryF, t]);
  const filteredUnlicensed = useMemo(() => unlicensed
    .filter((u) => (publisherF === 'all' || u.publisher === publisherF)
      && (!t || [u.name, u.publisher, u.software_key].some((v) => includes(v, t))))
    .sort((a, b) => b.install_count - a.install_count || a.name.localeCompare(b.name)),
  [unlicensed, publisherF, t]);

  const anyFilter = !!t || statusF !== 'all' || publisherF !== 'all' || expiryF !== 'any';
  const clearFilters = () => { setTerm(''); setStatusF('all'); setPublisherF('all'); setExpiryF('any'); };
  const changeView = (v: View) => {
    if (v === view) return;
    setView(v);
    // status / publisher options differ per view — a stale choice would silently hide everything
    setStatusF('all'); setPublisherF('all');
  };
  const onSort = (key: SortKey) => setSort((p) => (p.key === key ? { key, dir: p.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  /* ── mutations ── */
  const refresh = () => qc.invalidateQueries({ queryKey: ['licenses'] });
  const afterChange = (message: string) => { setDrawer(null); refresh(); toast.toast({ title: message, type: 'success' }); };
  const afterImport = (r: LicenseImportResult) => {
    setImportOpen(false);
    refresh();
    const parts = [`${nfmt(r.created)} added`];
    if (r.skipped) parts.push(`${nfmt(r.skipped)} already existed`);
    if (r.error_count) parts.push(`${nfmt(r.error_count)} skipped with errors`);
    toast.toast({ title: r.created ? 'Import complete' : 'Nothing was imported', message: parts.join(' · '), type: r.created ? 'success' : 'info' });
  };
  const del = useMutation({
    mutationFn: async (id: number) => licensesApi.delete(id),
    onMutate: (id) => setDeletingId(id),
    onSuccess: () => { refresh(); toast.toast({ title: 'Entitlement deleted', type: 'success' }); },
    onError: (e) => toast.toast({ title: 'Could not delete the entitlement', message: apiErrorMessage(e, 'Try again.'), type: 'error' }),
    onSettled: () => setDeletingId(null),
  });
  const confirmDelete = (e: LicenseEntitlement) => {
    const name = [e.product, e.edition].filter(Boolean).join(' ');
    if (window.confirm(`Delete the entitlement "${name}"?\n\nSoftware it covered will show as unlicensed again until another entitlement covers it.`)) del.mutate(e.id);
  };

  const openCreate = () => setDrawer({ key: Date.now(), mode: 'create' });
  const openEdit = (e: LicenseEntitlement) => setDrawer({ key: Date.now(), mode: 'edit', entitlement: e });
  // Publisher + product only — deliberately NOT the software key: an explicit key switches name matching off.
  const openForUnlicensed = (u: UnlicensedSoftware) => setDrawer({ key: Date.now(), mode: 'create', prefill: { publisher: u.publisher ?? '', product: u.name } });

  const fetching = entQ.isFetching || sumQ.isFetching || posQ.isFetching;

  /* ── KPI strip (all from /licenses/summary) ── */
  const tracked = s?.tracked_products ?? 0;
  const unmeasurable = s?.not_measured_products ?? 0;
  const sumLoading = sumQ.isPending && !sumQ.isError;
  const none = '—';
  const otherCurrencies = s?.by_currency ? Object.keys(s.by_currency).filter((c) => c !== cur) : [];
  const priced = s?.exposure_cost ?? 0;
  const unpriced = s?.exposure_unpriced ?? 0;
  const coverage = s && s.assets_with_inventory != null && s.assets_total != null
    ? `Software inventory collected on ${nfmt(s.assets_with_inventory)} of ${nfmt(s.assets_total)} assets.`
    : null;

  const tiles = (
    <nav aria-label="License indicators" className="grid shrink-0 grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      <Tile icon={<BadgeCheck size={15} />} label="License compliance" loading={sumLoading}
        value={s && tracked && s.compliance_pct != null ? `${Math.round(s.compliance_pct)}%` : none}
        sub={s ? (tracked
          ? `${nfmt(s.compliant)} of ${nfmt(tracked)} products compliant${unmeasurable ? ` · ${nfmt(unmeasurable)} not measurable` : ''}`
          : unmeasurable ? `${nfmt(unmeasurable)} products not measurable from scans` : 'no entitlements recorded yet') : 'unavailable'}
        title="Share of measured products whose live entitlements cover what is installed. Products licensed per CAL, concurrent user or usage can't be counted from scans, so they are excluded." />
      <Tile icon={<ShieldAlert size={15} />} label="Unlicensed software" tone={T.danger} loading={sumLoading}
        value={s ? nfmt(s.unlicensed_count) : none} valueColor={s && s.unlicensed_count > 0 ? T.danger : T.text}
        sub={s ? 'installs with no entitlement on record' : 'unavailable'}
        onClick={s && s.unlicensed_count > 0 ? () => changeView('unlicensed') : undefined} title="Open the unlicensed software list" />
      <Tile icon={<Layers size={15} />} label="Over-deployed products" tone={T.danger} loading={sumLoading}
        value={s ? nfmt(s.over_deployed) : none} valueColor={s && s.over_deployed > 0 ? T.danger : T.text}
        sub={s ? (s.over_deployed === 0 ? 'no product exceeds its entitlement'
          : priced > 0 ? `≈ ${money(priced, cur, true)} to cover${unpriced ? ` · ${nfmt(unpriced)} unpriced` : ''}`
            : unpriced ? `${nfmt(unpriced)} unpriced — add unit costs` : 'installs exceed entitlement') : 'unavailable'}
        onClick={s && s.over_deployed > 0 ? () => changeView('positions') : undefined} title="Open the license position view" />
      <Tile icon={<CalendarClock size={15} />} label="Expiring within 30 days" tone={T.warning} loading={sumLoading}
        value={s ? nfmt(s.expiring_30) : none} valueColor={s && s.expiring_30 > 0 ? T.warning : T.text}
        sub={s ? `60 days: ${nfmt(s.expiring_60)} · 90 days: ${nfmt(s.expiring_90)}${s.expired_lines ? ` · ${nfmt(s.expired_lines)} already expired` : ''}` : 'unavailable'}
        title="Live entitlements whose licence or support ends inside the window. The windows are cumulative: 90 days includes the 30 and 60." />
      <Tile icon={<Wallet size={15} />} label="Annual license spend" loading={sumLoading}
        value={s && s.annual_spend > 0 ? money(s.annual_spend, cur, true) : none}
        sub={s ? (s.annual_spend > 0 ? `renewals due in 90 days: ${s.renewal_cost_90d > 0 ? money(s.renewal_cost_90d, cur, true) : none}` : tracked ? 'no unit costs recorded' : 'no entitlements recorded yet') : 'unavailable'}
        title={otherCurrencies.length ? `Shown in ${cur}. Other currencies are recorded (${otherCurrencies.join(', ')}) and are not converted.` : undefined} />
      <Tile icon={<PiggyBank size={15} />} label="Reclaimable seats" tone={T.success} loading={sumLoading}
        value={s ? nfmt(s.reclaimable_count) : none}
        sub={s ? (s.reclaimable_count > 0 && s.reclaimable_savings > 0 ? `≈ ${money(s.reclaimable_savings, cur, true)} potential savings` : 'surplus or idle seats found') : 'unavailable'}
        title="Estimated from surplus entitlements and stale or decommissioned hosts — not from usage metering" />
    </nav>
  );

  /* ── view tabs ── */
  const tabDefs: Array<{ id: View; label: string; count?: number | null; tip: string }> = [
    { id: 'entitlements', label: 'Entitlements', count: entQ.data ? entitlements.length : null, tip: 'The licenses you own, one row per purchase line' },
    { id: 'positions', label: 'License position', count: s ? tracked : null, tip: 'Entitled versus consumed per product, with the assets that consume it' },
    { id: 'unlicensed', label: 'Unlicensed software', count: s ? s.unlicensed_count : null, tip: 'Installed software with no entitlement on record (count = installs)' },
  ];
  const tabs = (
    <div role="tablist" aria-label="Licenses view" className="inline-flex shrink-0 rounded-[11px] bg-[#E1E6EE] p-[3px]">
      {tabDefs.map((d) => {
        const on = view === d.id;
        return (
          <button key={d.id} role="tab" type="button" aria-selected={on} title={d.tip} onClick={() => changeView(d.id)}
            className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-[9px] border-0 px-3 text-[12px] font-semibold transition ${on ? 'bg-white text-[#014A81] shadow-[0_1px_2px_rgba(16,24,40,.08)]' : 'bg-transparent text-[#5B6673] hover:text-[#0F172A]'}`}>
            {d.label}
            {d.count != null && (
              <span className="rounded-full px-1.5 text-[10.5px] font-bold leading-[17px] tabular-nums"
                style={{ background: on ? alpha(T.base, 0.1) : '#D3DAE5', color: d.id === 'unlicensed' && d.count > 0 ? T.danger : on ? T.strong : '#5B6673' }}>
                {nfmt(d.count)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  /* ── toolbar ── */
  const toolbar = (
    <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
      <div className="relative">
        <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[#94A3B8]" />
        <input value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Search licenses"
          placeholder={view === 'unlicensed' ? 'Search software…' : 'Search publisher, product, PO…'}
          className="h-8 w-[220px] rounded-[9px] border border-[#E2E5EC] bg-white pl-8 pr-7 text-[12px] text-[#0F172A] placeholder-[#94A3B8] focus:border-[#005B96] focus:outline-none focus:ring-1 focus:ring-[#005B96]" />
        {term && (
          <button type="button" aria-label="Clear search" onClick={() => setTerm('')}
            className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#94A3B8] hover:text-[#0F172A]"><X size={12} /></button>
        )}
      </div>
      {view !== 'unlicensed' && (
        <select className={SELECT} value={statusF} onChange={(e) => setStatusF(e.target.value)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          {statusOptions.map((o) => <option key={o.value} value={o.value}>{o.label} ({nfmt(o.n)})</option>)}
        </select>
      )}
      <select className={SELECT} value={publisherF} onChange={(e) => setPublisherF(e.target.value)} aria-label="Filter by publisher">
        <option value="all">All publishers</option>
        {publisherOptions.map((p) => <option key={p} value={p}>{p}</option>)}
      </select>
      {view !== 'unlicensed' && (
        <select className={SELECT} value={expiryF} onChange={(e) => setExpiryF(e.target.value as ExpiryFilter)} aria-label="Filter by expiry">
          {EXPIRY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      {anyFilter && <button type="button" className={BTN} onClick={clearFilters}><X size={13} aria-hidden />Clear</button>}
      <button type="button" className={BTN} onClick={refresh} disabled={fetching} title="Reload from the latest scans and entitlements">
        <RefreshCw size={13} aria-hidden className={fetching ? 'animate-spin' : ''} style={{ color: T.base }} />Refresh
      </button>
      {canCreate && <button type="button" className={BTN} onClick={() => setImportOpen(true)} title="Load entitlements from a CSV or XLSX"><Upload size={13} aria-hidden style={{ color: T.base }} />Import</button>}
      {canCreate && <button type="button" className={BTN_PRIMARY} onClick={openCreate}><Plus size={14} aria-hidden />Add entitlement</button>}
    </div>
  );

  /* ── table body + footer, per view ── */
  const loadError = (what: string, retry: () => void) => (
    <EmptyBlock icon={<ShieldAlert size={18} />} title={`${what} didn't load`} body="The license service didn't respond. The rest of the page is unaffected."
      action={<button type="button" className={BTN} onClick={retry}><RefreshCw size={13} aria-hidden />Try again</button>} />
  );
  const filteredNothing = (what: string) => (
    <EmptyBlock icon={<Search size={18} />} title={`No ${what} match these filters`}
      action={<button type="button" className={BTN} onClick={clearFilters}><X size={13} aria-hidden />Clear filters</button>} />
  );
  const sumInstalls = (list: UnlicensedSoftware[]) => list.reduce((n, u) => n + (u.install_count || 0), 0);

  let body: ReactNode;
  let footer: ReactNode;
  if (view === 'entitlements') {
    if (entQ.isPending && !entQ.isError) body = <div className="p-5"><Loading rows={6} /></div>;
    else if (entQ.isError) body = loadError('Entitlements', () => entQ.refetch());
    else if (!entitlements.length) body = (
      <EmptyBlock icon={<KeyRound size={18} />} title="No entitlements recorded yet"
        body="Record the software licenses you own — quantity, terms, cost and expiry — or import them from a license sheet. ComplyVerse then compares them with what credentialed scans found installed, and flags unlicensed software, over-deployment and upcoming renewals."
        action={canCreate ? (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button type="button" className={BTN_PRIMARY} onClick={openCreate}><Plus size={14} aria-hidden />Add your first entitlement</button>
            <button type="button" className={BTN} onClick={() => setImportOpen(true)}><Upload size={13} aria-hidden style={{ color: T.base }} />Import a sheet</button>
          </div>
        ) : undefined} />
    );
    else if (!filteredEntitlements.length) body = filteredNothing('entitlements');
    else body = (
      <EntitlementsTable rows={filteredEntitlements.slice(0, ROW_CAP)} sort={sort} onSort={onSort}
        canEdit={canEdit} canDelete={canDelete} deletingId={deletingId} onOpen={openEdit} onDelete={confirmDelete} />
    );
    footer = (
      <>
        <span>Showing <b className="tabular-nums text-[#334155]">{nfmt(Math.min(filteredEntitlements.length, ROW_CAP))}</b> of <b className="tabular-nums text-[#334155]">{nfmt(entitlements.length)}</b> entitlements{filteredEntitlements.length > ROW_CAP ? ' — narrow with search or filters to see the rest' : ''}</span>
        <span>Consumption comes from credentialed scans; entitlements are what you record here, so compliance is only as accurate as these records.{coverage ? ` ${coverage}` : ''}</span>
      </>
    );
  } else if (view === 'positions') {
    if (posQ.isPending && !posQ.isError) body = <div className="p-5"><Loading rows={6} /></div>;
    else if (posQ.isError) body = loadError('License positions', () => posQ.refetch());
    else if (!positions.length) body = (
      <EmptyBlock icon={<Layers size={18} />} title="No license positions yet"
        body="A position appears for each product once you record an entitlement for it. Until then, installed software is listed under Unlicensed software."
        action={canCreate ? <button type="button" className={BTN_PRIMARY} onClick={openCreate}><Plus size={14} aria-hidden />Add entitlement</button> : undefined} />
    );
    else if (!filteredPositions.length) body = filteredNothing('products');
    else body = <PositionsTable rows={filteredPositions.slice(0, ROW_CAP)} currency={cur} />;
    footer = (
      <>
        <span>Showing <b className="tabular-nums text-[#334155]">{nfmt(Math.min(filteredPositions.length, ROW_CAP))}</b> of <b className="tabular-nums text-[#334155]">{nfmt(positions.length)}</b> products</span>
        <span>Computed from the latest scans and your entitlements each time this page loads. Expand a row to see the assets driving consumption.{coverage ? ` ${coverage}` : ''}</span>
      </>
    );
  } else {
    if (posQ.isPending && !posQ.isError) body = <div className="p-5"><Loading rows={6} /></div>;
    else if (posQ.isError) body = loadError('Unlicensed software', () => posQ.refetch());
    else if (!unlicensed.length) body = (
      <EmptyBlock icon={<BadgeCheck size={18} />} title="No unlicensed software found"
        body={`Every product detected by scans is covered by an entitlement on record. Only hosts with a credentialed scan are included — an unscanned host reports nothing.${coverage ? ` ${coverage}` : ''}`} />
    );
    else if (!filteredUnlicensed.length) body = filteredNothing('software');
    else body = <UnlicensedTable rows={filteredUnlicensed.slice(0, ROW_CAP)} canCreate={canCreate} onAddLicense={openForUnlicensed} />;
    footer = (
      <>
        <span>
          Showing <b className="tabular-nums text-[#334155]">{nfmt(Math.min(filteredUnlicensed.length, ROW_CAP))}</b> of <b className="tabular-nums text-[#334155]">{nfmt(unlicensed.length)}</b> products
          {' '}· <b className="tabular-nums text-[#334155]">{nfmt(sumInstalls(filteredUnlicensed))}</b> installs
        </span>
        <span>Matching uses the detected product name and publisher; add a license, or correct an existing entitlement&rsquo;s publisher or product, to clear an entry. Windows roles, listening processes and Linux packages are not flagged on their own.{coverage ? ` ${coverage}` : ''}</span>
      </>
    );
  }

  return (
    <div data-licenses className="mx-auto flex h-full min-h-[520px] w-full max-w-[1950px] flex-col gap-3 text-[#0F172A]" style={{ fontFamily: FONT, zoom: 0.8 /* same density lever as the Performance dashboard */ }}>
      {/* Slightly greyer canvas on this page only, so the white cards lift off it. */}
      <style>{'main:has([data-licenses]){background:#EDF0F5}'}</style>
      <h1 className="sr-only">Software licenses — entitlements versus installed software</h1>

      {tiles}

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        {tabs}
        {toolbar}
      </div>

      <section aria-label="License register" className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-[#E2E5EC] bg-white ${CARD_SHADOW}`}>
        <div className="min-h-0 flex-1 overflow-auto">{body}</div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-[#EEF1F5] px-4 py-2 text-[11.5px] text-[#64748B]">{footer}</div>
      </section>

      {drawer && (
        <EntitlementDrawer
          key={drawer.key}
          mode={drawer.mode}
          entitlement={drawer.entitlement}
          prefill={drawer.prefill}
          readOnly={drawer.mode === 'edit' && !canEdit}
          canDelete={canDelete}
          publishers={Array.from(new Set(entitlements.map((e) => e.publisher).filter(Boolean))).sort((a, b) => a.localeCompare(b))}
          defaultCurrency={cur}
          onClose={() => setDrawer(null)}
          onSaved={afterChange}
          onDeleted={afterChange}
        />
      )}
      {importOpen && <ImportDrawer onClose={() => setImportOpen(false)} onImported={afterImport} />}
    </div>
  );
}
