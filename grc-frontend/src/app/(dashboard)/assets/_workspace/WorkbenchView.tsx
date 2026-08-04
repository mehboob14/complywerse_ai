'use client';

/**
 * WorkbenchView — Assets master-detail workbench: a scrollable list of AssetRow
 * on the left, a sticky DetailPreview on the right. Selecting a row swaps the
 * preview in place — no page hop, no lost context. Mirrors
 * evidence/_workspace/WorkbenchView.
 */

import type { ITAsset } from '@/types';
import { AssetRow } from './AssetRow';
import { DetailPreview } from './DetailPreview';

export function WorkbenchView({
  rows,
  selectedId,
  onSelect,
  onOpenFull,
  onAssessRisk,
  onScan,
}: {
  rows: ITAsset[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onOpenFull: (id: number) => void;
  onAssessRisk?: (id: number) => void;
  onScan?: (id: number) => void;
}) {
  const list = rows ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* LEFT — master list */}
      <div className="lg:col-span-5">
        <div className="card p-0">
          {list.length ? (
            <div className="max-h-[70vh] overflow-y-auto">
              {list.map((asset) => (
                <AssetRow
                  key={asset.id}
                  asset={asset}
                  selected={asset.id === selectedId}
                  onClick={() => onSelect(asset.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[16rem] items-center justify-center px-4 py-8 text-sm text-slate-400">
              No assets to show
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — sticky detail preview */}
      <div className="lg:col-span-7">
        <div className="lg:sticky lg:top-4">
          <DetailPreview
            selectedId={selectedId}
            onOpenFull={onOpenFull}
            onAssessRisk={onAssessRisk}
            onScan={onScan}
          />
        </div>
      </div>
    </div>
  );
}

export default WorkbenchView;
