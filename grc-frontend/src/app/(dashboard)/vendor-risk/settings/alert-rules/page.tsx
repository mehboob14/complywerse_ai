'use client';

// The Alert rules page moved to Policy (its Alert rules section); the old address still leads there.

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AlertRulesMovedPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/vendor-risk/policy#alert-rules'); }, [router]);
  return (
    <p className="text-sm text-slate-600">
      Alert rules moved to <Link href="/vendor-risk/policy#alert-rules" className="font-medium text-primary-700 hover:underline">Policy</Link>.
    </p>
  );
}
