'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { errorText } from '@/components/settings/CustomFields';
import { BREACH_STATUS, breachActions, excessExpiryRange, type BreachAction, type BreachRecord } from './appetiteModel';

const INPUT = 'w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';
const BTN = 'rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const ACTION_LABEL: Record<BreachAction, string> = {
  plan: 'Propose plan', 'approve-plan': 'Approve plan', 'reject-plan': 'Send plan back', 'approve-excess': 'Approve excess',
};
const TH = 'px-3 py-2 text-left text-xs font-medium text-slate-600';

const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const label = (category: string) => category.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The breach log: every breach of a category's limit by a risk or a limit KRI, open ones first. The owner proposes a plan;
 * someone else approves the plan or a time-limited excess, or sends the plan back with the reason (the server refuses the
 * plan's author and says so).
 */
export default function BreachLog({ canDecide }: { canDecide: boolean }) {
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<{ id: number; action: BreachAction } | null>(null);
  const [text, setText] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const range = excessExpiryRange();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['appetite-breach-log'],
    queryFn: async () => (await ermApi.appetite.getBreachLog()).data as BreachRecord[],
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['appetite-breach-log'] });
    queryClient.invalidateQueries({ queryKey: ['appetite-configs-with-stats'] });
  };
  const check = useMutation({ mutationFn: () => ermApi.appetite.check(), onSuccess: refresh });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: BreachAction }): Promise<unknown> => {
      if (action === 'plan') return ermApi.appetite.proposePlan(id, text.trim());
      if (action === 'approve-plan') return ermApi.appetite.approvePlan(id, text.trim() || undefined);
      if (action === 'reject-plan') return ermApi.appetite.rejectPlan(id, text.trim());
      return ermApi.appetite.approveExcess(id, { expires_at: `${expiresAt}T23:59:59`, note: text.trim() });
    },
    onSuccess: () => { refresh(); setActing(null); setText(''); setExpiresAt(''); setError(null); },
    onError: (e: unknown) => setError(errorText(e, 'Could not save.')),
  });
  const start = (id: number, action: BreachAction, plan?: string | null) => {
    setActing({ id, action }); setText(action === 'plan' ? plan || '' : ''); setExpiresAt(''); setError(null);
  };
  const openCount = rows.filter((r) => r.status !== 'resolved').length;

  return (
    <section className="cw-card rounded-xl overflow-hidden" aria-labelledby="appetite-breach-log-title">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className={clsx('h-4 w-4', openCount ? 'text-rose-600' : 'text-slate-400')} strokeWidth={1.75} />
          <h3 id="appetite-breach-log-title" className="text-base font-semibold text-slate-900">Breach log</h3>
          <span className="text-xs text-slate-500">{openCount} open</span>
        </div>
        <button type="button" className={clsx(BTN, 'inline-flex items-center gap-1.5')} disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />} Check now
        </button>
      </div>
      {isLoading ? <p className="p-4 text-sm text-slate-500">Loading the breach log…</p> : rows.length === 0 ? (
        <p className="p-4 text-sm text-slate-600">No breaches recorded. Every risk and limit KRI is within appetite.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-200">
              {['Category', 'Risk / KRI', 'Value vs limit', 'Days open', 'Status', 'Plan', 'Decision', 'Excess until', ''].map((h) => <th key={h} className={TH}>{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => {
                const actions = breachActions(b, canDecide);
                const status = BREACH_STATUS[b.status];
                return (
                  <Fragment key={b.id}>
                    <tr className={clsx(b.status === 'resolved' && 'text-slate-500')}>
                      <td className="px-3 py-2">{label(b.category)}</td>
                      <td className="px-3 py-2">
                        {b.risk_id ? <Link href={`/erm/risks/${b.risk_id}`} className="hover:text-primary-600">{b.risk_title || `Risk #${b.risk_id}`}</Link>
                          : b.kri_id ? <Link href="/erm/kris" className="hover:text-primary-600">KRI: {b.kri_name || `#${b.kri_id}`}</Link>
                            : <Link href="/vendor-risk/concentration" className="hover:text-primary-600">Concentration: critical or important vendors on one fourth party</Link>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap"><span className="font-medium text-rose-600">{b.measured_value ?? '—'}</span> / {b.limit_value ?? '—'}</td>
                      <td className="px-3 py-2">{b.days_open}</td>
                      <td className="px-3 py-2"><span className={clsx('inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium', status.tone)}>{status.label}</span></td>
                      <td className="px-3 py-2 max-w-xs">{b.plan ? <><p className="whitespace-pre-wrap">{b.plan}</p><p className="text-xs text-slate-500">{b.plan_by_name || '—'}, {when(b.plan_at)}</p></> : '—'}</td>
                      <td className="px-3 py-2 max-w-xs">{b.decided_at ? <><p>{b.decision_note || '—'}</p><p className="text-xs text-slate-500">{b.decided_by_name || '—'}, {when(b.decided_at)}</p></> : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{b.status === 'excess_approved' ? when(b.excess_expires_at) : '—'}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap justify-end gap-1">
                        {actions.map((a) => <button key={a} type="button" className={BTN} onClick={() => start(b.id, a, b.plan)}>{ACTION_LABEL[a]}</button>)}
                      </div></td>
                    </tr>
                    {acting?.id === b.id && (
                      <tr><td colSpan={9} className="bg-slate-50/60 px-3 py-3">
                        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); act.mutate(acting); }}>
                          <label htmlFor={`breach-text-${b.id}`} className="block text-xs font-medium text-slate-700">
                            {acting.action === 'plan' ? 'How this comes back within appetite, and by when'
                              : acting.action === 'approve-plan' ? 'Decision note (optional)'
                                : acting.action === 'reject-plan' ? 'Why the plan is sent back' : 'Why the excess is allowed'}
                          </label>
                          <textarea id={`breach-text-${b.id}`} rows={2} className={INPUT} value={text} onChange={(e) => setText(e.target.value)}
                            required={acting.action !== 'approve-plan'} />
                          {acting.action === 'approve-excess' && (
                            <>
                              <label htmlFor={`breach-expiry-${b.id}`} className="block text-xs font-medium text-slate-700">Excess allowed until (at most six months)</label>
                              <input id={`breach-expiry-${b.id}`} type="date" required min={range.min} max={range.max} value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)} className={clsx(INPUT, 'max-w-[12rem]')} />
                            </>
                          )}
                          <div className="flex justify-end gap-2">
                            <button type="button" className={BTN} onClick={() => { setActing(null); setError(null); }}>Cancel</button>
                            <button type="submit" disabled={act.isPending}
                              className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">
                              {act.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {ACTION_LABEL[acting.action]}
                            </button>
                          </div>
                          {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
                        </form>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
