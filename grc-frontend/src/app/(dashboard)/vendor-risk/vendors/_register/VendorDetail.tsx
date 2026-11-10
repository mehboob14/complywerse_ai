'use client';

// The drawer of one vendor in the register: what a person needs to decide the next step without leaving the list (where it stands, who owns it, what it waits on, where it is in its
// lifecycle). Everything else, and every change, is on the vendor's own page; the lean row is all this reads, so there is nothing to wait for or to fail.
import { Button, Fact, FactList, PersonChip, StatusPill } from '@/components/ui/ds';
import { formatCount, formatDate, formatRelative, UNASSIGNED } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { vendorTier } from '@/lib/statuses/vendor';
import { piiWord, stageProgress, websiteHref, type VendorRow } from '../../_lib/vendorRegisterDef';
import { ClassPill, GradePill, NextStep, ReviewDate, StatusWord, TierPill } from './VendorCells';

export function VendorDetail({ v, now }: { v: VendorRow; now: Date }) {
  const life = v.lifecycle;
  const site = websiteHref(v.website);
  const pii = ({ yes: 'Holds personal data', no: 'Holds none' } as Record<string, string | undefined>)[piiWord(v)];
  const findings = life ? (life.open_findings > 0 ? `${formatCount(life.open_findings)} open${life.open_critical > 0 ? `, ${formatCount(life.open_critical)} critical` : ''}` : 'None open') : null;
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><TierPill v={v} /><StatusWord v={v} />{v.grade && <GradePill v={v} />}</div>
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
        {life?.residual_rating && <Fact label="Residual risk"><StatusPill size="sm" {...statusPill(vendorTier, life.residual_rating)} /></Fact>}
        {findings && <Fact label="Findings">{findings}</Fact>}
        {pii && <Fact label="Personal data">{pii}</Fact>}
        {v.data_classification && <Fact label="Data classification"><ClassPill v={v} /></Fact>}
        {v.contract_end_date && <Fact label="Contract ends">{`${formatDate(v.contract_end_date, { calendar: true })} (${formatRelative(v.contract_end_date, now, { calendar: true })})`}</Fact>}
        {typeof v.contract_value === 'number' && <Fact label="Annual value">{formatCount(v.contract_value)}</Fact>}
        {site && <Fact label="Website"><a href={site} target="_blank" rel="noopener noreferrer" className="text-ds-primary-text underline [overflow-wrap:anywhere]">{v.website}</a></Fact>}
      </FactList>
    </div>
  );
}
