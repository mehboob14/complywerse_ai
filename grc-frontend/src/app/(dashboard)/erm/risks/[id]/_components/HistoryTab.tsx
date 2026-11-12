'use client';

import { useQuery } from '@tanstack/react-query';
import { History, Loader2 } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { responseLabel } from '../../_components/riskRecord';

const ACTION_LABEL: Record<string, string> = {
  risk_updated: 'Edited',
  risk_assessed: 'Assessed',
  risk_treatment: 'Treatment plan',
  risk_acceptance_requested: 'Acceptance requested',
  risk_acceptance_approved: 'Acceptance approved',
  risk_acceptance_rejected: 'Acceptance refused',
};

const FIELD_LABEL: Record<string, string> = {
  inherent_likelihood: 'Before controls likelihood', inherent_impact: 'Before controls impact', inherent_score: 'Before controls score',
  residual_likelihood: 'After controls likelihood', residual_impact: 'After controls impact', residual_score: 'After controls score',
  target_likelihood: 'Target likelihood', target_impact: 'Target impact', target_score: 'Target score',
  owner_id: 'Risk owner', business_owner_id: 'Accountable executive', status: 'Status', response: 'Response',
  category: 'Category', review_date: 'Review date', due_date: 'Due date', acceptance_status: 'Acceptance',
  acceptance_expires_at: 'Acceptance expiry',
};

const stamp = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Who changed the risk, what and why — what an auditor samples — newest first. */
export default function HistoryTab({ riskId }: { riskId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['risk-history', riskId],
    queryFn: async () => (await ermApi.risks.getHistory(riskId)).data,
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;
  if (isError || !data) return <p className="text-sm text-rose-700">Could not load the history.</p>;

  const people = data.people || {};
  const show = (field: string, value: unknown): string => {
    if (value == null || value === '') return '—';
    if (field === 'owner_id' || field === 'business_owner_id') return people[String(value)] || `User #${value}`;
    if (field === 'response') return responseLabel(String(value)) || String(value);
    if (field.endsWith('_date') || field.endsWith('_at')) return new Date(String(value)).toLocaleDateString('en-GB');
    return String(value).replace(/_/g, ' ');
  };

  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <History className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Changes
        </h3>
        {data.changes.length === 0 ? (
          <p className="text-sm italic text-slate-400">No recorded changes yet. Edits to scores, owners, status, response or category appear here with their reason.</p>
        ) : (
          <ol className="space-y-2">
            {data.changes.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800">{ACTION_LABEL[entry.action] || entry.action.replace(/_/g, ' ')}</span>
                  <span className="text-xs text-slate-500">{entry.user_name || 'Unknown user'} · {stamp(entry.at)}</span>
                </div>
                {Object.keys(entry.changes).length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-xs text-slate-700">
                    {Object.entries(entry.changes).map(([field, diff]) => (
                      <li key={field}>
                        <span className="text-slate-500">{FIELD_LABEL[field] || field.replace(/_/g, ' ')}:</span>{' '}
                        {show(field, diff.from)} → <span className="font-medium">{show(field, diff.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-xs text-slate-600">
                  <span className="text-slate-500">Reason: </span>{entry.reason || <span className="italic text-slate-400">none given</span>}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>

      {data.scores.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Scores over time</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr><th className="py-1 pr-3 font-medium">When</th><th className="py-1 pr-3 font-medium">Before</th><th className="py-1 pr-3 font-medium">After</th>
                  <th className="py-1 pr-3 font-medium">Target</th><th className="py-1 pr-3 font-medium">What</th><th className="py-1 font-medium">Who</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {data.scores.map((row) => (
                  <tr key={row.id}>
                    <td className="py-1 pr-3 whitespace-nowrap">{stamp(row.at)}</td>
                    <td className="py-1 pr-3 tabular-nums">{row.inherent_score ?? '—'}</td>
                    <td className="py-1 pr-3 tabular-nums">{row.residual_score ?? '—'}</td>
                    <td className="py-1 pr-3 tabular-nums">{row.target_score ?? '—'}</td>
                    <td className="py-1 pr-3">{row.label || '—'}{row.reason ? ` · ${row.reason}` : ''}</td>
                    <td className="py-1">{row.user_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
