// An approval is the unit's page now (the answers, the history and the decision bar are one screen): this address keeps working and lands on it.
import { redirect } from 'next/navigation';

export default function RcsaApprovalRedirect({ params }: { params: { id: string } }) {
  redirect(/^\d+$/.test(params.id) ? `/erm/rcsa/assessments/${params.id}` : '/erm/rcsa?show=review');
}
