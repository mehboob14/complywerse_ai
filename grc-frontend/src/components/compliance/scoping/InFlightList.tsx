'use client';

/**
 * The Cyber Security Overview's "in flight" card: every assessment made for an application or function that is still being scoped or whose questions are
 * not all marked yet, across the nine types, most recently touched first. It is the manager's view across types; each type's own page has the full register.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PersonChip, ProgressBar, RegisterTable, SectionCard, StatusPill, rowCountText, sortRows, type RegisterColumn } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { assessmentHref } from './StartDialog';
import { infoOf, inFlight, PHASE_LABEL, PHASE_TONE, progressOf, registerSortValue, subjectOf } from './scopingModel';
import type { AssessmentRow } from './scopingApi';

const SHOWN = 8;

export default function InFlightList({ rows }: { rows: readonly AssessmentRow[] }) {
  const router = useRouter();
  const flight = useMemo(() => sortRows(rows.filter((r) => !!infoOf(r.assessment_format) && inFlight(r)), { key: 'updated', dir: 'desc' }, registerSortValue), [rows]);
  if (flight.length === 0) return null;
  const shown = flight.slice(0, SHOWN);
  const drafts = flight.filter((r) => r.phase === 'scoping').length;

  const columns: RegisterColumn<AssessmentRow>[] = [
    {
      key: 'subject', header: 'Assessment', isRowHeader: true,
      cell: (r) => <Link href={assessmentHref(r.id)} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{subjectOf(r)}</Link>,
    },
    { key: 'type', header: 'Type', card: 'meta', cell: (r) => infoOf(r.assessment_format)?.label ?? r.assessment_format },
    { key: 'phase', header: 'Phase', card: 'meta', cell: (r) => <StatusPill tone={PHASE_TONE[r.phase ?? 'scoping']} label={PHASE_LABEL[r.phase ?? 'scoping']} size="sm" /> },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (r) => <PersonChip name={r.owner_name} /> },
    { key: 'progress', header: 'Progress', width: 'w-[180px]', card: 'meta', cell: (r) => <ProgressBar value={r.phase === 'scoping' ? null : progressOf(r)} label={`${subjectOf(r)}: questions marked`} /> },
    { key: 'due', header: 'Due', priority: 3, card: 'meta', cell: (r) => formatDate(r.due_date, { calendar: true }) },
  ];

  return (
    <SectionCard id="in-flight" title="In flight" meta={`${rowCountText({ shown: shown.length, total: flight.length, noun: 'assessment' })}${drafts ? ` · ${drafts} ${drafts === 1 ? 'draft' : 'drafts'}` : ''}`}
      info="Assessments being scoped, and started ones whose questions are not all marked. Open a type to see all of its assessments.">
      <RegisterTable<AssessmentRow>
        caption="Assessments in flight"
        columns={columns}
        rows={shown}
        getRowId={(r) => r.id}
        onRowActivate={(r) => router.push(assessmentHref(r.id))}
        cardTitle={(r) => <Link href={assessmentHref(r.id)} className="break-words font-[600] text-ds-fg hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{subjectOf(r)}</Link>}
      />
    </SectionCard>
  );
}
