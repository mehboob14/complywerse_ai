// The old Risk Register dashboard is the register's Insights view now.
import { redirect } from 'next/navigation';

export default function RiskRegisterDashboardRedirect() {
  redirect('/erm/risks?view=insights');
}
