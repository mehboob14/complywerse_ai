// /nca[?tab=]: the NCA hub (its own Overview with four drill-downs, the DCC tool and the vulnerability, audit plan and risk registers) is the NCA part of Assessments now. The Overview forwards to
// All assessments filtered to NCA; a tab forwards to that workbook's assessment (to Types, where it is uploaded, when there is none). The workbook screens themselves (DccToolTab,
// NcaRegisterTab) stay in components/compliance for the lenses of the assessment page to take over.
import { redirect } from 'next/navigation';
import { FormatForward } from '../assessments/_forward/FormatForward';
import { ncaPlan } from '../assessments/_forward/forwardModel';

export const dynamic = 'force-dynamic';

export default function NcaForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const tab = searchParams?.tab;
  const plan = ncaPlan(Array.isArray(tab) ? tab[0] : tab);
  if ('go' in plan) redirect(plan.go);
  return <FormatForward format={plan.resolve} orElse={plan.orElse} />;
}
