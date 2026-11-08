// /assessments/<key>: the old type pages (the sidebar's DPIA / PIA, Saudi PDPL and Digital Operations Maturity, the KPI report link of the Performance Overview, the typed keys). One workbook
// goes to its assessment, a kind made per application to the register of that kind, and the NCA key to the organization's DCC workbook or the NCA workspace: forwardModel.ts holds the rules
// (a kind that is one workbook is looked up, because where it goes depends on how many there are).
import { redirect } from 'next/navigation';
import { FormatForward } from '../_forward/FormatForward';
import { planForKey } from '../_forward/forwardModel';

export const dynamic = 'force-dynamic';

export default function AssessmentTypeForward({ params }: { params: { framework: string } }) {
  const plan = planForKey(params.framework);
  if ('go' in plan) redirect(plan.go);
  return <FormatForward format={plan.resolve} orElse={plan.orElse} />;
}
