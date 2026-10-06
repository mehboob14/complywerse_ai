'use client';
// Certify: one decision per sampled identity. The table says who they are, how risky, how many
// rules failed, what the AI suggests (advice, not a decision) and what you decided. Quick
// buttons decide in one step; the details panel adds a justification and evidence first.

import { useMemo, useState } from 'react';
import { Check, ChevronRight, Info, Search, Sparkles, X } from 'lucide-react';
import { clsx } from 'clsx';
import { errorText, useAiRecommendations, useSetDecision } from '../../api';
import { decisionClass, decisionLabel, riskClass } from '../../pipeline';
import type { AccountKind, Decision, ReviewItem } from '../../types';
import { Alert, Badge, Button, FOCUS, FilterChip, ProgressBar, VisuallyHidden, inputClass } from '../../_components/ui';

export const KIND_LABEL: Record<AccountKind, string> = {
  person: 'Person', cloud_credential: 'Cloud key or token', db_account: 'Database account', service_account: 'Service account',
};
const aiWord = (r?: string | null) => (r === 'revoke' ? 'Revoke' : r === 'approved' || r === 'approve' ? 'Approve' : r === 'exception' ? 'Exception' : null);
const DECISIONS = [['approved', 'Approve', Check], ['revoke', 'Revoke', X], ['exception', 'Exception', Info]] as const;

export function CertifyTab({ campaignId, items, sampleSize, readOnly = false, onOpen, onContinue }: {
  campaignId: number; items: ReviewItem[]; sampleSize: number; readOnly?: boolean; onOpen: (id: number) => void; onContinue: () => void;
}) {
  const setDecision = useSetDecision(campaignId);
  const ai = useAiRecommendations(campaignId);
  const [filter, setFilter] = useState<'all' | 'flagged' | 'pending' | 'decided'>('all');
  const [q, setQ] = useState('');
  const decided = items.filter((i) => i.decision !== 'pending').length;
  const remaining = items.length - decided;

  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items
      .filter((u) => (filter === 'flagged' ? u.findings.length : filter === 'pending' ? u.decision === 'pending' : filter === 'decided' ? u.decision !== 'pending' : true))
      .filter((u) => !t || [u.display_name, u.email, u.department].some((s) => s?.toLowerCase().includes(t)))
      .sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0));
  }, [items, filter, q]);
  const counts = { all: items.length, flagged: items.filter((i) => i.findings.length).length, pending: remaining, decided };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="min-w-[220px] flex-1">
          <p className="text-sm font-semibold text-slate-900">{decided} of {sampleSize || items.length} certified</p>
          <div className="mt-1.5"><ProgressBar value={decided} max={sampleSize || items.length || 1} label="Identities certified" /></div>
        </div>
        {readOnly ? <p className="text-sm text-slate-700">Sealed. These decisions are read-only evidence.</p> : (
          <>
            <Button size="sm" icon={Sparkles} loading={ai.isPending} onClick={() => ai.mutate()}>Ask AI for suggestions</Button>
            <Button variant={remaining === 0 ? 'primary' : 'secondary'} size="sm" onClick={onContinue}>
              {remaining === 0 ? 'Continue to the report' : 'View the report'} <ChevronRight size={14} aria-hidden />
            </Button>
          </>
        )}
      </div>
      {ai.isError && <Alert tone="error">{errorText(ai.error, 'AI suggestions are not available.')}</Alert>}
      {setDecision.isError && <Alert tone="error">{errorText(setDecision.error, 'The decision could not be saved.')}</Alert>}

      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Filter identities" className="flex flex-wrap gap-1.5">
          {([['all', 'All'], ['flagged', 'With failed rules'], ['pending', 'Pending'], ['decided', 'Decided']] as const).map(([k, label]) => (
            <FilterChip key={k} pressed={filter === k} onClick={() => setFilter(k)} count={counts[k]}>{label}</FilterChip>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <label htmlFor="identity-search" className="sr-only">Search identities</label>
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" aria-hidden />
          <input id="identity-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search identities" className={clsx(inputClass, 'pl-9')} />
        </div>
        <p role="status" className="text-sm text-slate-600">Showing {rows.length} of {items.length}.</p>
      </div>

      <div role="region" aria-label="Identities to certify" tabIndex={0} className={clsx('relative overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm', FOCUS)}>
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <caption className="sr-only">Sampled identities and your decision on each</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-700">
              <th scope="col" className="px-4 py-3">Identity</th>
              <th scope="col" className="w-[80px] px-3 py-3">Risk</th>
              <th scope="col" className="w-[150px] px-3 py-3">Rules</th>
              <th scope="col" className="w-[140px] px-3 py-3">AI suggests</th>
              <th scope="col" className="w-[290px] px-3 py-3">Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const name = u.display_name || u.email || 'identity';
              const failed = (u.rules ?? []).filter((r) => r.status === 'fail').length;
              const unjudged = (u.rules ?? []).filter((r) => r.status === 'not_run').length;
              return (
                <tr key={u.id} className="border-b border-slate-100 align-top last:border-0">
                  <td className="px-4 py-3">
                    <button type="button" onClick={() => onOpen(u.id)} className={clsx('rounded text-left font-semibold text-slate-900 underline-offset-2 hover:underline', FOCUS)}>
                      {name}<VisuallyHidden>, open details</VisuallyHidden>
                    </button>
                    <p className="mt-0.5 text-xs text-slate-600">{u.email}{u.department ? ` · ${u.department}` : ''}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <Badge tone={u.kind && u.kind !== 'person' ? 'sky' : 'slate'}>{KIND_LABEL[u.kind ?? 'person']}</Badge>
                      {u.is_privileged && <Badge tone="amber">Privileged</Badge>}
                      {u.is_terminated && <Badge tone="rose">Terminated</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-3"><span className={clsx('inline-flex h-7 min-w-[36px] items-center justify-center rounded-md px-2 text-sm font-semibold tabular-nums', riskClass(u.risk_score))}><VisuallyHidden>Risk score </VisuallyHidden>{u.risk_score ?? 0}</span></td>
                  <td className="px-3 py-3 text-sm">
                    {failed ? <span className="font-semibold text-rose-800">{failed} failed</span> : <span className="text-emerald-800">None failed</span>}
                    {unjudged > 0 && <span className="block text-xs text-slate-600">{unjudged} could not run</span>}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-800">{aiWord(u.ai_recommendation) ?? <span className="text-slate-600">—</span>}</td>
                  <td className="px-3 py-3">
                    {readOnly || u.decision !== 'pending' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={clsx('rounded-full px-2.5 py-1 text-xs font-semibold', decisionClass[u.decision])}>{decisionLabel[u.decision]}</span>
                        <button type="button" onClick={() => onOpen(u.id)} className={clsx('rounded text-xs font-semibold text-teal-800 underline underline-offset-2', FOCUS)}>
                          {readOnly ? 'View' : 'Change'}<VisuallyHidden> decision for {name}</VisuallyHidden>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {DECISIONS.map(([d, label, Icon]) => (
                          <Button key={d} size="sm" aria-label={`${label} ${name}`} icon={Icon} disabled={setDecision.isPending}
                            onClick={() => setDecision.mutate({ itemId: u.id, decision: d as Decision })}>{label}</Button>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-600">No identity matches.</td></tr>}
          </tbody>
        </table>
      </div>
      {!readOnly && <p className="flex items-start gap-1.5 text-xs text-slate-600"><Info size={14} className="mt-0.5 shrink-0" aria-hidden /> Revoke records an instruction to remove access. Removing it in the source is a separate step.</p>}
    </div>
  );
}
