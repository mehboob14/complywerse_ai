'use client';

// The drawer of one vendor in the register: what a person needs to decide the next step without leaving the list (where it stands, who owns it, what it waits on, where it is in its
// lifecycle). Everything else, and every change, is on the vendor's own page; the lean row is all this reads, so there is nothing to wait for or to fail.
import { Button, Fact, FactList, PersonChip, StatusPill } from '@/components/ui/ds';
import { formatCount, formatDate, formatRelative, UNASSIGNED } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { piiWord, stageProgress, subline, websiteHref, type VendorRow } from '../../_lib/vendorRegisterDef';
import { ClassPill, GradePill, NextStep, ReviewDate, StatusWord, TierPill } from './VendorCells';

const MUTED = 'text-ds-fg-muted';

export function VendorDetail({ v, now }: { v: VendorRow; now: Date }) {
  const life = v.lifecycle;
  const site = websiteHref(v.website);
  const findings = life ? (life.open_findings > 0 ? `${formatCount(life.open_findings)} open${life.open_critical > 0 ? `, ${formatCount(life.open_critical)} critical` : ''}` : 'None open') : null;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><TierPill v={v} /><StatusWord v={v} />{v.grade && <GradePill v={v} />}</div>
      {subline(v) && <p className={`text-ds-body ${MUTED}`}>{subline(v)}</p>}
      <FactList min={150}>
        <Fact label="Next step">
          <span className="flex flex-wrap items-center gap-[8px]">
            <NextStep v={v} />
            {v.next_action?.link && !v.archived_at && <Button size="sm" variant="link" href={v.next_action.link}>Go there</Button>}
          </span>
        </Fact>
        <Fact label="Business owner" empty={UNASSIGNED}>{v.owner ? <PersonChip name={v.owner.full_name} /> : null}</Fact>
        <Fact label="Business unit">{v.business_unit?.name}</Fact>
        <Fact label="Next review">{v.next_reassessment_date ? <ReviewDate v={v} now={now} /> : null}</Fact>
        <Fact label="Lifecycle">{life ? stageProgress(life.stage) : 'Not started'}</Fact>
        <Fact label="Residual risk">{life?.residual_rating ? <StatusPill size="sm" {...statusPill(vendorTier, life.residual_rating)} /> : null}</Fact>
        <Fact label="Findings">{findings}</Fact>
        <Fact label="Personal data">{({ yes: 'Holds personal data', no: 'Holds none' } as Record<string, string>)[piiWord(v)]}</Fact>
        <Fact label="Data classification">{v.data_classification ? <ClassPill v={v} /> : null}</Fact>
        <Fact label="Contract ends">{v.contract_end_date ? `${formatDate(v.contract_end_date, { calendar: true })} (${formatRelative(v.contract_end_date, now, { calendar: true })})` : null}</Fact>
        <Fact label="Annual value">{typeof v.contract_value === 'number' ? formatCount(v.contract_value) : null}</Fact>
        <Fact label="Website">{site ? <a href={site} target="_blank" rel="noopener noreferrer" className="text-ds-primary-text underline [overflow-wrap:anywhere]">{v.website}</a> : null}</Fact>
      </FactList>
    </div>
  );
}
