'use client';

// What the register's drawer shows of one observation: its pills, the facts a reviewer scans (regulator, reference, period, due date and SLA, owner, category), the three texts in short
// previews with the rest one press away, and what hangs off it (counts that open the record's own tabs). Everything here is already in the row the list read: the drawer asks for nothing.
import Link from 'next/link';
import { ClampedText, Fact, FactList, PersonChip } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { linkedCount, type Level, type ObservationRow } from './observationModel';
import { MirroredNote, MUTED, PriorityTag, SlaTag, StatusTag, TypeTag } from './parts';

const LABEL = `mb-[4px] text-ds-label ${MUTED}`;
const LINK = 'inline-flex min-h-ds-control items-center text-ds-body text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

export function ObservationSummary({ o, levels }: { o: ObservationRow; levels: readonly Level[] }) {
  const base = `/auditor-portal/statutory-audit/${o.id}`;
  return (
    <div className="flex flex-col gap-[16px]">
      {o.mirrored && <MirroredNote issueId={o.mirrored_issue_id} compact />}
      <div className="flex flex-wrap items-center gap-[8px]">
        <StatusTag levels={levels} status={o.status} />
        <PriorityTag priority={o.priority} />
        <TypeTag type={o.observation_type} />
        <SlaTag sla={o.sla} />
      </div>
      <FactList min={150}>
        <Fact label="Regulator">{o.regulator_source}</Fact>
        <Fact label="Reference">{o.regulation_reference}</Fact>
        <Fact label="Period">{o.audit_period}</Fact>
        <Fact label="Due date" empty="Not set">{o.due_date ? formatDate(o.due_date, { calendar: true }) : null}</Fact>
        <Fact label="Owner">{o.owner_name ? <PersonChip name={o.owner_name} /> : null}</Fact>
        <Fact label="Category">{o.category}</Fact>
        <Fact label="Area">{o.area_domain}</Fact>
        <Fact label="Last changed">{formatDate(o.updated_at)}</Fact>
      </FactList>
      {o.description && <div><p className={LABEL}>Description</p><ClampedText text={o.description} lines={5} /></div>}
      {o.management_response && <div><p className={LABEL}>Management response</p><ClampedText text={o.management_response} lines={4} /></div>}
      {o.notes && <div><p className={LABEL}>Notes</p><ClampedText text={o.notes} lines={3} /></div>}
      <div className="flex flex-wrap gap-x-[16px]">
        <Link href={`${base}?tab=evidence`} className={LINK}>{o.evidence_count === 1 ? '1 file of evidence' : `${o.evidence_count} files of evidence`}</Link>
        <Link href={`${base}?tab=links`} className={LINK}>{linkedCount(o) === 1 ? '1 linked record' : `${linkedCount(o)} linked records`}</Link>
      </div>
    </div>
  );
}
