'use client';

// The registers (the old "Custom Templates") are the second kind of the Templates library now. This address stays alive for bookmarks and links: it sends the person there, and the old
// ?tab=assignments (the My Assignments tab) lands on the "Assigned to me" card of the same page.
import { Suspense, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

const REGISTERS = '/erm/rcsa/templates?kind=registers';

function Go() {
  const router = useRouter();
  const mine = useSearchParams()?.get('tab') === 'assignments';
  const to = mine ? `${REGISTERS}#assigned-to-me` : REGISTERS;
  useEffect(() => { router.replace(to); }, [router, to]);
  return <p className="text-ds-body text-ds-fg-muted">Taking you to the registers. <Link href={to} className="text-ds-primary-text underline">Go there now</Link></p>;
}

export default function CustomTemplatesRedirect() {
  return <Suspense fallback={null}><Go /></Suspense>;
}
