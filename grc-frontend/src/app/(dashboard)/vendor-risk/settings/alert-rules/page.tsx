'use client';

// The Alert rules page moved to Policy (its Alert rules section); the old address still leads there. A client forward, so the #alert-rules anchor travels with it.
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AlertRulesMovedPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/vendor-risk/policy#alert-rules'); }, [router]);
  return (
    <p className="text-ds-body text-ds-fg-body">
      Alert rules moved to <Link href="/vendor-risk/policy#alert-rules" className="font-[500] text-ds-primary-text underline">Policy</Link>.
    </p>
  );
}
