'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui';

/** Legacy attestations hub → Documents › Attestation. */
export default function LegacyAttestationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/governance/documents/attestation');
  }, [router]);
  return <PageLoader className="h-64" />;
}
