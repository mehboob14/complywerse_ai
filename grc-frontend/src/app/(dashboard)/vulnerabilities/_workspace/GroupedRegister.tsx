'use client';

/**
 * Grouped register view for the Vulnerabilities workspace.
 *
 * Collapses the flat 200+ row list into runtime-derived DOMAINS — the scanner's
 * own plugin family (reliable, no heuristic parsing, auto-growing as new device
 * types appear). Domains come from the server-side /vulnerabilities/domains
 * aggregate (whole register, not a page), ordered worst-severity-first. Each
 * domain lazy-loads its findings on expand. Titles are shortened for the list;
 * the full plugin name stays on hover + on the detail page.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, Loader2, Eye } from 'lucide-react';
import { vulnManagementApi } from '@/lib/api';
import type { Vulnerability } from './lib';
import { SeverityCell, StatusPill, PriorityBeforeAfter, ThreatChips, shortenVulnTitle } from './lib';

interface Domain {
  family: string;
  total: number;
  by_severity: Record<string, number>;
  worst_severity: string;
}

const SEV_CHIP: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-sky-100 text-sky-700',
  info: 'bg-slate-100 text-slate-600',
};
const SEV_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export interface GroupedRegisterProps {
  includeClosed?: boolean;
  templateType?: string;
  onView: (vuln: Vulnerability) => void;
}

export function GroupedRegister({ includeClosed = false, templateType, onView }: GroupedRegisterProps) {
  const domainsQ = useQuery({
    queryKey: ['vuln-domains', includeClosed, templateType],
    queryFn: async () =>
      (await vulnManagementApi.vulnerabilities.getDomains({
        include_closed: includeClosed,
        template_type: templateType,
      })).data.domains as Domain[],
  });
  const domains = domainsQ.data ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (domainsQ.isLoading) {
    return <div className="p-8 text-center text-sm text-slate-400">Loading domains…</div>;
  }
  if (!domains.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
        No findings to group yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {domains.map((d) => (
        <DomainGroup
          key={d.family}
          domain={d}
          open={!!open[d.family]}
          onToggle={() => setOpen((p) => ({ ...p, [d.family]: !p[d.family] }))}
          includeClosed={includeClosed}
          templateType={templateType}
          onView={onView}
        />
      ))}
    </div>
  );
}

function DomainGroup({
  domain, open, onToggle, includeClosed, templateType, onView,
}: {
  domain: Domain;
  open: boolean;
  onToggle: () => void;
  includeClosed: boolean;
  templateType?: string;
  onView: (v: Vulnerability) => void;
}) {
  const findingsQ = useQuery({
    queryKey: ['vuln-domain-findings', domain.family, includeClosed, templateType],
    queryFn: async () =>
      (await vulnManagementApi.vulnerabilities.getAll({
        plugin_family: domain.family,
        include_closed: includeClosed,
        template_type: templateType,
        limit: 1000,
      })).data as Vulnerability[],
    enabled: open,
  });
  const findings = (findingsQ.data ?? []).slice().sort(
    (a, b) =>
      SEV_ORDER.indexOf((a.severity || 'info').toLowerCase()) -
      SEV_ORDER.indexOf((b.severity || 'info').toLowerCase()),
  );

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
      >
        {open
          ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          : <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />}
        <span className="font-semibold text-slate-900">{domain.family}</span>
        <span className="shrink-0 text-xs text-slate-400">
          {domain.total} finding{domain.total === 1 ? '' : 's'}
        </span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          {SEV_ORDER.filter((s) => domain.by_severity[s]).map((s) => (
            <span key={s} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEV_CHIP[s]}`}>
              {domain.by_severity[s]} {s}
            </span>
          ))}
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {findingsQ.isLoading ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading findings…
            </div>
          ) : findings.length === 0 ? (
            <div className="px-4 py-4 text-sm text-slate-400">No open findings in this domain.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody>
                  {findings.map((v) => (
                    <tr key={v.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                      <td className="w-[92px] py-2 pl-10 pr-2 align-middle font-mono text-xs text-slate-400">
                        VULN-{v.id}
                      </td>
                      <td className="min-w-0 py-2 pr-3 align-middle">
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            onClick={() => onView(v)}
                            className="truncate text-left font-medium text-slate-900 hover:text-primary-700 hover:underline"
                            title={v.title}
                          >
                            {shortenVulnTitle(v.title)}
                          </button>
                          <ThreatChips vuln={v} />
                        </div>
                      </td>
                      <td className="w-[112px] py-2 pr-3 align-middle">
                        <SeverityCell severity={v.severity} cvss={v.cvss_score} />
                      </td>
                      <td className="w-[160px] py-2 pr-3 align-middle">
                        <PriorityBeforeAfter v={v} />
                      </td>
                      <td className="w-[96px] py-2 pr-3 align-middle">
                        <StatusPill status={v.status} />
                      </td>
                      <td className="w-[74px] py-2 pr-4 text-right align-middle">
                        <button
                          onClick={() => onView(v)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                          title="Open finding"
                        >
                          <Eye className="h-3.5 w-3.5" /> View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default GroupedRegister;
