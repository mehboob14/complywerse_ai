import { redirect } from 'next/navigation';
import { legacyTarget } from '@/lib/adminSections';

// The vulnerability scanner connections are a kind of Administration > Connected systems now. The older scanner dashboard and the connect wizard still link here; this address only forwards.
export default function ScannerConnectionsAddress({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(legacyTarget({ ...searchParams, tab: 'integrations' }).href);
}
