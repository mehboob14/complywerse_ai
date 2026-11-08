'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Drills: the register of drills and invocations on the facet explorer, with a Board. Everything is in _drills/DrillsRegister.tsx; the page is its address.
import { DrillsRegister } from '../_drills/DrillsRegister';

export default function BcmDrillsPage() {
  return <DrillsRegister />;
}
