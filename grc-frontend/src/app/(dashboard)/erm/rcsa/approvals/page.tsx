// Approvals are part of the Worklist ("To review"): this address keeps working and lands on that view.
import { redirect } from 'next/navigation';

export default function RcsaApprovalsRedirect() {
  redirect('/erm/rcsa?show=review');
}
