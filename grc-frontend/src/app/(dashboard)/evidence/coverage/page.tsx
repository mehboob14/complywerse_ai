import { redirect } from 'next/navigation';

// The old Evidence Coverage Dashboard (nothing linked to it) is the Insights tab of Evidence Management now: coverage by framework, what is lapsed or expiring, what is rated low.
// A bookmark or a typed address lands there.
export default function EvidenceCoverageForward() {
  redirect('/evidence?view=insights');
}
