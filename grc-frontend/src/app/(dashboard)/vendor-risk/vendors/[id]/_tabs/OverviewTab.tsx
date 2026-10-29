'use client';

// Overview tab of the vendor record. Owner: B2. (Stub; the build fills it.)
import type { TabProps } from './tabProps';

export default function OverviewTab({ vendorId }: TabProps) {
  return <div data-vendor={vendorId} />;
}
