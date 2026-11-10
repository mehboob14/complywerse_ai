// The Vendor Exchange is the Shared tab of Questionnaires. Every address that pointed here keeps working: /vendor-risk/exchange (a bookmark, the old Insights tab) opens that tab, and any param it came
// with is kept.
import { redirect } from 'next/navigation';
import { exchangeQuery } from '../_lib/questionnaires/hubModel';

export default function ExchangeForward({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = new URLSearchParams();
  Object.entries(searchParams ?? {}).forEach(([key, value]) => (Array.isArray(value) ? value : [value]).forEach((v) => { if (v !== undefined) query.append(key, v); }));
  redirect(`/vendor-risk/questionnaires?${exchangeQuery(query.toString())}`);
}
