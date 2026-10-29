'use client';

// Findings tab of the vendor record. Owner: B5. (Stub; the build fills it.)
import type { TabProps } from './tabProps';

export default function FindingsTab({ vendorId }: TabProps) {
  return <div data-vendor={vendorId} />;
}
