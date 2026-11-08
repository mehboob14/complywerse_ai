'use client';

// The framework journey (/frameworks/[id]): a thin shell. The page itself is _workspace/JourneyWorkspace.tsx (head, tabs, the requirement
// machinery) with one file per tab beside it; the numbers and the tab rules are src/lib/journeyModel.ts. Every address keeps working:
// ?tab=<tab> (including the old names, see TAB_ALIASES) and ?req=<requirement>.
import { useParams } from 'next/navigation';
import JourneyWorkspace from './_workspace/JourneyWorkspace';

export default function CertificationJourneyPage() {
  const params = useParams();
  return <JourneyWorkspace journeyId={parseInt(String(params?.id ?? ''), 10)} />;
}
