// The Breach alerts page became the Alerts register (Monitoring, the first tab). Every address that pointed here keeps working: e-mails, reminders and the Attention queue link to
// /vendor-risk/alerts?alert=<id>, which opens that alert in the register (?id=<id>); any other param is kept.
import { redirect } from 'next/navigation';
import { registerAddress } from '../_alerts/alertModel';

export default function AlertsForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((v) => { if (v !== undefined) query.append(key, v); }));
  const next = registerAddress(query.toString()) ?? query.toString();
  redirect(next ? `/vendor-risk/monitoring?${next}` : '/vendor-risk/monitoring');
}
