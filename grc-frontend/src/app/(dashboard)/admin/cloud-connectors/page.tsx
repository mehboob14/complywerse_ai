import { redirect } from 'next/navigation';
import { legacyTarget } from '@/lib/adminSections';

// Cloud security connections are a kind of Administration > Connected systems now. This address only forwards, keeping the rest of the query (?provider= opens that provider's connect form).
export default function CloudConnectorsAddress({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(legacyTarget({ ...searchParams, tab: 'cloud-connectors' }).href);
}
