'use client';

// Lifecycle tab of the vendor record. Owner: B3. (Stub; the build fills it.)
import type { TabProps } from './tabProps';

export default function LifecycleTab({ vendorId }: TabProps) {
  return <div data-vendor={vendorId} />;
}
