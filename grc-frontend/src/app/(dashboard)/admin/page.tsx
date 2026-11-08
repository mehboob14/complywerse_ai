import { redirect } from 'next/navigation';
import { legacyTarget } from '@/lib/adminSections';

// /admin used to be a host with 13 tabs (?tab=users …). Each tab is a page of its own now (lib/adminSections.ts); this address only forwards, so every
// old link, bookmark and sidebar deep link still lands where it meant to, with the rest of its query (?stage=, ?connector=, ?provider=) kept.
export default function AdministrationAddress({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  redirect(legacyTarget(searchParams).href);
}
