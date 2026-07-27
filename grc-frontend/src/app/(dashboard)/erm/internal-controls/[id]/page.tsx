'use client';

/**
 * Internal Control detail has moved into the unified Control Library workbench.
 * Redirect to the library (open the control from there).
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InternalControlDetailRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/controls'); }, [router]);
  return null;
}
