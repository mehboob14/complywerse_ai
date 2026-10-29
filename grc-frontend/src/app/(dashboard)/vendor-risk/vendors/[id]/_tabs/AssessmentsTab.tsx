'use client';

// Assessments tab of the vendor record. Owner: B4. (Stub; the build fills it.)
import type { TabProps } from './tabProps';

export default function AssessmentsTab({ vendorId }: TabProps) {
  return <div data-vendor={vendorId} />;
}
