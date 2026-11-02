'use client';

// This page was taken out of the module; an old link or bookmark lands on the Overview.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function RemovedPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/vendor-risk'); }, [router]);
  return <p className="text-sm text-slate-600">This page is gone. <Link href="/vendor-risk" className="font-medium text-primary-700 hover:underline">Go to the Overview</Link>.</p>;
}
