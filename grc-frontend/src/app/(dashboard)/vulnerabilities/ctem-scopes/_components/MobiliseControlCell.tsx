'use client';

/**
 * The Mobilise board's control cell — the live link to the Validate stage.
 *
 * Shows "N controls ▾"; opening it fetches the finding's real control links
 * (GET /vulnerabilities/{id}/controls) and lists them. Clicking one opens a
 * detail popup (blurred backdrop) with the control's code, framework, the AI's
 * reason + confidence (parsed from the link note), and its live effectiveness
 * tier. Reject deletes that one link (reversible, remembered) and refreshes.
 *
 * A finding can carry 1..N controls — the dropdown is why this isn't a flat chip.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import { ShieldCheck, ChevronDown, X, Loader2 } from 'lucide-react';

interface Link {
  id: number;
  framework_control_code?: string | null; framework_control_name?: string | null;
  normalized_control_code?: string | null; normalized_control_name?: string | null;
  normalized_control_id?: number | null; internal_control_name?: string | null;
  parsed_control_code?: string | null; parsed_control_name?: string | null;
  parsed_framework_name?: string | null; framework_short_code?: string | null;
  notes?: string | null; source?: string | null; assurance_tier?: string | null;
  satisfies?: string[] | null;
}

const codeOf = (l: Link) => l.parsed_control_code || l.framework_control_code || l.normalized_control_code || l.internal_control_name || `#${l.id}`;
const nameOf = (l: Link) => l.parsed_control_name || l.framework_control_name || l.normalized_control_name || l.internal_control_name || '';
const fwOf = (l: Link) => l.parsed_framework_name || l.framework_short_code || ((l.satisfies && l.satisfies.length) ? l.satisfies.join(' · ') : (l.normalized_control_id ? 'Unified Control Library' : '—'));

function parseNote(notes?: string | null): { basis: string; conf: string | null; reason: string } {
  if (!notes) return { basis: 'manual', conf: null, reason: 'Linked by a person.' };
  if (/^ai_(auto|suggested|reused):/.test(notes)) {
    const p = notes.split(' · ');
    return { basis: 'ai', conf: (p[1] || '').trim() || null, reason: p.slice(2).join(' · ') || 'AI-linked from your control library.' };
  }
  if (notes.startsWith('auto:cwe:')) return { basis: 'rule', conf: null, reason: 'Linked by the CWE crosswalk rule.' };
  return { basis: 'manual', conf: null, reason: notes };
}

const TIER: Record<string, { label: string; cls: string }> = {
  tested_effective: { label: 'effective ✓', cls: 'bg-emerald-50 text-emerald-700' },
  remediation_verified: { label: 'fix verified', cls: 'bg-sky-50 text-sky-700' },
  tested_failed: { label: 'failed ✗', cls: 'bg-rose-50 text-rose-700' },
  stale: { label: 'stale', cls: 'bg-slate-100 text-slate-500' },
  attested_only: { label: 'claimed', cls: 'bg-slate-100 text-slate-500' },
};

export function MobiliseControlCell({ vulnId, count, canEdit, onChanged }: { vulnId: number; count: number; canEdit: boolean; onChanged?: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Link | null>(null);

  const { data: links, isLoading, isError, refetch } = useQuery({
    queryKey: ['vuln-controls', vulnId],
    enabled: open || !!detail,
    staleTime: 60_000,
    retry: 2,
    queryFn: async () => (await vulnManagementApi.controlLinks.list(vulnId)).data as Link[],
  });
  const reject = useMutation({
    mutationFn: (linkId: number) => vulnManagementApi.controlLinks.delete(vulnId, linkId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vuln-controls', vulnId] }); onChanged?.(); setDetail(null); },
  });

  if (count === 0) {
    return <span className="text-[11px] italic text-slate-400" title="No control mapped yet — run Map controls in the Validate stage.">no control yet</span>;
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50 px-2 py-1 text-[11.5px] font-medium text-primary-700 transition hover:border-primary-400">
        <ShieldCheck className="h-3 w-3" /> {count} control{count > 1 ? 's' : ''} <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-40 mt-1 w-[330px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Linked controls · {count}</p>
            {isLoading ? (
              <p className="px-2 py-2 text-[11px] text-slate-400">Loading…</p>
            ) : isError ? (
              <p className="px-2 py-2 text-[11px] text-rose-600">
                Couldn&apos;t load the links (server busy?).{' '}
                <button type="button" onClick={() => refetch()} className="font-semibold underline">Retry</button>
              </p>
            ) : (links ?? []).length === 0 ? (
              <p className="px-2 py-2 text-[11px] text-slate-400">No links on this vulnerability.</p>
            ) : (
              (links ?? []).map((l) => (
                <button key={l.id} type="button" onClick={() => { setDetail(l); setOpen(false); }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-primary-50">
                  <span className="shrink-0 rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-primary-700">{codeOf(l)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-slate-700">{nameOf(l)}</span>
                  <span className="shrink-0 text-slate-300">›</span>
                </button>
              ))
            )}
          </div>
        </>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="w-full max-w-[500px] rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start gap-3 border-b border-slate-100 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-primary-700">{codeOf(detail)}</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{fwOf(detail)}</span>
                </div>
                <h3 className="mt-1.5 text-[15px] font-semibold text-slate-900">{nameOf(detail)}</h3>
              </div>
              <button onClick={() => setDetail(null)} className="ml-auto shrink-0 text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-4">
              {detail.assurance_tier && TIER[detail.assurance_tier] && (
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Effectiveness (from Validate)</p>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${TIER[detail.assurance_tier].cls}`}>{TIER[detail.assurance_tier].label}</span>
                </div>
              )}
              {(() => {
                const nb = parseNote(detail.notes);
                return (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Why it was linked to this finding</p>
                    <div className="rounded-lg border border-primary-100 bg-primary-50/60 p-2.5">
                      {nb.conf && <span className="mb-1 inline-block rounded border border-primary-200 px-1.5 py-0 text-[10px] font-semibold text-primary-700">{nb.conf} confidence</span>}
                      <p className="text-[12px] leading-relaxed text-slate-700">{nb.reason}</p>
                      <p className="mt-1 text-[10px] text-slate-400">basis: {nb.basis === 'ai' ? 'AI picked this from your control library' : nb.basis === 'rule' ? 'CWE crosswalk rule' : 'linked by a person'}</p>
                    </div>
                  </div>
                );
              })()}
              {canEdit && (
                <div className="flex items-center gap-2.5 pt-1">
                  <button onClick={() => reject.mutate(detail.id)} disabled={reject.isPending}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11.5px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                    {reject.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />} Reject this link
                  </button>
                  <span className="text-[10.5px] text-slate-400">Removes only this one link, and it&apos;s remembered.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
