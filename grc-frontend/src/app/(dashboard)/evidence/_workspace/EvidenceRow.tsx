'use client';

/**
 * EvidenceRow — a single full-width selectable row for the Workbench master list.
 * Letter tile · title + "type · owner/department" meta · status pill + expiry.
 */

import {
  type EvidenceItem,
  EvidenceLetterTile,
  StatusPill,
  StalePill,
  ExpiryStatus,
  typeLabel,
  ownerOf,
} from './lib';

export function EvidenceRow({
  item,
  selected,
  onClick,
}: {
  item: EvidenceItem;
  selected?: boolean;
  onClick?: () => void;
}) {
  const owner = ownerOf(item) || 'Unassigned';
  const meta = item.department
    ? `${item.department} · ${owner}`
    : `${typeLabel(item.evidence_type)} · ${owner}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-primary-50' : 'hover:bg-slate-50'
      }`}
    >
      <EvidenceLetterTile name={item.name} evidenceType={item.evidence_type} />

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{item.name}</span>
        <span className="block truncate text-xs text-slate-500">{meta}</span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="inline-flex items-center gap-1">
          <StatusPill status={item.status} />
          {item.is_stale && <StalePill />}
        </span>
        <ExpiryStatus expiry={item.expiry_date} />
      </span>
    </button>
  );
}
