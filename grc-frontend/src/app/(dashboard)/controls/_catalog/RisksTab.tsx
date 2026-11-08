'use client';

// The drawer's Risks tab: the risks this control mitigates. A risk is linked from a search of the risk register (the server answers the search, so the register's whole length is searched, not a first
// page) and unlinked with a labelled button. The residual score is a number with a word beside it, coloured by catalogModel.residualTone (the Catalog's own cut, listed for the user).
import { useState } from 'react';
import { Plus, Unlink, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button, DebouncedSearch, ErrorState, SkeletonRows, StatusPill, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import apiClient from '@/lib/api';
import { WB, type RefreshKeys } from './catalogData';
import { residualTone, residualWord, type ControlDetail } from './catalogModel';

interface RiskHit { id: number; title: string; category?: string; residual_score?: number; status?: string }

function Score({ score }: { score: number | null | undefined }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-[6px]">
      <span className="min-w-[28px] text-center text-ds-body font-[600] tabular-nums text-ds-fg">{score == null ? '—' : score}</span>
      <StatusPill size="sm" tone={residualTone(score)} label={residualWord(score)} />
    </span>
  );
}

function RiskPicker({ linkedIds, onLink, linking }: { linkedIds: Set<number>; onLink: (id: number) => void; linking: number | null }) {
  const [q, setQ] = useState('');
  const risks = useQuery({
    queryKey: ['wb-risks', q],
    queryFn: async () => (await apiClient.get(`${WB}/risks?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`)).data as { items: RiskHit[] },
  });
  const items = (risks.data?.items ?? []).filter((r) => !linkedIds.has(r.id));
  return (
    <div className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[12px]">
      <DebouncedSearch label="Search the risk register" placeholder="Search the risk register" value={q} onSearch={setQ} loading={risks.isFetching && !risks.isPending} />
      {risks.isError && !risks.data ? (
        <ErrorState compact title="Couldn’t search the risk register" message={errorMessage(risks.error)} onRetry={canRetry(risks.error) ? () => { void risks.refetch(); } : undefined} />
      ) : risks.isPending ? (
        <SkeletonRows rows={3} columns={2} label="Searching the risk register" />
      ) : items.length === 0 ? (
        <p className="m-0 p-[8px] text-center text-ds-body text-ds-fg-muted">No matching risks to link.</p>
      ) : (
        <ul className="m-0 max-h-[240px] list-none divide-y divide-ds-border overflow-y-auto rounded-ds-card border border-ds-border bg-ds-surface p-0">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-[8px] p-[8px]">
              <Score score={r.residual_score} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-ds-body font-[600] text-ds-fg" title={r.title}>{r.title}</span>
                <span className="text-ds-label text-ds-fg-muted">{[r.category, r.status].filter(Boolean).join(' · ')}</span>
              </span>
              <Button size="sm" leftIcon={<Plus aria-hidden />} loading={linking === r.id} onClick={() => onLink(r.id)}>Link</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function RisksTab({ d, keys }: { d: ControlDetail; keys: RefreshKeys }) {
  const [adding, setAdding] = useState(false);
  const add = useReportedMutation({
    mutationFn: (riskId: number) => apiClient.post(`${WB}/items/${d.work_item_id}/risks`, { risk_id: riskId }),
    success: { title: 'Risk linked', message: 'This control now counts against that risk.' },
    failure: "Couldn't link the risk",
    invalidate: keys,
    onSuccess: () => setAdding(false),
  });
  const del = useReportedMutation({
    mutationFn: (linkId: number) => apiClient.delete(`${WB}/risks/${linkId}`),
    success: 'Risk unlinked',
    failure: "Couldn't unlink the risk",
    invalidate: keys,
  });
  const links = d.risk_links;
  const linkedIds = new Set(links.map((l) => l.risk_id));
  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center justify-between gap-[8px]">
        <p className="m-0 min-w-0 flex-1 text-ds-body text-ds-fg-muted">The risks this control mitigates. An internal control brings the risks it was written for.</p>
        <Button leftIcon={adding ? <X aria-hidden /> : <Plus aria-hidden />} aria-expanded={adding} onClick={() => setAdding((v) => !v)}>{adding ? 'Close' : 'Link a risk'}</Button>
      </div>
      {adding && <RiskPicker linkedIds={linkedIds} onLink={(id) => add.mutate(id)} linking={add.isPending ? (add.variables ?? null) : null} />}
      {links.length === 0 ? (
        <p className="m-0 rounded-ds-card border border-dashed border-ds-border p-[12px] text-ds-body text-ds-fg-muted">No linked risks yet. Link a risk to connect this control to your risk register.</p>
      ) : (
        <ul className="m-0 list-none divide-y divide-ds-border overflow-clip rounded-ds-card border border-ds-border bg-ds-surface p-0">
          {links.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-[8px] gap-y-[6px] p-[12px]">
              <Score score={r.risk_residual_score} />
              <span className="min-w-[120px] flex-1">
                <span className="block truncate text-ds-body font-[600] text-ds-fg" title={r.risk_title || undefined}>{r.risk_title || 'A risk that was removed'}</span>
                <span className="text-ds-label text-ds-fg-muted">{[r.risk_category, r.link_type, r.effectiveness_rating].filter(Boolean).join(' · ')}</span>
              </span>
              <Button size="sm" leftIcon={<Unlink aria-hidden />} loading={del.isPending && del.variables === r.id} onClick={() => del.mutate(r.id)}>Unlink</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
