'use client';

// Compliance framework coverage: what the questionnaire library assesses, from each question's framework and control mapping (GET /vendor-risk/tpra/coverage). It loads on its own, under the
// register: a failed read says so with Retry in its own card (it was silent), and a library with no mapped question says nothing rather than show an empty table.
import { useQuery } from '@tanstack/react-query';
import { ChipList, ErrorState, SectionCard, SkeletonRows } from '@/components/ui/ds';
import { RegisterTable, type RegisterColumn } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { DOMAIN_LABELS } from '../../_lib/tprmShared';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import type { CoverageAnswer, CoverageItem } from './riskModel';

const COLUMNS: RegisterColumn<CoverageItem>[] = [
  { key: 'framework', header: 'Framework', isRowHeader: true, cell: (c) => <span className="break-words text-ds-body font-[600] text-ds-fg">{c.framework}</span>, card: 'hide' },
  { key: 'questions', header: 'Questions', align: 'right', width: 'w-[100px]', cell: (c) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(c.questions)}</span>, card: 'meta' },
  { key: 'controls', header: 'Controls', align: 'right', width: 'w-[100px]', priority: 2, cell: (c) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(c.controls)}</span>, card: 'meta' },
  { key: 'evidence', header: 'Evidence asked', align: 'right', width: 'w-[130px]', priority: 2, cell: (c) => <span className="tabular-nums text-ds-body text-ds-fg">{formatCount(c.evidence_required)}</span>, card: 'meta' },
  { key: 'domains', header: 'Domains', priority: 3, cell: (c) => <ChipList label="domains" items={c.domains.map((d) => DOMAIN_LABELS[d] ?? d)} shown={3} />, card: 'meta' },
];

export default function CoverageCard() {
  const q = useQuery({ queryKey: ['tprm-coverage'], queryFn: async () => (await tpraApi.getCoverage()).data as CoverageAnswer, ...TPRM_QUERY_OPTS });
  if (q.isLoading) return <SectionCard id="coverage" title="Compliance framework coverage"><SkeletonRows rows={3} columns={4} label="Loading the framework coverage" /></SectionCard>;
  if (q.isError) {
    return (
      <SectionCard id="coverage" title="Compliance framework coverage">
        <ErrorState compact title="Couldn't load the framework coverage" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      </SectionCard>
    );
  }
  const c = q.data;
  if (!c || c.items.length === 0) return null;
  return (
    <SectionCard
      id="coverage"
      title="Compliance framework coverage"
      info="What the questionnaire library assesses: derived from each question's framework and control mapping."
      meta={`${formatCount(c.frameworks)} frameworks · ${formatCount(c.mapped_questions)} of ${formatCount(c.total_questions)} questions mapped · ${formatCount(c.templates)} questionnaires`}
    >
      <RegisterTable caption="Compliance framework coverage" columns={COLUMNS} rows={c.items} getRowId={(r) => r.framework} cardTitle={(r) => r.framework} />
    </SectionCard>
  );
}
