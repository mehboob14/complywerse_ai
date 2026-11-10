'use client';

// The Domains drawer: the ten domains every assessment scores a supplier against, with what each is for, the evidence expected of a supplier in it, and how many open findings sit in it now (from the
// portfolio dashboard). It was ten static cards under the register; it is one drawer now. It reads its numbers only when it is opened: a failed read says so with Retry and never shows 0 findings.
import { useQuery } from '@tanstack/react-query';
import { ErrorState, Sheet, Skeleton } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { DOMAIN_INFO, findingsByDomain } from './riskModel';

export default function DomainsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useQuery({
    queryKey: ['tprm-dashboard', 'portfolio'],
    queryFn: async () => (await tpraApi.dashboard('portfolio')).data as { findings_by_domain?: Record<string, number> },
    enabled: open,
    ...TPRM_QUERY_OPTS,
  });
  const rows = findingsByDomain(q.data?.findings_by_domain);
  const most = Math.max(1, ...rows.map((d) => d.count));
  return (
    <Sheet open={open} onClose={onClose} width="md" title="Risk domains" subtitle="The ten domains every assessment scores a supplier against">
      {q.isError ? (
        <ErrorState compact title="Couldn't load the open findings" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-[16px] p-0">
          {rows.map((d) => (
            <li key={d.key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-[8px]">
                <h3 className="m-0 min-w-0 break-words !text-ds-body !font-[600] !text-ds-fg">{d.label}</h3>
                {q.isLoading ? <Skeleton className="h-[16px] w-[64px]" /> : <span className="shrink-0 text-ds-label text-ds-fg-muted">{d.count} open {d.count === 1 ? 'finding' : 'findings'}</span>}
              </div>
              <p className="mt-[2px] text-ds-body text-ds-fg-body">{DOMAIN_INFO[d.key].purpose}</p>
              {!q.isLoading && (
                <div className="mt-[6px] h-[6px] overflow-hidden rounded-full bg-ds-border" role="img" aria-label={`${d.label}: ${d.count} open findings`}>
                  <div className="h-full rounded-full bg-ds-primary" style={{ width: `${(d.count / most) * 100}%` }} />
                </div>
              )}
              <p className="mt-[6px] text-ds-label text-ds-fg-muted">Expected evidence: {DOMAIN_INFO[d.key].evidence.join(', ')}</p>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
