'use client';

/**
 * WorkbenchView — Vulnerabilities master-detail workbench: a scrollable list of
 * VulnRow on the left, a sticky DetailPreview on the right. Selecting a row
 * swaps the preview in place — no page hop, no lost context. Mirrors
 * assets/_workspace/WorkbenchView (12-col split).
 */

import type { Vulnerability } from './lib';
import { VulnRow } from './VulnRow';
import { DetailPreview } from './DetailPreview';

export function WorkbenchView({
  rows,
  selectedId,
  onSelect,
  onOpenFull,
}: {
  rows: Vulnerability[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onOpenFull: (id: number) => void;
}) {
  const list = rows ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      {/* LEFT — master list */}
      <div className="lg:col-span-5">
        <div className="card p-0">
          {list.length ? (
            <div className="max-h-[70vh] overflow-y-auto">
              {list.map((vuln) => (
                <VulnRow
                  key={vuln.id}
                  vuln={vuln}
                  selected={vuln.id === selectedId}
                  onClick={() => onSelect(vuln.id)}
                />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[16rem] items-center justify-center px-4 py-8 text-sm text-slate-400">
              No vulnerabilities to show
            </div>
          )}
        </div>
      </div>

      {/* RIGHT — sticky detail preview */}
      <div className="lg:col-span-7">
        <div className="lg:sticky lg:top-4">
          <DetailPreview selectedId={selectedId} onOpenFull={onOpenFull} />
        </div>
      </div>
    </div>
  );
}

export default WorkbenchView;
