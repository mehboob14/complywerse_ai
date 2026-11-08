'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Plans: the register of continuity plans on the facet explorer. Everything is in _plans/PlansRegister.tsx; the page is its address.
import { PlansRegister } from '../_plans/PlansRegister';

export default function BcmPlansPage() {
  return <PlansRegister />;
}
