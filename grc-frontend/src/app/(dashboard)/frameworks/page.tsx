'use client';

// Compliance Management > Frameworks: the hub. One page, two registers (?tab=journeys, the plain address, and ?tab=library) and the Onboarding page beside them on the strip. The heading, the posture,
// the facet explorer and the drawer are ./_hub (FrameworksHub); the old Dashboard and Manage Frameworks tabs, which drew the same journeys twice, are gone.
import { FrameworksHub } from './_hub/FrameworksHub';

export default function FrameworksPage() {
  return <FrameworksHub />;
}
