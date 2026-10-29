'use client';

// Monitoring tab of the vendor record. Owner: B2. (Stub; the build fills it.)
import type { TabProps } from './tabProps';

export default function MonitoringTab({ vendorId }: TabProps) {
  return <div data-vendor={vendorId} />;
}
