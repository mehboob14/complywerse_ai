'use client';

// 360° auto-mapped linkage for a policy statement: controls grouped by universe (normalized / framework / parsed / internal) + the evidence count. Sourced from the saved
// StatementControlMapping rows the AI auto-mapper writes after parsing: no AI call here, just display. A failed read says so with Retry (it used to read as "No control linkage yet").
import { useQuery } from '@tanstack/react-query';
import { complianceApi } from '@/lib/api';
import { ErrorState, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { formatCount } from '@/lib/format';

interface CtrlLink {
  id: number;
  control_kind: string;
  control_code?: string | null;
  control_title?: string | null;
  framework_name?: string | null;
  domain?: string | null;
  confidence?: number | null;
  coverage_type?: string | null;
  rationale?: string | null;
  link_source?: string | null;
}
interface Linkage {
  statement_id: number;
  ai_suggested_controls: string[];
  controls: Record<string, CtrlLink[]>;
  evidence: Array<{ id: number; name?: string | null }>;
  counts: Record<string, number>;
}

const KIND_ORDER = ['normalized', 'framework', 'parsed', 'internal'] as const;
const KIND_LABEL: Record<string, string> = { normalized: 'Normalized controls', framework: 'Framework controls', parsed: 'Framework requirements', internal: 'Internal controls' };

export default function StatementLinkagePanel({ statementId }: { statementId: number }) {
  const q = useQuery({
    queryKey: ['statement-linkage', statementId],
    queryFn: async () => (await complianceApi.statements.getLinkage(statementId)).data as Linkage,
    retry: (failures, error) => failures < 1 && canRetry(error),
  });
  const data = q.data;
  const counts = data?.counts || {};
  const totalCtrls = (counts.normalized || 0) + (counts.framework || 0) + (counts.parsed || 0) + (counts.internal || 0);

  return (
    <section aria-label="Mapped controls">
      <h3 className="m-0 mb-[8px] !text-ds-body !font-[600] !text-ds-fg">
        Mapped controls{totalCtrls > 0 && <span className="ml-[6px] text-ds-label font-normal text-ds-fg-muted">{`${formatCount(totalCtrls)} ${totalCtrls === 1 ? 'control' : 'controls'} · ${formatCount(counts.evidence || 0)} evidence`}</span>}
      </h3>
      {q.isPending && <SkeletonLines lines={2} label="Loading the mapped controls" />}
      {q.isError && !data && <ErrorState compact title="Couldn't load the mapped controls" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />}
      {data && totalCtrls === 0 && (
        <p className="m-0 rounded-ds-control border border-dashed border-ds-border-strong bg-ds-surface-subtle p-[8px] text-ds-label text-ds-fg-muted">
          No controls are mapped yet. The mapping runs on its own after the source document is read.
        </p>
      )}
      {data && totalCtrls > 0 && (
        <div className="flex flex-col gap-[12px]">
          {KIND_ORDER.map((kind) => {
            const items = data.controls?.[kind] || [];
            if (!items.length) return null;
            return (
              <div key={kind}>
                <h4 className="m-0 mb-[4px] text-ds-label font-[600] text-ds-fg-muted">{`${KIND_LABEL[kind]} (${items.length})`}</h4>
                <ul className="m-0 flex list-none flex-wrap gap-[6px] p-0">
                  {items.map((c) => (
                    <li
                      key={c.id}
                      title={c.rationale || (c.link_source === 'derived' ? 'Linked through a mapping between controls' : undefined)}
                      className="inline-flex max-w-full items-center gap-[6px] rounded-ds-control border border-ds-border bg-ds-surface-subtle px-[8px] py-[2px] text-ds-label text-ds-fg"
                    >
                      <span className="font-[600]">{c.control_code || '—'}</span>
                      {c.control_title && <span className="min-w-0 max-w-[200px] truncate text-ds-fg-body">{c.control_title}</span>}
                      {c.framework_name && <span className="text-ds-fg-muted">{`· ${c.framework_name}`}</span>}
                      {typeof c.confidence === 'number' && c.link_source === 'ai' && <span className="text-ds-fg-muted">{`AI ${Math.round(c.confidence * 100)}%`}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
