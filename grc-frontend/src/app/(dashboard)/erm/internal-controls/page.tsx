'use client';

/**
 * Internal Control has been merged into the unified Control Library workbench.
 * This route now redirects there (internal/risk-sourced controls are worked in
 * the library, filtered by source = Internal / Risk).
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function InternalControlRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace('/controls'); }, [router]);
  return null;
}
