'use client';

/**
 * The three tables of the Licenses register:
 *   EntitlementsTable — what we own (one row per purchase line), sortable.
 *   PositionsTable    — effective license position per product (entitled vs consumed),
 *                       with a drill-down to the assets that drive the consumption.
 *   UnlicensedTable   — installed software with no entitlement on record.
 * Presentational only: the page owns data, filtering and the drawer.
 *
 * Three honesty rules shape every cell here:
 *   - Consumption is POOL-level: all live lines of one product are counted together, so the
 *     Consumed / Position of two lines of the same product are the same figure by design.
 *   - A metric that scans cannot count (CAL, concurrent user, usage) shows "—", never a 0.
 *   - A shortfall with no unit cost shows "unpriced", never a zero cost.
 */
import { Fragment, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronRight, ChevronUp, ChevronsUpDown, Pencil, Plus, Trash2 } from 'lucide-react';
import type { LicenseEntitlement, LicensePosition, UnlicensedSoftware } from '@/cyber-assurance/lib/api';
import { Eyebrow, Pill, SEV, T, money, nfmt } from '../../dashboard/_components/kit';
import {
  LICENSE_METRICS, LICENSE_TYPES, TD, TH, fmtDate, isUnmeasured, optionLabel, relativeDay, statusHint, statusKey, statusTone,
  type SortKey, type SortState,
} from './lib';

const MUTED = { color: T.muted } as const;
const NUM = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const;
const NOT_COUNTED = "Scans can't count this metric (CALs, concurrent users, usage), so there is no consumed figure or position.";

/* ─── small shared pieces ───────────────────────────────────────────────── */

function SortTh({ label, k, sort, onSort, right, tip }: {
  label: string; k: SortKey; sort: SortState; onSort: (k: SortKey) => void; right?: boolean; tip?: string;
}) {
  const active = sort.key === k;
  return (
    <th scope="col" title={tip} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={{ ...TH, textAlign: right ? 'right' : 'left' }}>
      <button type="button" onClick={() => onSort(k)}
        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 hover:text-[#005B96]"
        style={{ font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: active ? T.base : 'inherit' }}>
        {label}
        {active
          ? (sort.dir === 'asc' ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />)
          : <ChevronsUpDown size={11} aria-hidden style={{ opacity: 0.4 }} />}
      </button>
    </th>
  );
}

const Th = ({ children, right, tip }: { children?: ReactNode; right?: boolean; tip?: string }) => (
  <th scope="col" title={tip} style={{ ...TH, textAlign: right ? 'right' : 'left' }}>{children}</th>
);

/** Status pill with the plain-language meaning of the status as a tooltip. */
const StatusPill = ({ status }: { status?: string | null }) => (
  <span title={statusHint(status)}><Pill tone={statusTone(status)} /></span>
);

/** entitled-vs-consumed gauge: neutral → amber at 90% → red once consumption exceeds what is owned. */
function UseBar({ used, owned }: { used: number; owned: number }) {
  if (!(owned > 0)) return null;
  const color = used > owned ? SEV.critical.c : used >= owned * 0.9 ? SEV.medium.c : T.base;
  return (
    <span aria-hidden className="mt-1 block h-[4px] w-[64px] overflow-hidden rounded-full bg-[#EEF1F5]" style={{ marginLeft: 'auto' }}>
      <i className="block h-full rounded-full" style={{ width: `${Math.min(100, (used / owned) * 100)}%`, background: color }} />
    </span>
  );
}

/** Signed position: red when short, muted at exactly covered, plain when in surplus. */
const Position = ({ value }: { value?: number | null }) =>
  value == null
    ? <span style={MUTED}>—</span>
    : <b className="font-semibold" style={{ color: value < 0 ? T.danger : value === 0 ? T.muted : T.ink2 }}>{value > 0 ? `+${nfmt(value)}` : nfmt(value)}</b>;

const NotCounted = () => <span style={MUTED} title={NOT_COUNTED}>—</span>;

function ExpiryCell({ date, label }: { date?: string | null; label?: string }) {
  if (!date) return <span style={MUTED}>—</span>;
  const rel = relativeDay(date);
  return (
    <span className="block leading-[1.35]">
      <span className="whitespace-nowrap">{label && <span style={MUTED}>{label} </span>}{fmtDate(date)}</span>
      {rel && <span className="block whitespace-nowrap text-[11px]" style={{ color: rel.color, fontWeight: rel.bold ? 600 : 400 }}>{rel.text}</span>}
    </span>
  );
}

/** `total` is the true count when the server capped the list it sent. */
function AssetChips({ assets, total, limit = 60 }: { assets: Array<{ asset_id: number; name: string; quantity?: number | null }>; total?: number; limit?: number }) {
  const shown = assets.slice(0, limit);
  const more = Math.max(total ?? assets.length, assets.length) - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((a) => (
        <Link key={a.asset_id} href={`/cyber-assurance/assets/${a.asset_id}?tab=licenses`} title={`Open ${a.name} — Licenses tab`}
          className="inline-flex max-w-[260px] items-center gap-1 rounded-full border border-[#E2E5EC] bg-white px-2.5 py-[3px] text-[11.5px] text-[#0F172A] hover:border-[#C7D2E4] hover:bg-[#F6F7FB]">
          <span className="truncate">{a.name}</span>
          {a.quantity != null && a.quantity > 1 && <b className="shrink-0 font-semibold tabular-nums" style={MUTED}>×{nfmt(a.quantity)}</b>}
        </Link>
      ))}
      {more > 0 && <span className="self-center text-[11.5px]" style={MUTED}>+{nfmt(more)} more</span>}
    </div>
  );
}

const iconBtn =
  'grid h-[26px] w-[26px] place-items-center rounded-md border-0 bg-transparent text-[#64748B] hover:bg-[#EEF1F5] hover:text-[#0F172A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#005B96] disabled:opacity-40';

/* ─── 1. entitlements ───────────────────────────────────────────────────── */

export function EntitlementsTable({ rows, sort, onSort, canEdit, canDelete, deletingId, onOpen, onDelete }: {
  rows: LicenseEntitlement[];
  sort: SortState;
  onSort: (k: SortKey) => void;
  canEdit: boolean;
  canDelete: boolean;
  deletingId: number | null;
  onOpen: (e: LicenseEntitlement) => void;
  onDelete: (e: LicenseEntitlement) => void;
}) {
  const sh = { sort, onSort };
  return (
    <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 1240 }}>
      <thead>
        <tr>
          <SortTh label="Publisher" k="publisher" {...sh} />
          <SortTh label="Product" k="product" {...sh} />
          <SortTh label="Edition" k="edition" {...sh} />
          <SortTh label="Type" k="type" {...sh} />
          <SortTh label="Metric" k="metric" {...sh} tip="What the vendor counts to size the license" />
          <SortTh label="Entitled" k="entitled" {...sh} right tip="Quantity owned on this purchase line" />
          <SortTh label="Consumed" k="consumed" {...sh} right tip="In use across the estate, from credentialed scans. Counted per product: every live line of the same product shares this figure." />
          <SortTh label="Position" k="position" {...sh} right tip="Entitled across the product's live lines minus consumed. Negative = short of licenses" />
          <SortTh label="Status" k="status" {...sh} />
          <SortTh label="Expiry" k="expiry" {...sh} tip="Licence expiry, with maintenance / support end underneath" />
          <SortTh label="Unit cost" k="cost" {...sh} right />
          <Th><span className="sr-only">Actions</span></Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => {
          const owned = e.total_quantity ?? 0;
          const pool = e.product_entitled ?? null;
          const uncounted = isUnmeasured(e);
          return (
            <tr key={e.id} onClick={() => onOpen(e)} className="cursor-pointer hover:bg-[#F7FAFD]">
              <td style={{ ...TD, color: T.ink2 }}>{e.publisher || <span style={MUTED}>—</span>}</td>
              <td style={TD}>
                <button type="button" onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}
                  className="max-w-[260px] cursor-pointer truncate border-0 bg-transparent p-0 text-left font-semibold text-[#0F172A] hover:text-[#005B96]"
                  style={{ font: 'inherit', fontWeight: 600 }} title={e.product}>
                  {e.product}
                </button>
              </td>
              <td style={{ ...TD, ...(e.edition ? null : MUTED) }}>{e.edition || '—'}</td>
              <td style={{ ...TD, color: T.ink2 }}>{optionLabel(LICENSE_TYPES, e.license_type)}</td>
              <td style={{ ...TD, color: T.ink2 }}>{optionLabel(LICENSE_METRICS, e.license_metric)}</td>
              <td style={{ ...TD, ...NUM }}>
                {nfmt(owned)}
                {pool != null && pool !== owned && (
                  <span className="block text-[10.5px] font-normal" style={MUTED} title="Owned across all live lines of this product — the pool consumption is measured against">pool {nfmt(pool)}</span>
                )}
              </td>
              <td style={{ ...TD, ...NUM }}>
                {uncounted ? <NotCounted />
                  : e.consumed == null ? <span style={MUTED}>—</span>
                    : <>{nfmt(e.consumed)}<UseBar used={e.consumed} owned={pool ?? owned} /></>}
              </td>
              <td style={{ ...TD, ...NUM }}>{uncounted ? <NotCounted /> : <Position value={e.position} />}</td>
              <td style={TD}>{e.status ? <StatusPill status={e.status} /> : <span style={MUTED}>—</span>}</td>
              <td style={TD}>
                {e.expiry_date || e.maintenance_expiry
                  ? (
                    <>
                      {e.expiry_date ? <ExpiryCell date={e.expiry_date} /> : <span style={MUTED}>No licence expiry</span>}
                      {e.maintenance_expiry && <span className="mt-1 block text-[11px]" style={MUTED}>Support ends {fmtDate(e.maintenance_expiry)}</span>}
                    </>
                  )
                  : <span style={MUTED} title="No expiry recorded — treated as perpetual">Perpetual</span>}
              </td>
              <td style={{ ...TD, ...NUM }}>{e.unit_cost == null ? <span style={MUTED}>—</span> : money(e.unit_cost, e.currency)}</td>
              <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <span className="inline-flex items-center gap-0.5">
                  {canEdit && (
                    <button type="button" className={iconBtn} aria-label={`Edit ${e.product}`} title="Edit"
                      onClick={(ev) => { ev.stopPropagation(); onOpen(e); }}><Pencil size={14} /></button>
                  )}
                  {canDelete && (
                    <button type="button" className={`${iconBtn} hover:!bg-[#FDECEC] hover:!text-[#B91C1C]`} aria-label={`Delete ${e.product}`} title="Delete"
                      disabled={deletingId === e.id} onClick={(ev) => { ev.stopPropagation(); onDelete(e); }}><Trash2 size={14} /></button>
                  )}
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─── 2. effective license position ─────────────────────────────────────── */

const posKey = (p: LicensePosition) => `${p.publisher}|${p.product}|${p.edition ?? ''}|${p.license_metric}`;

export function PositionsTable({ rows, currency }: { rows: LicensePosition[]; currency: string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return (
    <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 1040 }}>
      <thead>
        <tr>
          <Th><span className="sr-only">Expand</span></Th>
          <Th>Product</Th>
          <Th tip="What the vendor counts to size the license">Metric</Th>
          <Th right tip="Total owned across all live purchase lines of this product">Entitled</Th>
          <Th right tip="In use across the estate, from credentialed scans">Consumed</Th>
          <Th right tip="Entitled minus consumed. Negative = short of licenses">Position</Th>
          <Th>Status</Th>
          <Th right tip="Estimated cost of the shortfall (missing licenses × unit cost)">Exposure</Th>
          <Th right tip="Surplus or idle seats that could be reassigned instead of buying more. Estimated from surplus entitlements and stale / decommissioned hosts — not from usage metering.">Reclaimable</Th>
          <Th tip="Nearest licence or maintenance expiry">Next expiry</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const k = posKey(p);
          const isOpen = !!open[k];
          const assets = p.consuming_assets ?? [];
          const total = Math.max(p.consuming_assets_total ?? 0, assets.length);
          const expandable = assets.length > 0;
          const uncounted = isUnmeasured(p);
          const shortfall = statusKey(p.status) === 'over_deployed';
          return (
            <Fragment key={k}>
              <tr onClick={expandable ? () => toggle(k) : undefined} className={expandable ? 'cursor-pointer hover:bg-[#F7FAFD]' : undefined}>
                <td style={{ ...TD, width: 30, paddingRight: 0 }}>
                  {expandable && (
                    <button type="button" className={iconBtn} aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} the ${nfmt(total)} assets consuming ${p.product}`}
                      onClick={(ev) => { ev.stopPropagation(); toggle(k); }}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </td>
                <td style={TD}>
                  <span className="block font-semibold text-[#0F172A]">{p.product}{p.edition && <span className="font-normal" style={MUTED}> · {p.edition}</span>}</span>
                  <span className="block text-[11px]" style={MUTED}>{p.publisher}</span>
                </td>
                <td style={{ ...TD, color: T.ink2 }}>{optionLabel(LICENSE_METRICS, p.license_metric)}</td>
                <td style={{ ...TD, ...NUM }}>{nfmt(p.entitled)}</td>
                <td style={{ ...TD, ...NUM }}>{uncounted ? <NotCounted /> : <>{nfmt(p.consumed)}<UseBar used={p.consumed} owned={p.entitled} /></>}</td>
                <td style={{ ...TD, ...NUM }}>{uncounted ? <NotCounted /> : <Position value={p.position} />}</td>
                <td style={TD}><StatusPill status={p.status} /></td>
                <td style={{ ...TD, ...NUM }}>
                  {p.exposure_cost
                    ? <b className="font-semibold" style={{ color: T.danger }}>{money(p.exposure_cost, p.currency || currency)}</b>
                    : shortfall && p.exposure_cost == null
                      ? <span className="italic" style={{ color: T.warning }} title="There is a shortfall, but no unit cost is recorded for this product, so it can't be priced.">unpriced</span>
                      : <span style={MUTED}>—</span>}
                </td>
                <td style={{ ...TD, ...NUM }}>{!uncounted && p.reclaimable_count ? nfmt(p.reclaimable_count) : <span style={MUTED}>—</span>}</td>
                <td style={TD}><ExpiryCell date={p.nearest_expiry} /></td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={10} style={{ padding: 0, background: '#FAFBFC', borderBottom: '1px solid #F1F3F7' }}>
                    <div className="px-5 py-3">
                      <Eyebrow className="mb-2">Assets consuming this license · {nfmt(total)}</Eyebrow>
                      <AssetChips assets={assets} total={total} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─── 3. unlicensed software ────────────────────────────────────────────── */

export function UnlicensedTable({ rows, canCreate, onAddLicense }: {
  rows: UnlicensedSoftware[];
  canCreate: boolean;
  onAddLicense: (s: UnlicensedSoftware) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  return (
    <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: 780 }}>
      <thead>
        <tr>
          <Th><span className="sr-only">Expand</span></Th>
          <Th>Software</Th>
          <Th>Publisher</Th>
          <Th right tip="Installations found by scans — a product on 3 hosts counts 3">Installs</Th>
          <Th>Status</Th>
          <Th><span className="sr-only">Actions</span></Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const k = s.software_key || s.name;
          const isOpen = !!open[k];
          const assets = (s.assets ?? []).map((a) => ({ asset_id: a.asset_id, name: a.name }));
          const total = Math.max(s.assets_total ?? 0, assets.length);
          const expandable = assets.length > 0;
          const lapsed = s.reason === 'entitlement_expired';
          return (
            <Fragment key={k}>
              <tr onClick={expandable ? () => toggle(k) : undefined} className={expandable ? 'cursor-pointer hover:bg-[#F7FAFD]' : undefined}>
                <td style={{ ...TD, width: 30, paddingRight: 0 }}>
                  {expandable && (
                    <button type="button" className={iconBtn} aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} the ${nfmt(total)} assets with ${s.name}`}
                      onClick={(ev) => { ev.stopPropagation(); toggle(k); }}>
                      {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  )}
                </td>
                <td style={TD}>
                  <span className="block font-semibold text-[#0F172A]">{s.name}</span>
                  {s.software_key && <span className="block font-mono text-[10.5px]" style={MUTED}>{s.software_key}</span>}
                </td>
                <td style={{ ...TD, ...(s.publisher ? { color: T.ink2 } : MUTED) }}>{s.publisher || '—'}</td>
                <td style={{ ...TD, ...NUM }}><b className="font-semibold">{nfmt(s.install_count)}</b></td>
                <td style={TD}>
                  <span title={lapsed ? (s.note || 'This software was covered by an entitlement that has since lapsed.') : 'No entitlement on record covers this software.'}>
                    <Pill tone={statusTone(lapsed ? 'expired' : 'unlicensed')}>{lapsed ? 'Entitlement expired' : 'No entitlement'}</Pill>
                  </span>
                </td>
                <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canCreate && (
                    <button type="button" onClick={(ev) => { ev.stopPropagation(); onAddLicense(s); }}
                      className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-lg border border-[#D8DEE8] bg-white px-2.5 text-[12px] font-semibold text-[#005B96] hover:border-[#005B96] hover:bg-[#EFF5FA]">
                      <Plus size={13} aria-hidden />Add license
                    </button>
                  )}
                </td>
              </tr>
              {isOpen && (
                <tr>
                  <td colSpan={6} style={{ padding: 0, background: '#FAFBFC', borderBottom: '1px solid #F1F3F7' }}>
                    <div className="px-5 py-3">
                      <Eyebrow className="mb-2">Installed on · {nfmt(total)} {total === 1 ? 'asset' : 'assets'}</Eyebrow>
                      <AssetChips assets={assets} total={total} />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}
