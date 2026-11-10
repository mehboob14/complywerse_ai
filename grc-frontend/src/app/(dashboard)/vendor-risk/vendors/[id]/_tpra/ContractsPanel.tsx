'use client';

// Contracting stage (07) and the Paperwork tab: this vendor's contracts, opened in the same drawer
// as the Contracts page — dates, renewal, money, the signed copy and obligations.
// A contract for one engagement says which; the rest apply to the whole vendor.

import { useState } from 'react';
import { ErrorState } from '@/components/ui/ds';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { FileSignature, Loader2, Paperclip, Plus } from 'lucide-react';
import { vendorContractsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { BTN_PRIMARY } from '../_record/btn';
import RecordPanel from '../_record/RecordPanel';
import { fmt } from '../../../_ui/fmt';
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

  const { data, isLoading, isError, refetch } = useQuery<Register>({
    queryKey: ['tprm-contracts', { vendorId }],
    queryFn: async () => (await vendorContractsApi.list({ vendor_id: vendorId })).data,
  });
  const contracts = data?.items || [];
  const { data: engaged } = useEngagements(vendorId);
  const engagementName = (id: number | null) => (id ? engaged?.items.find((e) => e.id === id)?.name : undefined);

  const actions = (
    <>
      <Link href="/vendor-risk/contracts" className="rounded-ds-control text-[13px] font-medium text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-primary">All contracts</Link>
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
        <div className="flex items-center gap-2 py-8 text-[13px] text-ds-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : isError ? (
        <ErrorState compact title="Couldn’t load the contracts" onRetry={() => { void refetch(); }} />
      ) : contracts.length === 0 ? (
        <div className="rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle p-[24px] text-center">
          <FileSignature className="mx-auto mb-2 h-6 w-6 text-ds-fg-muted" />
          <p className="text-[13px] font-medium text-ds-fg-body">No contracts yet</p>
          <p className="text-[12px] text-ds-fg-muted">Record the MSA, DPA, service levels or security addendum, attach the signed copy, and list what it binds the vendor to.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contracts.map((c) => (
            <button key={c.id} type="button" onClick={() => setOpen(c.id)}
              className="flex w-full items-start gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface p-3 text-left hover:border-ds-border-strong hover:bg-ds-surface-subtle">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-ds-surface-hover px-2 py-0.5 text-[12px] font-medium text-ds-fg-body">{c.type_label}</span>
                  <span className={clsx('rounded-full border px-2 py-0.5 text-[12px] font-medium', STATE_META[c.state].cls)}>{STATE_META[c.state].label}</span>
                  {c.engagement_id && (
                    <span className="rounded-full border border-ds-border-strong bg-ds-primary-soft px-2 py-0.5 text-[12px] font-medium text-ds-primary-text"
                      title="Applies to this engagement only">{engagementName(c.engagement_id) || 'One engagement'}</span>
                  )}
                  {c.evidence_id && <Paperclip className="h-3.5 w-3.5 text-ds-fg-muted" aria-label="Signed copy attached" />}
                </div>
                <p className="mt-1 text-[13px] font-medium text-ds-fg">{c.title || 'Untitled contract'}</p>
                <p className="mt-0.5 text-[12px] text-ds-fg-muted">
                  {c.ends_on ? `${c.renewal_type === 'auto' ? 'Renews' : 'Ends'} ${fmtDate(c.ends_on)}` : 'No end date'}
                  {c.act_by && c.act_by !== c.ends_on && ` · notice by ${fmtDate(c.act_by)}`}
                  {c.annual_value !== null && ` · ${money(c.annual_value, c.currency)} a year`}
                </p>
                {CLAUSES.some(({ key }) => c[key] === false) && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {CLAUSES.filter(({ key }) => c[key] === false).map(({ key, gap }) => (
                      <span key={key} className="rounded-full border border-ds-border-strong bg-ds-warning-soft px-2 py-0.5 text-[12px] text-ds-warning">{gap}</span>
                    ))}
                  </div>
                )}
              </div>
              {countdown(c) && ['lapsed', 'decide', 'ending'].includes(c.state) && (
                <span className="shrink-0 text-[12px] text-ds-fg-muted">{countdown(c)}</span>
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

  if (framed) return <RecordPanel title="Contracts" count={contracts.length || undefined} action={actions}>{body}</RecordPanel>;
  return (
    <div className="space-y-[12px]">
      <div className="flex items-center justify-between">{actions}</div>
      {body}
    </div>
  );
}
