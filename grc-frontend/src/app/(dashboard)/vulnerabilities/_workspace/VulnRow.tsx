'use client';

/**
 * VulnRow — a single full-width selectable row for the Workbench master list.
 * Id tile · title (+ KEV/EPSS chips) + "VULN-{id} · owner" meta · right-aligned
 * severity badge + SLA pill. Selected → bg-primary-50. Mirrors
 * assets/_workspace/AssetRow.
 */

import type { Vulnerability } from './lib';
import { VulnIdTile, SeverityCell, SlaCell, ThreatChips } from './lib';

export function VulnRow({
  vuln,
  selected,
  onClick,
}: {
  vuln: Vulnerability;
  selected?: boolean;
  onClick?: () => void;
}) {
  const owner = vuln.assignee_name || 'Unassigned';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition-colors ${
        selected ? 'bg-primary-50' : 'hover:bg-slate-50'
      }`}
    >
      <VulnIdTile id={vuln.id} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-slate-900">{vuln.title}</span>
          <ThreatChips vuln={vuln} />
        </span>
        <span className="block truncate text-xs text-slate-400">
          VULN-{vuln.id} · {owner}
        </span>
      </span>

      <span className="flex shrink-0 flex-col items-end gap-1">
        <SeverityCell severity={vuln.severity} cvss={vuln.cvss_score} size="sm" />
        <SlaCell vuln={vuln} />
      </span>
    </button>
  );
}

export default VulnRow;
