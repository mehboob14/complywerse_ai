// /compliance/assessments (the Assessment Control Center): its 19 tabs are the kinds on Assessments > Types now, and the uploads of Internal Audit, Maturity Model, Standard and CIS workbooks
// are there too. Back links of an assessment, of Pending Approvals and of an evidence item still land here, so it forwards.
import { redirect } from 'next/navigation';
import { CONTROL_CENTER } from '../../assessments/_forward/forwardModel';

export default function ControlCenterForward() {
  redirect(CONTROL_CENTER);
}
