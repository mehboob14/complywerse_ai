'use client';

/**
 * WorkbenchView — the DEFAULT/headline Evidence view. A two-pane master-detail
 * workbench: a scrollable list of EvidenceRow on the left, a sticky DetailPreview
 * on the right. Selecting a row swaps the preview in place — no page hop, no lost
 * context. This is the master-detail headline fix.
 */

import { EvidenceRow } from './EvidenceRow';
import { DetailPreview } from './DetailPreview';
import type { EvidenceItem } from './lib';

export function WorkbenchView({
  items,
  selectedId,
  onSelect,
  onOpenFull,
  onApprove,
  onReassess,
  onOpenFile,
  canReview,
}: {
  items: EvidenceItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onOpenFull: (id: number) => void;
  onApprove: (id: number) => void;
  onReassess: (id: number) => void;
  onOpenFile: (id: number) => void;
  canReview?: boolean;
}) {
  const list = items ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* LEFT — master list */}
      <div className="lg:col-span-5">
        <div className="card p-0">
          {list.length ? (
            <div className="max-h-[70vh] overflow-y-auto">
              {list.map((item) => (
                <EvidenceRow
                  key={item.id}
                  item={item}
                  selected={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[16rem] items-center justify-center px-4 py-8 text-sm text-slate-400">
              No evidence to show
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — sticky detail preview */}
      <div className="lg:col-span-7">
        <div className="lg:sticky lg:top-4">
          <DetailPreview
            evidenceId={selectedId}
            onOpenFull={onOpenFull}
            onApprove={onApprove}
            onReassess={onReassess}
            onOpenFile={onOpenFile}
            canReview={canReview}
          />
        </div>
      </div>
    </div>
  );
}
