'use client';

import Link from 'next/link';
import { Loader2, Shield, Trash2 } from 'lucide-react';
import InlineLinkPicker from '@/components/ui/InlineLinkPicker';
import {
  controlTypeLabel, effectivenessLabel, effectivenessTone, kindLabel,
} from '../../../analytics/bowtie/bowtieModel';
import type { LinkedControl } from '../../../analytics/bowtie/bowtieModel';

/** One row of GET /erm/internal-controls/risk-links/{risk id}: the one risk–control link. */
export interface RiskControlRow extends LinkedControl {
  source: 'internal' | 'normalized' | 'framework' | 'catalog';
  control_id: number;
  scf_id?: string | null;
}

interface PickerControl {
  id: number | string;
  name?: string | null;
  title?: string | null;
  code?: string | null;
  scf_id?: string | null;
  internal_id?: string | null;
  control_id?: string | null;
  source?: string | null;
  custom?: boolean;
}

interface RiskControlsTabProps {
  controls: RiskControlRow[] | undefined;
  isLoading: boolean;
  allControls: PickerControl[];
  allInternalControls: PickerControl[];
  onLinkControl: (normalizedControlId: number) => void;
  onLinkInternalControl: (internalControlId: number) => void;
  onLinkRequirement: () => void;
  onUnlink: (linkId: number) => void;
  unlinkingId: number | null;
  canEdit: boolean;
  canDelete: boolean;
}

function controlHref(c: RiskControlRow): string | null {
  if (c.source === 'internal') return `/erm/internal-controls/${c.control_id}`;
  if (c.source === 'normalized') {
    return c.scf_id ? `/automation/soc2-controls/${encodeURIComponent(c.scf_id)}` : `/control-library/${c.control_id}`;
  }
  return null;
}

function day(value?: string | null): string {
  return value ? new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

export default function RiskControlsTab({
  controls, isLoading, allControls, allInternalControls, onLinkControl, onLinkInternalControl, onLinkRequirement,
  onUnlink, unlinkingId, canEdit, canDelete,
}: RiskControlsTabProps) {
  const rows = controls || [];
  const linked = new Set(rows.map((c) => `${c.source}-${c.control_id}`));
  const pickerItems = [
    ...allInternalControls.filter((c) => !linked.has(`internal-${c.id}`)).map((c) => ({
      value: `i-${c.id}`,
      label: c.name || c.title || `Control #${c.id}`,
      subLabel: c.control_id ? `Internal • ${c.control_id}` : 'Internal',
    })),
    ...allControls.filter((c) => !linked.has(`normalized-${c.id}`)).map((c) => {
      const scfOrCode = c.scf_id || c.code || c.internal_id || null;
      const kind = c.custom || c.source === 'custom' ? 'Custom' : scfOrCode ? 'SCF' : 'Library';
      return { value: `n-${c.id}`, label: c.name || `Control ${scfOrCode || c.id}`, subLabel: scfOrCode ? `${kind} • ${scfOrCode}` : kind };
    }),
  ];
  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Shield className="h-4 w-4 text-primary-400" />
          Controls
        </h3>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onLinkRequirement}
              className="flex items-center gap-2 rounded-lg border border-primary-600 px-3 py-1.5 text-sm text-primary-700 hover:bg-primary-50"
            >
              Link framework control
            </button>
            <InlineLinkPicker
              triggerLabel="Link control"
              triggerClassName="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700"
              items={pickerItems}
              onSelect={(value) => {
                if (value.startsWith('i-')) onLinkInternalControl(Number(value.slice(2)));
                else if (value.startsWith('n-')) onLinkControl(Number(value.slice(2)));
              }}
              searchPlaceholder="Search internal and library controls..."
              emptyText="No controls available"
            />
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="py-6 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-300" /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
          No controls linked.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Control</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Last test</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Next due</th>
                {canDelete && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((c) => {
                const href = controlHref(c);
                const overdue = !!c.next_test_due && new Date(c.next_test_due).getTime() < now;
                return (
                  <tr key={c.link_id} className="align-top">
                    <td className="px-3 py-2">
                      {href ? (
                        <Link href={href} className="font-medium text-slate-800 hover:text-primary-700 hover:underline">{c.name}</Link>
                      ) : (
                        <span className="font-medium text-slate-800">{c.name}</span>
                      )}
                      <div className="text-[11px] text-slate-500">{kindLabel(c.kind)}{c.code ? ` · ${c.code}` : ''}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-700">{controlTypeLabel(c.control_type)}</td>
                    <td className="px-3 py-2 text-slate-700">{day(c.last_tested_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] ${effectivenessTone(c.effectiveness)}`}>
                        {effectivenessLabel(c.effectiveness)}
                      </span>
                    </td>
                    <td className={`px-3 py-2 ${overdue ? 'font-medium text-rose-700' : 'text-slate-700'}`}>
                      {day(c.next_test_due)}{overdue ? ' · overdue' : ''}
                    </td>
                    {canDelete && (
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => onUnlink(c.link_id)}
                          disabled={unlinkingId === c.link_id}
                          title="Unlink"
                          className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className="text-[11px] text-slate-400">
          Test results do not change the residual score; a change goes through a Risk Review.
        </p>
      )}
    </div>
  );
}
