'use client';

// Monitoring tab of the vendor record. Owner: B2.
// The reassessment clock, the signals (the Signals panel is B5a's), what the internet sees of the vendor (outside-in), and incidents.
import IncidentsPanel from '../_record/IncidentsPanel';
import ReassessmentClock from '../_record/ReassessmentClock';
import Section from '../_record/Section';
import OutsideInPanel from '../_tpra/OutsideInPanel';
import SignalsPanel from '../_tpra/SignalsPanel';
import type { TabProps } from './tabProps';

export default function MonitoringTab({ vendorId, vendor }: TabProps) {
  return (
    <div className="space-y-[20px]">
      <ReassessmentClock vendorId={vendorId} vendor={vendor} />
      <Section title="Signals" info="Breach, rating, financial, service-level and certificate signals. A breach, or any high or critical one, opens a new reassessment.">
        <SignalsPanel vendorId={vendorId} />
      </Section>
      <Section title="Outside-in" info="The vendor's websites and domains as the internet sees them: the score its findings earn, the hosts, waivers and ratings.">
        <OutsideInPanel vendorId={vendorId} />
      </Section>
      <IncidentsPanel vendorId={vendorId} />
    </div>
  );
}
