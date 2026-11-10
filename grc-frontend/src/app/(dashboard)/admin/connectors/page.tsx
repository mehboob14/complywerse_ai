import { redirect } from 'next/navigation';
import { legacyTarget } from '@/lib/adminSections';

// Business tools (service desk, monitoring, collaboration, ratings …) are a kind of Administration > Connected systems now. The vendor pages and a vulnerability's service-desk panel still link
// here ("Admin > Connectors"); this address only forwards, keeping the rest of the query.
export default function ConnectorsAddress({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(legacyTarget({ ...searchParams, tab: 'connectors' }).href);
}
