// /compliance/assessments/approvals (Pending Approvals): the evidence waiting for a decision is the "Waiting for me" view of All assessments now, and it is decided in Needs my action (the decision
// dialog there sends the same request this page did, POST /compliance/assessments/evidence/<id>/approval). Library evidence waiting for review is decided in the Evidence Library, which
// has Approve on it. The top bar's Pending approvals menu and the inbox still link here (#approval-compliance-<id>), so this forwards.
import { redirect } from 'next/navigation';
import { APPROVALS } from '../../../assessments/_forward/forwardModel';

export default function PendingApprovalsForward() {
  redirect(APPROVALS);
}
