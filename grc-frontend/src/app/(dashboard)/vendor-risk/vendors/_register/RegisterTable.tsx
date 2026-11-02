'use client';

// The Register's table: a header per visible column (the sortable ones are buttons that cycle ascending, descending, back to the
// server's order), a 56px row per vendor, and the ⋯ menu. A click on the row opens the vendor; the links and buttons inside it do
// their own thing. Explicit colours and `!` where the dashboard CSS would repaint a table (header ink and size, zebra rows).

import type { MouseEvent, ReactNode } from 'react';
import Link from 'next/link';
import { AlertCircle, Check, ChevronDown, ChevronUp, ChevronsUpDown, Clock } from 'lucide-react';
import { RowActionsMenu, type RowAction } from '@/app/(dashboard)/governance/documents/_workspace/RowActionsMenu';
import { GradePill, PersonChip, SeverityChip, StatusPill, TierBadge, TONE, fmt, tones } from '../../_ui';
import VendorLogo from '../../_lib/VendorLogo';
import { StageProgress, stageNumberLabel } from '../../_lib/lifecycleShared';
import type { RegisterVendor } from '../../_lib/portfolioApi';
import {
  COLUMNS, ariaSort, asDay, classificationTone, isPast, isTiered, nextActionCell, nextSort, recordHref, vendorSubline,
  type Column, type ColumnId, type Sort,
} from '../../_lib/registerModel';

const MUTED = 'text-[13px] leading-5 text-[#64707e]';
const TEXT = 'text-[13px] leading-5 text-[#26323d]';
const LINK = 'rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';

function Head({ col, sort, onSort }: { col: Column; sort: Sort; onSort: (key: NonNullable<Column['sort']>) => void }) {
  // `!`: the dashboard CSS gives a table header its own ink and size
  const cls = `whitespace-nowrap !bg-[#f8fafb] px-4 !text-[11px] !font-semibold uppercase tracking-wide !text-[#586472] ${col.right ? 'text-right' : 'text-left'}`;
  if (!col.sort) return <th scope="col" className={cls}>{col.label}</th>;
  const key = col.sort;
  const on = sort.key === key;
  const Icon = !on ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th scope="col" aria-sort={ariaSort(sort, key)} className={cls}>
      <button type="button" onClick={() => onSort(key)} className={`inline-flex items-center gap-1 uppercase tracking-wide ${on ? 'text-[#0f766e]' : 'hover:text-[#1f2933]'} ${LINK}`}>
        {col.label}
        <Icon aria-hidden className={`h-3.5 w-3.5 ${on ? '' : 'opacity-40'}`} strokeWidth={2} />
      </button>
    </th>
  );
}

function Cell({ id, v }: { id: ColumnId; v: RegisterVendor }): ReactNode {
  switch (id) {
    case 'vendor': {
      const sub = vendorSubline(v);
      const engagements = v.open_engagements ?? 0;
      return (
        <div className="flex min-w-[15rem] items-center gap-3">
          <VendorLogo vendorId={v.id} name={v.name} size={32} cachedOnly />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link href={recordHref(v.id)} className={`truncate text-[14px] font-semibold leading-5 text-[#1f2933] hover:text-[#0f766e] hover:underline ${LINK}`}>{v.name}</Link>
              {v.holds_personal_data && (
                <span title="Holds personal data" className="shrink-0 rounded px-1.5 py-px text-[10px] font-bold leading-4" style={{ background: TONE.warning.tint, color: TONE.warning.text }}>PII</span>
              )}
              {v.archived_at && <StatusPill tone="neutral">Archived</StatusPill>}
            </div>
            {(sub || engagements > 0) && (
              <p className="truncate text-[12px] leading-4 text-[#64707e]">
                {sub}
                {engagements > 0 && (
                  <>
                    {sub && ' · '}
                    <Link href={`${recordHref(v.id)}?tab=overview`} className={`hover:text-[#1f2933] hover:underline ${LINK}`}>
                      {engagements} engagement{engagements === 1 ? '' : 's'}
                    </Link>
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      );
    }
    case 'tier':
      return <TierBadge tier={isTiered(v) ? v.tier : null} variant="dot" />;
    case 'status':
      return <StatusPill tone={tones.lifecycle(v.status)} variant="inline">{fmt.status(v.status) || 'Not set'}</StatusPill>;
    case 'next_action': {
      const a = nextActionCell(v);
      if (a.kind === 'archived') return <span className={MUTED}>Archived</span>;
      if (a.kind === 'none') {
        return <span className="inline-flex items-center gap-1.5 text-[13px] leading-5 text-[#64707e]"><Check aria-hidden className="h-4 w-4" strokeWidth={2} />Nothing outstanding</span>;
      }
      const Icon = a.tone === 'progress' ? Clock : AlertCircle;
      return (
        <Link href={a.href ?? recordHref(v.id)} className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium leading-5 hover:underline ${LINK}`} style={{ color: TONE[a.tone].text }}>
          <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          {a.label}
        </Link>
      );
    }
    case 'grade':
      return <GradePill grade={v.grade} score={v.grade_score} />;
    case 'owner':
      return <PersonChip name={v.owner?.full_name} size="sm" />;
    case 'business_unit':
      return v.business_unit?.name ? <span className={TEXT}>{v.business_unit.name}</span> : <span className={MUTED}>Not set</span>;
    case 'classification':
      return v.data_classification
        ? <StatusPill tone={classificationTone(v.data_classification)} variant="inline">{fmt.status(v.data_classification)}</StatusPill>
        : <span className={MUTED}>Not set</span>;
    case 'next_reassessment': {
      if (!v.next_reassessment_date) return <span className={MUTED}>No date</span>;
      const late = !v.archived_at && isPast(v.next_reassessment_date);
      return <span title={fmt.countdown(v.next_reassessment_date)} className="whitespace-nowrap text-[13px] leading-5" style={{ color: late ? TONE.danger.text : '#26323d' }}>{fmt.date(v.next_reassessment_date)}</span>;
    }
    case 'annual_value':
      return v.contract_value == null ? <span className={MUTED}>Not set</span> : <span className={`${TEXT} tabular-nums`}>{fmt.money(v.contract_value)}</span>;
    case 'risk_rating':
      return v.risk_rating
        ? <SeverityChip severity={v.risk_rating} solid={false} />
        : v.inherent_risk_score != null ? <span className={`${TEXT} tabular-nums`}>{v.inherent_risk_score.toFixed(1)}</span> : <span className={MUTED}>—</span>;
    case 'lifecycle':
      return (
        <div className="flex flex-col gap-1">
          <StageProgress currentKey={v.lifecycle_stage} size="sm" />
          <span className="text-[11px] leading-4 text-[#64707e]">{stageNumberLabel(v.lifecycle_stage)}</span>
        </div>
      );
    case 'data_access':
      return v.data_access_level ? <span className={TEXT}>{fmt.status(v.data_access_level)}</span> : <span className={MUTED}>—</span>;
    case 'contract_end':
      return v.contract_end_date ? <span className={`${TEXT} whitespace-nowrap`}>{fmt.date(asDay(v.contract_end_date))}</span> : <span className={MUTED}>No date</span>;
    default:
      return null;
  }
}

export default function RegisterTable({ rows, visible, sort, onSort, onOpen, menuFor, dim }: {
  rows: RegisterVendor[];
  visible: ColumnId[];
  sort: Sort;
  onSort: (next: Sort) => void;
  onOpen: (id: number) => void;
  menuFor: (v: RegisterVendor) => RowAction[];
  /** a new page or filter is loading: the rows shown are the last ones */
  dim?: boolean;
}) {
  const columns = COLUMNS.filter((c) => visible.includes(c.id));
  // a click on the row opens the vendor; one on a link or button inside it is theirs
  const open = (e: MouseEvent<HTMLTableRowElement>, id: number) => {
    if ((e.target as HTMLElement).closest('a, button, input, label, [role="menu"]')) return;
    onOpen(id);
  };
  return (
    <div className={`overflow-x-auto ${dim ? 'opacity-60 transition-opacity' : ''}`}>
      <table className="min-w-full">
        <thead>
          <tr className="h-10">
            {columns.map((c) => <Head key={c.id} col={c} sort={sort} onSort={(key) => onSort(nextSort(sort, key))} />)}
            <th scope="col" className="w-12 !bg-[#f8fafb]"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} onClick={(e) => open(e, v.id)} className={`h-14 cursor-pointer !bg-[#fff] hover:!bg-[#f8fafb] ${v.archived_at ? 'opacity-75' : ''}`}>
              {columns.map((c) => (
                <td key={c.id} className={`px-4 align-middle ${c.right ? 'text-right' : ''}`}>
                  <Cell id={c.id} v={v} />
                </td>
              ))}
              <td className="w-12 px-2 text-right align-middle"><RowActionsMenu actions={menuFor(v)} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
