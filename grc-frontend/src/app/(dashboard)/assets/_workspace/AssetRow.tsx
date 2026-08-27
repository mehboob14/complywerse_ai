'use client';

/**
 * AssetRow — a single full-width selectable row for the Workbench master list.
 * Letter tile · name (+ CDE) + "type · owner" meta · right-aligned criticality pill.
 * Selected → bg-primary-50. Mirrors evidence/_workspace/EvidenceRow.
 */

import type { ITAsset } from '@/types';
import {
  AssetLetterTile,
  CriticalityPill,
  assetTypeLabel,
  assetDisplayName,
} from './lib';

export function AssetRow({
  asset,
  selected,
  onClick,
}: {
  asset: ITAsset;
  selected?: boolean;
  onClick?: () => void;
}) {
  const name = assetDisplayName(asset);
  const owner = asset.owner_name || 'Unassigned';
  const meta = `${assetTypeLabel(asset.asset_type)} · ${owner}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-primary-50' : 'hover:bg-slate-50'
      }`}
    >
      <AssetLetterTile name={name} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{name}</span>
          {asset.cde_environment && (
            <span className="shrink-0 rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-rose-700">CDE</span>
          )}
          {asset.ephi_environment && (
            <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-indigo-700">ePHI</span>
          )}
        </span>
        <span className="block truncate text-xs text-slate-400">{meta}</span>
      </span>

      <span className="shrink-0">
        <CriticalityPill criticality={asset.criticality} />
      </span>
    </button>
  );
}

export default AssetRow;
