'use client';

/**
 * EvidenceRow: one option of the Workbench list. The file's letter tile, its name (two lines, the whole name in the tooltip), "type · owner" (an owner nobody
 * set reads "Unassigned"), its expiry in words, its maturity (or where the AI review stands) and its status. It is an option of a listbox: the list owns the keys.
 */
import { UNASSIGNED } from '@/lib/format';
import { type EvidenceItem, normPct, ownerOf, typeLabel } from './evidenceModel';
import { ExpiryText, LetterTile, ReviewChip, StatusBadges } from './lib';

export function EvidenceRow({ item, selected, tabStop, onFocus, onOpen }: {
  item: EvidenceItem;
  selected: boolean;
  /** the option the Tab key lands on */
  tabStop: boolean;
  onFocus: () => void;
  onOpen: () => void;
}) {
  const owner = ownerOf(item) ?? UNASSIGNED;
  const score = normPct(item.quality_score);
  return (
    <li
      role="option"
      aria-selected={selected}
      tabIndex={tabStop ? 0 : -1}
      data-evidence-id={item.id}
      onFocus={onFocus}
      onClick={onOpen}
      className={`flex cursor-pointer items-start gap-[12px] rounded-ds-control border px-[12px] py-[8px] focus-visible:outline-none focus-visible:shadow-ds-ring ${
        selected ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border bg-ds-surface hover:bg-ds-surface-hover'
      }`}
    >
      <LetterTile name={item.name} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={item.name} dir="auto">{item.name}</span>
        <span className="mt-[2px] block break-words text-ds-label text-ds-fg-muted">{typeLabel(item.evidence_type)} · {owner}</span>
        <span className="mt-[6px] flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
          <ExpiryText expiry={item.expiry_date} />
          {score != null
            ? <span className="whitespace-nowrap text-ds-label tabular-nums text-ds-fg-muted">Maturity {score}%</span>
            : <ReviewChip score={null} review={item.ai_review} />}
        </span>
      </span>
      <span className="shrink-0"><StatusBadges item={item} /></span>
    </li>
  );
}
