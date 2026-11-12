'use client';

// Assessments (ERM redesign, decision 1): risk workshops, RCSA self-assessments and framework IT risk assessments in one list. My assignments
// first, then everything by unit and status. Each row opens the page its kind already has; "Plan assessment" goes to that kind's create flow.
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList } from 'lucide-react';
import { ermApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/hooks/usePermissions';
import { PageLoader } from '@/components/ui';
import { ErrorState, Menu } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import {
  KIND_LABELS, STATUSES, arrange, planTargets,
  type AssessmentKind, type AssessmentRow, type AssessmentStatus, type Filters,
} from './assessmentsModel';

const PILL: Record<AssessmentStatus, string> = {
  Planned: 'bg-slate-100 text-slate-600 border-slate-200',
  'In progress': 'bg-amber-50 text-amber-700 border-amber-200',
  Returned: 'bg-orange-50 text-orange-700 border-orange-200',
  'Under review': 'bg-blue-50 text-blue-700 border-blue-200',
  Approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Closed: 'bg-slate-100 text-slate-500 border-slate-200',
};

const ALL = '';

function Rows({ title, rows, showUnit }: { title: string; rows: AssessmentRow[]; showUnit?: boolean }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title} <span className="text-slate-400">({rows.length})</span></h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Assessment</th>
              {showUnit && <th className="px-4 py-2">Unit</th>}
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Due</th>
              <th className="px-4 py-2">Lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={r.url} className="font-medium text-slate-900 hover:text-blue-700 hover:underline">{r.title}</Link>
                  <div className="text-[11px] text-slate-500">{KIND_LABELS[r.kind]}</div>
                </td>
                {showUnit && <td className="px-4 py-3 text-slate-700">{r.unit ?? '—'}</td>}
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PILL[r.status]}`}>{r.status}</span>
                </td>
                <td className="px-4 py-3 text-slate-700">{formatDate(r.due_date, { calendar: true })}</td>
                <td className="px-4 py-3 text-slate-700">{r.lead ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AssessmentsPage() {
  const router = useRouter();
  const { hasAnyPermission } = usePermissions();
  const [filters, setFilters] = useState<Filters>({});

  const listQ = useQuery({
    queryKey: ['erm-assessments'],
    queryFn: async () => (await ermApi.assessments.list()).data as AssessmentRow[],
  });

  const plan = planTargets(hasAnyPermission);
  const { mine, byUnit, total } = arrange(listQ.data ?? [], filters);
  const filtered = !!(filters.kind || filters.status);

  return (
    <div className="space-y-4 p-4 sm:p-5 max-w-[1400px] mx-auto">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-slate-900">
            <ClipboardList className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            Assessments
          </h1>
          <p className="mt-1 text-sm text-slate-600">Risk workshops, self-assessments (RCSA) and framework IT risk assessments, by unit and status.</p>
        </div>
        {plan.length > 0 && (
          <Menu label="Plan assessment" align="end"
                items={plan.map((p) => ({ key: p.kind, label: p.label, onSelect: () => router.push(p.href) }))} />
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <MultiSelectDropdown title="Kind" triggerVariant="input" multiSelect={false} selectedValues={[filters.kind ?? ALL]}
            onApply={(v) => setFilters((f) => ({ ...f, kind: (v[0] || undefined) as AssessmentKind | undefined }))}
            items={[{ value: ALL, label: 'All kinds' }, ...Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))]} />
        </div>
        <div className="w-48">
          <MultiSelectDropdown title="Status" triggerVariant="input" multiSelect={false} selectedValues={[filters.status ?? ALL]}
            onApply={(v) => setFilters((f) => ({ ...f, status: (v[0] || undefined) as AssessmentStatus | undefined }))}
            items={[{ value: ALL, label: 'All statuses' }, ...STATUSES.map((s) => ({ value: s, label: s }))]} />
        </div>
      </div>

      {listQ.isLoading ? <PageLoader /> : listQ.isError ? (
        <ErrorState title="Couldn't load the assessments" message={errorMessage(listQ.error)} onRetry={() => { void listQ.refetch(); }} />
      ) : total === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-700">{filtered ? 'No assessments match these filters.' : 'No assessments this cycle.'}</p>
          {!filtered && plan.length > 0 && <p className="mt-1 text-xs text-slate-500">Plan one to start: pick its kind from Plan assessment.</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {mine.length > 0 && <Rows title="Assigned to me" rows={mine} showUnit />}
          {byUnit.map((g) => <Rows key={g.unit ?? '—'} title={g.unit ?? 'No unit'} rows={g.rows} />)}
        </div>
      )}
    </div>
  );
}
