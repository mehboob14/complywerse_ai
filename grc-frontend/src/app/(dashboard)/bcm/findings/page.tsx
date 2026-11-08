'use client';

export const dynamic = 'force-dynamic';

// Business Continuity > Findings: the register of every finding of every drill, with who fixes it and by when. Everything is in _findings/FindingsRegister.tsx; the page is its address.
import { FindingsRegister } from '../_findings/FindingsRegister';

export default function BcmFindingsPage() {
  return <FindingsRegister />;
}
