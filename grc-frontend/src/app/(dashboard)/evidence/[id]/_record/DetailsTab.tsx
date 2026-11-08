'use client';

// The Details tab: what the file is (its description, who uploaded and owns it, when it was collected and how long it is valid, where it came from) and the review trail, who did what and
// when, with the reviewer's note in full. Names come from the people list; where it could not be read the dates stand alone.
import { ClampedText, Fact, FactList, Notice, SectionCard } from '@/components/ui/ds';
import { formatDate, formatDateTime } from '@/lib/format';
import { typeLabel } from '../../_workspace/evidenceModel';
import { trailOf } from './recordModel';
import type { EvidenceDetail } from './recordTypes';

const MUTED = 'text-ds-fg-muted';

export function DetailsTab({ evidence, nameOf, sentBack }: { evidence: EvidenceDetail; nameOf: (id: number | null | undefined) => string | null; sentBack: string | null }) {
  const trail = trailOf(evidence, sentBack, nameOf);
  return (
    <div className="flex flex-col gap-[16px]">
      <SectionCard id="about" title="About this file">
        <FactList min={200}>
          <Fact label="Description" empty="No description">{evidence.description ? <ClampedText text={evidence.description} lines={6} /> : null}</Fact>
          <Fact label="Type">{typeLabel(evidence.evidence_type)}</Fact>
          <Fact label="Uploaded by" empty="Unknown">{evidence.uploader_name}</Fact>
          <Fact label="Uploaded">{formatDateTime(evidence.uploaded_at)}</Fact>
          <Fact label="Owner" empty="Unassigned">{evidence.owner_name}</Fact>
          <Fact label="Collected" empty="Not set">{evidence.collection_date ? formatDate(evidence.collection_date, { calendar: true }) : null}</Fact>
          <Fact label="Valid for" empty="Not set">{evidence.validity_period_days ? `${evidence.validity_period_days} ${evidence.validity_period_days === 1 ? 'day' : 'days'}` : null}</Fact>
          <Fact label="Valid until" empty="Not set">{evidence.expiry_date ? formatDate(evidence.expiry_date, { calendar: true }) : null}</Fact>
          <Fact label="Source system" empty="Not set">{evidence.source_system}</Fact>
        </FactList>
      </SectionCard>

      <SectionCard id="trail" title="Review trail">
        <div className="flex flex-col gap-[12px]">
          {evidence.review_comments && !sentBack && <Notice tone="info" title="The reviewer's note">{evidence.review_comments}</Notice>}
          {trail.length === 0 ? (
            <p className={`text-ds-body ${MUTED}`}>Nobody has reviewed this file yet.</p>
          ) : (
            <ol className="m-0 list-none p-0">
              {trail.map((t) => (
                <li key={t.label} className="flex flex-wrap items-baseline justify-between gap-x-[12px] gap-y-[2px] border-b border-ds-border py-[8px] first:pt-0 last:border-b-0 last:pb-0">
                  <span className="text-ds-body font-[500] text-ds-fg">{t.label}{t.by ? ` by ${t.by}` : ''}</span>
                  <span className={`text-ds-label ${MUTED}`}>{formatDateTime(t.at)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
