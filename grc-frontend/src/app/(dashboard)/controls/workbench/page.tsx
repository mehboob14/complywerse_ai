// The Controls Workbench (a split master/detail over one framework's controls) was a second way into the Catalog with its own testing screens. The address stays alive and forwards to /controls with the query string it came with (Next answers the redirect; nothing renders). Nothing linked to it except its twin, so the Catalog is the one place for a framework's controls (/controls?framework=<id>). The page's source stays in the git history.
import { redirect } from 'next/navigation';
import { forwardTo, type SearchParams } from '@/lib/forwardTo';

export default function Forward({ searchParams }: { searchParams?: SearchParams }) {
  redirect(forwardTo('/controls', searchParams));
}
