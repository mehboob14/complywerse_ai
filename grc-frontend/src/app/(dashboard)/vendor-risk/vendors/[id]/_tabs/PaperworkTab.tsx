'use client';

// Paperwork tab of the vendor record. Owner: B2.
// In Verity's order: documents (coverage, renewal), assurance reports (SOC reviews), contracts, service levels, then the subprocessors
// that used to sit under Dependencies.
import ContractsPanel from '../_tpra/ContractsPanel';
import PaperworkPanel from '../_tpra/PaperworkPanel';
import SlaPanel from '../_tpra/SlaPanel';
import SubprocessorsPanel from '../_record/SubprocessorsPanel';
import type { TabProps } from './tabProps';

export default function PaperworkTab({ vendorId }: TabProps) {
  return (
    <div className="space-y-5">
      <PaperworkPanel vendorId={vendorId} sections={['documents']} />
      <PaperworkPanel vendorId={vendorId} sections={['soc']} />
      <ContractsPanel vendorId={vendorId} framed />
      <SlaPanel vendorId={vendorId} />
      <SubprocessorsPanel vendorId={vendorId} />
    </div>
  );
}
