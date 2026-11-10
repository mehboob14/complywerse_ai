'use client';

// The lifecycle board that lived here is the Board view of the Vendors register now (every vendor by stage, with the register's filters and the vendor's drawer). An old link or
// bookmark lands there, on the vendors whose assessment has started, as the old page opened.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function VendorAssessmentsForward() {
  const router = useRouter();
  useEffect(() => { router.replace('/vendor-risk/vendors?view=board&quick=lifecycle'); }, [router]);
  return <p className="text-ds-body text-ds-fg-muted">The vendor board is now part of the register. <Link href="/vendor-risk/vendors?view=board&quick=lifecycle" className="font-[500] text-ds-primary-text underline">Open the board</Link>.</p>;
}
