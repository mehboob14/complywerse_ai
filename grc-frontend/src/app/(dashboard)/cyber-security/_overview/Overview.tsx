'use client';

// Cyber Security > Overview: how the assessments stand, across the seven types. Four tiles (how many assessments, coverage, compliant, open gaps), what is
// in flight (drafts being scoped and assessments with questions left), each type with its own numbers (a table; a card each below 768px) and the status mix.
// On the design-system kit like the Governance Overview. The numbers keep the hub's own definitions (overviewModel.ts); each says what it rests on from an (i),
// and a request that failed is said where its numbers would be, never drawn as 0.
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState, ProgressBar, RegisterTable, SectionCard, StatTile, sortRows, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { EMPTY, formatCount, formatPercent } from '@/lib/format';
import InFlightList from '@/components/compliance/scoping/InFlightList';
import type { AssessmentRow } from '@/components/compliance/scoping/scopingApi';
import { statusMix, totalsOf, typeRows, type TypeRow } from './overviewModel';

export interface OverviewFeed {
  rows: AssessmentRow[];
  loading: boolean;
  error: { title: string; message?: string; onRetry?: () => void } | null;
}

const SORTED: Record<string, (r: TypeRow) => string | number | null> = {
  type: (r) => r.label.toLowerCase(), assessments: (r) => r.assessments, coverage: (r) => r.coverage, compliant: (r) => r.compliant, gaps: (r) => r.gaps,
};

export default function Overview({ rows, loading, error }: OverviewFeed) {
  const [sort, setSort] = useState<SortState>({ key: 'gaps', dir: 'desc' });
  const types = useMemo(() => typeRows(rows), [rows]);
  const t = useMemo(() => totalsOf(types), [types]);
  const shown = useMemo(() => sortRows(types, sort, (r, key) => SORTED[key]?.(r) ?? null), [types, sort]);
  const mix = statusMix(t);
  const nothing = !loading && !error && t.assessments === 0 && t.drafts === 0;

  const columns: RegisterColumn<TypeRow>[] = [
    {
      key: 'type', header: 'Type', sortable: true, isRowHeader: true,
      cell: (r) => <Link href={`/cyber-security?tab=${r.tab}`} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.label}</Link>,
    },
    {
      key: 'assessments', header: 'Assessments', sortable: true, align: 'right', card: 'meta',
      cell: (r) => (r.assessments > 0 || r.drafts > 0
        ? <>{formatCount(r.assessments)}{r.drafts > 0 && <span className="text-ds-fg-muted">{` · ${formatCount(r.drafts)} ${r.drafts === 1 ? 'draft' : 'drafts'}`}</span>}</>
        : <span className="text-ds-fg-muted">{EMPTY}</span>),
    },
    { key: 'coverage', header: 'Coverage', sortable: true, width: 'w-[180px]', card: 'meta', cell: (r) => <ProgressBar value={r.coverage} label={`${r.label}: coverage`} /> },
    { key: 'compliant', header: 'Compliant', sortable: true, align: 'right', priority: 2, card: 'meta', cell: (r) => formatPercent(r.compliant) },
    { key: 'gaps', header: 'Open gaps', sortable: true, align: 'right', card: 'meta', cell: (r) => <span className={r.gaps > 0 ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}>{formatCount(r.gaps)}</span> },
  ];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid gap-[12px] sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Assessments" loading={loading} error={error}
          value={formatCount(t.assessments)} unit={t.assessments === 1 ? 'assessment' : 'assessments'}
          note={`${t.typesStarted} of ${types.length} types started${t.drafts > 0 ? ` · ${formatCount(t.drafts)} ${t.drafts === 1 ? 'draft' : 'drafts'}` : ''}`}
          info="The assessments that count: every one that has started, and a type's uploaded questionnaire until one has started from it. A draft being scoped has no questions yet."
        />
        <StatTile
          label="Coverage" loading={loading} error={error}
          value={t.coverage === null ? null : formatPercent(t.coverage)} progress={t.coverage}
          note={t.total > 0 ? `${formatCount(t.assessed)} of ${formatCount(t.total)} controls assessed${t.na > 0 ? ` (${formatCount(t.na)} not applicable)` : ''}` : undefined}
          info="Every control with an answer, not applicable included, over all the controls of the assessments that count."
        />
        <StatTile
          label="Compliant" loading={loading} error={error}
          value={t.compliant === null ? null : formatPercent(t.compliant)} progress={t.compliant} tone={t.compliant !== null && t.compliant >= 70 ? 'success' : 'default'}
          note={t.assessed > 0 ? `${formatCount(t.complied)} of ${formatCount(t.assessed)} assessed controls` : undefined}
          info="Controls complied with, over the controls with an answer (not applicable included)."
        />
        <StatTile
          label="Open gaps" loading={loading} error={error}
          value={formatCount(t.gaps)} unit={t.gaps === 1 ? 'control' : 'controls'} tone={t.gaps > 0 ? 'danger' : 'default'}
          note={`${formatCount(t.notComplied)} not complied · ${formatCount(t.inProgress)} not answered yet`}
          info="Controls not complied with plus controls not answered yet: where the work is."
        />
      </div>

      {nothing ? (
        <EmptyState kind="firstUse" title="No assessment yet" description="Open a type and start one for an application or a function." />
      ) : (
        <>
          <InFlightList rows={rows} />
          <SectionCard id="by-type" title="By type" meta={`${formatCount(types.length)} types`} info="Each type with the numbers of the assessments that count. Open a type to see its assessments and start one.">
            <RegisterTable<TypeRow>
              caption="Assessment types"
              columns={columns}
              rows={shown}
              getRowId={(r) => r.format}
              sort={sort}
              onSortChange={setSort}
              loading={loading}
              error={error ? { message: error.message ?? error.title, onRetry: error.onRetry } : null}
              cardTitle={(r) => <Link href={`/cyber-security?tab=${r.tab}`} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{r.label}</Link>}
            />
          </SectionCard>
          {mix.length > 0 && (
            <SectionCard id="status-mix" title="Control status" meta={`${formatCount(t.total)} controls`} info="Every control of the assessments that count, by its status.">
              <div role="img" aria-label={`Control status: ${mix.map((m) => `${m.label} ${m.n}`).join(', ')}`} className="flex h-[12px] w-full overflow-hidden rounded-full bg-ds-border">
                {mix.map((m) => <div key={m.key} className={m.fill} style={{ width: `${m.percent}%` }} />)}
              </div>
              <ul className="mt-[12px] flex flex-wrap gap-x-[20px] gap-y-[6px]">
                {mix.map((m) => (
                  <li key={m.key} className="flex items-center gap-[6px] text-ds-body text-ds-fg-body">
                    <span aria-hidden className={`h-[10px] w-[10px] shrink-0 rounded-full ${m.fill}`} />
                    {m.label}
                    <span className="tabular-nums text-ds-fg-muted">{formatCount(m.n)}</span>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
}
