'use client';

// Contracting stage (07) and the Paperwork tab: this vendor's contracts, opened in the same drawer
// as the Contracts page — dates, renewal, money, the signed copy and obligations.
// A contract for one engagement says which; the rest apply to the whole vendor.

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { FileSignature, Loader2, Paperclip, Plus } from 'lucide-react';
import { vendorContractsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN_PRIMARY, Panel, fmt } from '../../../_ui';
import ContractDrawer from '../../../_lib/contracts/ContractDrawer';
import { CLAUSES, STATE_META, countdown, money, type Register } from '../../../_lib/contracts/shared';
import { useEngagements } from '../../../_lib/engagementsApi';

const fmtDate = (d?: string | null) => (d ? fmt.date(d) : '—');      // "5 Mar 2026", as everywhere in the module

/** `framed` draws the contracts as a panel of their own (the Paperwork tab); without it they sit in whatever frame the caller has (a lifecycle stage). */
export default function ContractsPanel({ vendorId, assessmentId, framed = false }: { vendorId: number; assessmentId?: number; framed?: boolean }) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('vendor_risk:contracts:create') || hasPermission('vendor_risk:contracts:edit')
    || hasPermission('erm:risks:edit');
  const [open, setOpen] = useState<number | 'new' | null>(null);

  const { data, isLoading } = useQuery<Register>({
    queryKey: ['tprm-contracts', { vendorId }],
    queryFn: async () => (await vendorContractsApi.list({ vendor_id: vendorId })).data,
  });
  const contracts = data?.items || [];
  const { data: engaged } = useEngagements(vendorId);
  const engagementName = (id: number | null) => (id ? engaged?.items.find((e) => e.id === id)?.name : undefined);

  const actions = (
    <>
      <Link href="/vendor-risk/contracts" className="rounded-sm text-[13px] font-medium text-[#0f766e] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]">All contracts</Link>
      {canCreate && (
        <button type="button" onClick={() => setOpen('new')} className={BTN_PRIMARY}>
          <Plus aria-hidden className="h-4 w-4" /> Add contract
        </button>
      )}
    </>
  );

  const body = (
    <>
      {isLoading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : contracts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
          <FileSignature className="mx-auto mb-2 h-6 w-6 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">No contracts yet</p>
          <p className="text-xs text-gray-500">Record the MSA, DPA, service levels or security addendum, attach the signed copy, and list what it binds the vendor to.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => (
            <button key={c.id} type="button" onClick={() => setOpen(c.id)}
              className="flex w-full items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 text-left hover:border-primary-300 hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{c.type_label}</span>
                  <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] font-medium', STATE_META[c.state].cls)}>{STATE_META[c.state].label}</span>
                  {c.engagement_id && (
                    <span className="rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-700"
                      title="Applies to this engagement only">{engagementName(c.engagement_id) || 'One engagement'}</span>
                  )}
                  {c.evidence_id && <Paperclip className="h-3.5 w-3.5 text-slate-400" aria-label="Signed copy attached" />}
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{c.title || 'Untitled contract'}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {c.ends_on ? `${c.renewal_type === 'auto' ? 'Renews' : 'Ends'} ${fmtDate(c.ends_on)}` : 'No end date'}
                  {c.act_by && c.act_by !== c.ends_on && ` · notice by ${fmtDate(c.act_by)}`}
                  {c.annual_value !== null && ` · ${money(c.annual_value, c.currency)} a year`}
                </p>
                {CLAUSES.some(({ key }) => c[key] === false) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {CLAUSES.filter(({ key }) => c[key] === false).map(({ key, gap }) => (
                      <span key={key} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">{gap}</span>
                    ))}
                  </div>
                )}
              </div>
              {countdown(c) && ['lapsed', 'decide', 'ending'].includes(c.state) && (
                <span className="shrink-0 text-[11px] text-slate-500">{countdown(c)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {open !== null && (
        <ContractDrawer contractId={open === 'new' ? null : open} vendorId={vendorId} assessmentId={assessmentId}
          onClose={() => setOpen(null)} />
      )}
    </>
  );

  if (framed) return <Panel title="Contracts" count={contracts.length || undefined} action={actions}>{body}</Panel>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">{actions}</div>
      {body}
    </div>
  );
}
